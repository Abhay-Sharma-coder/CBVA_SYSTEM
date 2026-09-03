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

**Affects:** `src/lib/seed-data/inventory.ts` → `BAYS`, and therefore every
occupancy denominator in the product.

**Why it matters:** the Phase 2 extraction detected **32 chairs** in the
top-left wing, against 0 scheduled seats. The drawing marks that wing three
times *"NO CHANGE AREA — ONLY REPAIR WORK"* and — unlike every other work area —
gives it no `N PAX.` annotation, which is why Phase 1 assigned it nothing and
why the remaining bays still reconcile to exactly 141.

But 32 desks is not a rounding error. If they are occupied, the floor holds
~173 desks, not 141, and every occupancy percentage this product reports is
overstated by roughly 19%. If they are retained-but-unused furniture in an area
excluded from the fit-out, 141 is right.

We cannot tell from the drawing, and it is the kind of thing anyone at CBVA can
answer in one sentence. **Ask before the analytics are built in Phase 5.**
Until then the plan draws that furniture and gives it no seats, and
`/admin/floor-plan` reports the gap on screen.

---

## 🟠 Material — changes behaviour or numbers

### A4 — Slot boundaries

**Assumed:** AM 09:00–13:30, PM 13:30–19:00 (Asia/Kolkata).

**Affects:** `src/lib/slots.ts` → `DEFAULT_SLOT_DEFINITIONS`, seeded into
`settings.slot_definitions`.

A half-day booking model was specified, but not where the day divides. 13:30 is
a guess at a lunch boundary. See also ADR-007: these values are baked into
`bookings.starts_at` / `ends_at` at write time, so changing them later needs a
backfill migration, not just a settings edit.

### A5 — Booking window, cut-off and auto-release timings

**Assumed:** `booking_window_days` 14, `cutoff_minutes` 60,
`auto_release_minutes` 120.

**Affects:** `scripts/seed.ts` (the settings row), `src/lib/db/schema.ts`.

The brief specifies the 2-hour auto-release rule, so 120 is solid. How far ahead
staff may book, and how close to a slot they may still cancel without penalty,
are both invented.

### A6 — The public holiday list

**Assumed:** 39 national and Maharashtra holidays across 2026–2027.

**Affects:** `src/lib/seed-data/holidays.ts`.

Every firm publishes its own list, and the lunar-calendar dates (Holi, both Ids,
Diwali, Janmashtami) vary by observance. The booking engine treats these as
non-working days, so **a wrong date means staff cannot book a day they are
expected in**. Replace with CBVA's official holiday circular before go-live.

### A7 — Who may book on behalf of someone else

**Assumed:** anyone can, and the seed generates ~4% on-behalf bookings from
arbitrary colleagues.

**Affects:** `scripts/seed.ts`, and the Phase 3 permission model.

More likely the real rule is admin staff and partners' secretaries only. The
`source` enum already distinguishes `self` / `on_behalf` / `admin`, so this is a
permission decision rather than a schema one.

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
