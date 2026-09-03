#!/usr/bin/env python3
"""
CBVA Workspace - floor plan extraction from the Neetaara AutoCAD PDF.

The drawing (09_-R8_-_NB_-FURNITURE_LAYOUT_-_12-06-2025.pdf) was plotted from
AutoCAD 2021 and still carries all 44 CAD layers as PDF optional content groups.
Every vector path therefore knows which layer it came from, so we can pull out
walls, columns, glazing and furniture independently and rebuild them as clean
SVG for the web app.

Usage:
    python extract_floorplan.py --list                      # layer inventory
    python extract_floorplan.py --svg walls  -o walls.svg
    python extract_floorplan.py --svg furniture -o furn.svg
    python extract_floorplan.py --json walls -o walls.json  # raw geometry

Requires: pip install pymupdf
"""
import argparse, json, sys
import pymupdf

SRC = "09_-R8_-_NB_-FURNITURE_LAYOUT_-_12-06-2025.pdf"

# CAD layer groupings. Confirmed present in the R007 revision.
GROUPS = {
    "walls": {"W-WALL", "K-WALL", "P-FULLHEIGHT PARTITION", "W-WINDOW",
              "G-GLASS", "C- COLOUMN", "K-COLS", "I-WALL", "I-PART-FULL",
              "I-DOOR", "B- BEAM"},
    "furniture": {"F-FURNITURE", "I-FURN-MODU", "I-FURN", "F-LOOSE FURNITURE",
                  "I-FURN-CHAIR"},
    "core": {"K-FLOR-STRS", "K-ELEV", "I-ELEV", "K-WINDOW"},
    "text": {"T-TEXT", "F-FURNITURE TEXT", "AR- TEXT"},
}

# Plan region on the A2 sheet, in PDF points. Excludes the title block.
PLAN_BOX = (85, 95, 1370, 1065)


def load(path):
    doc = pymupdf.open(path)
    return doc[0].get_drawings()


def in_plan(rect):
    x0, y0, x1, y1 = PLAN_BOX
    return rect.x0 >= x0 and rect.y0 >= y0 and rect.x1 <= x1 and rect.y1 <= y1


def to_path_d(drawing):
    """Convert one PyMuPDF drawing into a single SVG path 'd' string."""
    segs = []
    for it in drawing["items"]:
        kind = it[0]
        if kind == "l":
            segs.append(f"M{it[1].x:.2f},{it[1].y:.2f}L{it[2].x:.2f},{it[2].y:.2f}")
        elif kind == "c":
            segs.append(
                f"M{it[1].x:.2f},{it[1].y:.2f}"
                f"C{it[2].x:.2f},{it[2].y:.2f} {it[3].x:.2f},{it[3].y:.2f} "
                f"{it[4].x:.2f},{it[4].y:.2f}"
            )
        elif kind == "qu":
            q = it[1]
            segs.append(
                f"M{q[0].x:.2f},{q[0].y:.2f}L{q[1].x:.2f},{q[1].y:.2f}"
                f"L{q[2].x:.2f},{q[2].y:.2f}L{q[3].x:.2f},{q[3].y:.2f}Z"
            )
        elif kind == "re":
            r = it[1]
            segs.append(
                f"M{r.x0:.2f},{r.y0:.2f}H{r.x1:.2f}V{r.y1:.2f}H{r.x0:.2f}Z"
            )
    return "".join(segs)


def collect(drawings, layers):
    out = []
    for d in drawings:
        if d.get("layer") not in layers:
            continue
        if not in_plan(d["rect"]):
            continue
        dd = to_path_d(d)
        if dd:
            out.append(dd)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", default=SRC)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--svg", choices=sorted(GROUPS))
    ap.add_argument("--json", dest="as_json", choices=sorted(GROUPS))
    ap.add_argument("-o", "--out", default="-")
    ap.add_argument("--stroke", default="#1E2A5A")
    ap.add_argument("--width", type=float, default=1.0)
    a = ap.parse_args()

    drawings = load(a.pdf)

    if a.list:
        from collections import Counter
        c = Counter(d.get("layer") for d in drawings)
        for name, n in c.most_common():
            print(f"{n:8d}  {name}")
        return

    group = a.svg or a.as_json
    if not group:
        ap.error("pass --list, --svg GROUP or --json GROUP")

    paths = collect(drawings, GROUPS[group])
    x0, y0, x1, y1 = PLAN_BOX
    vb = f"{x0} {y0} {x1 - x0} {y1 - y0}"

    if a.as_json:
        payload = json.dumps({"viewBox": vb, "layerGroup": group, "paths": paths})
    else:
        body = "".join(f'<path d="{p}"/>' for p in paths)
        payload = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" '
            f'data-layer-group="{group}">'
            f'<g fill="none" stroke="{a.stroke}" stroke-width="{a.width}" '
            f'stroke-linecap="round" stroke-linejoin="round">{body}</g></svg>'
        )

    if a.out == "-":
        sys.stdout.write(payload)
    else:
        open(a.out, "w").write(payload)
        print(f"wrote {a.out}  ({len(paths)} paths, {len(payload)/1024:.0f} KB)",
              file=sys.stderr)


if __name__ == "__main__":
    main()
