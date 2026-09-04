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

> **✅ Closed in Phase 3 by ADR-021.** Editing `slot_definitions` now backfills
> every affected booking in the same transaction, and a change that would orphan
> a live booking is refused outright. The second copy of the derivation that had
> crept into `scripts/seed.ts` was deleted at the same time — there is one
> `deriveSlotBounds()` again, and `tests/integration/hourly-slots.test.ts` proves
> a moved boundary carries its bookings with it.

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

---

## ADR-015 — The CAD reader is stdlib Python, not PyMuPDF

`tools/cad/extract_floorplan.py` proved that filtering the PDF's 44 optional
content groups gives exact geometry. Phase 2 needed three things from the
drawing — layer-tagged paths, layer-tagged text with positions, and the block
transforms — and all three are recoverable from the page content streams with
nothing but `zlib`.

So `tools/cad/cadparse.py` interprets them directly. The cost is ~350 lines of
PDF operator handling. The benefit is that `npm run build:floorplan` works on a
clean checkout with no pip step, which matters because the geometry is the one
thing in this repo that cannot be re-derived from anything else.

It is verified by reproducing the known per-layer path counts exactly (9,403 on
layer `0`; 6,444 partition; 6,053 furniture hatch; 165 wall; 57 column). A
parser that mishandled the graphics state would not land on those numbers.

---

## ADR-016 — Seats are detected from chairs, not desks

The obvious primitive is the desk. It does not work: a 9-pax bay is drawn as
one continuous run of hatched desktop, so clustering it yields a single blob
and shape-matching a "workstation module" has nothing repeatable to match.

Chairs do work. Each is a 7-point ~8pt block on layer `0` (AutoCAD block
geometry plots as layer 0), there is exactly one per seat, and they do not
touch each other. Filtering for that footprint yields **93** components — and
the drawing's own schedule reads *"Work Station with rapid rail… = 93 nos"*.
That agreement, arrived at from two independent directions, is what justified
building the rest of the pipeline on it.

Assignment to bays is a **globally greedy capacity-constrained match**, not
nearest-anchor per chair. Nearest-anchor let one bay tag act as a magnet for a
whole wing: A2 collected 22 chairs against a schedule of 4.

Result: 130/141 detected, 11 interpolated, no bay over its scheduled count.

---

## ADR-017 — `seats.json` is the source of truth for geometry, not the database

Seat position had to live somewhere that survives `npm run db:reset` and is
reviewable in a diff, but also had to be editable at runtime, because furniture
moves and detection is 92% right.

So: the build writes `src/data/floorplan/seats.json` and commits it; the seed
reads it; the editor writes the database live **and** exports back to the file,
marking moved seats `source: "manual"`. Fifteen minutes of dragging becomes a
committed artefact rather than a state one `db:reset` away from being lost.

The alternative — database wins after first insert — was rejected because the
corrections would exist only in whichever database happened to receive them.

`buildSeats()` reconciles the file against `BAYS` strictly and throws on any
mismatch, so a drift between the drawing and the inventory stops the seed rather
than quietly producing a floor with missing desks.

---

## ADR-018 — Seats use `aria-disabled`, never `disabled`

Non-bookable seats were originally `disabled`. An axe run and a keyboard test
showed the cost: `disabled` removes an element from the tab order, so arrow
navigation dead-ended at every booked desk, and a keyboard user could never
land on a reserved desk to hear whose it was.

Seats are now always focusable, carry `aria-disabled`, and guard inside their
own `onClick`. A seat you cannot book is still a seat you need to be able to
read.

---

## ADR-019 — The plan texture is one raster at 55% opacity

The wall layer is 8,603 paths and the furniture layer 49,342. Neither goes in
the live DOM; the drawing is baked to webp at build time and the only
interactive nodes are the 141 seats. `e2e/floor-plan.spec.ts` asserts fewer
than 50 SVG paths on the page so this cannot be quietly undone.

The opacity is not decoration. At fit-to-floor a desk is about 11px across, and
against full-strength CAD linework the seat chips are invisible — the first
screenshot review showed exactly that. The drawing is context; the seats are the
content, and the contrast between them has to say so.

---

## ADR-020 — `bookings.slot` is text; the slot vocabulary is settings data

**Decision.** The `slot` Postgres enum is dropped. `bookings.slot` is `text`, and
`settings.slot_definitions` is an ordered, zod-validated list of
`{key, label, start, end}`.

**Why.** The brief requires that moving CBVA from half days to hourly booking be
a settings change, not a refactor. A two-value enum makes that impossible —
`H09` is not a legal value, and adding eight of them is a migration plus a type
change plus every switch statement that reads it. Their own document says
"hourly"; the only worked example in it is a half day. We ship half days and
keep the door open, at the cost of one column type.

**Cost.** The database no longer polices the slot vocabulary, so `requireSlot()`
does, at the write boundary, with an error naming the legal values. Overlapping
definitions are the one thing no database rule catches — two slots covering the
same hour would let one person hold two desks for the same real time while both
partial unique indexes stayed happy — so `slotDefinitionsSchema` rejects
overlaps explicitly.

**Proven by** `tests/integration/hourly-slots.test.ts`, which reconfigures
settings and then runs book → check in → edit → cancel → auto-release against a
slot key that did not exist when the code was written.

---

## ADR-021 — Editing slot definitions backfills derived bounds, in the same transaction

**Decision.** `PATCH /api/admin/settings` recomputes `bookings.starts_at` and
`ends_at` for every live booking inside the same transaction that writes the new
definitions. If the new definitions drop a slot key a live booking still uses,
the change is **refused** with that list.

**Why.** This closes the concern ADR-007 left open. Those columns are derived at
write time and stored so the auto-release job can range-scan a `timestamptz`
index instead of re-deriving a timezone conversion per row. The cost was that
editing a boundary made every historical row silently disagree with the settings
that supposedly defined it — and since analytics is the product, silently wrong
history is the worst failure available. Either both move or neither does.

The refusal matters as much as the backfill: a booking whose slot key no longer
exists has no start time that could be computed for it. There is no correct
value to write, so the only honest options are to refuse or to destroy data, and
refusing is the one that can be undone.

**Cost.** A settings edit is O(live bookings) — a few hundred rows at CBVA's
scale. `scripts/backfill-slot-bounds.ts` runs the identical computation from the
command line for a database edited by hand.

---

## ADR-022 — `occupant_slot_unique`: one person, one desk, per slot

**Decision.** A second partial unique index, beside `seat_slot_unique`:

```sql
CREATE UNIQUE INDEX occupant_slot_unique
  ON bookings (occupant_user_id, booking_date, slot)
  WHERE status IN ('confirmed', 'checked_in');
```

**Why.** Edge cases 9 and 10 in the brief are the same rule seen from two sides
— a person may not hold two desks in one slot, and an on-behalf booking for
somebody who already has one must be refused. Keying on the **occupant** gives
the carve-out the brief asks for free: booking *for* a different person is a
different key, so it is allowed with no special case in the code.

It lives in the database for ADR-003's reason. An application "does this person
already have a desk?" check has a race window between the read and the write,
and two browser tabs is all it takes.

**Verified before adding.** The seeded database was queried first — zero
occupant/date/slot groups with more than one live booking — so the index went on
without touching data.

**Cost.** One more constraint name the insert path recognises. The conflicting
booking is fetched *after* the rejection, purely to put it in the error message.
That read is an explanation, not a pre-check.

---

## ADR-023 — Edit is cancel-and-rebook inside one transaction

**Decision.** Changing a booking's date, slot or desk is a conditional cancel
followed by an insert, in a single transaction, with an optimistic lock on
`updated_at`.

**Why.** Updating the row in place would have to move it through a state where
it holds neither desk, or both. Cancel-and-rebook keeps `seat_slot_unique`
protecting the user throughout: if the desk they are moving to is taken between
opening the dialog and pressing Save, the insert trips `23505`, the transaction
rolls back, and **the original booking is still theirs**. They never end up with
nothing.

**What the optimistic lock is actually for.** `updated_at` cannot distinguish
two writes that land inside the same clock tick — under a frozen demo clock,
every write shares an instant. The thing that genuinely makes concurrent edits
safe is the conditional UPDATE, which matches zero rows once somebody else has
moved the booking out of an active status. The timestamp's job is to get the
*message* right, which is why a stale write is classified by re-reading the row:
a booking a person cancelled is a conflict worth reloading, a booking the job
auto-released has ended, and "reload and try again" would be a lie.

The comparison is `date_trunc('milliseconds', updated_at)`. Postgres timestamps
carry microseconds; the value the client echoes back has been through
`Date.toISOString()` and lost them. Comparing raw would fail every edit of a row
written by the column's `DEFAULT now()`.

---

## ADR-024 — Two new booking statuses, because analytics reads statuses

**Decision.** `booking_status` gains `cancelled_after_check_in` and
`cancelled_by_admin`.

**Why.** The brief requires cancelling after checking in to be counted
separately from a plain cancellation (edge case 5), and cases 7, 8 and 12 need
"the firm took this desk away" separate from "this person chose not to come in".

Both could be derived — `checked_in_at IS NOT NULL`, or an actor comparison —
but that relies on every future analytics query remembering the qualifier. A
status is what a `GROUP BY` reads. Occupancy is the product; the vocabulary it
groups by should not need a footnote.

Both are outside the `seat_slot_unique` predicate, so both free the desk.
`checked_in_at` is deliberately preserved on a `cancelled_after_check_in` row:
that somebody turned up is evidence, and cancelling later does not un-happen it.

---

## ADR-025 — Taking a desk out of service is refused, unless forced

**Decision.** Setting a seat to `fixed`, `blocked` or `decommissioned` while
live future bookings exist is refused with a 409 listing them. `force: true`
performs it, cancelling each booking as `cancelled_by_admin` and notifying every
affected occupant and booker. Deactivating a user does the same with no `force`
— there is no defensible reason to leave those bookings standing when nobody is
coming.

**Why.** The brief said "block the status change, or force-cancel with
notification — pick one, log the decision." Refusing is the safe default: an
admin dragging desks around in the editor should not silently unseat four
people, and the list is exactly the information needed to decide. But refusing
outright is also wrong — a desk really does break, and an admin who cannot
record that ends up with a floor plan that lies. `force` makes the destruction
deliberate and auditable rather than accidental.

The cancellations go through the ordinary `cancelBooking` service rather than a
bulk `UPDATE`, so each gets its notification, its audit row and its status
transition from the same code path an individual cancellation uses. A bulk
update would be faster and would silently skip all three.

---

## ADR-026 — `notification_log` is the outbox; `MailProvider` is only transport

**Decision.** Notifications are rendered and inserted **inside** the booking
transaction with `status = 'queued'`, and delivered afterwards by a dispatcher
that catches everything. `DemoMailProvider` no longer writes rows; it resolves.

**Why.** Three properties fall out, and none is available if the adapter owns
the row:

1. **A committed booking always has its message.** Enqueue is part of the atomic
   unit, so a crash cannot leave one without the other.
2. **A send failure can never roll back a booking.** Sending happens after
   commit, outside the transaction, with its errors recorded on the message.
3. **The retry path is real rather than decorative.** Under the old design the
   demo adapter could not fail, so nothing exercised attempts, backoff or the
   `failed` state.

Bodies are rendered at enqueue time and stored. In demo mode that is what makes
`/admin/notifications` a genuine mailbox; in production it is the record of what
the firm actually told somebody, and re-rendering it later from a booking that
has since changed would quietly rewrite history.

**Cost.** Email HTML hand-copies five design tokens (`EMAIL_PALETTE` in
`src/lib/notifications/render.ts`), because mail clients cannot read CSS custom
properties. That duplication is written down rather than pretended away.

---

## ADR-027 — Auto-release is one conditional `UPDATE … RETURNING` per transition

**Decision.** Three statements. No job table, no advisory lock, no leader
election:

- `confirmed`, past the grace window, slot still running → `auto_released`
- `confirmed`, past `ends_at` → `completed_no_show`
- `checked_in`, past `ends_at` → `completed`

**Why.** Every property the brief asks for is a consequence of the shape:

- **Idempotent** — the second run's predicate no longer matches, because the
  first moved the row out of `confirmed`.
- **Safe to run concurrently** — under READ COMMITTED a second runner blocks on
  the locked row, re-evaluates the predicate against the committed version, and
  finds it no longer qualifies.
- **Only this run notifies** — `RETURNING` hands back exactly the rows this
  statement transitioned.
- **Never touches the wrong row** — `checked_in` and every cancelled state are
  outside every predicate, by name.
- **A rewound clock corrupts nothing** — the predicates simply stop matching,
  and terminal statuses are terminal.

The separate no-show branch is edge case 3. Releasing a desk for a slot that has
already finished would be theatre — there is no remaining time for anybody to
use it — so it settles as evidence about attendance rather than availability.

**The trap this created, recorded because it bit.** The job is global by design,
and a test that drives it from a fixed clock years away settles the ENTIRE
seeded database, because from that clock's point of view every real booking
finished decades ago. It did exactly that once, marking 577 seeded future
bookings as no-shows and emptying the demo floor. `runAutoRelease` therefore
takes an optional `onlySeatIds`, used by tests and never by production.

---

## ADR-028 — QR check-in is session-authenticated, not a secret URL

**Decision.** Every bookable desk gets a printed sticker pointing at
`/checkin/<seat_code>`. The URL carries no token; identity comes from the
session, and the check-in is recorded with `check_in_method = 'qr'`.
`qrcode@1.5.4` is added to the pinned stack and renders SVG server-side.

**Why the flow exists at all.** A door swipe proves somebody entered the floor.
It does not prove they used C3-04. Occupancy analytics built only on swipes
cannot distinguish a full floor from a half-full one where everybody walked past
the same reader — precisely the question the partners are commissioning this
product to answer — and it makes the whole thing depend on an access-control
vendor whose export format nobody has seen. A sticker on the desk removes both
problems.

**Why no token.** The sticker is on a desk in an open-plan office, so anything
printed on it is known to everyone who walks past and treating the URL as a
secret would be security theatre. What the flow proves is: *this person, who
holds this desk for this slot, said they are at it.* Materially stronger than a
turnstile, and honestly weaker than physical presence — recorded in ASSUMPTIONS
A19, with the note that badge and QR together are the strong pair.

**Cost.** One dependency, added rather than substituted. SVG rather than a
data-URI PNG so the sheet prints crisply at any size with no network dependency,
which matters when 93 of them are being run off on an office printer.

---

## ADR-029 — Jobs on an interval in dev, a Vercel cron in production

**Decision.** `runScheduledJobs()` — auto-release, notification dispatch,
calendar retry — is called from three places: a 60-second interval registered in
`src/instrumentation-node.ts` during development, a Vercel cron hitting
`POST /api/cron/jobs` every five minutes in production, and a button in the demo
panel. The route is protected by `CRON_SECRET`, compared in constant time, and
accepts both the `Authorization: Bearer` form Vercel sends and an
`x-cron-secret` header.

**Why an interval in dev.** Without something on a timer the auto-release rule
only fires when somebody remembers to press a button — which is exactly how a
demo goes wrong in front of a partner. All three callers run the same code
against the same Clock, so advancing the demo clock makes the real job run the
real rule.

**Why the constant-time compare.** This route mutates bookings. A naive `===`
leaks the secret one byte at a time to anybody willing to measure, and the fix
is four lines.

**A shape that is load-bearing.** `instrumentation.ts` is compiled for the edge
runtime as well as Node, and anything reaching `pg` from an edge bundle fails to
resolve `fs` — taking the whole dev server down with it. The Node-only work
therefore lives in a separate module imported inside the
`NEXT_RUNTIME === "nodejs"` guard, which is the only shape Next tree-shakes
reliably. `next.config.ts` also marks `pg` as a server-external package.
