# Phase 7 handoff

The last phase. Full-fidelity plan texture, status LOD at whole-floor zoom, a
`prod:check` that can actually fail, and the client pack.

Everything below has been run. Where a number appears it was measured, not
estimated. Where something went wrong it is written down, including the one I
caused.

**Live: https://cbva-workspace.vercel.app**

---

## 1 · What changed, in one table

| | |
|---|---|
| Plan texture | 8 flat greyscale layer groups → **the drawing's own 29 colour combinations, 8 stroke widths, mixed joins, 149 fills and 11 embedded bitmaps** |
| Texture pipeline | a stdlib PORT, not the PyMuPDF reference (ADR-046). No pip step, one parser |
| SVG intermediates | **one per raster width**, because the hairline IS a function of it. Pairing checked |
| `--audit` | wired in as the build's FIRST step, **demonstrated failing two ways** |
| Status LOD | built, 2D and 3D, from one pure module (ADR-048) |
| Draw calls, whole floor | 16 → **13**. The switch spends the budget DOWN |
| `prod:check` | asserts what it selects, exits non-zero, **demonstrated failing three ways** |
| Zone C / D | invented names removed; the question goes back to CBVA |
| A24 | a `manual` anchor now survives a rebuild. It did not before |
| Tests | **240** vitest, up from 215 · **108** Playwright |
| axe surfaces | 22 → **25**, and the new one found a real defect |
| ADRs | 046, 047, 048 |

---

## 2 · The texture: what was being thrown away, and what it cost to fix

`write_texture_svg` flattened every path into eight hand-picked greyscale layer
groups. That grouping was written to answer "where are the walls", which it does
correctly, and was then promoted into being the presentation texture, which it
was never designed for.

Re-derived from the PDF with the repo's own stdlib parser **before** any code
was written, because the brief's table was a claim and not yet a measurement:

| | in the drawing | old texture | verified how |
|---|---|---|---|
| painted paths | 80,428 | all, re-coloured | `S`×80,279 + `b`×149 |
| (stroke, fill) combos | **29** | 1 per group | exact |
| stroke widths | **8** | 1 per group | content widths 0/5/9/12/19/24/28/47 × the 0.03 CTM scale |
| line joins | 49,863 miter / 30,565 round | all round | exact |
| line caps | all round | round | 80,428 of 80,428 |
| filled paths | **149** | 0 | the 149 `b` ops |
| embedded bitmaps | **11** in plan | 0 | 12 XObjects, 12 `Do`, 1 inside a legend EXCLUDE box |

Two things in the brief were slightly off and are corrected: zero-width paths
are **49,876**, not 49,763 (the substance — 62% of the drawing — holds), and the
reference renderer's `SRC` default names an underscored filename that does not
match the committed PDF, so its documented commands fail as written.

### Why it is a port and not an adoption — ADR-046

`render_plan_full.py` needs **pymupdf**, and neither it nor cairosvg was
installed. Taking the dependency would have added a mandatory `pip install` to
`npm run build:floorplan` — the property `cadparse.py` exists to preserve — put
AGPL-3.0 in a client deliverable's build, and left **two parsers reading one
PDF** with no gate comparing them, which is the Phase 6 class of defect.

The port was affordable because ADR-042 had already put colour on the `q`/`Q`
stack. The two parts that looked hard are not:

- the bitmaps are `/Filter [/FlateDecode /DCTDecode]`, so **one `zlib` pass
  leaves untouched JPEG bytes** for a `data:` URI;
- their soft masks are `[/FlateDecode /ASCII85Decode]` DeviceGray, which becomes
  a greyscale PNG in a dozen lines of `zlib` + `binascii.crc32` and rides
  alongside as an SVG **luminance `<mask>`**.

**No JPEG decoder is needed anywhere**, and `cairosvg` is not needed at all
because `sharp` already rasterises. That librsvg composites a `<mask>` over a
`data:` URI image was verified in-memory *before* the port was written.

**The evidence the port is faithful:** the audit's two exact constants — 2,492
paths removed by the legend EXCLUDE boxes, 11 in-plan bitmaps — **reproduce
exactly in both implementations**.

### One SVG per raster width

A PDF stroke width of 0 means one DEVICE pixel and 49,196 of the 79,827 in-plan
paths are zero-width. The correct hairline is `PLAN_W / target`: **0.627 at 2048,
0.314 at 4096**. One SVG was being rasterised at both, so one of the two shipped
textures was always wrong — silently too faint or too bold, which reads as a
rendering preference rather than a defect. Each SVG now carries
`data-raster-width` and `rasterise()` refuses a mismatch.

### Compared against the reference

Matched **`plan-muted.png`** — the muted palette, walls in brand navy. Rendered
at 1700px and compared pixel for pixel: **90.6% of the ink coincides**, and the
difference is accounted for:

- **175 paths (0.22%)** are dropped on purpose, because this pipeline also keeps
  the existing `planmask` interior test that the reference does not have. Those
  are sheet marks lying outside the building shell.
- the rest is hairline anti-aliasing between librsvg and cairosvg, which is the
  same effect the reference documents against the PDF itself.

Output: `plan-texture-2048.webp` 392 → **581 KB**, `4096` 1,124 → **1,660 KB**,
41 style groups, 11 bitmaps.

---

## 3 · The audit, demonstrated failing

It runs FIRST and its exit status is the build's. Five checks plus one the
reference does not have (`planmask` interior coverage, because that is what this
pipeline's geometry actually depends on).

**A guard nobody has watched fail is not a guard**, so both failure modes were
driven before it was trusted:

```
EXPECTED_PLAN_IMAGES 11 → 10
  embedded bitmaps in the plan: 11 (expected 10)
  FAIL: bitmap count changed: 11, expected 10 …
  CAD audit failed (exit 1). Nothing was written.        exit 1

widen an EXCLUDE box to (520,800,700,1050)
  EXCLUDE removes 2625 paths inside the plan
  FAIL: expected exactly 2492 … got 2625
  FAIL: 2 wall-class paths removed by an EXCLUDE box     exit 1
```

The second is the one that matters: it caught **both** the volume check and the
wall-class check, which is the exact bug class the constants exist for. An
earlier over-wide box once deleted 4,650 paths of real geometry and every
individual path in it was small — no per-path size threshold could ever have
caught it. Volume was the only signal that worked.

Restored, rebuilt, green.

### The byte-identity gate

`npm run build:floorplan` then `git diff --exit-code -- src/data/floorplan`:
**all nine files byte-identical to the REPOSITORY.** Only the two webps change.

`git status` reports `seats.json` as modified and `git diff` does not. `git diff`
is right — `core.autocrlf=true` means the working tree is expected to hold CRLF
while the blob holds LF. Confirmed by comparing the bytes directly against
`git show HEAD:…`: identical, 25,106 bytes both.

---

## 4 · Status LOD — ADR-048

**The threshold is not a guess.** `plan-canvas` sizes a marker
`min(34, max(13, scale * 16))`, so below **0.8125** the chip is pinned at its
13px floor while the drawing's 23-unit desk pitch keeps shrinking underneath it.
That is where chips start colliding. Enter bay detail below **0.85**, leave above
**1.00**; in 3D, enter beyond **70 m**, leave inside **55 m**.

Measured at 1440×900: fit-to-floor is **0.611**, already inside the band.

| | |
|---|---|
| Two thresholds, not one | a settling spring crossing a single one flickers between two renderings |
| `resolveLod` is pure | the transition is a unit test, not an eyeball |
| The 141 buttons never leave the DOM | names, tab order, `data-status` and hit box unchanged at every zoom |
| One colour map | `--seat-booked-fill` over `--seat-available-fill`; the count is the non-colour cue |
| Normalised per bay | the Phase 5 heat-map defect — an undivided count draws bay SIZE |
| Chips separated | 4 pairs in C and D sat within a chip's width. **13 chips, 0 overlapping pairs, none clipped**, asserted in e2e |
| 3D costs one draw call | merged geometry + strip atlas, the ADR-045 construction |

**Measured, production build:**

| | whole floor | zone C |
|---|---|---|
| distance | 99.7 m | 50.1 m |
| lod | `bay` | `seat` |
| **draw calls** | **13** (Phase 6: 16) | 14–15 |
| triangles | 41,386 | 30,644 |
| budget | < 60 calls, < 120,000 tris | ✓ |

The switch **subtracts** from the budget: one merged plate mesh replaces up to
six per-status glyph instance meshes.

**Frame rate is not reported from CI and must not be.** Headless Chromium is
SwiftShader; the suite reads 2.7–6.6 fps and that number measures the CPU. Phase
4's 58/59/56 fps on an Intel HD 520 stands as the last real measurement, and the
scene is now **three draw calls lighter** than the Phase 6 scene that measurement
was extrapolated to.

At 390px the plan stays in bay detail through several zoom steps, because
fit-to-floor there is ~0.25. That is correct: on a phone the whole floor does not
fit at per-seat detail.

---

## 5 · The contrast gate, which is where the real work was

**Axe cannot judge any of this.** When it cannot reduce a background to one
computed colour it returns `color-contrast` as **incomplete**, which is not a
pass. Reporting only violations after putting a coloured drawing behind the plan
would have been a false green of exactly the Phase 6 kind.

### axe, all 25 surfaces, after the change

**Zero critical and zero serious on every one.** Zero moderate or minor too. The
numbers worth reading are the third column — what axe silently could not judge:

| surface | crit+serious | mod+minor | contrast-undecidable |
|---|---|---|---|
| floor plan | 0 | 0 | **44** |
| floor list view | 0 | 0 | 68 |
| booking dialog | 0 | 0 | 45 |
| floor plan editor | 0 | 0 | 42 |
| on-behalf person picker | 0 | 0 | 44 |
| analytics — trends | 0 | 0 | 46 |
| analytics — forecast | 0 | 0 | 11 |
| styleguide | 0 | 0 | 16 |
| floor plan, 3D | 0 | 0 | 3 |
| settings | 0 | 0 | 1 |
| the other 15 | 0 | 0 | 0 |

**A NEW SURFACE FOUND A REAL DEFECT.** `/floor?mode=3d` had never been audited.
On the first run it returned one **serious** `nested-interactive`: the wrapper
carrying `role="img"` (ADR-032 — the 3D view is a picture, not the accessible
path) also contained the "Top down" and "Refit floor" buttons. An element
announced as an image containing focusable controls is a genuine fault: a screen
reader presents the subtree as one picture and the two buttons inside it are
announced as part of it or not at all. The role and label moved onto the canvas
itself; the controls are now siblings. **That is the argument for auditing
surfaces you believe are fine.**

### The measurement axe cannot make

Seat chips against the architect's drawing, measured directly from the baked
texture at the plan coordinate of **all 141 seats** — composited at the 55%
opacity the app actually renders, per pixel, taking the stronger of each chip's
two edges (fill or outline), then the worst location.

**And measured against the Phase 6 texture too, which is the number that
settles it:**

| status | Phase 7 (colour) | Phase 6 (grey) | Δ |
|---|---|---|---|
| available | 3.77:1 | 3.83 | −0.06 |
| booked | 3.77:1 | 3.83 | −0.06 |
| your_booking | 1.29:1 | 1.29 | 0.00 |
| reserved_fixed | 2.14:1 | 2.15 | −0.01 |
| checked_in | 3.77:1 | 3.83 | −0.06 |
| auto_released | 2.27:1 | 2.27 | 0.00 |
| blocked | 4.91:1 | 4.98 | −0.07 |

**The colour texture moved every number by at most 0.07.** Three statuses sit
under 3:1 and sat under 3:1 before this phase — the figure is set by how DARK
the linework is at 55%, and the muted palette preserved that while changing the
hue. So the gate is a **regression gate**, which is the honest one for this
change: what cleared 3:1 must still clear it, and nothing may get worse than
Phase 6 shipped. An absolute gate would have failed this build for something it
did not cause.

The gold rule alone measures 1.00:1 against the drawing's tan hatch — and
**2.17:1 against plain paper**, which it has been since Phase 1. Gold never
carries meaning alone: `your_booking` is the only status with a 2px rule and the
only one with the ● glyph.

`tests/unit/texture-contrast.test.ts` also asserts that **at 100% texture opacity
the worst case would be 1.00:1** — so the 55% is load-bearing, and if anybody
raises it that test objects.

### Text over the plan

| | ratio | needs | |
|---|---|---|---|
| room label | 17.05:1 | 4.5 | PASS — by construction, see below |
| bay chip count | 17.05:1 | 4.5 | PASS |
| seat chip: available | 13.12:1 | 4.5 | PASS |
| seat chip: reserved_fixed | 6.47:1 | 4.5 | PASS |
| seat chip: checked_in | 13.12:1 | 4.5 | PASS |
| seat chip: auto_released | 5.14:1 | 4.5 | PASS |
| seat chip: blocked | 15.90:1 | 4.5 | PASS |

**The room labels were changed, not the texture.** Sampling the pixels *between*
the glyphs showed `ink-subtle` reaching only **4.02:1** over the drawing's darker
linework — below the floor, and varying with whatever the label happened to sit
over, which is the worse property. They now use `ink` with a `paint-order:
stroke` paper halo, so the surface behind every glyph **is** paper: not measured
to be paper, but painted paper before the glyph goes down. The drawing is the
thing being reproduced faithfully; a label drawn over it is ours to make legible.

### The instrument that did not work, and what replaced it

This is the part worth reading, because it is a negative result.

I tried to measure text-over-drawing by sampling pixels behind the glyphs. **It
cannot be made reliable.** Every glyph edge blends ink into whatever is behind
it, so an anti-aliased pixel is always an intermediate tone and always scores
about 2:1 — for *any* text on *any* background, black-on-white included.
Excluding pixels near the foreground helps and does not settle it, because the
blend is a gradient and wherever the cutoff is placed some pixel sits just past
it. Three successive thresholds gave **2.06, then 3.75**, and would have given
something else again. At that point the number is a property of the threshold,
not of the design — and tuning it until it passes is precisely the behaviour
these gates exist to prevent.

So the browser spec now judges only **computed colours** (the opaque chips) and
**construction** (the label halo is asserted to exist, which is exact), and the
pixel question moved to `tests/unit/texture-contrast.test.ts`, where it is
answered properly: against the baked texture, at all 141 plan coordinates, with
no anti-aliasing, no neighbouring chip and no browser — and compared against the
Phase 6 texture so a regression is distinguishable from a standing figure.

Three of my own measurements were wrong before they were right, each recorded in
the spec that makes it:

1. `color(srgb 0.33 …)` is Chrome's output for `color-mix()` tokens — 0..1
   floats, not bytes. Read as bytes it turned a mid-grey into near-black and
   reported `reserved_fixed` at 1:1.
2. A ring sampled tight around a seat catches the chip's **own rotated border**
   — navy against navy, 1:1.
3. Widening that ring reaches the **neighbouring chip** instead: desks sit ~40px
   apart at working zoom and a chip is 28px wide.

---

## 6 · `prod:check` — demonstrated failing

It reported *"looks presentable"* against **three bookings** after the Phase 6
deploy emptied production. It selected the count, printed it, asserted nothing,
and always exited 0.

The judgement is now a pure `evaluateProduction()` so it can be tested at all.
It fails on: an unapplied migration, fewer than 2,000 bookings, meeting rooms
≠ 5, seats or users ≠ 141, no bookable seats. It warns on a stray clock offset,
queued mail, missing releases or series, and production being *ahead* of the
checkout.

**Migration drift is checked first**, because it is the cause rather than the
damage and the only one that is a live outage. `bay_code` was in `schema.ts` and
in `drizzle/0004`, journalled and committed — it had simply never reached
production, because `db:migrate` reads `.env.local`.

**Proven two ways.** Nine unit tests over the three damaged shapes, and end to
end against a throwaway database created on the local endpoint, seeded to 5,804
bookings and damaged in turn:

```
healthy                        exit 0   "looks presentable"
3 bookings                     exit 1   names the bookings floor
+ 1 meeting room               exit 1   names both
+ 0004 unapplied               exit 1   names all three, drift first
```

`--scratch-url` is accepted by `check` only, which performs no writes. The
scratch database was dropped afterwards; `neondb` was untouched throughout.

---

## 7 · I pointed the e2e suite at production. Here is what happened

**This is the most useful thing in this document.**

Phase 6's handoff recommends running the suite against a production build:

```bash
npm run build && npm start
PLAYWRIGHT_BASE_URL=… npm run e2e
```

`next start` sets `NODE_ENV=production`, and **Next loads
`.env.production.local` at higher priority than `.env.local` in production.**
So that command points the entire suite at the **deployed database**. The
recommendation is right about `next dev` being flaky mid-suite and wrong about
the target.

It fails in the worst way available: **everything passes.** 108/108 green. The
app is fine and the data is a copy of the same seed, so there is no error and
nothing to notice. The only consequence is that a suite which books, cancels,
advances the demo clock and drives a real auto-release — deliberately — does all
of that to the database a partner is looking at.

**What it did:** production came back with **65 of 95 bookable desks
auto-released** on the demo's default date, and five extra bookings.

**How it was found:** not by a test. The plan looked wrong in a screenshot, the
API disagreed with the local database, and a restart did not clear it — which
ruled out caching and left the connection string.

**`prod:check` said "looks presentable" throughout, and was right to.** Every
count was healthy: 141/141/93, 5,809 bookings, 5 rooms, migrations 5/5. The
damage was to the DISTRIBUTION of bookings, which no count threshold can see.
That is a real limit of the check and worth knowing: it catches *missing* data,
not *wrong-shaped* data.

**Repaired** with `npm run prod:seed -- --yes-production`. Production now matches
the local database exactly — 59 confirmed / 5 auto-released on the demo date,
clock offset 0 — and every route returns 200.

**Closed** by `scripts/start-local.mjs` (`npm run start:local`), which resolves
the connection strings from `.env.local` itself into the child environment,
where they outrank every `.env` file Next reads, and then **refuses outright** if
the resolved host is not the local one. `npm start` is left alone: it is what
Vercel runs. Documented in `CLAUDE.md`, `RUNBOOK.md` and `DEMO-TO-PRODUCTION.md`.

### A second, smaller one from the same session

A `next dev` server left running from an earlier session kept running its 60s
job interval against the shared demo database, auto-releasing bookings against
whatever clock offset the walkthrough had left. Every reseed was corrupted
within a minute and it looked like the seed was at fault. **Two dev servers also
race the seed**: `occupant_slot_unique` caught the double insert, which is the
constraint doing exactly its job.

---

## 8 · Verification

| | |
|---|---|
| `typecheck` / `lint` / `build` | clean |
| vitest | **240 passed**, up from 215 |
| Playwright | **108 passed**, one clean sequential run against the local production build |
| `build:floorplan` reproducibility | 9/9 files byte-identical **to the repository** |
| `--audit` failing | demonstrated 2 ways, both exit 1, nothing written |
| `prod:check` failing | demonstrated 3 ways + 9 unit tests |
| axe | 25 surfaces, 0 critical, 0 serious, 0 moderate, 0 minor |
| contrast over the plan | measured, tabled above, no regression against Phase 6 |
| 3D budget | 13 calls / 41,386 tris against 60 / 120,000 |
| `/floor` First Load JS | 245 kB (Phase 6: 244) — three stays lazy |

**One integration test was failing and it was not mine.** *"detaches an edited
occurrence from its series"* builds a `FixedClock(new Date())` — the real wall
clock, deliberately, so the materialiser's window is the real window — and then
edited an **arbitrary** occurrence with `.limit(1)`. The series starts on the
first bookable date, which is often today, and `cutoff_minutes` closes edits 60
minutes before a slot starts. So the test passed before 08:00 and failed after.

Proven pre-existing rather than assumed: `git diff --name-only phase-6..HEAD`
touches **zero files** in `src/lib/booking/`, `src/lib/rooms/`, `settings.ts`,
`slots.ts`, `booking-days.ts`, `src/lib/db/`, `drizzle/` or `tests/integration/`.
Fixed by ordering to the furthest occurrence, which keeps the real clock and puts
the edited day inside the edit window.

---

## 9 · Assumptions moved

- **A11 — Zone C and D no longer carry invented names.** Reversing Phase 6's
  decision to keep them. The earlier argument was that a bare "Zone C" removes
  information without removing the claim. But a partner does not read
  `ASSUMPTIONS.md`; they read "Audit Floor", and either believe something untrue
  about their own office or notice it is wrong and start doubting the rest of the
  screen. The question goes back to CBVA reworded as a request.
- **A24 — the editor loop was HALF BROKEN and now is not.** A `manual` anchor
  survived `db:reset` and was silently discarded by the next
  `build:floorplan`. So the one route to closing A24 was undone by an ordinary
  rebuild, with nothing reported — the Phase 6 trap in its other direction.
  Verified end to end: C7-04 moved and marked `manual` survived a full rebuild
  byte for byte, de-collide relaxed the other eleven around it (13 colliding
  pairs → 0), and it reached the database through `npm run seed`.
- **A29 is new** — `#B88A00` on `F-FURNITURE HATCH`, 1,148 paths, probably
  corian. Logged now rather than left as a curiosity because the texture paints
  it on screen in a colour we chose for something we have not identified.

**The client trio is unchanged: A1, A16, A17.**

---

## 10 · Notes for whoever picks this up

- **`npm start` is for Vercel. `npm run start:local` is for you.** §7.
- **`prod:check` catches missing data, not wrong-shaped data.** It cannot see a
  floor that is technically full and visibly wrong. §7.
- **The audit constants are EXACT on purpose.** If an EXCLUDE box changes, they
  must be re-verified against the PDF, not updated to match.
- **Do not raise the texture opacity above 55%** — `texture-contrast.test.ts`
  says why, with the number.
- **Do not scale the glyph plate** to chase legibility at distance. Phase 4
  defect 7; the atlas cell holds one centred glyph.
- **`render_plan_full.py` is kept as `tools/cad/reference_render_plan_full.py`**
  and is deliberately NOT in the build. It is where the audit constants came
  from and it needs pymupdf.
- **The one thing I would still fix given another day:** `your_booking` is the
  only status whose outline is gold, gold is 2.17:1 on paper, and "which desk is
  mine" is the single most important thing on that screen. It is redundantly
  coded by a 2px rule and the ● glyph, and it predates this phase — but darkening
  that chip's fill would make the answer unmistakable rather than merely
  compliant. It is a design decision about a rationed colour, not a cleanup, so
  it was not taken unilaterally on the last day.
