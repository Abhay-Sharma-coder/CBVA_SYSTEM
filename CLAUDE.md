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
2. CAD geometry pipeline and the interactive 2D floor plan ← next
3. Booking engine, meeting rooms, auto-release, notifications
4. 3D floor plan view
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
  lib/seed-data/          inventory.ts, names.ts, holidays.ts, rng.ts
  lib/store/ui.ts         zustand — client UI state only
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
npm run dev          # http://localhost:3000
npm run build
npm run typecheck    # tsc --noEmit
npm run lint
npm run db:reset     # drop + recreate public schema (destructive)
npm run db:migrate
npm run seed         # idempotent; refuses to run with APP_MODE=production
npm test             # vitest — includes the DB constraint + concurrency proofs
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
