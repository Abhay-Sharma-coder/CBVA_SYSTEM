# Phase 2 handoff

CAD geometry pipeline and the interactive 2D floor plan. Everything below has
been run; where a number appears it was measured, not estimated.

---

## 1. What changed

The Phase 1 seat grid is gone. `plan_x` / `plan_y` / `rotation_deg` now come
from the architect's drawing, `/floor` is the real screen staff will use, and
`/admin/floor-plan` can correct any desk the extraction got wrong.

```bash
npm run build:floorplan   # re-reads the PDF; outputs are committed, so optional
npm run seed              # now reads src/data/floorplan/seats.json
npm run dev               # http://127.0.0.1:8081
```

> **Port change.** `dev`, `start` and Playwright now use **8081**, bound to
> `127.0.0.1`. Port 3000 had a stale listener answering the test suite instead
> of this app, which presents as every test failing for no visible reason.
> `PORT=… npx playwright test` overrides it.

---

## 2. The CAD pipeline

`npm run build:floorplan` → `scripts/build-floorplan.ts` → Python extraction →
`sharp` rasterisation → zod validation. One command; the outputs are committed
so nobody needs to run it to work on the app.

**No pip step.** `tools/cad/cadparse.py` interprets the PDF's page content
streams with nothing but `zlib`. PyMuPDF would also work, but a stdlib reader
means a clean checkout can regenerate the floor. It is verified by reproducing
the known per-layer path counts exactly:

| Layer | Expected | Parsed |
|---|---|---|
| `F-FURNITURE` | 47,414 | 47,380 (34 fall wholly outside the plan box) |
| `0` | 9,403 | 9,403 |
| `P-FULLHEIGHT PARTITION` | 6,444 | 6,444 |
| `F-FURNITURE HATCH` | 6,053 | 6,053 |
| `F-LOOSE FURNITURE` | 1,884 | 1,884 |
| `G-GLASS` / `W-WINDOW` / `W-WALL` | 337 / 264 / 165 | 337 / 264 / 165 |
| `I-FURN-MODU` / `C- COLOUMN` | 76 / 57 | 76 / 57 |

### Outputs — `src/data/floorplan/`

| File | What |
|---|---|
| `meta.json` | plan bounds, source SHA-256, `mmPerUnit`, texture paths |
| `walls.json` | **252** simplified polygons (budget 400) — Phase 4 extrudes these |
| `zones.json` | the four wing outlines, for highlighting and hit testing |
| `seats.json` | **141** anchors with rotation and provenance — **the source of truth** |
| `detected-modules.json` | all 222 detected chair blocks, including unassigned ones |
| `detection-report.json` | the table in §3, machine-readable |
| `public/floorplan/plan-texture-{2048,4096}.webp` | 392 KB / 1,124 KB |

### Three things that were not obvious

1. **The bay labels are real text.** 322 `Tj` operations in a Calibri
   Identity-H CIDFont, decodable through the `/ToUnicode` CMap (object 11).
   All 17 bay tags and every `N PAX.` annotation carry a position. Nothing was
   traced or eyeballed.

2. **Desks cannot be segmented; chairs can.** A 9-pax bay is drawn as one
   continuous run of hatched desktop, so clustering it yields one blob.
   Detection therefore keys off the **chair block** — a 7-point ~8pt footprint
   on layer `0` — because there is exactly one per seat and chairs do not
   touch. Layer `0` is where AutoCAD block geometry lands. Confirmation that
   this is the right primitive: filtering layer `0` for that footprint yields
   **93** components, and the drawing's own schedule reads *"Work Station with
   rapid rail… = 93 nos"*.

3. **The sheet's hatch keys sit inside the plan box but outside the
   building**, in the wedges between wings. `tools/cad/planmask.py` rasterises
   the shell, floods in from the sheet border and keeps the largest enclosed
   component. The interior settles at **57.8%** of the plan box and barely
   moves as the closing dilation is varied — what a watertight cruciform does
   and a leaking outline does not.

### Scale

`mmPerUnit: 70.5556` — the drawing carries no readable dimension text, so the
scale is recovered by asking which **standard plot scale** makes the two
measured quantities come out believable:

| Scale | Chair footprint | Workstation pitch |
|---|---|---|
| 1:150 | 417 mm | 1,218 mm |
| **1:200** | **556 mm** | **1,624 mm** |
| 1:250 | 695 mm | 2,030 mm |

1:200 is 8% off nominal on the mean; the next-best candidate is 25% out. If a
future revision makes no scale fit within 25%, the build publishes
`mmPerUnit: null` and a note rather than a number somebody might build on.

---

## 3. Seat detection, per bay — reported as measured

`pax` is the annotation the architect wrote on the drawing. `sched` is the
Phase 1 bay schedule. Where `pax` is blank, the bay size rests on our
assumption, not on the drawing.

```
bay  zone    pax  sched  detected  placed  interp  dropped
----------------------------------------------------------
A1   A         -      4         4       4       0        0
A2   A         -      4         4       4       0        0
C1   C         6      6         5       6       1        0
C2   C         4      4         4       4       0        0
C3   C         9      9         7       9       2        0
C4   C         9      9         9       9       0        0
C5   C         9      9         9       9       0        0
C6   C         9      9         7       9       2        0
C7   C         4      4         3       4       1        0
PA   C        16     16        15      16       1        0
D1   D         9      9         7       9       2        0
D2   D         9      9         9       9       0        0
D3   D         9      9         9       9       0        0
D4   D         9      9         9       9       0        0
D5   D         1      1         1       1       0        0
D6   D         4      4         4       4       0        0
D7   D         4      4         3       4       1        0
D8   D         4      4         3       4       1        0
PD   D        18     18        18      18       0        0
----------------------------------------------------------
TOTAL               141       130     141      11        0
zone B  —      -      0        33       0       0        0
```

**130 of 141 desks (92.2%) placed from detected geometry. 11 interpolated.**
Nothing was dropped and no bay came out over its scheduled count.

### What "interpolated" means, and where

Eleven seats sit at positions extended along their own bay's detected axis
because that bay yielded fewer chair blocks than the schedule calls for:
`C1-06, C3-08, C3-09, C6-08, C6-09, C7-04, D1-08, D1-09, D7-04, D8-04, PA-16`.

They are **flagged in the data** (`source: "interpolated"`) and listed as
clickable chips in `/admin/floor-plan` so the first fifteen minutes of
correction go exactly where detection was weakest. They are plausible, not
verified.

### The independent check that matters

The PAX annotations reconcile to **exactly 141** and match the Phase 1 bay
schedule bay for bay. That schedule was read off the drawing by hand in Phase 1;
it has now been confirmed by the drawing's own machine-readable text. The build
asserts this and **fails** if the two ever disagree, rather than silently
preferring one.

**133 of 141 seats are confirmed by a PAX annotation. A1 and A2 (8 seats) are
not** — they carry a bay tag but no pax label, so their size remains the Phase 1
assumption. Detection found exactly 4 chairs at each, which is consistent but
not proof.

### 🔴 Zone B — a new open question

The detector found 222 chair blocks; assignment claimed 130. The 92 unclaimed
break down by wing:

| Zone | Unclaimed | Explained? |
|---|---|---|
| A | 46 | **Yes** — 25-pax boardroom + 10-pax + 8-pax rooms + reception lounge (`RECEPTION`, `SOFA`, `CENTER TABLE`, `SWIVEL CHAIR`, and the retained-Herman-Miller sheet note all sit inside the zone A polygon) |
| C / D | 7 / 6 | Visitor and spare chairs beside the bays |
| **B** | **33** | **No** |

The lounge-and-boardroom explanation is right, but it accounts for **zone A**,
not zone B. Zone B is the north-west wing: room tags `K L M Q R`, a hub room,
electrical panels, and the label **`MODULAR FURNITURE`** — workstation language.
It carries no `N PAX.` count and three `NO CHANGE AREA — ONLY REPAIR WORK` notes
point into it, so it was excluded from the fit-out; that is not the same as
nobody sitting there.

If those 33 are staff desks the bookable pool is 115–126 rather than 93, so
utilisation is overstated by **24–36% relative** depending on how they split
between fixed and bookable. **ASSUMPTIONS A16 carries the full derivation**,
including why the three plausible-looking percentages here are different
quantities. Its furniture is drawn in the texture; it gets no seat hit areas.

**This does not block Phase 3.** It blocks the Phase 5 headline number, together
with A1.

---

## 4. The 2D floor plan

`/floor`. `src/components/floor-plan/`.

```tsx
<FloorPlan seats={FloorPlanSeat[]} mode="2d" view="plan" ... />
```

Phase 4 adds `mode="3d"` over the **same array and the same store**. Position is
data; 2D versus 3D is a rendering choice. The only 2D-specific state is
`viewport` in `src/lib/store/ui.ts`; focused seat, date, slot and zone are shared.

### Architecture, and why

- **One static raster.** `plan-texture-2048.webp` as a single `<img>`
  (4096 swapped in above 2× zoom), `pointer-events: none`, `aria-hidden`. The
  walls SVG is 8,603 paths and the furniture SVG 49,342; none of it is in the
  live DOM. `e2e/floor-plan.spec.ts` asserts fewer than 50 SVG paths on the
  page so nobody can quietly inline it later.
- **141 interactive nodes**, real `<button>`s. Budget was 200.
- **Pan and zoom is one CSS transform** on one layer. No per-seat work, no
  re-layout.
- **The texture sits at 55% opacity.** At fit-to-floor a desk is ~11px across
  and against full-strength CAD linework the seat chips vanish. The drawing is
  context; the seats are the content.
- **Markers track the real desk pitch** (~23 plan units), clamped 13–34px, so
  they stay hittable framed and stop growing zoomed in.
- **Fit-to-floor ignores the manual zoom floor.** Clamping it cropped both side
  wings off a 390px phone.

### Behaviour

Date strip (from `settings.booking_window_days`, skipping weekends and
`holidays`) · AM/PM from `settings.slot_definitions` · zone filter with an
animated reframe · pan, wheel zoom, `+`/`-`/`0`, "Fit to floor" · hover card ·
click an available seat to open the booking dialog (Phase 3 wires the write;
the intent is logged) · reserved-fixed seats name their occupant and decline to
act · live occupancy count, always visible, the one gold metric on the screen.

**State is in the URL** — `?date=&slot=&zone=&view=` — so a view is shareable
and survives reload. `replace`, not `push`, so Back leaves the page.

### One colour map

Seats take colour, border treatment and glyph from `SEAT_STATUS_TOKENS` and
nowhere else. `SeatSwatch` is a non-focusable `<span>` that shows code **XOR**
glyph, so the plan has its own marker — but it reads the same token record. The
greyscale and colour-vision guarantee proven on `/styleguide` still holds
because there is exactly one vocabulary.

`src/lib/seat-visual-status.ts` is the one pure function mapping
(`seats.status`, booking row, viewer) → one of the seven visual statuses. The
plan, the list view, Phase 4 and Phase 5 analytics all call it rather than each
re-deriving it slightly differently.

### Accessibility

- Every seat is a `<button>` named *"Seat C3-04, Zone C, bay C3, Available"*.
- **`aria-disabled`, never `disabled`.** A disabled button leaves the tab order,
  which made arrow navigation dead-end at every booked desk and stopped a
  keyboard user reading who had it.
- Roving tabindex; arrows move to the geometrically adjacent desk in the bay;
  Home/End jump to its ends.
- **List view** carries the same seats, the same statuses and the same actions,
  filterable by zone, status and free text.
- axe (wcag2a/aa, wcag21a/aa): **zero serious or critical** violations on the
  plan, list view, booking dialog and editor.

### Motion

`motion/react`. Spring on hover/selection (<200ms) · a gold ring pulse on
exactly the seats whose status changed when the date or slot moves, so the eye
is told where to look instead of diffing 141 squares · animated reframe on zone
focus · layout animation on the count. `useReducedMotion()` is read **once** at
the `<FloorPlan>` root and threaded down as a prop, so JS-driven springs are
genuinely off rather than merely fast.

---

## 5. The seat position editor

`/admin/floor-plan`, admin-guarded server-side (`notFound()` — the hidden nav
item is a courtesy, not a permission check).

Drag · rotate (15° snap or a numeric field) · change `seats.status` · **snap to
nearest detected workstation**, searching all 222 detected modules including the
ones no seat was assigned to, which is exactly where detection failed ·
undo/redo with Ctrl+Z / Ctrl+Shift+Z · interpolated seats badged.

It renders through the **same `<FloorPlan>`** as `/floor`; the only difference is
that it passes `onDragSeat`.

**Save** writes each seat via `PATCH /api/admin/seats/[seatCode]` (with an
`audit_log` row) and then `POST /api/admin/floor-plan/export`, which rewrites
`src/data/floorplan/seats.json` from the database and marks moved seats
`source: "manual"`. That is what makes the editor more than a scratchpad — the
seed reads that file, so a corrected floor survives `npm run db:reset`. Export is
refused in production mode.

---

## 6. Verification — all run

| Gate | Result |
|---|---|
| `npm run build:floorplan` | 141 anchors, 252 wall polygons, 4 zones, checksum recorded |
| `npm run typecheck` | 0 errors |
| `npm run lint` | clean; the clock rule does not fire |
| `npx vitest run` | **83 passed** (was 34; +39 unit, DB constraint proofs still green) |
| `npx playwright test` | **43 passed** (was 12) |
| `npm run build` | succeeds; `/floor` still statically rendered |
| `npm run seed` twice | identical counts; coordinates inside the plan bounds |
| axe on 4 surfaces | 0 serious, 0 critical |
| Screenshots 1440 / 1280 / 390 | captured, opened and compared against `floor4-plan-texture.png` |

### Defects the audits found, all fixed

1. **`--cbva-ink-subtle` measured 4.30:1 on paper** — under AA, despite the
   comment beside it claiming otherwise. Raised to 62% (4.90:1). One token, so
   every tertiary label in the product is fixed, including the header wordmark
   that had been failing since Phase 1. The selected date chip needed
   `ink-muted` separately: on `navy-tint`, subtle drops to 4.21:1.
2. **`disabled` seats were unreachable by keyboard** → `aria-disabled`.
3. **Pointer capture on the plan swallowed clicks** on the zoom controls.
4. **Fit-to-floor was clamped** and cropped the side wings on mobile.

### Deliberate deviation

The list view renders all 141 rows rather than virtualising, against the usual
">50 items" guidance. 141 is well inside what a table handles, and virtualising
would break find-in-page — one of the reasons somebody picks the list.

---

## 7. Notes for Phase 3

- `GET /api/floor?date=&slot=` already returns every seat resolved to a visual
  status for the viewer. The booking write path needs to invalidate the
  `["floor", date, slot]` query key.
- `BookingIntentDialog` is where the write lands. It already has the seat, date
  and slot, and is where the on-behalf-of picker and cut-off warning belong.
- `seatVisualStatus` already understands `auto_released`, so once the job runs,
  released desks will show their own status on the plan with no UI change.
- Do not add an app-level "is this seat free?" pre-check. Treat `23505` and
  `23P01` as ordinary outcomes.

## 8. Notes for Phase 4

- `walls.json` is 252 simplified polygons in plan coordinates, deliberately
  cleaned so `SVGLoader` is not needed at all — extrude the point arrays.
- `meta.json.mmPerUnit` (70.5556) converts plan units to millimetres, so wall
  heights and desk sizes can be set in real dimensions.
- Every seat has a `rotationDeg`, so chairs face the right way without guessing.
- Render `mode="3d"` inside the existing `<FloorPlan>` over the same seat array
  and the same store. Do not add a second seat pipeline.
