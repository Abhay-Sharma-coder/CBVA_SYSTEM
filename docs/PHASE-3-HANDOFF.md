# Phase 3 handoff

The booking engine. Everything below has been run; where a number appears it was
measured, not estimated.

---

## 1. What changed

Phases 1 and 2 built everything that reads. Not one row had ever been written by
the product: `/bookings` and `/rooms` were stubs, the booking dialog's Confirm
button was hard-coded `disabled`, and `settings.cutoff_minutes` and
`auto_release_minutes` were read by nothing in `src/`.

Now a person can book a desk from the plan or the list, for themselves or a
colleague; edit or cancel it up to the cut-off; check in with a QR sticker on the
desk; and watch a colleague's un-checked-in booking auto-release when the demo
clock advances — with a brand-correct email for each of those in a viewable
inbox.

```bash
npm run db:migrate     # applies drizzle/0002_booking_engine.sql
npm run seed           # slot times changed, so a re-seed is part of this phase
npm run dev            # http://127.0.0.1:8081 — the job interval starts with it
```

---

## 2. Three decisions everything else follows from

### Slots stopped being a type (ADR-020)

`bookings.slot` was a two-value Postgres enum. The brief requires that moving
CBVA to hourly booking be *a settings change, not a refactor* — and an enum makes
that impossible, because `H09` is not a legal value. The column is now `text` and
`settings.slot_definitions` is an ordered, zod-validated list.

`tests/integration/hourly-slots.test.ts` is the proof: it adds one-hour slots to
settings and then runs book → check in → edit → cancel → auto-release against a
slot key that did not exist when the code was written.

It adds slots rather than replacing them, and that is not a dodge. The seeded
database has ~530 live AM/PM bookings, and `updateSettings` **refuses** to drop a
slot key that live bookings still use — a booking whose slot no longer exists has
no start time that could be computed for it. That refusal is asserted in its own
case. The change the test performs is the one a real firm could actually make.

### A second partial unique index (ADR-022)

```sql
CREATE UNIQUE INDEX occupant_slot_unique
  ON bookings (occupant_user_id, booking_date, slot)
  WHERE status IN ('confirmed', 'checked_in');
```

Edge cases 9 and 10 are the same rule seen from two sides. Keying on the
**occupant** gives the on-behalf carve-out for free — booking *for* somebody else
is a different key. It went on after querying the seeded database for violations
first: there were none.

**There is still no "is this seat free?" pre-check anywhere.** `23505` and
`23P01` are ordinary outcomes with sentences attached.

### `notification_log` became the outbox (ADR-026)

Messages are rendered and inserted **inside** the booking transaction, and
delivered afterwards by a dispatcher that catches everything. So a committed
booking always has its message, a send failure can never roll back a booking, and
the retry path is real rather than decorative — `DemoMailProvider` used to write
the row itself and could not fail, so nothing exercised attempts or backoff.

---

## 3. Where things live

```
src/lib/booking/     errors · authorise · rules · service · auto-release · queries · badge
src/lib/rooms/       validation (the Zod layer) · service (grid, book, cancel, retry sync)
src/lib/notifications/  kinds · render (the HTML templates) · outbox (enqueue + dispatch)
src/lib/admin/       settings-service (the ADR-021 backfill) · seat-lifecycle (ADR-025)
src/lib/jobs/        run-jobs — auto-release + dispatch + calendar retry
src/lib/settings.ts  the one reader of the singleton
src/lib/api.ts       the HTTP boundary: actor, zod, error → status
src/lib/qr.ts        seatCheckInUrl, seatQrSvg
```

**Every service function takes its `db`, its `Clock` and its actor as
arguments.** That is not ceremony. All eighteen edge cases are about timing or
concurrency and none is controllable through HTTP; `auth()` reads `next/headers`
and throws outside a request, so a service that called it could not be tested at
all; and the concurrency proofs need two independent sessions on the direct
endpoint, which means the handle has to be a parameter.

### Screens

| Route | What |
|---|---|
| `/floor` | the plan, now with a working booking dialog |
| `/bookings` | upcoming and past, grouped by date, edit and cancel |
| `/rooms` | room-by-hour grid, click or drag to select |
| `/checkin/[seatCode]` | the QR target |
| `/admin/notifications` | the demo inbox, every email rendered |
| `/admin/qr` | the printable sticker sheet, 12 to an A4 page |

Plus one **demo panel**, bottom right, holding every demo affordance: advance the
clock, simulate a badge swipe, run the jobs now. Deliberately not scattered on
booking cards — a fake control next to a real Cancel teaches a partner that the
product has pretend buttons in it, and the next question is which of the others
are also pretend.

---

## 4. The eighteen cases

`tests/integration/phase3-edge-cases.test.ts`, numbered 1–18 to match the brief.
All pass. **139 vitest tests, up from 83.**

| # | Case | Outcome |
|---|---|---|
| 1 | Concurrent identical booking | one wins; loser gets `SEAT_TAKEN` and a refreshed map |
| 2 | Auto-release twice | second run releases 0, notifies 0 |
| 3 | Auto-release after the slot ended | `completed_no_show`, not a release |
| 4 | Skips `checked_in` and cancelled | both untouched |
| 5 | Cancel after check-in | `cancelled_after_check_in`, `checked_in_at` kept |
| 6 | Cut-off passes with the modal open | `PAST_CUTOFF`, naming the instant |
| 7 / 8 | Desk blocked / decommissioned with bookings | refused with the list; `force` cancels + notifies |
| 9 | One person, two desks, one slot | refused; on-behalf for another person allowed |
| 10 | On-behalf for somebody already booked | refused, with the offending booking |
| 11 | Five working days over a weekend + holiday | correct dates, and the write path enforces them |
| 12 | Deactivated user | bookings cancelled, occupant **and** booker told |
| 13 | Concurrent edits | one wins, other gets `BOOKING_CONFLICT` |
| 14 | Meeting starting as another ends | allowed; genuine overlap refused |
| 15 | Zero-length / inverted / out-of-hours range | refused at the Zod layer |
| 16 | Calendar down | booking persists, `sync_status='failed'`, retry works |
| 17 | Mail down | booking persists, attempts counted, retry sends |
| 18 | Clock wound backwards | nothing un-happens, desk still rebookable |

Plus one that is not in the brief but is the reason `reminder` exists as a kind
(**2b**): halfway through the grace window, before anything is taken away, the
occupant is told their desk is about to go. Taking a desk from somebody who
simply forgot to scan lands in the analytics as a no-show — which is supposed to
mean "did not come in" — so one nudge is the difference between measuring
occupancy and measuring intent. It is once-only by the same partial unique index
that makes the release notification idempotent.

---

## 5. Defects these found, all fixed

Seven real ones, in the order they surfaced.

**1. Drizzle wraps the driver error.** A `DrizzleQueryError` carries the pg error
on `.cause`, so `mapPgError` was reading a top-level object with no SQLSTATE and
returning null. **Every race — the one thing both database constraints exist for
— was surfacing as an unhandled 500** instead of "somebody just took that desk".
It only fails under genuine concurrency, which is why case 1 is a real
two-transaction race rather than a serial insert.

**2. A timestamp lock is blind inside its own tick.** Case 13 runs two edits
under a frozen clock, so both stamp the same `updated_at`. That is not an
artefact of the test — it is what the lock is. The conditional UPDATE inside the
transaction is what actually arbitrates; the timestamp's job is the message. A
stale write is now classified by re-reading the row, because a booking a *person*
cancelled is a conflict worth reloading and a booking the *job* released has
ended.

**3. A test drove a global job from a clock in 2099 — and settled the entire
database.** `runAutoRelease` scans every booking whose grace window has expired,
and from a 2099 clock every real booking finished decades ago. It marked 577
seeded future bookings as no-shows and emptied the demo floor. `runAutoRelease`
now takes an optional `onlySeatIds`, used by tests and never by production
(ADR-027). The seeded data was rebuilt.

**4. `router.replace` was cancelling navigations off `/floor`.** The floor plan
writes its date/slot/zone state back to the URL. The default date arrives from
the API about a second after load, so if somebody clicked "My Bookings" in that
window, the resulting `router.replace` aborted their click and they stayed put.
A race, so it read as flakiness. It is now `history.replaceState` — a URL sync is
not a route change, and only a route change can cancel one.

**5. `instrumentation.ts` is compiled for the edge runtime too.** The dev job
interval reached `pg`, which cannot resolve `fs` in an edge bundle, and the whole
dev server failed to start. The Node-only work moved into
`src/instrumentation-node.ts` behind the `NEXT_RUNTIME` guard.

**6. The notification dispatcher claimed nothing.** It selected due rows
`FOR UPDATE SKIP LOCKED` inside a transaction and sent afterwards — but the lock
dies with the transaction, and the transaction has to commit before a send that
may take seconds. Two runners would select the same rows and send the same email
twice, which is precisely what an outbox exists to prevent, and the dev
interval, the Vercel cron and the demo panel's button really can overlap. The
claim is now an UPDATE that leases the rows forward, atomically.

**7. Two accessibility defects, found by axe on the new surfaces.**
`role="listbox"` may only contain `role="option"` children — the person picker's
"Loading…" row was a critical `aria-required-children` violation. And the
selected row in the demo inbox used `ink-subtle` on `navy-tint`, which measures
4.21:1: **exactly the trap Phase 2 documented on the date chip, repeated.**

---

## 6. Rules that had to be invented

The brief left these open. Each is commented where it lives and logged in
ASSUMPTIONS.

- **The cut-off governs edit and cancel, not booking** (A21). Extending it to
  creation would break the case the product most needs to support: somebody
  whose desk was just auto-released being told by our own email to "book another
  desk" and finding they cannot. What *is* refused is a slot that has finished.
- **The cut-off does not apply once somebody has checked in** (A21). Check-in
  only happens after a slot starts, so it is always after the cut-off; without
  this carve-out edge case 5 is unreachable. It is right anyway — releasing a
  desk you are leaving hands the rest of the slot back to the floor.
- **Desk removal is refused, unless forced** (ADR-025). Refusing is the safe
  half; `force` cancels with notification. Both halves, safe one as default.
- **On-behalf is managers and above, plus admins** (A7), narrowing Phase 1's
  "anyone can". Confirmed with the client team.
- **Office hours 08:00–20:00** (A18) and **check-in opens 30 minutes early**
  (A20), both invented, both settings values.

---

## 7. Open for the client — one new blocking item

**A17 🔴 — if the meeting rooms are already Outlook room mailboxes, we have
recreated the double-booking problem through the back door.** This product
enforces one booking per room per range in the database, uncrackable. That
guarantee covers bookings made *through this app*. If the rooms exist as resource
mailboxes — and in a Microsoft 365 tenant they almost certainly do — staff will
go on booking them from Outlook, our grid will show the hour free, and two groups
will arrive. The calendar sync is one-way: Outlook learns about our bookings,
nothing tells us about theirs, and a one-way sync cannot prevent a conflict, only
announce one.

CBVA has to pick: **exclusive booking rights** for the app's service account, or
**two-way sync** via Graph change notifications. The first makes our constraint
the truth and costs staff the Outlook room picker. The second keeps Outlook and
weakens the guarantee from "impossible" to "usually caught quickly".

Desk booking is unaffected — desks have no second system.

A19 also matters for the analytics: a QR check-in proves a booking, not a body in
a chair. Badge and QR together is the strong pair, and the schema is ready for it.

**The client-facing trio is A1, A16 and A17** — the HR split, Zone B, and who
owns room booking. None blocks a build phase; together they fix the denominator
and the room guarantee, and they should go to CBVA as one set rather than being
raised piecemeal. A22 is ours, not theirs: an engineering bound to add, not a
question to ask.

---

## 8. Verification — all run

| Gate | Result |
|---|---|
| `npm run db:migrate` twice, and from empty | applied cleanly, idempotent |
| `npm run seed` twice | identical counts; `occupant_slot_unique` holds |
| `npx vitest run` | **139 passed** (was 83) |
| `npm run typecheck` | 0 errors |
| `npm run lint` | clean; the clock rule does not fire |
| `npm run build` | succeeds |
| `npx playwright test` | full suite green |
| axe on **9** surfaces | 0 serious, 0 critical |
| Screenshot capture | 8 pages × 3 widths, plus the walkthrough's 18 |
| Walkthrough screenshots | 18 captured, opened and read |

`e2e/phase3-walkthrough.spec.ts` runs the brief's script end to end: book →
inbox → QR check-in → book on behalf → cancel → advance the clock → watch a
different booking auto-release → book a room.

**The suite mutates demo data on purpose.** The walkthrough books, cancels and
auto-releases real rows, and step 9 releases every un-checked-in booking for that
morning — that is the demonstration. Run `npm run seed` afterwards to restore a
presentable floor.

---

## 9. Notes for Phase 4 and 5

- **`seat_slot_unique` does not include `completed`, deliberately.** After an
  auto-release the desk is legitimately rebooked and both bookings complete, so
  two `completed` rows for one seat/date/slot is true history. What stops
  nonsense is the write path refusing dates outside the bookable window, never a
  wider index. `/api/floor` prefers the row that still holds the desk, then the
  newest.
- **Analytics has five terminal statuses to separate**, and they mean different
  things: `completed` (used it), `completed_no_show` (claimed it, never came),
  `auto_released` (claimed it, released before the slot ended),
  `cancelled_by_user` / `cancelled_after_check_in` (their decision, before or
  after arriving), `cancelled_by_admin` (ours, not evidence about them).
  **This distinction has to be visible in Phase 5's own status legend, not only
  in the schema.** Collapsing "left early" or "the firm took the desk back" into
  a plain no-show is not a display simplification — it corrupts the utilisation
  figure the whole product exists to produce, in the direction that looks
  plausible rather than obviously broken.
- **The auto-release job has no batch cap, horizon or dry run** — ASSUMPTIONS
  A22, logged with the incident that demonstrated it. It is the one component
  that can silently rewrite thousands of rows of attendance history, and it
  should not be trusted in production until it is bounded.
- **`check_in_method` is the column that makes occupancy honest.** `qr` is desk
  level, `badge` is floor level. Do not blend them.
- **`audit_log` now has a real vocabulary** — `src/lib/audit.ts` is the one
  writer, and the action union there is the closed set.
- Phase 4's 3D view renders the same `FloorPlanSeat[]`, which now carries
  `bookingId` and `bookingUpdatedAt` for the viewer's own booking, so a 3D seat
  can open the same dialog with no second pipeline.
