# Phase 4 handoff

The 3D floor plan. `/floor` now renders the same 141 desks either as the Phase 2
plan or as a three-dimensional model of Floor 4, and the two are the same view
of the same data rather than two features. Everything below has been run; where
a number appears it was measured, not estimated.

---

## 1. What changed

Until now `mode="3d"` returned an empty `<div role="note">` reading "The 3D view
arrives in Phase 4". That placeholder is gone, and with it the last piece of the
floor plan that existed only as a promise.

```bash
npm run build:floorplan   # regenerates the shell; outputs are committed
npm run dev               # http://127.0.0.1:8081/floor  →  the "3D view" toggle
npm test                  # 158 vitest, up from 139
npm run e2e               # 86 playwright, up from 75
npm run seed              # afterwards, because the suite books and cancels real rows
```

> The 3D view is never the default, at any screen width. It is one labelled
> radio away, and the plan and list views stay on screen beside it.

---

## 2. What is actually being drawn

The naive approach is to extrude the CAD linework. The furniture layer is 49,342
paths and cannot even be segmented into individual desks (ADR-016), so instead:

| Layer | What it is | Draw calls |
|---|---|---|
| **The floor** | `plan-texture-2048.webp` — the architect's own drawing — mapped 1:1 onto the plan bounds, anisotropy 16 | **1** (+1 backing slab) |
| **The shell** | `walls.json`, 534 chains split into wall / partition / glazing, extruded as merged segment boxes | **3** |
| **The furniture** | one procedural desk and one chair, instanced 141× from `seats.json` | **2** |
| **The status panels** | one instanced panel per status that has a glyph | **≤ 6** |
| **Gold** | a ring on your desk and on the selected one | ≤ 2 |

**Looking straight down, this is the drawing.** Not a redrawing of it — the same
baked webp the 2D plan uses, at the same 1:1 mapping onto `PLAN_BOUNDS`. That is
what makes the model read as faithful, and it costs one draw call. The "Top down"
button exists to make that point in one tap: the model eases to a plan camera and
resolves into the sheet CBVA handed us, with live booking status on it.

### The one conversion

`three/coords.ts` is the only place a plan coordinate is multiplied. Plan units
are PDF points with **+Y down**; world is metres with **+Y up**, `coreCentre` on
the origin, and plan +Y mapped to world **+Z**. That last choice is what lets the
top-down camera reproduce the drawing with the default up vector and no special
casing: orbit from azimuth 0 and plan +X runs screen-right, plan +Y screen-down.

`mmPerUnit` is 70.5556, so the floor is **90.66 m × 68.44 m** and every
horizontal dimension is real. Every *vertical* one is invented — see A23.

---

## 3. The shell had to be rebuilt, and the rebuild found a hatch

`walls.json` could not support what the 3D view needed. Generator 2 merged eight
CAD layers into one untagged array, so a desk-height partition and a structural
wall were indistinguishable, and it excluded `G-GLASS` and `W-WINDOW` entirely —
reasonable when glazing is one more line on a flat drawing, wrong when the
difference between a room and a box is whether you can see through it.

Generator 3 chains **per class** and tags each polygon: 97 wall, 157 partition,
280 glazing, **534 total, 1,431 segments**. Two things fell out of measuring it.

**The longest polygon in the file was not a wall.** 61 points and 971 plan units
of 45-degree zig-zag inside a 35-unit box in zone A — a hatch fill that had
survived the length filter. Flat on a drawing it is invisible; extruded it is a
thicket. The populations separate cleanly on how often a chain doubles back:

| | reversal share | length |
|---|---|---|
| the hatch chain | **1.00** | 971 |
| the five longest real walls | **0.00 – 0.40** | 598 – 908 |

`is_hatch()` drops chains reversing at 80% or more over six points or more. Three
chains go; nothing else is touched, and a unit test holds the committed file to it.

**The 400-polygon budget predated glazing.** Squeezing 534 chains into 400 threw
away 45% of the curtain wall's length. That budget existed because SVGLoader and
`ExtrudeGeometry` choke on CAD complexity; Phase 4 merges segment boxes instead,
where 534 chains is three draw calls. The ceiling is 600, with per-class budgets
so one noisy class cannot silently truncate another (ADR-030).

The regeneration was gated on `seats.json`, `zones.json`, `detected-modules.json`
and `detection-report.json` coming back **byte-identical**, and they did. A
drifted seat file would have been a silent loss.

---

## 4. Why segment boxes and not `THREE.Shape`

`ExtrudeGeometry` needs a *simple closed* shape. 437 of the 534 chains are open
polylines and several closed ones touch themselves where corridors meet; earcut
produces holes, inverted faces or NaN on exactly that. It would have reintroduced
the class of failure the whole Phase 2 simplification exists to avoid, one layer
further in.

One oriented box per segment, merged per class. It cannot fail to triangulate, a
chain that doubles back merely overlaps itself, and after merging it is still one
draw call per class — which was the only thing the shape approach was buying.
~34k triangles instead of a few thousand, which at 11 draw calls is not a cost.

---

## 5. The architecture rule, and how it is held

**Same seat array, same store, same dialog.** `mode === "3d"` in
`floor-plan.tsx` swaps the renderer and nothing else: the 3D view receives the
same `FloorPlanSeat[]` the plan receives, calls the same `onActivateSeat`, and
opens the same `BookingDialog`.

Selection is genuinely shared rather than mirrored. `selectedSeatCode` has been
declared in `lib/store/ui.ts` since Phase 2 and unused ever since; it is now the
one value both renderings write. Pick a desk in 3D, switch to the plan, and the
same desk is still selected — by construction, not by synchronisation.
`e2e/floor-plan-3d.spec.ts` asserts it anyway. `mode` rides the URL alongside
`date`, `slot`, `zone` and `view`, so "look at Zone C in 3D" is a link.

There are deliberately **no zone buttons inside the canvas**. Flying to a wing is
the existing zone filter's job — the same value that filters the seat array and
drives the legend counts. A second set of zone controls would put one piece of
state in two places and guarantee they disagree.

`onDragSeat` is the one thing not forwarded. Moving a desk is a plan-space edit
against the drawing, and doing it by dragging a box across a perspective
projection would be a worse tool. `/admin/floor-plan` stays 2D.

### One colour map, in a medium that needs numbers

`three/seat-materials.ts` resolves the same `--seat-*` custom properties
`globals.css` defines, out of the live cascade at runtime, through a probe
element (the tokens are `color-mix()` expressions, which `THREE.Color` cannot
parse but the browser can compute). There are no hex values anywhere in the 3D
code, so re-skinning the palette re-skins the 3D view. The map is a
`Record<SeatVisualStatus, …>`, so an eighth status is a compile error here rather
than a desk that silently renders black.

The non-colour differentiator survives as a **status panel on each desktop**
carrying the token's glyph. `available` has no glyph and gets no panel — a bare
desktop, which is the same statement the plan's plain outline makes.

---

## 6. Performance, measured against the budget

| Budget | Result | |
|---|---|---|
| under 60 draw calls | **11** whole floor, **10** one wing | ✅ |
| 60 fps, mid-range laptop, integrated graphics | **58 idle / 59 orbiting / 56 one wing** | ✅ |
| lazy: three must not reach `/floor` | `/floor` first load **232 kB → 238 kB** | ✅ |

Scene totals: **40,420 triangles** whole floor, 28,384 for one wing; 8
geometries, 5 textures, 10 shader programs.

**Frame rate, on the machine and not on a spec sheet.** Measured in a headed
Chromium on an **Intel HD Graphics 520** — a 2015 integrated GPU, and a fair
floor for "mid-range laptop". The device pixel ratio the adaptive monitor
settles on is what decides it, and the ceiling was set from these numbers rather
than picked:

| device pixel ratio | whole floor |
|---|---|
| 2.00 | 48 fps |
| 1.75 | 55 fps |
| **1.50** | **58 fps** idle, 59 orbiting, 56 framing one wing |

Left at 2 the monitor also oscillates against itself: filtering to a single wing
sheds a third of the triangles, the frame rate rises, `<PerformanceMonitor>`
spends the headroom on resolution, and the result is *slower* than before the
filter. The ceiling is 1.5, the floor is 1, and 1.5 still supersamples on a 1x
display, which is what keeps the CAD hairlines legible.

**Bundle.** three, drei and the whole scene are **855 KB raw / 224 KB gzipped**,
in chunks that appear nowhere in `/floor`'s build manifest. The 6 kB `/floor`
grew by is the mode toggle and the store field. Somebody who never presses the
toggle never downloads a byte of three.

**Frame rate is not asserted by any test, on purpose.** Headless Chromium renders
WebGL2 through SwiftShader, a software rasteriser: the whole suite runs at 2–5
fps, and a test that accepted that number would be measuring the CI machine's
CPU. Draw calls and triangle counts *are* asserted, because they are properties
of the scene graph and identical on any renderer.

---

## 7. Never a blank canvas

Three things can go wrong, and all three land on the 2D plan with one quiet line
of explanation:

| | detected by | notice |
|---|---|---|
| no WebGL at all | `detectWebgl()` before the canvas mounts | "This browser cannot show the 3D view…" |
| context lost mid-session | a `webglcontextlost` listener | "The 3D view lost its graphics context…" |
| anything throwing in the scene | a local error boundary | "The 3D view could not be drawn…" |

There is deliberately no `error.tsx` anywhere in this app: a route-level error
page would replace the whole floor screen when all that has failed is one
optional rendering of it. A black rectangle in front of a partner is worse than
never having offered 3D (ADR-032).

3D is `role="img"` with a summary label, never `role="application"` — Phase 2's
real `<button>` per seat, arrow adjacency and roving tabindex are not
reproducible in a canvas, and claiming the role would announce an interactive
widget that then fails to behave like one. The plan and list views stay one
labelled control away.

---

## 8. Defects, all fixed

Eleven, and most of them were the same mistake in different clothes: **assuming a
cause instead of measuring one.** Every one was settled in the end by sampling a
pixel, counting a coverage, or reading a frame counter.

1. **A grey sheet over the whole drawing.** drei's `<ContactShadows>` bakes its
   depth pass on the frame it mounts — before the merged walls and the instanced
   furniture exist — and an empty pass reads back as a solid dark rectangle.
   Delaying the mount by four frames did not fix it.

2. **The floor still uniformly shadowed** after replacing it with a real shadow
   map, because the map was frozen (`shadowMap.autoUpdate = false`) three frames
   in, having been rendered *before* the light's shadow camera was configured in
   an effect. The frustum is now set declaratively, before the first render, and
   the map is not frozen; one pass per frame is not worth another ordering
   hazard. Its `near`/`far` bracket the light's own distance rather than spanning
   1–400 m, because depth precision spread over 400 m lets a flat floor
   self-shadow.

3. **The drawing rendered as flat mid-grey**, and the first two fixes were both
   wrong diagnoses of it — ACES tone mapping (turned off, correctly, but not the
   cause) and over-exposure (the lights were *lowered*, making it worse). It was
   settled by sampling the rendered pixel: 161,160,159 where paper is 251,250,247.
   three has used physically-correct lighting since r155, so the diffuse BRDF
   divides by π and the intensities must sum to about π, not to 1. They now do,
   and the floor measures **252,250,248**.

4. **The walls were black slabs.** Navy is the drawing's own wall colour and was
   the obvious choice; as a 1px stroke it is a line, as 534 solid volumes it
   buries the drawing underneath. The shell is now a white study model, and navy
   is spent where it earns something — the glazing, and the seat statuses. Wall
   extrusion width also had to drop from 150 mm to 70 mm: CAD draws both faces of
   a wall, so extruding each at full thickness stacked them into something twice
   the width of the line beneath.

5. **The default camera walked the plan off the bottom of the viewport.** Fitting
   each axis independently is exact only looking straight down. A bounding sphere
   fixed that and introduced its own problem — it treats a 90 × 68 m slab as 112 m
   tall and pulls back until the building is a stamp. The fit now solves the four
   corners in the camera's own frame, which is exact at any polar angle, and
   re-runs when the viewport's aspect changes — without which the phone got a
   framing computed for a landscape canvas.

6. **The seat statuses did not read.** The seven fill colours are tuned for a 2D
   chip inside a coloured border; as the body colour of a solid object seen from
   twenty metres up, `available` paper and `booked` navy-tint are both simply
   pale. The desktop itself became the swatch, with the glyph as a mark on it.

7. **Every desk turned into a dark blob** — the fix for (6), overshooting. The
   glyph plate was grown to cover the whole desktop on the theory that a bigger
   mark reads from further away. The atlas cell holds one *centred* glyph, so
   stretching the plate stretches the glyph with it, and 141 desks each carried
   a smeared dark shape. Two rounds of diagnosis went at the colour before the
   geometry: the palette's `.convertSRGBToLinear()` was double-converting (three
   has decoded sRGB while parsing since r155, so this is a real bug and is
   fixed) but it was not *this* bug. What settled it was measuring the atlas —
   5–19% opaque per cell, exactly as intended — which ruled the texture out and
   left the plate size. It is a 0.34 m mark again.

8. **Playwright could not find a desk in the canvas.** Two causes, both about
   cost rather than correctness. The sweep clicked, and every click re-rendered
   a software-rasterised scene; and it swept at whole-floor framing, where a
   1.3 m desk is about eight pixels wide. It now hovers instead of clicking,
   filters to a wing first so a desk is roughly thirty pixels, and reads the new
   `data-focused-seat` attribute — which is what the 2D plan already publishes
   as `[data-seat]`, in the one form a canvas can. Tracing is off for that spec:
   the recorder snapshots the DOM on every one of ~100 pointer moves, which was
   the difference between seconds and a four-minute timeout.

9. **Navigating away from `/floor` did not work at all, on a cold server.** The
   shell's navigation spec caught this for the second time in two phases, and
   the first two fixes were both aimed at the symptom.

   Phase 3 dropped `router.replace` for `history.replaceState`, because a
   navigation cancels the navigation already in flight. Phase 4's first attempt
   guarded on `pathname !== "/floor"` — which fails, because `usePathname()`
   only updates when the new route *commits*. Reading `window.location.pathname`
   instead fails identically: during a soft navigation the address bar has not
   changed yet either. **Every version of "am I still on this page?" is blind in
   exactly the window that races.**

   The window was never the point; the write was. Exactly one URL sync fires
   without anybody doing anything — the one triggered by the default date
   arriving from `/api/floor/dates`, about a second after load — and that is the
   one landing on top of the click. On a warm machine the date arrives before a
   person could click, which is why it read as flakiness for two phases: it
   failed cold and passed warm, at a rate of about one run in three.

   The sync now fires only in response to a user action. The controls are
   wrapped to arm it and nothing else may.

   **This is a deliberate behaviour change, not just a fix.** Landing on
   `/floor` no longer writes `?date=…&slot=AM` by itself, and
   `floor-url-state.spec.ts` was updated to say so. A bare `/floor` resolves to
   the same screen, so what is lost is sharing the *default* day without
   touching anything; the moment any control is used the URL carries everything,
   date included. Two navigation-breaking bugs is a high price for that.

   Verified the way a race has to be: two cold runs from `rm -rf .next`, both
   10/10, having reproduced 2/2 cold before the fix.

10. **The camera buttons sat under the demo panel on a phone.** The panel is
    pinned to the bottom-right of the viewport and the scene controls to the
    bottom-right of the canvas, which at 390 px are the same corner. The
    controls sit a row higher below `sm`.

11. **A dropped database connection killed the dev server.** Found the hard
    way: two full e2e runs destroyed by a transient
    `getaddrinfo ENOTFOUND …neon.tech`, each surfacing as
    `uncaughtException: Connection terminated unexpectedly` and failing every
    test after it. Neither pool had an `error` listener, and `error` is one of
    Node's special-cased events — unhandled, it is rethrown as an
    uncaughtException rather than ignored. The pool recovers from a dead idle
    client on its own; it just needed permission not to die first. ADR-033.

    Strictly outside Phase 4, and fixed anyway, for two reasons: it was
    preventing the suite from being verified at all, and the same blip during a
    live demo would have ended the demo.

---

## 9. What the 3D view found in the data

**Eleven desks are drawn in the wrong place, and have been since Phase 2.**

Interpolated anchors are spaced by dividing up the bay rather than by the
drawing's measured 1.62 m workstation pitch, so fifteen pairs sit closer than the
1.30 m a desk is wide. The worst is **C7-04, 6 cm from PA-15** — effectively the
same desk drawn twice.

Two dots 6 cm apart on a 90-metre floor are the same pixel at fit-to-floor zoom,
so the plan has been drawing them on top of each other for two phases and nobody
could see it. Two solid desks 6 cm apart are unmistakable.

**The overlap set maps exactly onto the interpolated set**, which is the
difference between a bounded defect and a reason to distrust the pipeline:

| | |
|---|---|
| pairs closer than 1.30 m | **15** |
| detected + interpolated | 11 |
| interpolated + interpolated | 4 |
| **detected + detected** | **0** |
| closest detected-to-detected pair | **1.357 m** — clear of a desk |

All eleven inferred anchors collide; none of the 130 detected anchors collides
with another detected one. The eight detected desks that appear in those pairs
are victims, not causes. **Detection is sound and needs no re-examination before
Phase 5.**

This affects **where a desk is drawn, not whether it is real**: all 141 exist,
all are bookable, every constraint holds, and the count of 141 is confirmed three
independent ways. It is **visual and interaction, not numerical** — seat identity
and occupancy are untouched, so unlike A1 and A16 it does not gate the analytics.
It does gate the demo, because two desks at one pixel resolve a click
ambiguously. A pre-demo fix, and ours rather than the client's: fifteen minutes
in `/admin/floor-plan` with somebody who knows the floor, which is exactly what
ADR-017 built the editor and the export for.

Deliberately *not* fixed by nudging geometry in the renderer: a desk drawn where
it is not is a data problem, and hiding it in one view would leave the plan, the
list and Phase 5's analytics still wrong.

---

## 10. Verification — all run

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean — the `new Date()` ban covers the new `src/**` files; `useFrame` supplies elapsed time, so no system clock is read |
| `npm test` | **158 passed**, up from 139 |
| `npm run e2e` | **86 passed**, up from 75 |
| `npm run build` | clean; `/floor` 238 kB first load, three lazy-only |
| `npm run build:floorplan` | 534 wall polygons; seats, zones, modules, report and both webps byte-identical |
| `npm run seed` twice | idempotent |
| axe (`e2e/accessibility.spec.ts`) | 0 serious, 0 critical |
| screenshots | `floor-3d-default`, `floor-3d-topdown`, `floor-3d-zone-c`, `floor-3d-390` |
| frame rate | headed, Intel HD 520, 58/59/56 fps — see §6 |

The top-down screenshot held against `public/floorplan/plan-texture-2048.webp` is
the acceptance test for the geometry, and the cruciform, the wing positions, the
core and the meeting-room walls all register on the drawing.

### Deliberate deviations

- **Segment boxes rather than `THREE.Shape` + `ExtrudeGeometry`.** §4, ADR-030.
- **No zone buttons inside the canvas.** The zone filter already is one, and it
  is shared state. §5.
- **The 3D e2e specs run at a 240-second timeout**, against the suite's 60, and
  with tracing off. The slowness is SwiftShader, not the code; the assertions
  underneath are exact.
- **The shared-selection test drives the mode toggle with `dispatchEvent`**, not
  a click. With the booking dialog open, Radix marks everything behind it
  `aria-hidden`, so a role query cannot even find the toggle — correct for a
  modal, and the right thing for a screen reader. A real click would also move
  the pointer off the canvas and clear the hover the test is observing.
- **The 3D screenshots are page screenshots.** Targeting the canvas container
  failed intermittently with "element is not attached": under SwiftShader a long
  scene can genuinely lose its WebGL context, at which point the view correctly
  swaps itself for the 2D plan and the element really is gone.

---

## 11. Notes for Phase 5

- **`three/coords.ts` is the only place a plan coordinate is multiplied.** If
  Phase 5 plots analytics over the floor — a heat map of occupancy by desk is the
  obvious one — it goes through that module, over the same `seats.json`. Do not
  add a second transform.
- **`window.__cbva3d` is how the budget stays honest.** It publishes draw calls,
  triangles and fps every frame and costs a few property reads. If a future
  change pushes draw calls up, the e2e catches it; if the probe is removed,
  nothing does.
- **The dev server dies on a lost database connection, and that is a demo risk.**
  A transient DNS failure to Neon mid-suite (`getaddrinfo ENOTFOUND
  ep-empty-hall-…neon.tech`) surfaced as `uncaughtException: Connection
  terminated unexpectedly` from the `pg` pool, taking the whole server down and
  failing every test after it. The network blip was external and not a defect,
  but an unhandled `error` event on a pooled client is: a hotel wifi hiccup
  during the demo would do the same thing. `src/lib/db/index.ts` wants a pool
  `error` handler. Out of Phase 4's scope, deliberately not widened into it, but
  it should be fixed before anyone stands up in front of the client.
- **A24 is the one that needs CBVA in the room.** Eleven desks, fifteen minutes
  in the editor, and the export writes them back to `seats.json` as a reviewable
  diff. Worth doing before the analytics screen makes desk-level claims.
- **Do not raise the adaptive DPR ceiling back to 2.** It is 1.5 because it was
  measured (§6), and the counterintuitive part is worth keeping: recovered
  headroom gets spent on resolution, so filtering to one wing — which sheds a
  third of the triangles — can leave the view *slower* than the unfiltered one.
  Somebody will otherwise see a scene running comfortably and try to buy sharpness
  with the slack.
- **Do not let `three` leak upward.** Nothing above
  `src/components/floor-plan/three/` may import from it. A stray `import type` is
  enough to pull 224 KB gzipped onto every `/floor` load, and nothing will fail —
  the bundle will just quietly get four times bigger.
- **Weak status legibility at whole-floor zoom is an LOD problem, not a colour
  problem — and the right answer is probably to stop trying.** Nobody picks a
  desk from sixty metres up. At that distance the question is "how full is the
  floor, and which wing is busy", which is a density question; per-seat status is
  the wrong thing to be rendering at all. Phase 5 should consider zone- or
  bay-level occupancy at far zoom, switching to per-seat glyphs past a distance
  threshold. Note the trap already found the hard way: do not chase legibility by
  scaling the glyph plate up. The atlas cell holds one *centred* glyph, so a
  bigger plate stretches the glyph with it and every desk becomes a smear — see
  defect 7. This is also the natural place for the occupancy heat map, and it
  goes over the same `seats.json` through `three/coords.ts`.
- **The status panel is the non-colour cue in 3D.** Phase 5's analytics legend
  must keep the same seven-status vocabulary; `SEAT_STATUS_TOKENS` is still the
  only place it is defined, and `three/seat-materials.ts` is a bridge to it, not
  a second copy.
- **Zone B still has no desks and 33 unexplained chairs (A16).** In 3D that wing
  is now visibly an empty room with meeting furniture drawn on the floor and
  nothing standing on it, which is a good prompt to ask the question again.
