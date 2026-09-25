#!/usr/bin/env python3
"""
REFERENCE IMPLEMENTATION -- NOT THE PIPELINE. See ADR-046.

The shipping renderer is tools/cad/texture.py, which is a stdlib port of this
file. This one needs `pip install pymupdf`, which the build deliberately does
not, and it is kept because the audit constants (2492 excluded paths, 11
embedded bitmaps) were first derived here and independently reproduce in the
stdlib parser. Run it to cross-check; do not wire it into the build.

Full-fidelity plan renderer for the CBVA Workspace floor plan.

Why this exists
---------------
The Phase 2 extractor flattened every path to a single stroke colour and a single
line weight. This drawing actually carries 80,428 individually coloured paths
across 29 distinct (stroke, fill) combinations and 8 stroke widths, plus 10
embedded raster images inside the plan that a vector-only extractor cannot see at
all. That is why the baked texture read as pale monochrome while the architect's
sheet reads as a colour-coded drawing.

This renderer preserves colour, fill, stroke width, line join, even-odd rule and
the embedded bitmaps.

Verified against the source PDF by pixel comparison. Residual difference is 3.3%
of the drawing's ink, attributable to hairline anti-aliasing between two
rasterisers, plus 9.6% that is text this renderer deliberately does not emit
because the application draws its own labels.

Usage
-----
    python render_plan_full.py --list-layers
    python render_plan_full.py --audit          # build guard, exits non-zero on failure

    # --raster-width sets the hairline stroke, so always pass it
    python render_plan_full.py --palette muted --raster-width 4096 \
        --out plan-4096.svg --png plan-4096.png

Requires: pip install pymupdf   (cairosvg only when --png is used)
"""
import argparse
import base64
import collections
import sys

import pymupdf

SRC = "09 -R8 - NB -FURNITURE LAYOUT - 12-06-2025.pdf"

# The plan area of the A2 sheet, in PDF points. Excludes the title block.
PLAN_BOX = (85, 95, 1370, 1065)
PLAN_W = PLAN_BOX[2] - PLAN_BOX[0]          # 1285 user units

# Embedded raster images inside the plan area: the solid B.P.G storage credenzas.
# get_drawings() cannot see these, so a missing one is silent. --audit fails if
# the count ever changes.
#
# Paths removed by the EXCLUDE boxes inside the plan area, for this exact PDF.
# This is an EXACT expectation, not a threshold. A size-based check cannot work
# here: an earlier over-wide box deleted 4,650 paths of real geometry and every
# individual path in it was under 64x87pt, so no per-path size limit would ever
# have fired. Volume is the only signal that distinguishes "trimmed a swatch"
# from "ate two wings". If this number changes, re-verify against the PDF before
# updating it.
EXPECTED_PLAN_IMAGES = 11
EXPECTED_EXCLUDED_IN_PLAN = 2492

# Layers belonging to the sheet (north point, scale bar) rather than the building.
SHEET_ONLY = {"AR- TEXT", "AR- HATCH", "AR- FURN", "AR- SMALL CAR"}

# Legend SWATCH blocks only. The legend wording is real text, not vector paths, so
# it never reaches get_drawings() and needs no exclusion. An earlier version of
# this file used generous rectangles around the whole legend area and silently
# deleted 4,650 paths of real building geometry from Zone B and Zone C, including
# 684 workstation hatch paths and 323 wall paths. Keep these tight to the swatches
# and re-run --audit after any change.
EXCLUDE = [
    (431, 96, 500, 188),      # "NO CHANGE AREA" three-swatch key
    (661, 236, 728, 328),     # material key, 3x2 swatch grid
    (559, 857, 597, 999),     # furniture key swatch column
    (1370, 0, 1684, 1191),    # title block
]

# Optional restraint pass. Keeps the drawing's colour SEMANTICS but pulls
# saturation towards the application palette, so it reads as a professional tool
# rather than a contractor's sheet.
MUTED = {
    "#FF0000": "#C4453C",   # rapid-rail workstation hatch
    "#0037DD": "#3F63B8",   # screen-only workstation hatch
    "#4A9500": "#6E9155",   # foldable table hatch
    "#FF4405": "#C9622F",   # rapid rail on tile finish
    "#DD6EDD": "#B884B8",   # italian marble
    "#6E6EDD": "#8189C4",   # fabric glass
    "#5CB873": "#7FA98A",   # B.P.G
    "#B88A00": "#A98B3E",   # corian
    "#954A00": "#8A6440",   # vitrified tile / chairs
    "#700095": "#6E4A85",
    "#009595": "#4F8C8C",
    "#FF00FF": "#C08FC0",   # setting-out grid
    "#595959": "#6B6B6B",
    "#000000": "#1E2A5A",   # walls take the brand navy
}


def hairline_for(raster_width):
    """A PDF stroke width of 0 means 'one device pixel'. 49,763 of this drawing's
    80,428 paths are zero-width, so the correct SVG width depends on the
    resolution the SVG is rasterised at. Too small and 62% of the drawing is
    invisible; too large and it renders visibly bolder than the architect's sheet.
    """
    return round(PLAN_W / raster_width, 3)


def hx(colour):
    """PDF colour tuple to hex. Tolerates grey (1) and CMYK (4) components."""
    if colour is None:
        return None
    c = tuple(colour)
    if len(c) == 1:
        c = (c[0], c[0], c[0])
    elif len(c) == 4:
        cy, m, y, k = c
        c = ((1 - cy) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
    elif len(c) != 3:
        return None
    return "#%02X%02X%02X" % tuple(max(0, min(255, int(round(v * 255)))) for v in c)


def excluded(rect):
    return any(rect[0] >= a and rect[1] >= b and rect[2] <= c and rect[3] <= d
               for a, b, c, d in EXCLUDE)


def in_plan(rect):
    a, b, c, d = PLAN_BOX
    return rect[0] >= a and rect[1] >= b and rect[2] <= c and rect[3] <= d


def d_attr(drawing):
    """One PyMuPDF drawing to a single SVG path 'd' string."""
    out = []
    for it in drawing["items"]:
        k = it[0]
        if k == "l":
            out.append(f"M{it[1].x:.2f},{it[1].y:.2f}L{it[2].x:.2f},{it[2].y:.2f}")
        elif k == "c":
            out.append(f"M{it[1].x:.2f},{it[1].y:.2f}"
                       f"C{it[2].x:.2f},{it[2].y:.2f} {it[3].x:.2f},{it[3].y:.2f} "
                       f"{it[4].x:.2f},{it[4].y:.2f}")
        elif k == "qu":
            q = it[1]
            out.append(f"M{q[0].x:.2f},{q[0].y:.2f}L{q[1].x:.2f},{q[1].y:.2f}"
                       f"L{q[2].x:.2f},{q[2].y:.2f}L{q[3].x:.2f},{q[3].y:.2f}Z")
        elif k == "re":
            r = it[1]
            out.append(f"M{r.x0:.2f},{r.y0:.2f}H{r.x1:.2f}V{r.y1:.2f}H{r.x0:.2f}Z")
        else:
            # Fail loudly rather than dropping geometry. Silent omission is how
            # three earlier defects in this pipeline stayed hidden.
            raise ValueError(f"unhandled path primitive {k!r}")
    return "".join(out)


def plan_images(page):
    """Embedded raster images inside the plan area, excluding legend swatches."""
    return [i for i in page.get_image_info(xrefs=True)
            if in_plan(i["bbox"]) and not excluded(i["bbox"])]


def encode_image(doc, xref):
    """Base64 PNG for one embedded image, with its soft-mask alpha applied.

    The credenzas are rotated shapes inside axis-aligned bitmaps, so their corners
    are transparent. That transparency lives in a separate soft-mask object;
    without it the corners composite solid black.
    """
    pix = pymupdf.Pixmap(doc, xref)
    if pix.n - pix.alpha > 3:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    smask = doc.xref_get_key(xref, "SMask")
    if smask and smask[0] == "xref":
        pix = pymupdf.Pixmap(pix, pymupdf.Pixmap(doc, int(smask[1].split()[0])))
    return base64.b64encode(pix.tobytes("png")).decode()


def audit(doc, page, drawings):
    """Build guard. Returns non-zero if the pipeline has silently lost content."""
    ok = True

    killed = [x for x in drawings if excluded(x["rect"])]
    inside = [x for x in killed if in_plan(x["rect"])]
    print(f"EXCLUDE removes {len(killed)} paths, {len(inside)} inside the plan")
    for lay, n in collections.Counter(x.get("layer") for x in inside).most_common():
        print(f"     {n:6d}  {lay}")
    if len(inside) != EXPECTED_EXCLUDED_IN_PLAN:
        print(f"  FAIL: expected exactly {EXPECTED_EXCLUDED_IN_PLAN} paths removed "
              f"inside the plan, got {len(inside)}. An EXCLUDE box has changed "
              f"size. Verify against the PDF before updating the constant.")
        ok = False
    else:
        print(f"  OK: exactly {EXPECTED_EXCLUDED_IN_PLAN} paths removed, as expected")

    # Wall and partition geometry must never be collateral. The legend swatches
    # legitimately contain 408 partition-layer dot-fill paths, so allow that and
    # nothing beyond it.
    walls = sum(n for lay, n in collections.Counter(
        x.get("layer") for x in inside).items()
        if lay in {"W-WALL", "K-WALL", "C- COLOUMN", "K-COLS", "I-WALL"})
    if walls:
        print(f"  FAIL: {walls} wall-class paths removed by an EXCLUDE box")
        ok = False
    else:
        print("  OK: no wall-class geometry removed")

    imgs = plan_images(page)
    print(f"embedded raster images in the plan: {len(imgs)} "
          f"(expected {EXPECTED_PLAN_IMAGES})")
    if len(imgs) != EXPECTED_PLAN_IMAGES:
        print("  FAIL: image count changed. get_drawings() cannot see these, so a "
              "missing one is silent. Verify against the PDF before changing "
              "EXPECTED_PLAN_IMAGES.")
        ok = False
    else:
        print("  OK")

    hidden = set(doc.get_layer().get("off", []))
    print(f"CAD layers: {len(doc.get_ocgs())}, hidden by default: {len(hidden)}")
    if hidden:
        print("  FAIL: layers are hidden in the PDF's default view but this "
              "renderer draws every layer.")
        ok = False
    else:
        print("  OK: every layer visible, nothing drawn that a viewer would hide")

    try:
        for x in drawings:
            d_attr(x)
        print("path primitives: OK, all recognised")
    except ValueError as exc:
        print(f"  FAIL: {exc}")
        ok = False

    print("\nAUDIT PASSED" if ok else "\nAUDIT FAILED")
    return 0 if ok else 1


def build_svg(doc, page, drawings, palette, bg, hairline, with_images=True):
    buckets = collections.defaultdict(list)
    for x in drawings:
        if x.get("layer") in SHEET_ONLY or excluded(x["rect"]):
            continue
        stroke = hx(x.get("color"))
        fill = hx(x.get("fill"))
        width = round(x.get("width") or 0, 2) or hairline
        if palette == "muted":
            stroke = MUTED.get(stroke, stroke)
            fill = MUTED.get(fill, fill)
        dd = d_attr(x)
        if not dd:
            continue
        # lineCap is round on every path in this drawing; lineJoin is mixed
        # (49,858 miter / 30,570 round). Rounding a miter join visibly softens the
        # corners of the 1.41pt wall lines, so carry it per bucket.
        join = "round" if (x.get("lineJoin") or 0) == 1 else "miter"
        buckets[(stroke, fill, width, bool(x.get("even_odd")), join)].append(dd)

    x0, y0, x1, y1 = PLAN_BOX
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'viewBox="{x0} {y0} {x1 - x0} {y1 - y0}" '
        f'shape-rendering="geometricPrecision">',
        f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" fill="{bg}"/>',
    ]

    def emit(want_fill):
        for (stroke, fill, width, eo, join), paths in sorted(
                buckets.items(), key=lambda kv: -kv[0][2]):
            if bool(fill) != want_fill:
                continue
            style = f'fill="{fill}"' if fill else 'fill="none"'
            if eo:
                style += ' fill-rule="evenodd"'
            style += (f' stroke="{stroke or "none"}" stroke-width="{width}"'
                      f' stroke-linecap="round" stroke-linejoin="{join}"')
            body = "".join(f'<path d="{p}"/>' for p in paths)
            parts.append(f"<g {style}>{body}</g>")

    # Paint order: solid fills, then the embedded bitmaps, then all linework on
    # top. Putting the bitmaps last would let the credenzas cover the wall and
    # furniture lines that cross them.
    emit(True)

    n_img = 0
    if with_images:
        for info in plan_images(page):
            bx = info["bbox"]
            try:
                b64 = encode_image(doc, info["xref"])
            except Exception as exc:                      # noqa: BLE001
                print(f"  WARNING: image xref {info['xref']} failed: {exc}",
                      file=sys.stderr)
                continue
            parts.append(
                f'<image x="{bx[0]:.2f}" y="{bx[1]:.2f}" '
                f'width="{bx[2] - bx[0]:.2f}" height="{bx[3] - bx[1]:.2f}" '
                f'preserveAspectRatio="none" '
                f'xlink:href="data:image/png;base64,{b64}" '
                f'href="data:image/png;base64,{b64}"/>')
            n_img += 1
        if n_img != EXPECTED_PLAN_IMAGES:
            print(f"  WARNING: composited {n_img} images, expected "
                  f"{EXPECTED_PLAN_IMAGES}. Run --audit.", file=sys.stderr)

    emit(False)
    parts.append("</svg>")
    return "".join(parts), buckets, n_img


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf", default=SRC)
    ap.add_argument("--out", help="SVG output path")
    ap.add_argument("--png", help="also rasterise to PNG at --raster-width")
    ap.add_argument("--palette", choices=["true", "muted"], default="muted")
    ap.add_argument("--bg", default="#FBFAF7")
    ap.add_argument("--raster-width", type=int, default=4096,
                    help="pixel width the SVG will be rasterised at. Sets the "
                         "hairline stroke. 4096 -> 0.314, 2048 -> 0.627")
    ap.add_argument("--no-images", action="store_true",
                    help="skip the embedded credenzas (diagnostic only)")
    ap.add_argument("--list-layers", action="store_true")
    ap.add_argument("--audit", action="store_true",
                    help="verify nothing is silently lost; non-zero exit on failure")
    a = ap.parse_args()

    # Hold the Document. Binding only the page lets the Document be garbage
    # collected while the page is still referenced, which segfaults PyMuPDF
    # intermittently under memory pressure.
    doc = pymupdf.open(a.pdf)
    page = doc[0]
    drawings = page.get_drawings()

    if a.audit:
        raise SystemExit(audit(doc, page, drawings))

    if a.list_layers:
        for lay, n in collections.Counter(
                x.get("layer") for x in drawings).most_common():
            print(f"{n:8d}  {lay}")
        return

    if not a.out and not a.png:
        ap.error("pass --out and/or --png (or --audit / --list-layers)")

    hairline = hairline_for(a.raster_width)
    svg, buckets, n_img = build_svg(doc, page, drawings, a.palette, a.bg,
                                    hairline, not a.no_images)

    if a.out:
        with open(a.out, "w") as fh:
            fh.write(svg)
        print(f"wrote {a.out}: {len(buckets)} style groups, "
              f"{sum(len(v) for v in buckets.values())} paths, {n_img} images, "
              f"hairline {hairline} for {a.raster_width}px, {len(svg) / 1024:.0f} KB")

    if a.png:
        import cairosvg
        h = round(a.raster_width * (PLAN_BOX[3] - PLAN_BOX[1]) / PLAN_W)
        cairosvg.svg2png(bytestring=svg.encode(), write_to=a.png,
                         output_width=a.raster_width, output_height=h)
        print(f"wrote {a.png}: {a.raster_width}x{h}")


if __name__ == "__main__":
    main()
