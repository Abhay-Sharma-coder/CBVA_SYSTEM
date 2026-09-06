# Open questions for CBVA

Everything in this list was decided by us because we had to decide something to
build. None of it has been confirmed by CBV & Associates. Each entry says what
we assumed, why, and — the part that matters — **what changes if the answer is
different**.

Most of these are now a screen rather than a code change. Where that is true it
says so, and names the screen.

**Read the first four and ignore the rest if you are short of time.** They are
the ones that change numbers you would act on.

---

## 1. How do the 54 CAs split between Manager and Assistant Manager?

**We assumed** 22 Managers (allocated desk) and 32 Assistant Managers (must
book).

**Why it matters more than anything else here.** This single split sets the
denominator for every occupancy figure in the product. We seeded 94 people who
must book against 94 bookable desks, so demand and supply balance exactly — and
that balance is an artefact of our guess, not a finding.

If the real split is 15/39, demand rises to 101 against 94 desks and the floor
is **structurally short**, which is close to the opposite of what the current
report says. We cannot answer your question with a number we invented.

**What we need:** an HR list — name, email, grade, team, and whether the person
holds an allocated desk.

**Where the answer goes:** Admin → People. Grade and seat mode are editable per
person; nothing is deployed.

---

## 2. Is Zone B used as a workspace on a normal day?

**We now know what it is.** We went back to your furniture layout and read it at
the vector level. Zone B — the north-west wing — is drawn as a **flexible
room**, and the drawing is unusually clear about it:

| | |
|---|---|
| Seat-count annotations anywhere in the wing | **none** |
| Workstation hatch (either type in your legend) | **none** |
| Foldable-table hatch | **714 marks — more than the rest of the floor combined** |
| Your own note, inside this wing | *"Foldable table on castors: 2'-9" x 4'-0" = 5 nos, 2'-6" x 5'-0" = 3 nos"* |

So the 33 chairs we could not explain last time are explained: eight foldable
tables on castors, a sofa lounge, and the storage credenzas along the outer
wall. That wing is now drawn with all of it, and labelled, so you can see what
we are describing.

**What we still cannot tell from a drawing** is how you use it. So the question
is no longer "does anybody sit there":

> **Zone B is drawn as a flexible room with eight foldable tables on castors.
> Do staff work there on a normal day, or is it used only for training and
> all-hands?**

**Why it matters less than it did.** We can now finalise the occupancy figures
against a bookable pool of 93 rather than holding them back. If you tell us
staff work there daily, those desks become bookable and every percentage comes
down — but that is an upside correction we can apply later, not a reason to
distrust the numbers now. Previously this question and question 1 together were
holding up the headline figure. Now only question 1 is.

---

## 3. Who owns meeting-room booking — this app, or Outlook?

**We assumed** this app, and built accordingly. **This is the one that can
embarrass the product in front of staff.**

The product enforces one booking per room per time range in the database, with a
constraint that cannot be raced. That guarantee holds for bookings made **here**.
It says nothing about a meeting booked in Outlook.

If the six rooms already exist as room resource mailboxes — and in a Microsoft
365 tenant they almost certainly do, because that is how anybody books a room
from the Outlook picker today — staff will go on booking them the way they
always have, our grid will show the hour as free, somebody will book it, and two
groups will arrive. The calendar sync we built is **one-way**: Outlook will know
about our bookings, nothing tells us about theirs. A one-way sync cannot prevent
a conflict, only announce one.

**We need one of two decisions, and it is yours:**

1. **Exclusive booking rights.** The room mailboxes are configured so only this
   application's service account may book them, and everyone is directed here.
   Simplest to build and the only option that makes our guarantee true. It costs
   staff the Outlook room picker they are used to.
2. **Two-way sync.** We subscribe to Graph change notifications per room mailbox
   and mirror external bookings in before showing the grid. Keeps Outlook
   working, but the guarantee weakens from "impossible" to "usually caught
   quickly".

Desk booking is unaffected — desks have no second system.

---

## 4. Which physical desks are allocated, and to whom?

**We assumed** a plausible 47: the cabins and perimeter bays to Partners,
Directors and Managers, bay C3 to admin/HR/IT, and both passage runs left in the
bookable pool.

**Why it matters.** The floor plan now draws 47 specific desks as reserved, in
their real positions. Anybody at CBVA opening it will recognise their own bay
and see the wrong desks greyed out — which undermines confidence in everything
else on the screen, including the parts that are right.

**Where the answer goes:** Admin → Seats. Allocating a desk to a person is a
dropdown; it takes about five minutes for all 47.

---

## 5. What are the five meeting rooms called?

**Corrected since we last wrote.** We had six rooms from a first reading of the
drawing: Boardroom 25, Conference A 10, Conference B 8, Meeting Room 1 7,
Meeting Room 2 6, Huddle Room 4. Re-reading it properly, there are **five**, all
in Zone A, and each one is tagged and counted on your own drawing:

| Bay | Seats | What we are calling it |
|---|---|---|
| A3 | 25 | Boardroom |
| A9 | 10 | Meeting Room A9 |
| A8 | 7 | Meeting Room A8 |
| A7 | 5 | Meeting Room A7 |
| A6 | 5 | Meeting Room A6 |

Two of our capacities were wrong and one room did not exist. **The counts are
now yours, not ours** — they come from the pax annotations beside each bay tag,
and they reconcile: 25+10+7+5+5 = 52, plus the 8-seat workstation run in A1/A2
is 60, which is exactly the zone-A total on the sheet.

**Two things we still need:**

1. **The names.** We have used your bay tags rather than inventing names, so
   "Meeting Room A9" is a placeholder you can replace. You will have your own.
2. **The Outlook room resource mailbox** for each one. Null on all five rows,
   and it is what blocks the calendar sync regardless of how question 3 is
   answered.

---

## 6. The slot boundaries

**We assumed** AM 09:00–13:00 and PM 13:00–17:00, Asia/Kolkata. These are the
values in the brief; they have not been confirmed by anybody at CBVA.

**Note what they imply:** the office day they describe is 09:00–17:00, so
nothing is bookable in the evening. If people routinely stay past five, PM's end
is wrong and every "attended" figure is measuring a window that closes before
people leave.

**Where the answer goes:** Admin → Settings. Editing a boundary recomputes every
affected booking's stored times in the same transaction. Moving to hourly
booking is also a settings change here rather than a rebuild.

---

## 7. The booking window, the cut-off, and the check-in window

**We assumed** five working days bookable ahead, edit and cancel close 60
minutes before a slot, and check-in opens 30 minutes before.

The **two-hour auto-release is from your brief**, so that one is solid. The
others are invented and are all editable in Admin → Settings.

**One thing to watch if you change the grace window:** it must stay well under a
slot length. A grace window longer than the slot means an un-checked-in booking
can never be released — by the time the window expires the slot is over — which
silently removes the feature rather than breaking it visibly.

---

## 8. The public holiday list

**We assumed** 39 national and Maharashtra holidays across 2026–2027.

Every firm publishes its own list, and the lunar-calendar dates (Holi, both Ids,
Diwali, Janmashtami) vary by observance. **A wrong date here means staff cannot
book a day they are expected in**, which is the most user-visible way this
product can be wrong.

**Where the answer goes:** Admin → Settings → Public holidays. Replace the list
with your official circular.

---

## 9. How should a released desk be counted? — **we deliberately have not answered this**

When somebody books a desk and never turns up, the two-hour rule hands it back.
How much of that slot did they consume? There are three defensible answers and
the product shows **all three side by side** rather than picking one:

| Measure | Counts | Does not tell you |
|---|---|---|
| **Seats booked** | Every desk claimed, whether or not anybody came | That a claim is not use |
| **Seats attended** | Desks somebody actually checked into | Anybody who came in and never scanned |
| **Seat-hours consumed** | How long each desk was really held — a PM desk released at 15:00 consumed two hours, not four | — |

The one judgement inside the third measure that we would like you to confirm: a
booking nobody checked into **but which was never released** (the slot ended
first) is counted as consuming the **whole slot**, because nobody else could
have that desk for one second of it. The report shows the alternative alongside,
and the gap between the two is itself the cost of no-shows.

**Where to see it:** Admin → Analytics, the "Measure" control, with the
explanation on screen beside it.

---

## 10. A QR scan proves a booking, not a body in a chair

**We assumed** that scanning the sticker on a desk, while signed in and holding
that desk for the running slot, is good enough evidence the desk is in use.

**Stated plainly because the analytics is the product.** The URL is printed on a
desk in an open-plan office, so it is not a secret and is not treated as one —
identity comes from the session. Somebody at home who knows the seat code and
holds that booking could check in without being in the building. Nothing in this
flow prevents that.

What it does establish is stronger than the alternative: a door swipe proves
somebody reached the floor but says nothing about which desk, and desk-level
occupancy is the number you are commissioning. The product records **which kind
of evidence** each check-in is (`qr`, `badge`, `app`, `admin`) and never blends
them.

**The strong pair is both** — a badge at the door plus a QR at the desk gives
presence and location. The schema is ready for it; we need your badge vendor and
their export format.

---

## 11. Who may book on behalf of somebody else

**We assumed** administrators, plus Manager, Director and Partner grades.

This follows your own grade table ("Managers book on behalf of their team") and
adds the admin/HR/IT staff who seat people for a living. **One direction we may
have got wrong:** partners' secretaries are admin staff and so are covered, but
if you have a designated bookings coordinator per team who is *not* a manager,
they are currently locked out.

---

## 12. Eleven desks are drawn in a position we inferred — **ours to fix, not yours**

130 of the 141 desks were located from the drawing's own geometry. Eleven could
not be, and were inferred. Until this phase they overlapped their neighbours —
one was six centimetres from another desk, which is one desk drawn twice.

They have been re-placed at the drawing's own measured 1.62 m workstation pitch
and no two desks now overlap. **They are still inferred**, and we have left them
flagged as such rather than pretending otherwise.

Closing it properly needs fifteen minutes in Admin → Floor plan with somebody
who knows the floor. It affects where a desk is *drawn*, never whether it exists
or what it is counted as, so no occupancy number depends on it.

The eleven: C1-06, C3-08, C3-09, C6-08, C6-09, C7-04, PA-16, D1-08, D1-09,
D7-04, D8-04.

---

## 13. Smaller things we invented

| | We assumed | Changes if wrong |
|---|---|---|
| **Email format** | `firstname.lastname@cbva.in` | Nothing until cutover, when `users.email` becomes the join key to your Entra tenant |
| **Everyone is on Floor 4** | One active floor | Adding another is data, not a migration |
| **Zone names for C and D** | C "Audit Floor", D "Tax & Advisory" | Labels only, and **these two are guesses** — your drawing labels the wings A–D and never says what the people in them do. A and B we have corrected from the drawing: Zone A is the boardroom and meeting rooms, Zone B the flexible room. |
| **Desk types per bay** | Passage seats on PA/PD, cabins in A1/A2/D5, foldables in C7 | Cosmetic. The C7 foldables are a guess made so the type has a live example |
| **One blocked desk (PD-18)** | Out of service | Entirely invented, so the status has a live example and capacity is not simply the desk count |
| **Office hours 08:00–20:00** | The bounds of the meeting-room grid | Only the columns the grid draws |
| **Staff names** | 141 generated Mumbai-plausible names | Replaced by the HR list in question 1 |
| **Every height in the 3D view** | Walls 2.7 m, partitions 1.35 m, desks 0.74 m | Looks slightly off; no number changes. Partition height decides what you can see over, so it is the one worth confirming |
| **The clock is shared** | One demo clock for the whole database | If two people demo at once, one advancing the clock moves it for the other |

---

## What we would ask for first

If you can only answer three things:

1. **The HR list** (question 1) — it is the denominator for everything, and it
   is now the *only* thing holding the headline figure back.
2. **Who owns room booking** (question 3) — the one that can embarrass the
   product in front of staff.
3. **Zone B** (question 2) — one sentence. It no longer blocks the numbers, but
   it decides whether the bookable pool is 93 or nearer 115.

Questions 4, 5, 6 and 8 are all now screens in the admin area. You can answer
them yourselves in an afternoon, and nothing needs to be deployed.
