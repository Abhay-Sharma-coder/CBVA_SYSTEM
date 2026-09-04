# Workspace — living spec

CBV & Associates LLP, Mumbai. Office seat and meeting room booking.

Keep this current. It describes what the product **is**, not what has been
built — `PHASE-1-HANDOFF.md` covers the latter.

---

## 1. The problem

CBVA runs a one-day-a-week work-from-home policy. Two consequences:

1. Desks sit empty on an unpredictable pattern, and nobody knows which.
2. The firm cannot forecast next-day capacity, so it cannot tell whether it is
   paying for more desks than it needs.

Booking is the instrument, not the goal. **The deliverable is the occupancy
analytics that lets partners right-size desk count against headcount.** Every
design decision is judged against whether it produces trustworthy occupancy data.

## 2. Who uses it

| Grade | Seat | Uses the product to |
|---|---|---|
| Partner | Fixed | Read the analytics. Book meeting rooms. |
| Director | Fixed | As above. |
| Manager | Fixed | Book rooms; book on behalf of their team. |
| Assistant Manager | **Books** | Book a desk for each day in office. |
| Article | **Books** | Same. The largest group — 62 of 141. |
| Admin / HR / IT | Fixed | Book on behalf; manage seat inventory; read analytics. |

Floor 4 today: **141 desks, 141 people, 47 fixed / 94 who must book against 94
bookable desks** — supply and demand balance exactly, which is itself a finding.
The Manager/Assistant Manager split that produces those numbers is an assumption
(ASSUMPTIONS A1).

## 3. Core rules

- A desk is booked for a **slot**. The slots are **data**, not a fixed pair:
  `settings.slot_definitions` is an ordered list of named time ranges, seeded as
  AM 09:00–13:00 and PM 13:00–17:00. A full day is two bookings on the same
  desk. Moving the firm to hourly booking is a settings change (ADR-020).
- **One active booking per desk, per date, per slot.** Enforced by the database.
- **One desk per person, per date, per slot.** Also enforced by the database,
  and keyed on the *occupant* — so booking for a colleague who is free is
  allowed, and booking a second desk for yourself is not (ADR-022).
- Cancelling or auto-releasing frees the slot **without deleting the row** — the
  history is the analytics.
- **Auto-release**: a booking not checked into within the grace window
  (`settings.auto_release_minutes`, 120) is released back into the pool
  automatically and marked `auto_released`. Past the slot it settles to
  `completed_no_show`.
- **Check-in** comes from a badge swipe at the door (`badge_events`), from a QR
  code on the desk, or from the app, and `bookings.check_in_method` records
  which. Check-in is what turns a booking into evidence of occupancy — an
  un-checked-in booking is a claim, not a fact, and the analytics must keep the
  two apart. It must also keep the *kinds* of evidence apart: a door swipe
  proves somebody reached the floor, a desk QR proves they used that desk.
- **The cut-off** (`settings.cutoff_minutes`) closes edit and cancel before a
  slot starts. It does not stop somebody booking a desk mid-slot — that is how
  an auto-released desk gets used — and it does not apply to a booking somebody
  has already checked into, because releasing a desk you are leaving hands the
  rest of the slot back to the floor.
- Meeting rooms are booked as **arbitrary time ranges**, not slots. Overlaps are
  rejected by the database.
- Weekends and rows in `holidays` are not bookable.

## 4. Data model

12 tables. Full DDL in `drizzle/`, schema in `src/lib/db/schema.ts`.

```
floors ─┬─ zones ── seats ── bookings ─┬─ users
        └─ meeting_rooms ── room_bookings
users ── badge_events
bookings/room_bookings ── notification_log
holidays · settings (singleton) · audit_log
```

Load-bearing details:

- `seats.plan_x` / `plan_y` / `rotation_deg` are in **plan coordinate space**,
  not pixels, and come from the architect's drawing via
  `npm run build:floorplan`. `src/data/floorplan/seats.json` is the source of
  truth; the seed reads it and `/admin/floor-plan` writes back to it. One plan
  unit is 70.5556 mm (the drawing plots at 1:200).
- `seats.status` (`bookable`/`fixed`/`blocked`/`decommissioned`) is the desk's
  own state. The seven **visual** statuses are a different, richer vocabulary —
  they combine seat status with the viewer's relationship to a booking.
- `bookings.booked_by_user_id` vs `occupant_user_id` — different when someone
  books on behalf of a colleague. Analytics must count the **occupant**.
- `badge_events` is a stub with no feed behind it, modelled now so a real reader
  webhook lands later with no schema change.
- `settings` is a singleton, enforced by a unique index on `((true))`.

## 5. Integrations, none of them connected

| Interface | Production target | Blocked on |
|---|---|---|
| `AuthProvider` | Microsoft Entra ID | Tenant app registration |
| `MailProvider` | Graph `sendMail` | `Mail.Send` consent + service account |
| `CalendarSync` | Graph `/events` | Room resource mailbox list — **and a decision about who owns room booking, see A17** |
| `CheckInSource` | Badge reader webhook | Vendor and export format unknown |

Each has a demo implementation good enough to demonstrate the whole flow and a
production stub that throws with a TODO naming the exact wiring. `APP_MODE`
selects between them in one file.

## 6. Time

Everything is reasoned about in **Asia/Kolkata**. Business logic reads time from
a `Clock`, never from the system — see the clock rule in `CLAUDE.md`. This is
what lets the demo advance the clock and have the real auto-release job produce
a real release.

## 7. Design principles

1. **Analytics is the product.** If a decision makes booking marginally nicer
   but occupancy data less trustworthy, it is the wrong decision.
2. **Professional services, not consumer SaaS.** Hairlines, 4px radius, no
   gradients, no shadows. It should look printed.
3. **Gold is rationed.** Under 5% of pixels, three sanctioned uses.
4. **Colour is never the only cue.** Seven seat statuses, each with a border
   treatment and glyph, verified desaturated on `/styleguide`.
5. **The database keeps its own integrity.** Race conditions are solved where
   they occur.
6. **Every assumption is written down.** Three questions are open with the
   client; `ASSUMPTIONS.md` is the list, with file references.

## 8. Roadmap

**Phase 1 — Foundation ✅**
Repo, pinned stack, design system, 12-table schema, both database constraints
with concurrency proofs, clock service, four adapters, realistic seed
(141 desks, 141 people, 45 working days of bookings), app shell, `/styleguide`.

**Phase 2 — CAD pipeline and 2D floor plan ✅**
`npm run build:floorplan` reads the 44 CAD layers with a stdlib PDF interpreter
and writes walls, zones, seat anchors and a baked texture into
`src/data/floorplan/`. 130 of 141 desks (92.2%) were located from the drawing's
own geometry by detecting the repeated chair block; 11 were interpolated and are
flagged as such. `/floor` renders the linework as one raster with 141 real
`<button>` seats over it, with pan/zoom, zone focus, a list view and the state in
the URL. `/admin/floor-plan` drags, rotates and retires desks and exports the
corrections back to the committed geometry.

**Phase 3 — Booking engine ✅**
Book, amend and cancel against the database constraints, with `23505` and
`23P01` handled as ordinary "someone just took that desk" outcomes. Editing is a
cancel-and-rebook inside one transaction, so a lost race leaves the original
booking intact. On-behalf booking for managers and above. Meeting rooms over
arbitrary ranges, with a one-way calendar sync that cannot lose a booking when
Graph is down. Auto-release as one conditional `UPDATE … RETURNING` per
transition — idempotent, concurrency-safe, and driven by the shared Clock, so
advancing the demo clock makes the real job run the real rule. Real QR check-in
at `/checkin/<seat_code>` with a printable sticker sheet. Eight notification
kinds as real HTML, queued inside the booking transaction and viewable at
`/admin/notifications`. ADR-007's `starts_at` drift is closed: editing slot
definitions backfills every affected booking in the same transaction.

The brief's eighteen edge cases are `tests/integration/phase3-edge-cases.test.ts`,
numbered to match. 138 tests, up from 83.

**Phase 4 — 3D floor plan**
R3F v9 `mode="3d"` inside the existing `<FloorPlan>`, over the same seat array,
the same store and the same status vocabulary. `walls.json` is 252 pre-simplified
polygons ready to extrude, and `meta.json.mmPerUnit` converts to real dimensions.

**Phase 5 — Admin analytics and deploy**
⚠️ The headline number — peak observed occupancy against the bookable pool —
cannot be finalised until **A1** and **A16** close; together they fix its
denominator. Phases 3 and 4 are not blocked by either.

The actual product: occupancy by day, zone, team and bay; desks held versus
desks needed; no-show reporting; seat inventory management; the notification
outbox. Full accessibility pass. Deploy.

## 9. Open questions

See `ASSUMPTIONS.md`. The five that block real use:

1. **The HR list** — how the 54 CAs split Manager / Assistant Manager, and who
   holds an allocated seat. This sets the denominator for every number the
   product reports.
2. **Which physical desks are fixed**, so the plan shows the right ones reserved.
   Now visible: the plan draws 47 specific desks as reserved, in their real
   positions.
3. **The real meeting rooms** — names, capacities and Outlook resource mailboxes.
4. **Who owns meeting room booking — this app, or Outlook?** If the six rooms
   already exist as Outlook resource mailboxes, staff will go on booking them
   from Outlook, our grid will show the hour free, and two groups will arrive.
   Our exclusion constraint is airtight for bookings made here and blind to
   bookings made there, and the calendar sync is one-way. CBVA has to choose
   exclusive booking rights for this app or two-way sync. Full statement in
   ASSUMPTIONS A17. **This is new in Phase 3 and it is the one that can
   embarrass the product in front of staff.**

5. **Does anybody sit in Zone B?** Phase 2 detected 33 unclaimed chairs in the
   north-west wing, which the drawing marks "NO CHANGE AREA", labels "MODULAR
   FURNITURE" and gives no pax count. Zone A's 46 unclaimed chairs *are*
   explained — boardroom, conference rooms and reception lounge — but Zone B's
   are not. If those are staff desks the bookable pool is 115–126 rather than
   93, so utilisation is overstated by 24–36% relative. Full derivation in
   ASSUMPTIONS A16.
