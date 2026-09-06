# Phase 6 handoff

Visual fidelity to the architect's drawing. No seat identity, no seat count, no
booking logic and no analytics changed. Everything below has been run; where a
number appears it was measured, not estimated.

**Live: https://cbva-workspace.vercel.app**

---

## 1 · What changed, in one table

| | |
|---|---|
| The partition layer is filtered by stroke colour | 534 → **462** wall polygons; partition 157 → 85 |
| The build finally reproduces the repository | and the gate that said it did was **vacuously green** |
| Meeting rooms | 6 provisional → **5 from the drawing**, each carrying its bay code |
| Static furniture | **318** boxes, so zones A and B stop rendering as bare plate |
| Room labels | 2D text and a 3D floor decal, extracted from the drawing |
| **Not shipped** | `furniture_type` on seats, and the three desk variants that key off it. **The reconciliation gate failed.** §4 |
| Tests | **215** vitest, up from 203 |
| ADRs | 042–045 |

---

## 2 · The four findings, checked rather than trusted

All four were re-derived from
`tools/cad/09 -R8 - NB -FURNITURE LAYOUT - 12-06-2025.pdf` with the existing
stdlib parser. Two were confirmed exactly, one was confirmed and understated,
and one produced a classification that does not work.

### Finding 1 — the hatch colours ARE a machine-readable key. Confirmed exactly.

The PDF uses nothing but plain 3-operand DeviceRGB `RG`/`rg` — not one `sc`,
`scn`, `SCN`, `g`, `G`, `k` or `K` in the whole content stream — so recovering
colour is three branches in the interpreter. Path counts inside the building
reconcile with the brief to the unit: `#FF0000` **3,544** (333 A + 1,886 C +
1,325 D) and `#0037DD` **177**, splitting 44 in C and 133 in D exactly as
stated. The remainder in each case is a legend swatch sitting in a wedge
*between* wings, outside the shell, which the plan mask excludes.

One thing the brief's table omits: `F-FURNITURE HATCH` has a **fifth** colour,
`#B88A00`, 1,148 paths. It is not in the legend extract we were given and
nothing here depends on it, but anybody re-reading this drawing should know it
is there.

### Finding 2 — zones A and B are right in the data and were wrong in the renderer. Confirmed.

Zone A's six PAX annotations sum to 60 and pair to their bay tags within 33 plan
units: A3→25 (18.6), A9→10 (32.2), A8→7 (25.9), A7→5 (25.3), A6→5 (25.9), and
an `8 PAX` on the A1/A2 run (19.1). A4 and A5 carry none, correctly. Zone B has
zero PAX and zero workstation hatch of either colour.

**No seat was added.** `seats.json` was right; the renderer drew a mesh only
where a bookable seat existed. §5.

### Finding 3 — the wall source is 97% not walls. Confirmed, and understated.

| stroke | paths | length | extent |
|---|---|---|---|
| `#FF4405` | 5,012 | 34,916 | C and D wings only |
| `#0037DD` | 1,152 | 1,473 | one narrow vertical band |
| `#000000` | **200** | **9,347** | the whole floor |
| `#006EDD` | 52 | 351 | |
| `#8AB85C` | 28 | 398 | one 31×31 unit symbol |

**Where the brief is wrong:** "the rest collapse into about five small solid
bars". They do not. Run through the same chainer, the `#FF4405` paths produce
**37 polygons, 4,673 units of length, longest 472**. Filtering to black removes
**80 of the 157 partition polygons — 46% of the class, not a handful of bars.**

That is why this step was gated on a rendered before/after diff rather than on
counts. Every one of the 80 removed polygons lies inside a C or D workstation
bay along a bench run; no room divider and no part of the envelope goes. `wall`
and `glazing` came out identical in both count *and* total length.

### Finding 4 — the meeting room seed was wrong. Confirmed, twice, by different routes.

Once when the inventory was corrected, and again a commit later when the room
labels were extracted from the drawing's own tags. The two agree, and
`tests/unit/floorplan-geometry.test.ts` now asserts they keep agreeing.

---

## 3 · The building envelope — written down because it was not obvious

The brief asked where the cruciform outer shell comes from, on the grounds that
if it arrives accidentally it can vanish accidentally.

**It is `W-WALL`, and it arrives on purpose.** 165 black paths, bbox
`[89 109 1361 1058]` — the only layer touching all four edges of
`PLAN_BOX (85, 95, 1370, 1065)` — chaining to 71 polygons of which the longest,
858 units, is the outline itself with its 45° wing chamfers. `C- COLOUMN` adds
23 chains for the core ring. Both are named explicitly in `WALL_CLASSES` in
`tools/cad/build_floorplan.py`.

`P-FULLHEIGHT PARTITION` black is inset roughly 80 units on every side and is
interior dividers only — which is *why* filtering it cannot touch the shell.

Independent confirmation: `planmask` floods inward from the sheet border and
settles at 57.75% interior coverage, which is what a watertight cruciform does
and a leaking outline does not.

---

## 4 · Step 4 and Step 5 did not ship, and this is the reason

The brief set a hard gate: classify each of the 141 anchors by hatch colour, and
**produce exactly 93 `rapid_rail_workstation` and exactly 4
`screen_only_workstation` or nothing ships.** It does not reconcile. Nothing
shipped. No code for either step was written, so there was nothing to revert.

### What was tried, in order

| method | rapid | screen |
|---|---|---|
| bbox clustering + distance threshold, swept 6–20 units | 72–73 | 4–8 |
| bbox clustering, parameter-free nearest region | 78 | 22 |
| **true segment distance ≤ 12 units** (the correct geometry) | **68** | **7** |

The second method exposed a real methodological error worth recording: I had
been clustering **bounding boxes**, and a hatch line drawn diagonally across a
room has a bounding box covering the whole room. Rendering the regions showed it
immediately — `#4A9500` "8 foldable tables" appeared to cover half the D wing.
The third row is the corrected measurement.

### Why it is structural, not a tolerance to tune

**34 of 141 anchors have no hatch of any colour within 12 units** — C1 (6),
C6 (9), D1 (9), D2 (9), D5 (1). These are ordinary workstation bays confirmed by
the drawing's own PAX annotations, so they must be among the 93, and there is no
hatch under them to say so. D1 and D2 sit at a consistent **26.8–27.7 units
(1.89–1.95 m)** from the nearest `#FF4405` and 31–115 units from any `#FF0000`.

The likely reason: the hatch marks a **desktop surface treatment per bench run**
and a run can carry more than one colour (`#FF4405` is the legend's "Rapid Rail
… on tile finish table" — the same bench with a different top), while the
legend's 93 and 4 count **workstation units**. Reconciling those needs desk
footprints, and ADR-016 already established that desks cannot be segmented from
this drawing; only chairs can.

### What was established and is worth keeping

- The colour extraction is right — it reconciles with the brief's own per-wing
  path counts exactly (§2).
- There are **exactly four `#0037DD` regions inside the building**, each a
  single ~25×25-unit workstation footprint, plus one legend swatch outside. The
  drawing's "4" is confirmed *as regions*. What fails is attributing them to
  specific seat anchors.
- Continuing past this point would have meant fitting a hypothesis to a target
  of 93, which is the exact thing the gate exists to prevent.

**If somebody picks this up:** the productive next step is not a better probe.
It is deciding whether `furniture_type` needs to be per-anchor at all. Per-BAY
would reconcile trivially against the bay schedule and would drive three desk
variants just as well, at the cost of being a coarser claim.

---

## 5 · The static furniture layer, which is the actual fix

318 oriented boxes from `F-LOOSE FURNITURE`, `LANDSCAPE` and `I-FURN-MODU`:
11 table, 229 seating, 72 planter, 6 modular; by wing **A 148, B 73, D 81,
C 16**.

Zone A now shows the 25-person boardroom with its boat-shaped table and full
chair ring, the four meeting rooms, and the lounge. Zone B shows the credenza
run along the outer wall, the foldable tables and the sofa lounge. Both read as
furnished rooms.

**Zero interactivity** is the constraint that matters. Every mesh sets
`raycast={() => null}` and nothing enters the DOM. Note which failure is
possible, because the first test written for this guarded the wrong one: the
furniture has no pointer handler so it can never **steal** a pick — it has no
seat code to report — but it can **block** one. The guard is therefore the
existing pick test, which filters to Zone D, a wing now carrying 81 furniture
boxes, and still resolves a desk.

2D deliberately gets **no** furniture massing: the baked texture already carries
the architect's linework at full fidelity there, and the emptiness was only ever
a 3D problem.

---

## 6 · Measured against budget

| | Phase 4/5 | Phase 6 | Budget |
|---|---|---|---|
| Draw calls, whole floor | 11 | **16** | < 60 |
| Draw calls, one wing | 10 | 13 (A) / 9 (B) | < 60 |
| Triangles, whole floor | 40,420 | **42,680** | < 120,000 |
| `/floor` first load JS | 239 kB | **244 kB** | three stays lazy-only |
| Wall polygons | 534 | **462** | < 600 |
| SVG paths on the plan | — | **8** | < 50 |

The +5 draw calls are four instanced furniture kinds and one merged label mesh.
Every label in the scene is **one** draw call and one texture regardless of how
many there are, because the quads are merged with their atlas rows baked into
their UVs.

**Frame rate is not asserted and is not reported from CI.** Headless Chromium
renders WebGL2 through SwiftShader; the suite reads 1.2–2.7 fps and that number
measures the CPU, not the scene. Phase 4's 58/59/56 fps on an Intel HD 520 at
DPR 1.5 stands as the last real measurement, and the scene has grown by 5 draw
calls and 2,260 triangles since — under 6% more geometry, against a budget with
44 draw calls of headroom.

---

## 7 · Two traps found on the way, both now guarded

### The byte-identical gate was vacuously green

`npm run build:floorplan` had not reproduced the committed `seats.json` since
Phase 5, which closed A24 by running `scripts/fix-interpolated-anchors.mjs` **by
hand, once**. A rebuild reverted all eleven interpolated anchors and took the
floor from 0 colliding desk pairs back to 15, worst 6 cm apart.

Nothing reported it, because the phase gate compared two consecutive **builds to
each other**. Two runs of a deterministic program always agree. **A false green
is worse than a red**: a red is a bug, a false green is a bug plus a reason not
to look for it.

The de-collide is now part of the pipeline, and `validate()` refuses any build
where two desks sit inside 1.30 m. Negative-tested three ways, including against
the real pre-A24 geometry, where it names `C7-04` and `PA-15` at 0.061 m.

**On Windows, `git diff --exit-code` is the byte-identity gate, not
`sha256sum`.** This repository is checked out with `core.autocrlf=true`, so git
rewrites LF to CRLF in the working tree and a hash of a checked-out file does
not match its blob. A hash comparison is only valid between two files the build
itself wrote.

### The drawing confirms all 141 seats, not 133

`detection-report.json` has said `baysWithoutDrawingPax: ["A1","A2"]` and
`seatsConfirmedByDrawingPax: 133` since Phase 2, and both handoffs repeated it.
It is wrong. There is an `8 PAX` annotation **19.1 plan units from the A2 tag** —
exactly A1 + A2 in the bay schedule.

It was never seen because `bay_anchors` skips every tag beginning with `A`, so
that a meeting room's capacity can never be imported as a desk count. That guard
is right and stays; it simply also threw out the one zone-A annotation that *is*
a desk count. Now reported as `workstationRunPax` and asserted by a test.

**Reported, not applied.** It confirms the pair totals 8. How the 8 split
between A1 and A2 is still ours.

---

## 8 · Assumptions moved

- **A16 🔴 → 🟠.** Zone B is a flexible room: zero PAX, zero workstation hatch,
  714 foldable-table hatch paths, and the castors note inside the wing. Kept
  open — the question is now *"do staff work there on a normal day, or is it
  training and all-hands?"* — but **the Phase 5 headline number can be finalised
  on a pool of 93 once A1 closes.** A1 is now the only thing holding it.
- **A3 PARTLY CLOSED.** Five rooms and their capacities come from the drawing.
  The names and the Outlook mailboxes do not, and the mailboxes are **A17**,
  untouched.
- **A11 — two entries were WRONG.** Zone B was called "Boardroom & Conference"
  when the boardroom and all four meeting rooms are in Zone A. A and B are now
  drawing-derived; **C and D are still ours and are deliberately kept**, because
  they are logged as inventions in both docs and because bare "Zone C" would
  remove information without removing a claim. The entry no longer lumps all
  four together — that is what let a wrong one sit for five phases.
- **A23** grew four furniture heights and one classification threshold.

**The client trio is now A1, A16 (reworded) and A17.**

---

## 9 · ⚠️ DEPLOYMENT IS BLOCKED, and the live site is on the PREVIOUS build

**Status: deployed, broken, rolled back. `https://cbva-workspace.vercel.app` is
serving the pre-Phase-6 build and is healthy.**

Migration `0004_room_bay_code.sql` adds `meeting_rooms.bay_code`. Drizzle then
selects that column on every meeting-room query. I applied the migration with
`npm run db:migrate`, which reads `DATABASE_URL_UNPOOLED` from `.env.local` —
and **that is not the database Vercel talks to.** The deploy went out, and every
request touching `meeting_rooms` failed:

```
error: column "bay_code" does not exist   (42703)
  select "id", "floor_id", "name", "bay_code", … from "meeting_rooms"
```

`/rooms` and `/` were broken for about three minutes. Rolled back to
`cbva-workspace-i7w2rb3k1`, verified healthy, and `/api/rooms` is serving the
old six rooms again.

**Why I could not simply fix it forward.** The production `DATABASE_URL` and
`DATABASE_URL_UNPOOLED` are stored on Vercel as **Secret**, and
`vercel env pull` refuses to emit secret values. I cannot reach that database to
run the migration.

**What has to happen before this ships, in this order:**

1. Apply `drizzle/0004_room_bay_code.sql` to the **production** database. It is
   `ALTER TABLE meeting_rooms ADD COLUMN IF NOT EXISTS bay_code text` — additive,
   nullable, and safe to run on a live table. Either
   `DATABASE_URL_UNPOOLED=<prod> npm run db:migrate` from a machine that has the
   secret, or run the SQL in the Neon console.
2. Re-seed, so the five rooms replace the six. The seed deletes rooms no longer
   in `MEETING_ROOMS`, and it deletes all `room_bookings` first, so it is safe —
   but it *is* destructive to demo booking history, which is the point of a
   re-seed.
3. `npx vercel --prod --scope <team>`.
4. Check `GET /api/rooms?date=<a working day>` returns five rooms with bay codes.

**The general lesson, which is bigger than this column.** Nothing in this
project sequences a migration against a deploy. `vercel.json` has a cron and no
build command that migrates; `npm run db:migrate` is a thing a human remembers.
That worked for five phases because no phase before this one added a column.
The first one that did took the site down. **Any future schema change needs the
migration applied to the production database BEFORE the code that reads the new
column is promoted** — or a release step that does it, which is the real fix.

---

## 10 · Notes for whoever picks this up

- **`furniture_type` per anchor is unsolved, and per-bay is the obvious
  retreat.** §4. Do not tune a threshold until 93 appears.
- **The room labels and `/rooms` join on `bay_code`, not on the name.** That is
  the whole reason the column exists — the name is the field CBVA is expected to
  change.
- **`nonBookableSummary()` is the one sentence both views' accessible labels
  use.** If the labels change, it changes with them, from the same data.
- **The 3D labels have depth testing off deliberately.** With it on they were
  invisible: a 16 m boardroom table is 0.74 m high and covers its own label.
- **`build_furniture`'s 40-unit table/seating split is the softest thing in this
  phase.** The Zone B credenza run comes out as a 16.7 m "table" — right shape,
  right height, wrong noun.
- **`npm run dev` restarts itself on Next's memory threshold**, which surfaces
  mid-suite as `ERR_CONNECTION_REFUSED` and looks like flakiness. The e2e run
  for this phase was made against `npm run build && npm start` with
  `PLAYWRIGHT_BASE_URL`, which is both steadier and the thing Vercel actually
  serves.
