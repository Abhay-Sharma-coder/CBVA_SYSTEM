# Assumptions

Everything here was decided by us, not confirmed by CBVA. Each entry names the
file it affects so it can be found and changed when an answer arrives.

**Status key:** 🔴 blocking — the product is wrong until answered · 🟠 material —
changes numbers or behaviour · 🟡 cosmetic — safe to leave.

---

## 🔴 The four open client questions

### A1 — How do the 54 CAs split between Manager and Assistant Manager?

**Assumed:** 22 Manager (fixed seat) / 32 Assistant Manager (must book).

**Affects:** `src/lib/seed-data/inventory.ts` → `HEADCOUNT`, and by extension
every occupancy number in the product.

**Why it matters:** this single number sets the denominator for the entire
analytics product. The floor has 94 bookable desks. We seeded 94 people who must
book, so demand and supply balance exactly. If the real split is 15/39, demand
rises to 101 against 94 desks and the floor is structurally short — which is
precisely the finding the partners are commissioning this tool to produce. We
cannot answer their question with a number we invented.

**WE NEED AN HR LIST**: name, email, grade, team, and whether they hold an
allocated seat. Nothing else in Phase 1 is as important as this.

---

### A2 — Which physical desks are allocated to fixed-grade staff?

**Assumed:** a deterministic allocation, 47 desks:

| Grade | Seats | Count |
|---|---|---|
| Director (management cabin) | D5-01 | 1 |
| Partner | A1-01…04, A2-01…04, C1-01…06, C2-01, C2-02 | 16 |
| Manager | C2-03, C2-04, C4-01…08, D6-01…04, D7-01…04, D8-01…04 | 22 |
| Admin / HR / IT | C3-01…08 | 8 |

Both passage runs (PA-01…16, PD-01…18) stay bookable.

**Affects:** `src/lib/seed-data/inventory.ts` → `FIXED_SEAT_ALLOCATION`.

**Why it matters:** the drawing gives bay sizes but not who sits where. This is
plausible — cabins and perimeter bays to fixed grades, open bays and passage
seats to the bookable pool — but it is invented. It determines which desks
appear as "Reserved (Fixed)" on the floor plan, so it will be visibly wrong to
anyone from CBVA looking at a demo.

**Sharper since Phase 2.** The plan now shows the real floor, so this is no
longer abstract: 47 specific desks in their real physical positions are drawn
as reserved. A partner opening `/floor` will recognise their own bay and see
the wrong desks greyed out. Answering this is now a five-minute edit in
`/admin/floor-plan` (change a seat's status, Save) rather than a code change.

---

### A3 — Are the six meeting rooms right, and what are they called?

**Assumed:** Boardroom 25, Conference A 10, Conference B 8, Meeting Room 1 7,
Meeting Room 2 6, Huddle Room 4.

**Affects:** `src/lib/seed-data/inventory.ts` → `MEETING_ROOMS`.

**Why it matters:** capacities are read off the pax annotations in Zones A and B
of the drawing; the **names are entirely ours**. CBVA will have its own names,
probably after clients or partners. Also needed: the Outlook room resource
mailbox for each, which is null on every row today and blocks the Graph calendar
sync in Phase 3 (`meeting_rooms.outlook_resource_email`).

---

### A16 — Does anybody sit in Zone B?

**Assumed:** no. Zone B has zero bookable seats.

**Affects:** `src/lib/seed-data/inventory.ts` → `BAYS`, and therefore the
denominator of the Phase 5 headline number.

**What was detected:** the chair detector found **222** chair blocks and the bay
assignment claimed 130. The 92 it did not claim break down by wing as:

| Zone | Unassigned chairs | Explained? |
|---|---|---|
| A | 46 | **Yes, and the drawing says so outright** — see below. The 25-pax boardroom, the 10-pax and 8-pax conference rooms and the reception lounge. 25 + 10 + 8 = 43, plus lounge seating ≈ 46. |
| C | 7 | Visitor and spare chairs beside the bays. |
| D | 6 | As above. |
| **B** | **33** | **No.** |

### The drawing settles Zone A in the client's own words

The title block carries this, set immediately beneath the headline total:

```
TOTAL WORKING PEOPLE =   141 PAX
NOTE: CONFERENCE AREA AND CAFETERIA NOT INCLUDED.
```

So zone A's 46 surplus chairs are not merely *inferable* as conference and
lounge seating from their furniture type — **the architect states on the same
sheet, one line under the 141, that the conference area is excluded from that
count.** That is the line to quote if anyone at CBVA ever asks why a room full
of chairs is drawn with no bookable seats.

It is also a third independent confirmation of 141, alongside the per-bay PAX
annotations summing to it and the furniture schedule (93 + 4 workstations + 8
foldables + the passage runs). `npm run build:floorplan` now reads the title
block and **fails** if that figure and the bay schedule ever disagree; the note
is carried through into `detection-report.json` as `sheetExclusionNote`.

The supporting furniture evidence stands too: `RECEPTION`, `SOFA`,
`CENTER TABLE`, `SWIVEL CHAIR` ×2 and `3 grey + 1 black chair` all fall inside
the zone A polygon, as does the sheet note *"EXISTING HERMENMILLER CHAIRS IN
BOARD ROOM TO RETAIN - 25 NOS"* — verified by point-in-polygon against
`zones.json` rather than by reading the layout.

**Zone A therefore needs no question asked. Zone B is not covered by that note**
— it is neither conference area nor cafeteria, and it is the only wing with
unexplained chairs.

Zone B is the upper-left wing. Its annotations are room tags `K L M Q R`, a
`HUB ROOM`, `ELEC PANELS`, two lifts, one `CENTRE TABLE` / `SOFA` pair — and
**`MODULAR FURNITURE`**, which is workstation language, not lounge language.
Three `NO CHANGE AREA — ONLY REPAIR WORK` notes sit just outside the wing on
leader lines pointing into it. So the wing was excluded from the fit-out, which
is why it has no `N PAX.` count and why Phase 1 gave it no seats — but "excluded
from the refit" is not the same as "nobody sits there".

**One sentence from CBVA closes this: are the ~33 desks in the north-west wing
occupied by staff, and if so by how many?**

### What it changes, with the arithmetic shown

Measured from the seeded database: 141 desks — 47 fixed, 93 bookable, 1 blocked.
The floor plan's occupancy denominator is the **bookable pool (93)**, not the
total desk count.

Let `D_r` be the reported denominator and `D_t` the true one. For any booking
count `B`, reported utilisation is `B/D_r` and true utilisation is `B/D_t`, so
the **relative overstatement is `D_t/D_r − 1`, constant in `B`**. The
**percentage-point** gap is `B × (1/D_r − 1/D_t)`, which does depend on `B`.

Three different quantities, all real, none interchangeable:

| Quantity | Value |
|---|---|
| Total desks understated, as a fraction of the true total | 33 / 174 = **19.0%** |
| Total desks understated, as a fraction of the reported total | 33 / 141 = **23.4%** |
| Utilisation overstated, **if all 33 are bookable** (pool 93 → 126) | 126/93 − 1 = **35.5%** relative |
| Utilisation overstated, **if they split like the floor** (~33% fixed → pool 115) | 115/93 − 1 = **23.7%** relative |
| Point gap at the seeded 52 bookings, all-33-bookable case | 55.9% → 41.3% = **14.6 points** |

An earlier draft of this entry said "overstated by roughly 19%". That number is
the first row — *capacity* understated relative to the true total — and it was
wrongly attached to the word *occupancy*. The occupancy figure is out by 23.7%
or 35.5% depending on how the 33 split between fixed and bookable, which is
itself unknown. Corrected here so the wrong one does not reach a partner.

### When this has to close

**Not before Phase 3.** Booking and the auto-release rule do not care about the
denominator; they operate per seat. **Before the Phase 5 headline number** —
peak observed occupancy against the bookable pool — is finalised. Pair it with
**A1**: those two together fix the denominator, and nothing else does.

---

## 🟠 Material — changes behaviour or numbers

### A4 — Slot boundaries

**Assumed:** AM 09:00–13:00, PM 13:00–17:00 (Asia/Kolkata).

**Affects:** `src/lib/slots.ts` → `DEFAULT_SLOT_DEFINITIONS`, seeded into
`settings.slot_definitions`.

**Revised in Phase 3.** Phase 1 guessed 09:00–13:30 / 13:30–19:00; these are the
values the client brief states. Still not confirmed by CBVA themselves, and note
what they imply: the office day these describe is 09:00–17:00, so nothing is
bookable in the evening. If people routinely stay past five, PM's end is wrong
and every "attended" figure will be measuring a window that closes before they
leave.

**No longer costly to change.** ADR-007's warning — that these are baked into
`bookings.starts_at`/`ends_at` at write time — was closed by ADR-021. Editing a
boundary now backfills every affected booking in the same transaction. The
vocabulary itself is data too (ADR-020), so adding hourly slots is a settings
write rather than a migration.

### A5 — Booking window, cut-off and auto-release timings

**Assumed:** `booking_window_working_days` 5, `booking_window_days` 14,
`cutoff_minutes` 60, `auto_release_minutes` 120,
`check_in_opens_minutes_before` 30.

**Affects:** `scripts/seed.ts` (the settings row), `src/lib/db/schema.ts`,
`src/lib/booking-days.ts`.

The brief specifies the 2-hour auto-release rule, so 120 is solid. How close to a
slot staff may still cancel without penalty is invented — see A21 for the two
rules that had to be settled around it.

**Sharpened in Phase 3.** The window is now expressed in **working days** (5),
with `booking_window_days` (14) retained as the calendar-day ceiling the scan
stops at so an unusual run of holidays cannot walk it forward indefinitely. More
importantly, the window is now **enforced**: before Phase 3 the date strip was a
suggestion and a hand-edited URL could book any date at all, including one in
the past. One function returns the list, the strip renders it and the write path
validates against it, so the offer and the rule cannot drift apart.

**A note for CBVA.** If the 2-hour rule is ever shortened, or the firm moves to
hourly slots, check `auto_release_minutes` against the slot length. A grace
window longer than the slot means an un-checked-in booking can never be
released — by the time the window expires the slot is over and it settles as a
no-show instead. That is correct behaviour, and it silently removes the feature.

### A6 — The public holiday list

**Assumed:** 39 national and Maharashtra holidays across 2026–2027.

**Affects:** `src/lib/seed-data/holidays.ts`.

Every firm publishes its own list, and the lunar-calendar dates (Holi, both Ids,
Diwali, Janmashtami) vary by observance. The booking engine treats these as
non-working days, so **a wrong date means staff cannot book a day they are
expected in**. Replace with CBVA's official holiday circular before go-live.

### A7 — Who may book on behalf of someone else

**Assumed (revised in Phase 3):** `is_admin`, plus Manager, Director and
Partner grades. The occupant must additionally be bookable-grade and active.

**Affects:** `src/lib/booking/authorise.ts` → `canBookOnBehalf()`,
`GET /api/people`, and the picker in the booking dialog.

Phase 1 assumed anyone could, and the seed still generates on-behalf bookings
from arbitrary colleagues — that seeded history is now looser than the live
rule, which is fine for demo data but worth knowing if anybody reads the seed as
documentation.

The narrower rule follows PROJECT.md's own grade table, which says Managers
"book on behalf of their team", and adds the admin/HR/IT staff who seat people
for a living. **Still a guess in one direction:** partners' secretaries are
admin staff and therefore covered, but if CBVA has a designated bookings
coordinator per team who is *not* a manager, they are currently locked out.

The list endpoint is gated on the same rule as the write, so somebody who may
not book for a colleague cannot enumerate the roster either.

### A8 — Email address format

**Assumed:** `firstname.lastname@cbva.in`.

**Affects:** `scripts/seed.ts`.

Real addresses come from the Entra tenant. This matters at cutover because
`users.email` is the join key between our roster and the Entra `preferred_username`
claim (see the TODO in `src/lib/adapters/production.ts`).

### A9 — Everyone is on Floor 4

**Assumed:** one active floor, number 4, all 141 people and all six rooms on it.

**Affects:** `scripts/seed.ts`.

The drawing covers Floor 4 only. The schema is already multi-floor
(`floors`, `zones`, `seats.floor_id`), so adding another is data, not migration.

### A10 — The demo clock offset is global

**Assumed:** one shared `settings.demo_offset_seconds` for the whole database.

**Affects:** `src/lib/clock.ts`, `src/app/api/clock/route.ts`.

Correct for a single-tenant partner demo, and required for server and client to
agree. But if two demos ever run against the same database at once, one person
advancing the clock moves it for the other. Acceptable for now; worth knowing
before a multi-audience demo day.

---

## 🟡 Cosmetic — safe to leave, easy to change

### A11 — Zone display names

**Assumed:** Zone A "Reception & Cabins", B "Boardroom & Conference",
C "Audit Floor", D "Tax & Advisory Floor".
**Affects:** `src/lib/seed-data/inventory.ts` → `ZONES`. The drawing labels the
zones A–D but does not name their function.

### A12 — Seat types per bay

**Assumed:** PA/PD → `passage`; A1, A2, D5 → `cabin`; C7 → `foldable`; the rest
`workstation`.
**Affects:** `src/lib/seed-data/inventory.ts` → `seatTypeForBay()`. The `cabin`
and `passage` calls follow the drawing; **`foldable` for C7 is a guess** made so
the enum has a live example.

### A13 — One blocked desk (PD-18)

**Assumed:** one desk out of service, so the "blocked" status has a live example
and analytics has to cope with capacity below the raw seat count.
**Affects:** `scripts/seed.ts`. Entirely invented.

### A14 — Staff names and teams

**Assumed:** 141 generated Mumbai-plausible names across six practice teams.
**Affects:** `src/lib/seed-data/names.ts`, `inventory.ts` → `TEAMS`.
Not real people. Superseded by the HR list in A1.

### A15 — Seat plan coordinates

**Assumed:** a temporary grid, bays in rows of three.
**Affects:** `scripts/seed.ts` → `buildSeats()`. **Known temporary** — Phase 2
replaces both columns from the CAD extraction in `tools/cad/`. Not a real open
question, listed so nobody mistakes the grid for the floor.

---

### A17 — 🔴 If the meeting rooms are already Outlook room mailboxes, we have recreated the double-booking problem through the back door

**The problem, plainly.** This product now enforces one booking per room per
time range, in the database, with an exclusion constraint that cannot be raced.
That guarantee holds for bookings made **through this app**. It says nothing
about a meeting booked in Outlook.

If Boardroom, Conference A and the rest exist as **room resource mailboxes** —
and in a Microsoft 365 tenant they almost certainly do, because that is how
anybody books a room from the Outlook calendar picker today — then staff will go
on booking them the way they always have. Our grid will show the hour as free.
Somebody will book it. Two groups will arrive.

That is not a smaller version of the problem CBVA asked us to solve. It is the
same problem, made harder to diagnose, because now there are two systems each
confident they are correct.

**What Phase 3 built, and what it does not do.** `CalendarSync.upsert()` writes
our booking out to the calendar, and the retry job makes sure it gets there even
if Graph is down. So Outlook will know about **our** bookings. Nothing tells us
about **theirs**. The sync is one-way, and a one-way sync cannot prevent a
conflict — it can only announce one.

**Affects:** `src/lib/rooms/service.ts`, `src/lib/adapters/production.ts`
(`GraphCalendarSync`), `meeting_rooms.outlook_resource_email` — which is still
null on all six rows, so nothing can be wired until A3 is answered.

**What we need from CBVA — one of these two, and it is their choice:**

1. **Exclusive booking rights.** The room mailboxes are configured so that only
   this application's service account may book them; everyone else is directed
   here. Simplest to build, and the only option that makes our constraint the
   actual truth. It costs staff the Outlook room picker they are used to.
2. **Two-way sync.** We subscribe to Graph change notifications on each room
   mailbox and mirror external bookings into `room_bookings` before showing the
   grid. Keeps Outlook working, but the guarantee weakens from "impossible" to
   "usually caught quickly" — a race between an Outlook booking and ours is
   resolved by whoever Graph tells us about first, which is not a constraint,
   it is a reconciliation.

**Until one is chosen, the honest position is that room double-booking is
prevented among people using this app and not prevented generally.** The desk
booking guarantee is unaffected — desks have no second system.

---

### A18 — Office hours for the room grid

**Assumed:** 08:00–20:00, in `settings.office_hours`.

**Affects:** `src/lib/settings.ts`, `src/lib/rooms/validation.ts`, and the
columns the grid draws.

Nobody has told us when the floor opens or closes. The range is wide enough not
to obstruct anybody and narrow enough that a range outside it is obviously a
mistake rather than a 3 a.m. meeting. It bounds the grid and is enforced at the
Zod layer (edge case 15).

---

### A19 — A QR check-in proves a booking, not a body in a chair

**Assumed:** scanning the sticker on a desk, while signed in and holding that
desk for the running slot, is good enough evidence that the desk is in use.

**Affects:** `src/app/checkin/[seatCode]/page.tsx`, `src/lib/qr.ts`, and every
occupancy figure that counts `checked_in`.

**Stated honestly, because analytics is the product.** The URL is printed on a
desk in an open-plan office, so it is not a secret and is not treated as one —
identity comes from the session. Somebody at home who knows the seat code and
holds that booking could check in without being in the building. Nothing in this
flow prevents that.

What it does establish is stronger than the alternative: a door swipe proves
presence on the floor but says nothing about which desk, and desk-level
occupancy is the number CBVA is commissioning. `bookings.check_in_method` records
which kind of evidence each check-in is (`qr`, `badge`, `app`, `admin`) so the
two are never blended.

**The strong pair is both.** A badge swipe at the door plus a QR scan at the
desk gives presence *and* location, and the schema is ready for it today. That
needs A-block: the badge vendor and export format are still unknown.

---

### A20 — When check-in opens

**Assumed:** `settings.check_in_opens_minutes_before` = 30.

**Affects:** `src/lib/booking/rules.ts` → `checkInOpensAt()`, the QR page and
the badge handler.

Somebody arriving twenty minutes early should be able to sit down and scan.
Somebody scanning the previous slot's desk at lunchtime should not accidentally
check in to the afternoon. Thirty minutes is a guess at where that line sits.

---

### A21 — The cut-off governs changes, not bookings

**Assumed:** `settings.cutoff_minutes` (60) closes **edit and cancel**. It does
not stop somebody booking a desk for a slot that has already started, and it
does not apply at all to a booking that has already been checked into.

**Affects:** `src/lib/booking/service.ts` (`createBooking`, `cancelBooking`),
and the disabled states on `/bookings`.

Two rules we had to invent, because the brief defines the cut-off only for edit
and cancel:

- **Booking late is allowed.** Extending the cut-off to creation would break the
  case the product most needs to support — somebody who came in unexpectedly, or
  somebody whose desk was just auto-released being told by our own email to
  "book another desk from the floor plan" and finding they cannot. What *is*
  refused is a slot that has already finished.
- **Cancelling after check-in is always allowed.** Check-in only happens after a
  slot starts, so it is always after the cut-off; without this carve-out edge
  case 5 is unreachable. And it is the right behaviour anyway — releasing a desk
  you are leaving hands the rest of the slot back to the floor.

Both are cheap to reverse if CBVA disagrees; both are settings-adjacent
behaviour rather than settings values, so changing them is a code change.

---

### A22 — 🟠 The auto-release job has no blast radius bound, and we have already seen what that costs

**Assumed:** that the clock the job reads is always sane, so an unbounded
`UPDATE` over every expired booking is safe.

**Affects:** `src/lib/booking/auto-release.ts` → `runAutoRelease()`,
`src/app/api/cron/jobs/route.ts`, `settings.demo_offset_seconds`.

**This is not hypothetical. It happened during Phase 3.** A test drove
`runAutoRelease` from a `FixedClock` set to January 2099. From that clock's point
of view every real booking in the seeded database had finished decades earlier,
so the job did exactly what it is built to do: **577 bookings were settled as
`completed_no_show` and the demo floor was emptied**, in one run, with no
confirmation and nothing to stop it. It was caught because the floor plan looked
wrong afterwards, not because anything complained.

**Why the current fix is not enough.** `runAutoRelease` now takes an optional
`onlySeatIds`, and the tests pass it. That closes the test hole and nothing else
— production never sets it, and the three transitions are still unbounded
`UPDATE`s with no `LIMIT`, no dry run, and no sanity check on the clock:

```
confirmed, grace expired, slot running   -> auto_released
confirmed, past ends_at                  -> completed_no_show
checked_in, past ends_at                 -> completed
```

**The production failure modes this leaves open**, none of which need a test to
reach:

1. **A bad `demo_offset_seconds`.** It is an `integer` column with no bound, set
   by `POST /api/clock` which accepts any `z.number().int()`. One fat-fingered
   value — or one demo left running with a large offset — and the next cron tick
   settles every future booking in the database. `APP_MODE=production` uses
   `SystemClock` and ignores the offset, so this is a demo-and-staging risk
   rather than a live one, but demo data is what CBVA will be shown.
2. **Server clock skew.** In production the job reads the system clock. A host
   that comes back from suspend, or a container with a wrong clock, has the same
   effect and no offset to blame.
3. **A settings edit.** `auto_release_minutes` accepts 5–720 today. Nothing
   stops it being set far below a slot length, which would release most of a
   floor within minutes of every slot start.

In all three the job is behaving correctly and the *input* is wrong — which is
exactly the case a bound is for.

**What to build, in Phase 5 or at production hardening:**

- **A batch cap.** Refuse to settle more than N rows in one run (N ~ the
  bookable pool, 93) and log loudly instead. A single run legitimately settling
  more bookings than the floor has desks is not a real workload.
- **A horizon.** Ignore bookings whose `ends_at` is more than a few days behind
  "now". Anything older is a backlog to be settled deliberately, not silently.
- **A dry run.** `runScheduledJobs({ dryRun: true })` returning the counts it
  *would* apply, so the cron's effect is inspectable before it is trusted — and
  so this entry can be verified rather than argued about.

**Why it is 🟠 and not 🔴.** Nothing built so far is wrong, the live rule is
correct, and `APP_MODE=production` does not read the demo offset. But the
analytics is the deliverable, and a job that can quietly rewrite thousands of
rows of attendance history is the one piece of this product that can corrupt the
number CBVA is buying — silently, and in a direction (more no-shows) that looks
plausible rather than obviously broken.
