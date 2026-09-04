# CBVA Workspace — read this first

## The product, in one paragraph

CBV & Associates LLP (CBVA) is a Mumbai chartered accountancy firm. They run a
one-day-a-week work-from-home policy, so desks sit empty and they cannot
forecast next-day capacity. Staff at **Assistant Manager grade and below must
book a seat** to come to office; **Manager and above have fixed allocated
seats**. The booking flow is the data collection mechanism. **THE ACTUAL
PRODUCT IS THE OCCUPANCY ANALYTICS**, which partners will use to right-size
desks against headcount. Design every decision with that in mind.

## Phases

1. **Foundation** — repo, design system, schema, adapters, clock, seed ✅ done
2. **CAD geometry pipeline and the interactive 2D floor plan** ✅ done
3. **Booking engine, meeting rooms, auto-release, notifications** ✅ done
4. 3D floor plan view ← next
5. Admin analytics, seat inventory, accessibility pass, deploy

---

## Stack — pinned, do not substitute

Every dependency is pinned to an exact version in `package.json` (no `^`).

| Package | Version | Notes |
|---|---|---|
| next | 15.5.25 | App Router |
| react / react-dom | 19.1.0 | |
| typescript | 5.9.3 | `strict: true` |
| tailwindcss | 4.1.18 | v4 `@theme`, with `@tailwindcss/postcss` |
| drizzle-orm | 0.44.7 | with `pg` (node-postgres), **not** the Neon serverless driver |
| drizzle-kit | 0.31.6 | |
| zustand | 5.0.9 | client UI state only |
| @tanstack/react-query | 5.90.5 | all server state |
| zod | 4.1.13 | every input boundary |
| motion | 12.23.24 | **import from `motion/react`.** Never install or import `framer-motion` directly — it appears in the lockfile only as `motion`'s own transitive dependency |
| date-fns / date-fns-tz | 4.1.0 / 3.2.0 | |
| vitest | 3.2.4 | unit + integration |
| @playwright/test | 1.56.1 | browser verification |
| three | 0.182.0 | Phase 4 |
| @react-three/fiber | 9.7.0 | **v9, not the v10 alpha.** v8 does not work with React 19 |
| @react-three/drei | 10.7.8 | Phase 4 |
| qrcode | 1.5.4 | Phase 3 addition, not a substitution. Renders the per-desk check-in codes as SVG, server-side — see ADR-028 |

Radix primitives, `lucide-react`, `class-variance-authority`, `clsx` and
`tailwind-merge` back the shadcn-style components in `src/components/ui/`.

---

## THE CLOCK RULE

**Never call `new Date()` or `Date.now()` anywhere in business logic.**

`src/lib/clock.ts` exports a `Clock` interface with `now(): Date` and two
implementations:

- `SystemClock` — real time, used in production. The only sanctioned read of the
  system clock in `src/`.
- `DemoClock` — real time plus `settings.demo_offset_seconds`, read from the
  database so the offset is shared between server and client and survives a
  refresh.

`getClock()` selects on `APP_MODE`.

**Why this matters, so it does not get eroded:** the demo has to show the 2-hour
auto-release rule working. With this pattern, an "advance the clock 2 hours"
control shifts the demo clock and the **real** auto-release job runs the **real**
rule against **real** rows and really releases the seat. The demo proves
production behaviour instead of faking it. Every time-dependent test also
becomes deterministic for free.

`eslint.config.mjs` **errors** on `new Date()` and `Date.now()` outside
`src/lib/clock.ts`, `scripts/**`, `tests/**` and `e2e/**`.

Client code reads "now" from `GET /api/clock`, never from the browser's own
`Date`, so client and server never disagree about whether a slot has started.

---

## THE SLOT RULE

**Slots are data, not a type.** `settings.slot_definitions` is an ordered list of
`{key, label, start, end}`; `bookings.slot` is `text`. Seeded as AM 09:00–13:00
and PM 13:00–17:00.

The brief requires that moving CBVA to hourly booking be a settings change and
not a refactor, and a two-value enum makes that impossible — `H09` is not a legal
value. So:

- **Never reintroduce a closed slot union.** `SlotKey` is `string`. A `"AM" |
  "PM"` anywhere is the bug this rule exists to prevent.
- **`deriveSlotBounds()` in `src/lib/slots.ts` is still the only place
  `starts_at`/`ends_at` are computed.** The seed had grown a private second copy;
  it is gone. Do not add a third.
- **Editing slot definitions backfills.** `updateSettings()` recomputes every
  live booking's stored bounds in the same transaction, and refuses a change that
  would orphan a booking whose slot key disappears (ADR-021, closing ADR-007).
- `tests/integration/hourly-slots.test.ts` proves the whole lifecycle works on a
  slot key that did not exist when the code was written. It is the regression
  test for this rule.

---

## THE WRITE RULES

**No app-level "is this seat free?" check exists, and none may be added.** Both
integrity rules are in the database (ADR-003, ADR-022) because a read-then-write
has a race window and two people tapping Book at the same moment is exactly the
case that must not double-book. `23505` and `23P01` are **ordinary outcomes**,
mapped in `src/lib/booking/errors.ts` to sentences a person can act on.

`mapPgError` unwraps `.cause`: Drizzle raises a `DrizzleQueryError` carrying the
driver's error underneath, and reading the top level finds no SQLSTATE at all.
That failure only appears under real concurrency, so it is easy to reintroduce
and hard to notice.

**Every service function takes `db`, `Clock` and actor as arguments.** Not
ceremony: `auth()` reads `next/headers` and throws outside a request, the
concurrency proofs need two sessions on the direct endpoint, and the timing cases
need an injectable clock. Route handlers resolve all three and call in.

**Editing a booking is a cancel-and-rebook inside one transaction**, so a lost
race rolls back and leaves the original booking intact (ADR-023).

**`runAutoRelease` is global by design and takes an optional `onlySeatIds` for
tests only.** A test that drives it from a fixed clock years away will otherwise
settle the entire seeded database — it did exactly that once.

---

## THE NOTIFICATION RULE

**`notification_log` is the outbox, not a log of what a provider already did.**
Messages are rendered and inserted **inside** the booking transaction with
`status = 'queued'`; delivery happens afterwards and its failures are recorded on
the message, never propagated. `MailProvider` is only a transport —
`DemoMailProvider` writes no rows.

So: a committed booking always has its message, a send failure can never roll
back a booking, and the retry path is real rather than decorative.

---

## THE ADAPTER RULES

Four integrations CBVA cannot connect yet. Each has an interface in
`src/lib/adapters/types.ts`, a demo implementation (`demo.ts`) and a production
stub (`production.ts`).

```ts
interface AuthProvider  { currentUser(): Promise<User | null> }
interface MailProvider  { send(msg: OutboundMail): Promise<void> }
interface CalendarSync  { upsert(b: RoomBooking): Promise<string>
                          remove(id: string): Promise<void> }
interface CheckInSource { subscribe(cb: (e: BadgeEvent) => void): void }
```

Rules:

1. **`APP_MODE` is branched on in exactly one file**: `src/lib/adapters/index.ts`.
   If you are writing `if (appMode === ...)` anywhere else, the logic belongs
   behind an adapter.
2. **Booking logic must never know which implementation is live.** Import the
   interface, call `auth()` / `mail()` / `calendar()` / `checkIn()`.
3. Production stubs **throw**, and each TODO names exactly what must be wired
   (Entra ID / MSAL, Graph `sendMail`, Graph `/events`, badge webhook). They
   throw rather than no-op so a premature `APP_MODE=production` fails loudly on
   the first request instead of quietly losing bookings.

Demo behaviour: `AuthProvider` returns the seeded user named by the `cbva_role`
cookie (the role switcher writes it). `MailProvider` writes to
`notification_log` and stops. `CalendarSync` returns a fake `demo-evt-…` id.
`CheckInSource` is driven by a UI button.

---

## THE FLOOR PLAN RULES

**The CAD linework never enters the live DOM.** The wall layer is 8,603 paths
and the furniture layer 49,342. The drawing ships as one baked webp
(`public/floorplan/`); the only interactive nodes are the 141 seats.
`e2e/floor-plan.spec.ts` asserts fewer than 50 SVG paths on the page.

**Seat position is data; 2D versus 3D is a rendering choice.** The signature is
`<FloorPlan seats={FloorPlanSeat[]} mode="2d" ... />`, and Phase 4 adds
`mode="3d"` over the *same* array and the *same* zustand store. Do not build a
second seat pipeline.

**`src/data/floorplan/` is generated and committed.** `npm run build:floorplan`
re-reads the architect's PDF. `seats.json` is the source of truth for seat
geometry: the seed reads it, and `/admin/floor-plan` exports back to it so a
hand correction survives `npm run db:reset` (ADR-017).

**One colour map.** Seats take colour, border treatment and glyph from
`SEAT_STATUS_TOKENS`. The greyscale and colour-vision guarantee proven on
`/styleguide` only holds because there is exactly one vocabulary. Visual status
is derived by `src/lib/seat-visual-status.ts` and nowhere else.

---

## Design tokens

This is a professional services firm, not consumer SaaS.

The **entire palette** is one `:root` block at the top of
`src/app/globals.css`, mapped through Tailwind v4 `@theme`. Swap those values
and the whole product re-skins. Nothing else hard-codes a colour.

```
--navy      #1E2A5A   primary, from their logo
--gold      #D9A34A   accent ONLY
--paper     #FBFAF7   page background
--ink       #14181F   body text
--hairline  #E4E0D9   1px borders
```

**The gold rule.** Gold never exceeds ~5% of pixels and appears exactly three
ways: the active tab/nav underline, a 2px rule on the seat that is yours, and a
single key metric per screen. **Never a large fill, never a primary button.**
There is deliberately no gold `Button` variant.

**Geometry.** Border radius maxes out at 4px (the `@theme` has no radius larger
than that). 1px hairline borders. Generous white space. No gradients, no
glassmorphism, no shadow heavier than a 1px hairline.

**Type.** Three faces, each with one job:
- **Source Serif 4** — page titles only. Echoes their engraved wordmark.
- **Inter** — everything else.
- **JetBrains Mono** — seat codes, bay labels, floor plan annotations only
  (`.seat-code`).

**Seat status** is defined once in `src/components/seat/seat-status.ts` and
rendered by `SeatSwatch`. Seven statuses — available, booked, your booking,
reserved fixed, checked in, auto released, blocked — and **every one carries a
non-colour differentiator** (border style + glyph) so the plan survives
greyscale printing and colour-vision deficiency. `/styleguide` shows them
normally and desaturated side by side; that comparison is the acceptance test.

---

## Folder layout

```
src/
  app/                    layout, page, styleguide/, floor|bookings|rooms|admin/, api/
  components/ui/          Button, primitives (Card, Badge, Input, Tabs, Dialog, Table…)
  components/app-shell/   Wordmark, Header, RoleSwitcher, ClockReadout, session hooks
  components/seat/        seat-status.ts (the vocabulary), SeatSwatch
  lib/clock.ts            THE CLOCK RULE
  lib/config.ts           env parsing via zod; nothing reads process.env directly
  lib/slots.ts            deriveSlotBounds() — the only place starts_at/ends_at are computed
  lib/db/                 index.ts (pools), schema.ts
  lib/adapters/           types.ts, demo.ts, production.ts, index.ts (the only APP_MODE branch)
  components/floor-plan/  FloorPlan (mode 2d|3d), PlanCanvas, SeatMarker, controls,
                          list-view — Phase 4 renders the SAME seat array
  data/floorplan/         GENERATED by npm run build:floorplan, committed.
                          seats.json is the source of truth for seat geometry
  lib/floorplan.ts        typed loaders for the generated geometry
  lib/seat-visual-status.ts  (seat, booking, viewer) -> one of the 7 statuses
  lib/seed-data/          inventory.ts, names.ts, holidays.ts, rng.ts
  lib/store/ui.ts         zustand — client UI state only
  lib/booking/            errors · authorise · rules · service · auto-release · queries · badge
  lib/rooms/              validation (the Zod layer) · service (grid, book, cancel, retry)
  lib/notifications/      kinds · render (HTML templates) · outbox (enqueue + dispatch)
  lib/admin/              settings-service (the slot backfill) · seat-lifecycle
  lib/jobs/run-jobs.ts    auto-release + notification dispatch + calendar retry
  lib/settings.ts         the one reader of the settings singleton
  lib/api.ts              the HTTP boundary: actor, zod, error -> status
  lib/qr.ts               per-desk check-in URLs and SVG codes
  components/booking/     person-picker, edit dialog, the mutation hooks
  components/demo/        demo-panel — every demo affordance, in one place
  instrumentation.ts      + instrumentation-node.ts: the dev job interval
drizzle/                  0000_initial_schema.sql (generated) + 0001_constraints.sql (hand-written)
scripts/                  seed.ts, migrate.ts, reset-db.ts
tests/                    unit/, integration/ (the constraint + concurrency proofs)
e2e/                      Playwright specs and screenshot capture
tools/cad/                source PDF + extract_floorplan.py — Phase 2 input
assets/cad/               generated SVG/PNG — Phase 2 input
docs/                     PROJECT.md, DECISIONS.md, ASSUMPTIONS.md, PHASE-1-HANDOFF.md
```

---

## Database

Neon Postgres 18, ap-southeast-1. **Two connection strings, both required:**

- `DATABASE_URL` — pooled (PgBouncer). The Next.js runtime.
- `DATABASE_URL_UNPOOLED` — direct. Migrations, seed and tests. PgBouncer
  transaction pooling breaks DDL sequencing and makes the two-parallel-transaction
  constraint tests non-deterministic.

**Two rules are enforced by the database, not the app** — see
`drizzle/0001_constraints.sql`. Do not add an app-level pre-check for either;
that reintroduces the race window they exist to close.

```sql
CREATE UNIQUE INDEX seat_slot_unique ON bookings (seat_id, booking_date, slot)
  WHERE status IN ('confirmed','checked_in');

ALTER TABLE room_bookings ADD CONSTRAINT no_room_overlap
  EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status = 'confirmed');
```

## Commands

```
npm run dev          # http://127.0.0.1:8081  (3000 is a busy default)
npm run build:floorplan   # re-read the CAD PDF; outputs are committed
npm run build
npm run typecheck    # tsc --noEmit
npm run lint
npm run db:reset     # drop + recreate public schema (destructive)
npm run db:migrate
npm run seed         # idempotent; refuses to run with APP_MODE=production
npm run jobs:run     # run auto-release / notifications / calendar retry once
npm run db:backfill-slots   # recompute starts_at/ends_at from settings
npm test             # vitest — constraint proofs + the 18 edge cases
npm run e2e          # playwright
```

## Conventions

- Every unconfirmed assumption goes in `docs/ASSUMPTIONS.md` with the file it
  affects. Three questions are open with the client; that file is the list.
- Every architectural choice worth defending goes in `docs/DECISIONS.md`.
- Commit at every meaningful milestone with a message that says *why*.
- Zod validates every input boundary (API routes, env).
- `numeric`/`date` columns come back from `pg` as strings — that is deliberate,
  not a bug to "fix".
- **The e2e suite mutates demo data on purpose** — the walkthrough books,
  cancels and auto-releases real rows. Run `npm run seed` afterwards to restore
  a presentable floor.
- `CRON_SECRET` protects `POST /api/cron/jobs`. Optional in demo, required in
  production, compared in constant time.
