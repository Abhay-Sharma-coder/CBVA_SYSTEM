# Phase 1 handoff

Foundation for CBVA Workspace. Everything below has been run and verified; where
a number appears it was measured, not estimated.

---

## 1. Getting it running

```bash
cp .env.example .env.local     # fill in both connection strings
npm install
npm run db:migrate             # applies drizzle/ to the database
npm run seed                   # 141 desks, 141 people, 45 working days of bookings
npm run dev                    # http://localhost:3000
```

Two connection strings are required and they are not interchangeable:

| Variable | Endpoint | Used by |
|---|---|---|
| `DATABASE_URL` | Neon **pooled** (`-pooler` host) | The Next.js runtime |
| `DATABASE_URL_UNPOOLED` | Neon **direct** | drizzle-kit, seed, Vitest |

PgBouncer transaction pooling breaks DDL sequencing and makes the
two-parallel-transaction tests non-deterministic — hence the split (ADR-001).

`APP_MODE=demo|production` selects the adapter implementations.

### All commands

```
npm run dev / build / start
npm run typecheck     tsc --noEmit
npm run lint
npm run db:reset      DROP SCHEMA public CASCADE, then recreate — destructive
npm run db:migrate
npm run db:generate   drizzle-kit generate (see the warning in §3)
npm run db:studio
npm run seed          idempotent; refuses to run with APP_MODE=production
npm test              vitest — includes the constraint and concurrency proofs
npm run e2e           playwright
```

---

## 2. What exists

**Stack, all pinned exactly** — Next 15.5.25 / React 19.1 / TS 5.9 strict,
Tailwind v4, Drizzle 0.44 + `pg`, Zustand 5, TanStack Query 5, Zod 4,
motion 12 (`motion/react`), date-fns 4, Vitest 3, Playwright 1.56.
three 0.182 / R3F **9**.7 / drei 10.7 installed now — they resolve against
React 19 with no peer warnings, so Phase 4 will not be a surprise.

**Design system** — the whole palette is one `:root` block in
`src/app/globals.css`, mapped through Tailwind v4 `@theme`. Radius capped at 4px
(no larger token exists), hairline borders, no gradients or drop shadows, and no
gold button variant. Three fonts via `next/font`, each with one job.

**Seat status vocabulary** — seven statuses in
`src/components/seat/seat-status.ts`, rendered by `SeatSwatch`. Each carries a
border treatment and glyph as well as a colour. `/styleguide` shows all seven
normally **and desaturated side by side**; that comparison is the acceptance
test, and it is where Phase 2 should look before drawing anything.

**App shell** — CBVA serif wordmark, nav (Floor Map / My Bookings / Meeting
Rooms / Admin, the last gated on `is_admin`), demo role switcher, and a clock
readout that shows the **shared** clock with a badge when it is offset.
`/floor`, `/bookings`, `/rooms`, `/admin` are stubs naming the phase that fills
them in. `/styleguide` is complete.

**Not built** (by design): any booking action, the floor plan, the auto-release
job, notifications, analytics.

---

## 3. Schema as built

12 tables, `src/lib/db/schema.ts`, migrations in `drizzle/`.

```
users            id, email (unique), display_name, grade, team, seat_mode,
                 fixed_seat_id → seats, is_admin, is_active, created_at
floors           id, number, name, plan_asset_key, is_active
zones            id, floor_id, code, display_name, sort_order   (unique floor+code)
seats            id, zone_id, floor_id, seat_code (unique), bay, plan_x, plan_y,
                 rotation_deg, seat_type, status, assigned_user_id, amenities,
                 active_from, active_to
bookings         id, seat_id, booking_date (DATE), slot, starts_at, ends_at,
                 booked_by_user_id, occupant_user_id, status, source,
                 checked_in_at, released_at, cancelled_at, created_at, updated_at
meeting_rooms    id, floor_id, name (unique), capacity, amenities,
                 outlook_resource_email, is_bookable
room_bookings    id, room_id, starts_at, ends_at, organiser_user_id, title,
                 status, calendar_event_id, sync_status, created_at
badge_events     id, user_id, swiped_at, reader_id, raw
notification_log id, kind, booking_id, room_booking_id, recipient_email,
                 subject, body, channel, status, attempts, sent_at, error
holidays         id, holiday_date (unique), name
settings         id, booking_window_days, slot_definitions, auto_release_minutes,
                 cutoff_minutes, timezone, demo_offset_seconds     ← singleton
audit_log        id, actor_user_id, entity, entity_id, action, before, after, at
```

Enums are Postgres enums: `grade`, `seat_mode`, `seat_type`, `seat_status`,
`slot`, `booking_status`, `booking_source`, `room_booking_status`, `sync_status`,
`notification_status`.

**Two deltas from the brief**, both deliberate:
- `settings.demo_offset_seconds` added — the brief describes the shared demo
  offset but does not name a column for it (ADR-005).
- `room_bookings.status` is its own enum (`confirmed`/`cancelled`/`completed`)
  rather than reusing the booking status enum; desk statuses like
  `auto_released` are meaningless for a room.

### The two constraints — `drizzle/0001_constraints.sql`

Hand-written, because Drizzle cannot express either, and **in the database
because an app-level check has a race window**.

```sql
CREATE UNIQUE INDEX seat_slot_unique ON bookings (seat_id, booking_date, slot)
  WHERE status IN ('confirmed','checked_in');

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE room_bookings ADD CONSTRAINT no_room_overlap
  EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status = 'confirmed');
```

Plus, added on top (ADR-004): `CHECK (ends_at > starts_at)` on both booking
tables — without it a zero-length range overlaps nothing and slips straight past
the exclusion constraint; `seats_assigned_user_unique`; `settings_singleton`;
and the `users.fixed_seat_id → seats.id` FK that the circular `users`↔`seats`
reference forced out of the generated migration.

> ⚠️ **`0001_constraints.sql` is hand-registered** in
> `drizzle/meta/_journal.json` with a hand-copied snapshot. If you run
> `npm run db:generate`, check that entry survives before migrating.

**Do not add an app-level "is this seat free?" pre-check.** Phase 3 should treat
`23505` and `23P01` as ordinary user-facing outcomes — "someone just took that
seat" — not as 500s.

---

## 4. Where the important things live

| Thing | File |
|---|---|
| **Clock** | `src/lib/clock.ts` — `Clock`, `SystemClock`, `DemoClock`, `getClock()`, `advanceDemoClock()` |
| Clock over HTTP | `src/app/api/clock/route.ts` (`GET` reads, `POST` shifts) |
| Clock lint rule | `eslint.config.mjs` |
| **Adapters** | `src/lib/adapters/` — `types.ts`, `demo.ts`, `production.ts`, `index.ts` |
| The only `APP_MODE` branch | `src/lib/adapters/index.ts` |
| Slot derivation | `src/lib/slots.ts` — `deriveSlotBounds()`, the only place `starts_at`/`ends_at` are computed |
| Env parsing | `src/lib/config.ts` — nothing reads `process.env` directly |
| DB pools | `src/lib/db/index.ts` — `db()` pooled, `directDb()` direct |
| Seat status vocabulary | `src/components/seat/seat-status.ts` |
| Seed inventory | `src/lib/seed-data/inventory.ts` |
| Constraint proofs | `tests/integration/` |

### The clock rule

Business logic never calls `new Date()` or `Date.now()`. ESLint **errors** on
both outside `src/lib/clock.ts`, `scripts/`, `tests/`, `e2e/` — verified by
adding a probe file with both violations, watching it fail, and removing it.

The demo offset lives in `settings.demo_offset_seconds` so server and client
agree and it survives a refresh. Client code reads "now" from `/api/clock`,
never from the browser's `Date`.

The payoff, for Phase 3: shifting the demo clock two hours makes the **real**
auto-release job run the **real** rule and really release the seat. Build the
job against `getClock()` and the demo comes free.

---

## 5. Seed data

Deterministic (fixed-seed mulberry32) and idempotent — verified by running it
twice from an empty database and getting identical counts.

Reference data is upserted on natural keys via UUID v5 ids. **Bookings are
deleted and regenerated** each run, because the random stream shifts whenever
the generator changes and stale rows then collide with new ones — the room
exclusion constraint caught exactly this during development (ADR-008). The
script refuses to run with `APP_MODE=production`.

Measured output:

| | |
|---|---|
| Seats | 141 (47 fixed, 93 bookable, 1 blocked) |
| People | 141 — 16 partner, 1 director, 22 manager, 32 asst. manager, 62 article, 8 admin |
| Bookings | 6,020 across 45 working days (8 weeks back + 5 days forward) |
| Meeting rooms / bookings | 6 / 310 |
| Holidays | 39 (2026–2027) |

Distribution, measured against the seeded database:

| | Mon | Tue | Wed | Thu | Fri |
|---|---|---|---|---|---|
| % of bookable staff booking | 70% | 84% | 82% | 80% | 71% |

Mon and Fri noticeably lighter, as briefed. No-shows 11.6% (`auto_released` →
`completed_no_show`), user cancellations 8.4%, on-behalf 4.3%. AM-only and
PM-only mixed with full-day pairs. Each person has a preferred bay they return
to ~65% of the time, falling back to any free desk when it is full.

Seat inventory matches the CAD bay schedule exactly; `tests/unit/slots.test.ts`
asserts the reconciliation (141 seats, 141 people, 47 fixed seats for 47
fixed-grade people, 94 bookable seats for 94 people who must book) so it cannot
silently drift.

---

## 6. What is stubbed

| Stub | Where | Blocked on |
|---|---|---|
| Entra ID sign-in | `production.ts` → `EntraAuthProvider` | Tenant app registration. Demo uses the `cbva_role` cookie. |
| Graph `sendMail` | `GraphMailProvider` | `Mail.Send` consent + service account. Demo writes `notification_log`. |
| Graph calendar | `GraphCalendarSync` | Room resource mailboxes — `outlook_resource_email` is null on all 6 rows. |
| Badge feed | `BadgeWebhookCheckInSource` | Vendor and export format unknown. `badge_events` is modelled and empty. |
| Seat coordinates | `scripts/seed.ts` → `buildSeats()` | Phase 2. Temporary grid; CAD source is in `tools/cad/`. |
| `/floor` `/bookings` `/rooms` `/admin` | `src/app/*/page.tsx` | Phases 2, 3, 3, 5. |

Every production stub throws with a TODO naming what to wire — deliberately
loud, so a premature `APP_MODE=production` fails on the first request rather
than quietly losing bookings.

---

## 7. Verification — all run, all green

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `npm run lint` | clean; the clock rule proven to fire against a probe |
| Migrations on an **empty** database | applied cleanly (`db:reset` then `db:migrate`) |
| `npm run seed` twice | identical counts — idempotent |
| `npx vitest run` | **34 passed** |
| `npm run build` | succeeds |
| `npx playwright test` | **12 passed** |
| Screenshots reviewed | `/` and `/styleguide` at 1440×900 and 390×844, opened and read |

The tests that matter:

- **`seat_slot_unique` concurrency** — two separate `pg` sessions, both `BEGIN`,
  both insert the same seat/date/slot. B is asserted to still be *blocked* 300ms
  in (Postgres holds it on A's uncommitted index entry), then fails `23505` the
  moment A commits. Exactly one live booking survives.
- **`no_room_overlap` concurrency** — same shape, failing `23P01`.
- Boundary cases: containment both ways, back-to-back bookings allowed by the
  half-open `[)` bound, cancelled rows ignored, empty and inverted ranges caught
  by the CHECK, and the partial predicate proven on `UPDATE` as well as `INSERT`.

Four real defects were found by screenshotting and reading the result, all
fixed: a hard-coded demo email that no longer existed in the generated roster
(nobody was signed in); role switching updating client components but not the
server-rendered page body (needed `router.refresh()`); a duplicate React key;
and the role switcher's longest option setting the page's intrinsic width and
pushing mobile into horizontal overflow.

Muted text contrast measured in-browser: 7.0:1 and 4.6:1 on paper, both AA.

---

## 8. Open questions

`docs/ASSUMPTIONS.md` has all 15 with file references. The three that block
real use:

1. 🔴 **The HR list.** How do the 54 CAs split Manager / Assistant Manager, and
   who holds an allocated seat? We seeded 22/32, which makes demand (94) exactly
   equal supply (94 bookable desks). If the real split differs, the floor is
   structurally short or long — and *that number is the answer the partners are
   commissioning this tool to produce*. We cannot report it from a figure we
   invented. Need: name, email, grade, team, fixed/bookable.
2. 🔴 **Which physical desks are fixed.** We allocated 47 plausibly (cabins and
   perimeter bays); the drawing does not say. Visibly wrong to anyone from CBVA
   looking at the floor plan.
3. 🔴 **The real meeting rooms** — capacities came from the drawing's pax
   annotations, but the names are entirely ours, and we need the Outlook
   resource mailbox for each before Graph sync can be built.

Also worth resolving before Phase 3: slot boundaries (we guessed 09:00–13:30 /
13:30–19:00), the booking window and cut-off, CBVA's official holiday circular,
and who is permitted to book on behalf of someone else.

---

## 9. Notes for Phase 2

- The CAD source is `tools/cad/09 -R8 - NB -FURNITURE LAYOUT - 12-06-2025.pdf`
  with `extract_floorplan.py` beside it (needs `pip install pymupdf`). It groups
  the 44 CAD layers into walls / furniture / core / text and emits SVG or raw
  JSON geometry. Pre-generated output is in `assets/cad/`.
- Replacing `plan_x`/`plan_y` is a **data migration**, not a schema change — the
  columns are already `numeric` and NOT NULL, keyed by `seat_code`.
- Render seats through `SeatSwatch` / `SEAT_STATUS_TOKENS`. Do not introduce a
  second colour map; the greyscale guarantee only holds if there is one.
- `floors.plan_asset_key` already points at `assets/cad/floor4-walls.svg`.
- Zone C is 66 seats and Zone D is 67, so a naive fit-to-viewport will make the
  passage runs (PA 16, PD 18) unreadably small. Plan for zoom from the start.
