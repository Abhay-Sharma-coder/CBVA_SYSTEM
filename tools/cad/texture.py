#!/usr/bin/env python3
"""
The baked presentation texture, at the drawing's own colour fidelity.

Why this is its own module
--------------------------
Until Phase 7 the texture was emitted inline by build_floorplan.py, which
flattened 79,827 paths into eight hand-picked greyscale layer groups with one
stroke width each, all-round joins, no fills and no bitmaps. That grouping was
written to answer "where are the walls" -- which it does correctly -- and was
then promoted into being the presentation texture, which it was never designed
for.

On this drawing colour is a machine-readable key (ADR-042), and the numbers are
not marginal. Measured from the source PDF with the repo's own stdlib parser:

    painted paths                     80,428   (79,827 inside PLAN_BOX)
    distinct (stroke, fill) combos        29   kept as 1 per layer group
    stroke widths                          8   kept as 1 per layer group
    line joins           49,257 miter / 30,570 round   kept as all-round
    filled paths                         149   kept as 0, everything fill="none"
    embedded bitmaps in the plan          11   kept as 0, structurally unseen

The eleven bitmaps are the solid B.P.G storage credenzas. A vector-only
extractor cannot see them at all, so their absence was completely silent for
five phases.

ADR-046 records why this is a stdlib port rather than an adoption of the
PyMuPDF reference implementation in reference_render_plan_full.py.
"""
import collections
import os

import cadparse as C

# Layers belonging to the SHEET rather than the building -- the north point,
# the scale bar, the drawing's own annotation. The app draws its own labels.
SHEET_ONLY = {"AR- TEXT", "AR- HATCH", "AR- FURN", "AR- SMALL CAR"}

# Legend SWATCH blocks only, kept tight to the swatches. The legend WORDING is
# real text, so it never reaches the path list and needs no exclusion.
#
# An over-wide version of these boxes once deleted 4,650 paths of real building
# geometry from Zone B and Zone C, including 684 workstation hatch paths and
# 323 wall paths -- and every individual path inside that region was small, so
# no per-path size threshold could ever have caught it. Volume was the only
# signal that worked. That is why audit() asserts an EXACT count and not a
# bound, and why changing one of these boxes must be re-verified against the
# PDF rather than by updating the constant.
EXCLUDE = [
    (431, 96, 500, 188),      # "NO CHANGE AREA" three-swatch key
    (661, 236, 728, 328),     # material key, 3x2 swatch grid (holds one bitmap)
    (559, 857, 597, 999),     # furniture key swatch column
    (1370, 0, 1684, 1191),    # title block
]

EXPECTED_EXCLUDED_IN_PLAN = 2492
EXPECTED_PLAN_IMAGES = 11

# Wall-class geometry must never be collateral damage from an EXCLUDE box.
WALL_AUDIT_CLASSES = {"W-WALL", "K-WALL", "C- COLOUMN", "K-COLS", "I-WALL"}

# Restraint pass. Keeps every colour's SEMANTICS -- workstation hatch still
# reads red, rapid rails orange, the setting-out grid recedes -- but pulls
# saturation towards the application palette, with walls taking the brand navy.
# True colour is correct and looks like a contractor's sheet; this is a booking
# tool for a professional services firm.
MUTED = {
    "#FF0000": "#C4453C",   # rapid-rail workstation hatch
    "#0037DD": "#3F63B8",   # screen-only workstation hatch
    "#4A9500": "#6E9155",   # foldable table hatch
    "#FF4405": "#C9622F",   # rapid rail on tile finish
    "#DD6EDD": "#B884B8",   # italian marble
    "#6E6EDD": "#8189C4",   # fabric glass
    "#5CB873": "#7FA98A",   # B.P.G
    "#B88A00": "#A98B3E",   # corian -- 1,148 paths on F-FURNITURE HATCH. The
                            # legend extract we hold does not name it; see A29.
    "#954A00": "#8A6440",   # vitrified tile / chairs
    "#700095": "#6E4A85",
    "#009595": "#4F8C8C",
    "#FF00FF": "#C08FC0",   # setting-out grid
    "#595959": "#6B6B6B",
    "#000000": "#1E2A5A",   # walls take the brand navy
}


def path_rect(p):
    xs = [pt[0] for sp in p.subpaths for pt in sp]
    ys = [pt[1] for sp in p.subpaths for pt in sp]
    return (min(xs), min(ys), max(xs), max(ys))


def excluded(rect):
    return any(rect[0] >= a and rect[1] >= b and rect[2] <= c and rect[3] <= d
               for a, b, c, d in EXCLUDE)


def hairline_for(raster_width):
    """A PDF stroke width of 0 means "one device pixel".

    49,196 of this drawing's 79,827 in-plan paths are zero-width, so the
    correct SVG width depends on the resolution the SVG is rasterised at. Too
    small and 62% of the drawing disappears; too large and it renders visibly
    bolder than the architect's sheet. 4096 -> 0.314, 2048 -> 0.627.

    This is why there is one SVG PER RASTER WIDTH rather than one SVG scaled
    twice, and why each SVG carries data-raster-width for the rasteriser to
    check. Baking at a width the SVG was not generated for produces a texture
    that is silently too faint or too bold.
    """
    x0, _, x1, _ = C.PLAN_BOX
    return round((x1 - x0) / raster_width, 3)


def visible_images(images, mask):
    """The placed bitmaps that belong in the texture."""
    return [im for im in images
            if not excluded(im.bbox()) and mask.keeps(im.quad)]


def build_svg(paths, images, assets, mask, raster_width,
              palette="muted", bg="#FBFAF7"):
    x0, y0, x1, y1 = C.PLAN_BOX
    w, h = x1 - x0, y1 - y0
    hairline = hairline_for(raster_width)

    buckets = collections.defaultdict(list)
    for p in paths:
        if p.layer in SHEET_ONLY or excluded(path_rect(p)):
            continue
        d = []
        for sp in p.subpaths:
            if len(sp) < 2 or not mask.keeps(sp):
                continue
            d.append("M" + " L".join("%.2f,%.2f" % (x, y) for x, y in sp))
        if not d:
            continue
        stroke = p.stroke_hex()
        fill = p.fill_hex() if p.painted == "f" else None
        if palette == "muted":
            stroke = MUTED.get(stroke, stroke)
            fill = MUTED.get(fill, fill)
        width = round(p.width, 2) or hairline
        # lineCap is round on every path in this drawing; lineJoin is mixed.
        # Rounding a miter join visibly softens the corners of the 1.41pt wall
        # lines, so it is carried per bucket rather than flattened.
        join = "round" if p.join == 1 else "miter"
        buckets[(stroke, fill, width, p.even_odd, join)].append("".join(d))

    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" '
        'viewBox="%g %g %g %g" width="%g" height="%g" '
        'data-raster-width="%d" shape-rendering="geometricPrecision">'
        % (x0, y0, w, h, w, h, raster_width),
        '<rect x="%g" y="%g" width="%g" height="%g" fill="%s"/>'
        % (x0, y0, w, h, bg),
    ]

    def emit(want_fill):
        # Widest first, so the hairline mesh lands on top of the heavy lines
        # rather than under them.
        for key, ds in sorted(buckets.items(), key=lambda kv: -kv[0][2]):
            stroke, fill, width, even_odd, join = key
            if bool(fill) != want_fill:
                continue
            style = 'fill="%s"' % fill if fill else 'fill="none"'
            if even_odd:
                style += ' fill-rule="evenodd"'
            style += (' stroke="%s" stroke-width="%s" stroke-linecap="round"'
                      ' stroke-linejoin="%s"'
                      % (stroke or "none", width, join))
            body = "".join('<path d="%s"/>' % d for d in ds)
            parts.append("<g %s>%s</g>" % (style, body))

    # Paint order: solid fills, then the bitmaps, then all linework on top.
    # Putting the bitmaps last would let a credenza cover the wall and
    # furniture lines that cross it.
    emit(True)

    kept = visible_images(images, mask)
    for im in kept:
        bx0, by0, bx1, by1 = im.bbox()
        asset = assets[im.num]
        box = ('x="%.2f" y="%.2f" width="%.2f" height="%.2f" '
               'preserveAspectRatio="none"'
               % (bx0, by0, bx1 - bx0, by1 - by0))
        mask_ref = ""
        if "mask_b64" in asset:
            # An SVG luminance mask over the untouched JPEG reproduces what a
            # pixel renderer does with the PDF soft mask, and needs no JPEG
            # decoder. The credenzas are rotated shapes inside axis-aligned
            # bitmaps, so without this their corners composite solid black.
            parts.append(
                '<mask id="pm%d" maskUnits="userSpaceOnUse" '
                'x="%.2f" y="%.2f" width="%.2f" height="%.2f">'
                '<image %s href="data:image/png;base64,%s"/></mask>'
                % (im.num, bx0, by0, bx1 - bx0, by1 - by0,
                   box, asset["mask_b64"]))
            mask_ref = ' mask="url(#pm%d)"' % im.num
        parts.append('<image %s%s href="data:%s;base64,%s"/>'
                     % (box, mask_ref, asset["mime"], asset["b64"]))

    if len(kept) != EXPECTED_PLAN_IMAGES:
        raise SystemExit(
            "composited %d bitmaps, expected %d. A vector-only extractor "
            "cannot see these at all, so a missing one is silent. Run --audit."
            % (len(kept), EXPECTED_PLAN_IMAGES))

    emit(False)
    parts.append("</svg>")
    return "".join(parts), len(buckets), len(kept)


def write_texture_svg(paths, images, assets, mask, dest, raster_width,
                      palette="muted", bg="#FBFAF7"):
    svg, groups, n_img = build_svg(paths, images, assets, mask, raster_width,
                                   palette, bg)
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write(svg)
    return os.path.getsize(dest), groups, n_img


def audit(paths, images, mask, layers_hidden, coverage):
    """Build guard. Returns a list of failures; empty means pass.

    Each check exists because the thing it checks has silently gone wrong, or
    could go wrong without producing any visible error.
    """
    failures = []

    inside = [p for p in paths if excluded(path_rect(p))]
    by_layer = collections.Counter(p.layer for p in inside)
    print("EXCLUDE removes %d paths inside the plan" % len(inside))
    for layer, n in by_layer.most_common():
        print("     %6d  %s" % (n, layer))
    if len(inside) != EXPECTED_EXCLUDED_IN_PLAN:
        failures.append(
            "expected exactly %d paths removed inside the plan, got %d. An "
            "EXCLUDE box has changed size. Verify against the PDF before "
            "updating the constant."
            % (EXPECTED_EXCLUDED_IN_PLAN, len(inside)))
    else:
        print("  OK: exactly %d removed, as expected" % EXPECTED_EXCLUDED_IN_PLAN)

    walls = sum(n for layer, n in by_layer.items()
                if layer in WALL_AUDIT_CLASSES)
    if walls:
        failures.append("%d wall-class paths removed by an EXCLUDE box" % walls)
    else:
        print("  OK: no wall-class geometry removed")

    kept = visible_images(images, mask)
    print("embedded bitmaps in the plan: %d (expected %d)"
          % (len(kept), EXPECTED_PLAN_IMAGES))
    if len(kept) != EXPECTED_PLAN_IMAGES:
        failures.append(
            "bitmap count changed: %d, expected %d. A vector-only extractor "
            "cannot see these, so a missing one is silent. Verify against the "
            "PDF before changing EXPECTED_PLAN_IMAGES."
            % (len(kept), EXPECTED_PLAN_IMAGES))
    else:
        print("  OK")

    print("CAD layers hidden in the PDF's default view: %d" % len(layers_hidden))
    if layers_hidden:
        failures.append(
            "layers are hidden in the PDF's default view (%s) but this "
            "renderer draws every layer"
            % ", ".join(sorted(layers_hidden)[:5]))
    else:
        print("  OK: every layer visible, nothing drawn a viewer would hide")

    # The planmask is what the geometry pipeline actually relies on, and the
    # reference implementation has no equivalent. Narrowing it would move
    # interiorCoverage, and through it coreCentre and every zone hull -- so a
    # texture change that quietly moved the mask would move the geometry too.
    print("planmask interior coverage: %.4f (expected 0.5775)" % coverage)
    if abs(coverage - 0.5775) > 0.0010:
        failures.append(
            "planmask interior coverage is %.4f, expected 0.5775 +/- 0.0010. "
            "The mask has moved, which moves coreCentre and every zone hull."
            % coverage)
    else:
        print("  OK")

    return failures
