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
| A | 46 | **Yes** — the 25-pax boardroom, the 10-pax and 8-pax conference rooms, plus the reception lounge. The drawing labels `RECEPTION`, `SOFA`, `CENTER TABLE`, `SWIVEL CHAIR` ×2 and `3 grey + 1 black chair` in this wing, and a sheet note reads *"EXISTING HERMENMILLER CHAIRS IN BOARD ROOM TO RETAIN - 25 NOS"*. 25 + 10 + 8 = 43, plus lounge seating ≈ 46. Accounted for. |
| C | 7 | Visitor and spare chairs beside the bays. |
| D | 6 | As above. |
| **B** | **33** | **No.** |

**The hypothesis that boardroom and lounge furniture explains this is correct,
but it lands on Zone A, not Zone B.** All of the lounge and conference
annotations are inside the Zone A polygon (verified by point-in-polygon against
`zones.json`, not by eye). Zone A's surplus is fully explained and needs no
question asked.

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
