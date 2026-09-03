# Architecture Decision Record

Newest last. Each entry records what was decided, why, and what it costs.

---

## ADR-001 — Two Neon connection strings, pooled and direct

**Decision.** `DATABASE_URL` points at Neon's pooled PgBouncer endpoint and is
used by the Next.js runtime. `DATABASE_URL_UNPOOLED` points at the direct
endpoint and is used by drizzle-kit, the seed script and Vitest.

**Why.** The URL supplied was the pooled one. PgBouncer in transaction mode
hands each statement to whichever backend is free, which breaks DDL sequencing
(`CREATE EXTENSION` in particular) and makes "two transactions racing for the
same row" untestable — the concurrency tests are a Phase 1 acceptance criterion.

**Cost.** Two environment variables instead of one, and a rule to remember.
`src/lib/db/index.ts` exposes `db()` and `directDb()` so the choice is explicit
at the call site rather than ambient.

---

## ADR-002 — `pg` (node-postgres), not `@neondatabase/serverless`

**Decision.** Drizzle runs on node-postgres.

**Why.** The serverless driver multiplexes over HTTP/WebSocket and does not give
long-lived sessions with real `BEGIN`/`COMMIT` semantics. The constraint tests
need two independent sessions holding open transactions against each other.
Correctness proof beats cold-start latency at this stage.

**Cost.** No edge runtime for database routes. Acceptable — this is an internal
tool for one office in one timezone.

**Revisit if** the app is ever deployed to edge functions.

---

## ADR-003 — Both integrity rules live in the database

**Decision.** `seat_slot_unique` (partial unique index) and `no_room_overlap`
(GiST exclusion constraint) are hand-written SQL in
`drizzle/0001_constraints.sql`. **No app-level pre-check exists anywhere.**

**Why.** An application "is this seat free?" check has a race window between the
read and the write. Two people tapping Book at the same moment is exactly the
case that must not double-book, and it is exactly the case a pre-check misses.
Postgres closes the window for free.

Both are **partial**: only `confirmed`/`checked_in` bookings and `confirmed`
room bookings participate. A cancelled booking therefore frees the slot while
its history survives, which analytics depends on — a deleted no-show is a
no-show that never happened.

**Cost.** Drizzle cannot express either, so `0001_constraints.sql` is
hand-written and hand-registered in `drizzle/meta/_journal.json`. Any future
`drizzle-kit generate` must not clobber it. The insert path must handle `23505`
and `23P01` as ordinary user-facing outcomes ("someone just took that seat"),
not as 500s — that is Phase 3's job.

**Proven by** `tests/integration/*.test.ts`, including two concurrent-session
tests that assert the loser blocks and then fails.

---

## ADR-004 — Supporting constraints the brief did not ask for

**Decision.** Added alongside the two required ones:

- `CHECK (ends_at > starts_at)` on both `bookings` and `room_bookings`.
- `seats_assigned_user_unique` — a seat is allocated to at most one person.
- `settings_singleton` — a unique index on `((true))`, so the settings table
  cannot grow a second row.
- `users.fixed_seat_id → seats.id`, added here because `users` and `seats`
  reference each other and one direction has to come after both tables exist.

**Why.** The range check is not decorative: an empty or inverted range
(`starts_at = ends_at`) overlaps nothing by definition and slips straight past
the exclusion constraint. Without the CHECK, a zero-length meeting is a legal
way to double-book a room. The singleton index matters because `DemoClock` reads
`settings` with `LIMIT 1` and would silently pick an arbitrary row.

---

## ADR-005 — The demo clock offset lives in the database

**Decision.** `settings.demo_offset_seconds`, a column the brief did not name.
`DemoClock` takes the offset as a constructor argument and stays synchronous and
pure; `getClock()` reads it server-side, and the browser reads it from
`GET /api/clock`.

**Why.** The offset has to be shared between server and client — otherwise the
server thinks a slot has started and the browser does not — and it has to
survive a page refresh and a server restart. In-memory state fails both.

**Cost.** A database round-trip per `getClock()`, and the offset is global (see
ASSUMPTIONS A10).

---

## ADR-006 — ESLint errors on `new Date()`, rather than a convention

**Decision.** `no-restricted-syntax` errors on zero-arg `new Date()` and
`Date.now()` across `src/**`, `scripts/**` and `tests/**`, with an override for
`src/lib/clock.ts`, `scripts/**`, `tests/**`, `e2e/**`.

**Why.** The clock pattern only works if it is total. One stray `new Date()` in
an auto-release code path silently opts that path out of the demo, and the bug
appears as "the demo does not work" during a partner presentation. A convention
in a document does not survive five phases; a failing lint does.

**Verified.** A probe file containing both violations was added, observed
erroring with the custom messages, and removed.

---

## ADR-007 — `bookings.starts_at`/`ends_at` are stored derived columns

**Decision.** Built as the brief specifies, written from a single
`deriveSlotBounds()` in `src/lib/slots.ts`.

**The concern, stated plainly.** These are derived from `booking_date` + `slot` +
`settings.slot_definitions` at write time. The moment an admin edits a slot
boundary, every historical row silently disagrees with the settings that
supposedly define it — and analytics is the product, so silently wrong history
is the worst failure mode available.

**Why build it anyway.** The auto-release job needs to range-scan
`starts_at` cheaply, and a `timestamptz` index is the right tool. Deriving on
read would make the hot path a per-row timezone computation.

**Mitigation now.** Exactly one function computes them. **Fix in Phase 3:** make
editing `slot_definitions` trigger a backfill migration, or move to a generated
column. Do not add a second copy of the derivation.

---

## ADR-008 — The seed rebuilds bookings rather than upserting them

**Decision.** Reference data (users, seats, zones, rooms, holidays, settings) is
upserted on its natural key via UUID v5 ids. Bookings and room bookings are
**deleted and regenerated** on every run. The script refuses to run when
`APP_MODE=production`.

**Why.** All randomness comes from a fixed-seed PRNG, so the output is
deterministic — but the *stream* shifts whenever the generator changes. During
development, tuning the attendance curve moved every meeting by an hour, and
stale rows from the previous stream collided with the new ones. The room
exclusion constraint caught it, correctly and loudly. Rebuilding makes a re-run
safe both after a code change and when run twice unchanged, which is what
"idempotent" has to mean in practice.

**Cost.** The seed is destructive to booking data. Guarded by the `APP_MODE`
check, and by the fact that no real booking exists yet.

---

## ADR-009 — Deterministic UUID v5 ids for seeded rows

**Decision.** Every seeded row's primary key is `uuidv5(naturalKey, FIXED_NS)` —
`uuidv5("seat|C3-04")`, `uuidv5("user|priya.shah@cbva.in")`.

**Why.** Makes `onConflictDoUpdate` possible on rows whose natural key is not
the primary key, keeps ids stable across re-seeds so a bookmarked URL survives,
and makes the seed diffable.

**Cost.** Seeded ids are guessable. Irrelevant for an internal tool behind SSO;
would matter if these ids were ever capability tokens.

---

## ADR-010 — Seat status is a component, not a colour map

**Decision.** `src/components/seat/seat-status.ts` holds the seven statuses with
their label, description, classes, glyph and screen-reader name.
`SeatSwatch` is the only thing that renders a seat.

**Why.** The brief requires statuses to be distinguishable without colour. That
guarantee is only as good as its weakest render, and Phases 2, 4 and 5 each draw
seats in a different medium (SVG plan, 3D mesh, table cell). One vocabulary,
imported everywhere, is the only way the guarantee survives.

`/styleguide` renders all seven normally **and desaturated, side by side**. That
comparison is the acceptance test — if two become indistinguishable there, the
fix belongs in `seat-status.ts`.

---

## ADR-011 — `motion`, and what `framer-motion` is doing in the lockfile

**Decision.** `motion@12.23.24` is the direct dependency; imports are from
`motion/react`. `framer-motion@12.43.0` appears in `package-lock.json`.

**Why it is there.** `motion` is the renamed successor to `framer-motion` and
re-exports it; the package depends on it internally. Nothing in `src/` imports
`framer-motion`, and it is not a direct dependency. This satisfies the brief's
"do not install framer-motion" — the package cannot be removed without removing
`motion` itself.

---

## ADR-012 — R3F v9 pinned now, three phases early

**Decision.** `three@0.182.0`, `@react-three/fiber@9.7.0`,
`@react-three/drei@10.7.8` installed in Phase 1 despite being unused until
Phase 4.

**Why.** As the brief asked: surface version conflicts today. R3F v8 does not
support React 19 and v10 is alpha, so v9 is the only viable line. Verified: the
three packages install against React 19.1 with no peer warnings and `npm run
build` passes.

**Cost.** ~55 unused packages in `node_modules`. They are not imported, so they
do not reach the client bundle.

---

## ADR-013 — Client state split: TanStack Query vs Zustand

**Decision.** Anything that lives on the server — bookings, seats, the clock,
the session — is TanStack Query. Zustand (`src/lib/store/ui.ts`) holds only
ephemeral UI state: the focused seat, the active slot tab, panel open/closed.

**Why.** The line blurs by default, and once server data is mirrored into
Zustand it starts drifting from the database. Phase 2's floor plan is where that
temptation appears.

**Corollary found in testing:** invalidating the Query cache does **not**
re-render server components. Mutations that change identity or time
(`useSwitchRole`, `useShiftClock`) must also call `router.refresh()`. Switching
role updated the header but not the page body until this was fixed.

---

## ADR-014 — Skills installed

`vercel-labs/agent-skills@web-design-guidelines` (as instructed),
`giuseppe-trisciuoglio/developer-kit@nextjs-app-router`,
`pedronauck/skills@drizzle-postgres`. The web interface guidelines were fetched
and built against directly — hence the skip link, `:focus-visible` rings,
`aria-live` on the role switcher, `tabular-nums` on number columns,
`text-wrap: balance` on headings, `autocomplete`/`spellcheck` on inputs,
`Intl.DateTimeFormat` for dates, and the `prefers-reduced-motion` block.

No useful accessibility skill was found for React/Radix specifically; the
dedicated accessibility pass is Phase 5 regardless.
