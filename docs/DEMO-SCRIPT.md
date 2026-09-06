# The ten-minute walkthrough

**URL:** https://cbva-workspace.vercel.app

For whoever is presenting. It assumes you have not seen the product before and
tells you which control to touch, in order. Timings are generous; the whole
thing fits in ten minutes with room to be interrupted.

**The one thing to hold on to:** the booking flow is how the data gets
collected. The analytics is what CBVA bought. Everything before minute seven is
you earning the right to show them minute seven.

---

## Before you start — two minutes, alone

1. Open the URL. Check the **role switcher** (top right) reads **Aarav Agarwal —
   Partner (Admin)**. That is the default; if it says anything else, switch back.
2. Check the **clock readout** next to it. If it shows a gold `Clock +Nh` badge,
   press **Reset** — a previous run left the demo clock advanced.
3. Open the **Demo controls** panel (bottom right, flask icon) and leave it
   closed again. You just want to know where it is.
4. Open a second tab on **Admin → Analytics → Trends** and leave it there. It
   takes a few seconds to compute and you do not want to wait on it in front of
   people.

> **If more than one person is driving a demo at the same time, read this.**
> The demo clock is one shared value in the database. If a colleague advances
> the clock in another room, it moves for you mid-sentence. Agree who has it.

---

## 1 · The floor, 60 seconds

**Go to Floor Map.**

> "This is Floor 4 as your architect drew it. It is not a redrawing — that is
> the actual sheet, in the drawing's own colours, with 141 desks on top of it."

*The plan carries the architect's linework at full fidelity now: every hatch in
its own colour, the line weights the drawing uses, and the storage credenzas —
which are embedded photographs in the PDF, not vector geometry, and were
invisible to us until this phase. If somebody says "that looks like our
drawing", that is exactly the intent.*

**Start zoomed out and say what you are looking at, because the plan answers a
different question here.**

> "At this zoom you are not picking a desk, you are reading the floor. Each bay
> shows how many of its bookable desks are taken — eight of sixteen on the
> passage run, nine of seventeen down there. That is the whole floor in one
> glance."

- **Zoom in twice.** The bay counts fade out and the per-desk statuses appear.

> "Now you are choosing a desk, so now it shows you desks."

*Why this matters, if anybody asks: at whole-floor zoom a desk is about eleven
pixels across. Seven different statuses at eleven pixels is a colour chart
nobody can read. So past a threshold it stops trying and answers the question
that zoom actually asks.*

- Point at the **legend**. Note that every status has a **shape or a glyph as
  well as a colour** — these screens get printed in greyscale.
- Click **Zone C** in the zone filter. The plan focuses; the counts update.
- Click **3D view**.

> "Same desks, same data, same booking dialog — it is one floor plan with two
> renderings, not two products."

- Press **Top down**. Let it settle.

> "Looking straight down, this is the drawing again. That is the point of the
> 3D view: it is faithful, not decorative."

*The bay counts are there in 3D too, lying flat in the plan, and they hand over
to per-desk status as you fly in — the same threshold, the same rule.*

- Switch back to **Plan**.

*If somebody asks why it is not the default: it is not the keyboard-operable
view, and the plan is. 3D is one labelled control away, never where you land.*

---

## 2 · Booking a desk, 90 seconds

**Switch the role to _Ananya Gokhale — Article_.**

> "Article grade. She has no allocated desk, so she books one for each day she
> comes in — that is the group the policy actually affects."

- On **Floor Map**, pick **tomorrow** on the date strip (the next working day).
- Click desk **C5-03** (Zone C, bay C5 — it is free).
- In the dialog, turn on **"Book this desk every Monday"** *(the weekday will
  match whatever date you picked)*.
- **Confirm booking.**

> "One booking, and it now repeats. Each new day books itself as it comes into
> the five-day window. If somebody takes the desk first on one of those days she
> gets an email about that day only — the rest of the series carries on."

- Go to **My Bookings**. The desk is there.
- Click the **My desk** tab. The recurring booking is listed with the days it
  covers.

---

## 3 · Who is in, 45 seconds

**Go to Who's In.**

> "This is the screen people will actually open. Every review of every product
> in this category says the same thing: the reason somebody opens a desk-booking
> app is to find out whether their team is in."

- Point at the totals: about **107 people in**, grouped by team.
- Point at a row badged **allocated desk**.

> "Partners and managers are in here too. They never book — they just have a
> desk — so a roster without them would be missing most of the people you are
> looking for."

**Why it is in the product at all, if asked:** your seat contention is low. If
people find they can always get a desk, they stop bothering to book, and
occupancy data nobody generates is worth nothing. This is the cheapest thing
that gives somebody a reason to open the app on a day they were not going to
book anything.

---

## 4 · Releasing an allocated desk, 45 seconds

**Switch the role to _Aarav Agarwal — Partner (Admin)_.**

- **My Bookings → My desk** tab. It shows **A1-01, your desk**.
- Pick tomorrow from the dropdown and press **Release for that day**.

> "He is working from home. Two things just happened. Somebody else can now
> book A1-01 — and, more importantly, that desk has entered the occupancy data
> for the first time."

**Say this part slowly, it is the one partners react to:**

> "You have 47 allocated desks. Today they are invisible to any measurement:
> an empty allocated desk is counted as neither used nor free. This is the only
> mechanism by which those 47 ever get measured."

*Already-released desks you can point at instead if you would rather not create
one: **A1-03** and **D8-04** on Monday 7 September, **C1-02** on Tuesday 8th.*

---

## 5 · The two-hour rule, 90 seconds — the part that proves the product is real

**Switch to _Ananya Gokhale_. Go to Floor Map, today's date.**

Find her desk (gold rule around it — the only place gold is load-bearing).

- Open **Demo controls** → press **+2 hours**.
- Press **Run jobs now**.
- Close the panel. The plan refreshes.

Her desk is now **Auto Released** — dotted border, `↺` glyph.

> "That was not a simulation. Advancing the clock moved a value in the database
> that the server and the browser both read, the real scheduled job ran the real
> rule against the real booking, and the desk really went back to the pool."

- Go to **Admin → Outbox**. The **Desk auto-released** email is there, rendered.

> "The message was written inside the same transaction as the release, so a
> booking can never be settled without its notification existing. Delivery is a
> separate step that cannot roll it back."

- **Press Reset on the clock before moving on.**

---

## 6 · Checking in, 30 seconds — optional, skip if you are behind

**Admin → QR sheet.**

> "One sticker per desk. Scanning it while signed in checks that person in to
> **that desk** — which is what makes the occupancy figure desk-level rather
> than door-level. A badge at the door proves somebody reached the floor; it
> does not tell you which desk they used. We record which kind of evidence each
> check-in is and never blend them."

---

## 7 · The analytics — four minutes, and this is what they are buying

**Switch to your second tab: Admin → Analytics.**

### Trends first — the headline

Read the sentence at the top out loud. It says something close to:

> "Over 40 working days the busiest single slot saw **76 desks** in use against
> a bookable pool of **93**. Even at its fullest the floor had 17 desks spare."

Then point at the four figures beneath it:

- **Peak 76** — the busiest moment in two months.
- **95th percentile 76** — what you would actually size against. One peak is an
  anecdote.
- **Median 63** — the typical half-day.
- **94 people** booking.

> "The gap between the median and the peak is what you are paying for peak-day
> capacity."

**Point at the caveat paragraph underneath and read it.** Do not skip this.

> "Two things make that denominator provisional — the Manager / Assistant
> Manager split, and whether anybody sits in the north-west wing. If Zone B is
> occupied the pool is nearer 115 and every percentage here is overstated by
> about a quarter. Both are one sentence from you."

### The day-of-week chart

> "Wednesday is the busiest day and Monday the quietest. That is the shape a
> one-day-a-week work-from-home policy makes — and it is the argument for
> sizing the floor to a typical day rather than to the peak."

### The bay heat map

> "Each bay against its own desk count, so a small bay that is always full reads
> as dark as a large one. The passage runs sit at 38–59%; the workstation bays
> run 67–100%. Those are your least-used desks, and the table at the bottom of
> this page names them individually."

### The three measures — the honest bit

Point at the **Measure** dropdown and the explainer beside it.

> "You have not told us how to count a desk somebody booked and never used, so
> we have not decided for you. Seats booked, seats attended, and seat-hours
> consumed are all here over the same filters. The difference between them is
> itself a finding — it is what no-shows cost you in desks."

### Then Today and Forecast

- **Today** — live, refreshes on its own.
- **Forecast** —

> "The next five working days. This is the thing you said you have no way to see
> today: whether tomorrow is going to be full."

### Finish on an export

Press **Occupancy** in the filter bar. A CSV downloads.

> "Everything on screen, over exactly the filters you are looking at, in Excel."

---

## 8 · Close, 30 seconds

> "Everything you have seen runs against a real Postgres database with eight
> weeks of history. The four integrations you cannot connect yet — sign-in,
> email, the room calendar and the badge reader — sit behind interfaces with a
> demo implementation and a production stub. Going live is wiring four adapters,
> not rewriting anything."

Hand over `docs/OPEN-QUESTIONS.md`.

---

## What to say if they raise one of the open questions

Short answers. The full versions are in `docs/OPEN-QUESTIONS.md`.

**"Why do zones C and D just say Zone C and Zone D?"**
> "Because your drawing does not say what the people in those wings do, and we
> would rather leave it blank than guess on your screen. If they map to teams,
> tell us and we will label them — it is one line in Admin → Settings."

**"Are those the right desks marked as reserved?"**
> "Almost certainly not — we invented that allocation. It is a dropdown per desk
> in Admin → Seats; you can fix all 47 in about five minutes."

**"Where did 22 Managers and 32 Assistant Managers come from?"**
> "We invented it, and it is the most important number in the product because it
> sets the denominator for everything. We need your HR list. It is typed into
> Admin → People, not deployed."

**"Nobody sits in Zone B."** *(or "people do")*
> "That is the second question we need answered. If they do, the pool is nearer
> 115 than 93 and every percentage on the trends screen is overstated by about a
> quarter."

**"We book meeting rooms in Outlook."**
> "Then we have a problem to solve together, and it is the one that could
> embarrass this in front of your staff. We stop double-booking for anything
> booked here; we are blind to anything booked in Outlook, and our calendar sync
> is one-way. You need to choose: either the rooms are booked here exclusively,
> or we build a two-way sync. It is written up as question 3."

**"Those are not our room names."**
> "They are ours — the capacities came off your drawing, the names did not."

**"Can we book by the hour instead of half-days?"**
> "Yes, and it is a settings change rather than a rebuild. Admin → Settings, the
> Slots table. Editing a boundary recomputes every affected booking's times in
> the same transaction."

**"Those holidays are wrong."**
> "Very likely — we generated them. Admin → Settings has the list. Replace it
> with your circular; a wrong date means somebody cannot book a day they are
> expected in."

**"Could somebody check in from home?"**
> "Yes, if they know the desk code and hold that booking. The QR on a desk in an
> open-plan office is not a secret and we do not treat it as one. It still tells
> you more than a door swipe, which proves somebody reached the floor but not
> which desk. The strong version is both, and the schema is ready for it."

**"What happens when a desk is released — does that count as used?"**
> "That is a decision we have deliberately left to you. All three ways of
> counting it are on the analytics screen side by side, with the reasoning."

---

## If something goes wrong

| | |
|---|---|
| **The floor looks empty or wrong** | Somebody left the clock advanced. Press **Reset** on the clock readout, then **Run jobs now** in the demo panel. |
| **A screen is stuck loading** | The first load of the analytics after a quiet period is slow — the database is in Singapore and the deployment cold-starts. Give it ten seconds. |
| **One card says "could not be drawn"** | That is a widget error boundary doing its job. The rest of the page is fine; reload. |
| **You are signed in as the wrong person** | Role switcher, top right. It is a demo control and is labelled as one. |
| **The 3D view shows the 2D plan with a notice** | The browser could not give it a graphics context. That is the designed fallback, not a failure — carry on with the plan view. |

---

## The two-minute version, if that is all you get

1. **Floor Map** — the real drawing, live bookings, 3D toggle.
2. **Demo controls → +2 hours → Run jobs** — the desk auto-releases for real.
3. **Admin → Analytics** — read the headline sentence and the day-of-week chart.

Peak 76 against 93 desks; Wednesday busy, Monday dead. That is the whole
argument.

---

## The fifteen-minute job worth booking before go-live

**Not part of the demo. Offer it at the end, to whoever knows the floor best.**

Eleven of the 141 desks are drawn in a position we *inferred* rather than read
off the drawing — the drawing genuinely does not say where those chairs are.
They no longer overlap anything and no occupancy number depends on them; it is
only where a desk is **drawn**. But somebody from CBVA can close it properly in
about a quarter of an hour, and it is the last inferred thing on the screen.

**The loop, start to finish:**

1. Open **Admin → Floor plan**. The eleven are listed and badged
   `11 interpolated` — the corrector starts there and nowhere else.
2. **Drag each one** to where the desk actually is. Rotate if it faces the wrong
   way.
3. Press **Export**. That writes the corrections back into
   `src/data/floorplan/seats.json`, marked `manual`, and arrives as a reviewable
   diff rather than a silent database edit.
4. `npm run seed` carries them into the database.

**A `manual` position now outranks the drawing permanently.** Rebuilding the
geometry from the PDF (`npm run build:floorplan`) preserves every manual anchor
verbatim and regenerates only the detected and interpolated ones. Until Phase 7
it did not — a rebuild silently reverted every correction, which made this loop
quietly pointless. It is worth knowing that was true, because it is the reason
the eleven are still inferred.

The eleven: C1-06, C3-08, C3-09, C6-08, C6-09, C7-04, PA-16, D1-08, D1-09,
D7-04, D8-04.
