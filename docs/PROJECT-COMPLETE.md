# CBVA Workspace — what was built

Seven phases. A desk and meeting-room booking system for CBV & Associates LLP,
Mumbai, whose actual deliverable is the occupancy analytics that lets partners
right-size desk count against headcount.

**Live: https://cbva-workspace.vercel.app**

This document is the short version: what exists, what CBVA can change without
us, what we assumed, and what is still owed. The engineering record is
`DECISIONS.md` (48 ADRs), `ASSUMPTIONS.md` (29 entries) and seven phase
handoffs. The thing to send CBVA is `OPEN-QUESTIONS.md`.

---

## 1 · What was built

**The floor.** The architect's own furniture layout, read straight from the PDF
by a dependency-free parser and baked into a texture that preserves the
drawing's 29 colour combinations, 8 line weights, mixed joins, fills and its 11
embedded photographs. 141 desks sit on it as real `<button>`s — 130 located from
the drawing's own geometry, 11 inferred and still flagged as such. Pan, zoom,
zone focus, a list view, and every bit of state in the URL. The same seat array
renders in 3D through one `next/dynamic` boundary, so `/floor` costs 6 kB more
than it did. Past a zoom threshold both views stop drawing per-seat status —
unreadable at that distance in principle — and answer the density question
instead.

**The booking engine.** Book, amend and cancel against two database
constraints, with `23505` and `23P01` handled as ordinary "somebody just took
that desk" outcomes rather than errors. Editing is a cancel-and-rebook inside
one transaction, so a lost race leaves the original booking intact. On-behalf
booking for managers and above. Meeting rooms over arbitrary ranges with a
one-way calendar sync that cannot lose a booking when Graph is down.
Auto-release as one conditional `UPDATE … RETURNING` per transition —
idempotent, concurrency-safe, bounded, and driven by a shared clock so the demo
proves production behaviour rather than imitating it. QR check-in on a printable
sticker sheet. Eight notification kinds queued inside the booking transaction.

**The analytics, which is the product.** Today, Forecast and Trends over one
measure vocabulary, with **all three candidate occupancy measures side by side**
— seats booked, seats attended, seat-hours consumed — because the auto-release
accounting question is genuinely open and picking one for the client would put
an invented assumption into a board pack. CSV export over the same filters.

**Five admin screens**, so that answering an open question is typing rather
than deploying.

---

## 2 · What CBVA can change without us

This is the part worth reading. Nine questions were open at the start; five
became screens.

| | Where |
|---|---|
| Who holds an allocated desk, and which desk | **Admin → Seats**, a dropdown each |
| Slot boundaries — and moving to hourly booking | **Admin → Settings**. Editing one recomputes every affected booking's stored times in the same transaction |
| Booking window, cut-off, check-in window, auto-release grace and its safety cap | **Admin → Settings** |
| The public holiday list | **Admin → Settings** |
| Meeting room names | **Admin → Seats**. Rooms join on the architect's bay code, not the name, precisely so the name is free to change |
| Zone names | **Admin → Settings** |
| Where the eleven inferred desks actually are | **Admin → Floor plan**, ~15 minutes, exports to a reviewable diff |
| People, grades, teams | **Admin → People** |

Nothing in that table needs a deploy, and none of it needs us.

---

## 3 · What is assumed

Every assumption is in `ASSUMPTIONS.md` with the file it affects. The ones that
change numbers:

- **The Manager / Assistant Manager split (A1)** — 22/32 is ours. It sets the
  denominator for every occupancy figure, and it is the only thing still holding
  the headline number back.
- **Which 47 desks are allocated (A2)** — a plausible invention. Visible on the
  plan, so a partner will recognise it as wrong immediately, and correctable in
  five minutes.
- **Slot boundaries (A4)**, the holiday list (A6), office hours (A18), the
  check-in window (A20) — all from the brief or invented, all editable.
- **Every vertical dimension in the 3D view (A23)** — the drawing is a plan and
  carries no section. The plan dimensions are real; the heights are plausible
  office numbers.
- **Eleven desk positions (A24)** — inferred, flagged, de-collided, and closable
  by hand in the editor.
- **How a no-show is charged (A25)** — both accountings ship side by side, and
  the gap between them is itself the reportable cost of no-shows.

What is **not** assumed, because the drawing settles it: 141 desks (confirmed
three independent ways), five meeting rooms and their capacities, the building
envelope, which wings hold no bookable desks, and that Zone B is a flexible room
rather than a bank of desks.

---

## 4 · What CBVA still owes

Three things, in `OPEN-QUESTIONS.md`, written to be sent as-is.

1. **The HR grade list** — name, email, grade, team, allocated seat or not.
   Nothing else is as important. Note the structure partners will otherwise
   miss: the bookable pool and the number of people who must book are the same
   quantity seen from two ends, so they balance at *any* split. The balance is
   arithmetic, not a finding. What the split decides is whether the floor is
   short by seven or slack by sixteen.
2. **Is Zone B used as a workspace on a normal day?** The drawing says it is a
   flexible room — zero PAX annotations, zero workstation hatch, 714
   foldable-table hatch paths, and the architect's own castors note inside the
   wing. A drawing cannot say how people use it. One sentence closes it.
3. **Are the five meeting rooms already Outlook resource mailboxes?** The one
   most likely to embarrass the product in front of staff. Our constraint is
   airtight for bookings made here and blind to bookings made in Outlook, and a
   one-way sync can announce a conflict but never prevent one. CBVA chooses
   exclusive booking rights or two-way sync. **Desk booking is unaffected** —
   desks have no second system.

Plus the four integrations, all stubbed behind interfaces with production TODOs
naming the exact wiring: Entra ID, Graph `sendMail`, Graph `/events`, and the
badge feed. `DEMO-TO-PRODUCTION.md` estimates 8–13 working days, about half of
it blocked on CBVA rather than on us.

---

## 5 · The rules that hold it together

Six, and each exists because breaking it cost something:

1. **The clock rule.** No business logic reads the system clock. That is what
   lets a demo advance time and have the *real* auto-release job run the *real*
   rule against *real* rows — the demo proves production behaviour rather than
   imitating it, and every time-dependent test is deterministic for free.
2. **Slots are data, not a type.** Moving CBVA to hourly booking is a settings
   change, and a test proves the whole lifecycle on a slot key that did not
   exist when the code was written.
3. **The database keeps its own integrity.** Two constraints, no app-level
   pre-check, because a read-then-write has a race window and two people tapping
   Book at the same moment is exactly the case that must not double-book.
4. **The outbox is not a log.** Messages are written inside the booking
   transaction, so a committed booking always has its message and a send failure
   can never roll back a booking.
5. **`APP_MODE` is branched on in exactly one file.** Booking logic never knows
   which adapter is live.
6. **Colour is never the only cue.** Seven seat statuses, each with a border
   treatment and a glyph, verified desaturated on `/styleguide`.

---

## 6 · What this project kept learning

The same lesson, four times, in four disguises:

- Phase 5 fixed eleven desk positions **by hand, once**, and every rebuild
  silently reverted them while the gate reported success — because it compared
  two consecutive *builds* to each other, and two runs of a deterministic
  program always agree.
- Phase 6 deployed code that selected a column production had never been given,
  because `db:migrate` reads `.env.local`. `/rooms` went down, and the recovery
  cost eight weeks of demo history.
- Phase 6's `prod:check` then reported **"looks presentable" against three
  bookings** — greenlighting the exact damage it existed to catch.
- Phase 7 ran the e2e suite against the **production database**, because
  `next start` reads `.env.production.local`, and got 108/108 green while doing
  it.

**A false green is worse than a red.** A red is a bug; a false green is a bug
plus a reason not to look for it. Every one of those was found by looking at
something rather than by a check, and each is now closed by a guard that has
been **watched failing** before being trusted:

| guard | proven by |
|---|---|
| `build:floorplan` reproducibility | `git diff --exit-code` against the REPOSITORY, never a second build |
| the CAD audit | driven to failure two ways, exits non-zero, writes nothing |
| `prod:check` | driven to failure three ways against a damaged throwaway database, plus nine unit tests |
| the e2e target | `start:local` refuses any host but the local one |
| texture contrast | measured against the previous phase's texture, so a regression is visible and a pre-existing figure is not misreported |

---

## 7 · Numbers, as shipped

| | |
|---|---|
| Desks · people · bookable pool | 141 · 141 · 93 |
| Meeting rooms | 5, from the drawing, with their capacities |
| Seeded history | 5,804 bookings across 43 working days |
| Tables · migrations · ADRs | 12 · 5 · 48 |
| Tests | 240 vitest · 108 Playwright |
| axe | 25 surfaces, 0 critical, 0 serious, 0 moderate, 0 minor |
| 3D budget | 13 draw calls / 41,386 triangles against 60 / 120,000 |
| `/floor` First Load JS | 245 kB, with `three` lazy-only |
| CAD paths in the live DOM | 0 — the drawing ships as one raster |

---

## 8 · If you read one other file

`docs/OPEN-QUESTIONS.md`, and send it.
