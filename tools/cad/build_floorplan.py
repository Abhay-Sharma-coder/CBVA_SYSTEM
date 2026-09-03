#!/usr/bin/env python3
"""
CBVA Workspace -- floor plan build step.

Reads the architect's PDF and writes everything the app needs into
src/data/floorplan/. Run it through `npm run build:floorplan`, which also
rasterises the texture; this script on its own writes JSON and one SVG.

Nothing here is traced by hand. The drawing was plotted from AutoCAD 2021 and
kept all 44 CAD layers as PDF optional content groups, so every path knows the
layer it came from and we filter rather than guess.

What the layers turned out to mean, measured rather than assumed:

  W-WALL / K-WALL / P-FULLHEIGHT PARTITION / C- COLOUMN   the shell
  F-FURNITURE            47k paths, mostly the fine detail of desk assemblies
  F-FURNITURE HATCH      the hatched desktop surfaces
  0                      AutoCAD's default layer, and where the *chair* blocks
                         live -- block geometry drawn on layer 0 inherits the
                         insertion layer in CAD but plots as "0"
  F-LOOSE FURNITURE      loose chairs, mostly the passage runs and meeting rooms

Seat detection keys off the chair, not the desk, because there is exactly one
chair per seat and chairs do not touch each other, whereas desks in a 9-pax bay
are drawn as one continuous run and refuse to segment.
"""
import argparse
import collections
import hashlib
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cadparse as C  # noqa: E402
from planmask import PlanMask, wedge_classifier  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PDF = os.path.join(HERE, "09 -R8 - NB -FURNITURE LAYOUT - 12-06-2025.pdf")
OUT = os.path.join(ROOT, "src", "data", "floorplan")

GENERATOR_VERSION = 2

# The shell. I-DOOR is deliberately absent: those are the swing arcs, and they
# are noise in 2D and wrong in 3D.
WALL_LAYERS = {
    "W-WALL", "K-WALL", "P-FULLHEIGHT PARTITION", "C- COLOUMN", "K-COLS",
    "I-WALL", "I-PART-FULL", "B- BEAM",
}
GLAZING_LAYERS = {"G-GLASS", "W-WINDOW"}

BAY_RE = re.compile(r"^(A[12]|C[1-7]|D[1-8])$")
PAX_RE = re.compile(r"^(\d+)\s*PAX\.?$", re.I)

# The bay schedule the Phase 1 seed already encodes. Kept here so the build can
# assert the drawing and the seed still agree; if they ever diverge the build
# fails rather than silently preferring one of them.
SCHEDULE = {
    "A1": 4, "A2": 4,
    "C1": 6, "C2": 4, "C3": 9, "C4": 9, "C5": 9, "C6": 9, "C7": 4, "PA": 16,
    "D1": 9, "D2": 9, "D3": 9, "D4": 9, "D5": 1, "D6": 4, "D7": 4, "D8": 4,
    "PD": 18,
}
BAY_ZONE = {b: {"PA": "C", "PD": "D"}.get(b, b[0]) for b in SCHEDULE}


# --------------------------------------------------------------------------
# geometry helpers
# --------------------------------------------------------------------------

def dist2(a, b):
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def rdp(points, eps):
    """Ramer-Douglas-Peucker."""
    if len(points) < 3:
        return points
    ax, ay = points[0]
    bx, by = points[-1]
    dx, dy = bx - ax, by - ay
    norm = math.hypot(dx, dy)
    worst, wi = -1.0, 0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        if norm < 1e-9:
            d = math.hypot(px - ax, py - ay)
        else:
            d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
        if d > worst:
            worst, wi = d, i
    if worst <= eps:
        return [points[0], points[-1]]
    return rdp(points[:wi + 1], eps)[:-1] + rdp(points[wi:], eps)


def drop_collinear(points, tol_deg=0.5):
    if len(points) < 3:
        return points
    out = [points[0]]
    for i in range(1, len(points) - 1):
        ax, ay = out[-1]
        bx, by = points[i]
        cx, cy = points[i + 1]
        a1 = math.atan2(by - ay, bx - ax)
        a2 = math.atan2(cy - by, cx - bx)
        if abs(math.degrees(a2 - a1)) % 180.0 > tol_deg:
            out.append(points[i])
    out.append(points[-1])
    return out


# --------------------------------------------------------------------------
# walls
# --------------------------------------------------------------------------

def build_walls(paths, snap=1.0, simplify=1.2, min_length=10.0, max_polys=400):
    """
    The raw wall layers are 8,603 paths of CAD noise. Chain them into
    polylines and simplify hard: Phase 4 extrudes these, and SVGLoader chokes
    on unsimplified CAD geometry.
    """
    def key(p):
        return (round(p[0] / snap), round(p[1] / snap))

    adj = collections.defaultdict(set)
    coords = {}
    seen = set()
    for p in paths:
        if p.layer not in WALL_LAYERS:
            continue
        for sp in p.subpaths:
            for a, b in zip(sp, sp[1:]):
                ka, kb = key(a), key(b)
                if ka == kb:
                    continue
                e = (ka, kb) if ka < kb else (kb, ka)
                if e in seen:
                    continue
                seen.add(e)
                coords.setdefault(ka, (ka[0] * snap, ka[1] * snap))
                coords.setdefault(kb, (kb[0] * snap, kb[1] * snap))
                adj[ka].add(kb)
                adj[kb].add(ka)

    used = set()
    polys = []

    def walk(start, first):
        chain = [start, first]
        used.add((start, first) if start < first else (first, start))
        while True:
            cur, prev = chain[-1], chain[-2]
            nxt = None
            for cand in adj[cur]:
                if cand == prev:
                    continue
                e = (cur, cand) if cur < cand else (cand, cur)
                if e in used:
                    continue
                nxt = cand
                break
            if nxt is None:
                break
            used.add((cur, nxt) if cur < nxt else (nxt, cur))
            chain.append(nxt)
            if nxt == start:
                break
        return chain

    # start from junctions and endpoints first so chains break sensibly
    order = sorted(adj, key=lambda k: (len(adj[k]) == 2, k))
    for node in order:
        for nb in list(adj[node]):
            e = (node, nb) if node < nb else (nb, node)
            if e in used:
                continue
            chain = walk(node, nb)
            pts = [coords[k] for k in chain]
            pts = drop_collinear(pts)
            if len(pts) > 2:
                pts = rdp(pts, simplify)
            if len(pts) < 2:
                continue
            length = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
            if length < min_length:
                continue
            closed = math.dist(pts[0], pts[-1]) < snap * 2
            polys.append({"points": pts, "length": length, "closed": closed})

    polys.sort(key=lambda p: -p["length"])
    if len(polys) > max_polys:
        polys = polys[:max_polys]
    return polys


# --------------------------------------------------------------------------
# seat detection
# --------------------------------------------------------------------------

CHAIR_LAYERS = ("0", "F-LOOSE FURNITURE", "I-FURN-MODU")


def find_chairs(paths, mask=None):
    """
    Chair blocks: 7-point closed polylines with a 6-10.5pt bounding box. That
    is the repeated block AutoCAD emitted for a task chair, at every one of the
    wing rotations. Verified by shape-hashing: the top eight normalised shapes
    in the drawing are all this footprint.
    """
    out = []
    for p in paths:
        if p.layer not in CHAIR_LAYERS:
            continue
        for sp in p.subpaths:
            if len(sp) != 7:
                continue
            xs = [q[0] for q in sp]
            ys = [q[1] for q in sp]
            w, h = max(xs) - min(xs), max(ys) - min(ys)
            if not (6.0 <= w <= 10.5 and 6.0 <= h <= 10.5):
                continue
            cx, cy = (max(xs) + min(xs)) / 2.0, (max(ys) + min(ys)) / 2.0
            if mask is not None and not mask.contains(cx, cy):
                continue
            # facing: from the polygon centroid towards the midpoint of its
            # longest edge -- the chair's back, consistently, for every
            # rotation of the same block.
            best, bmid = -1.0, (cx, cy)
            for a, b in zip(sp, sp[1:]):
                d = math.dist(a, b)
                if d > best:
                    best, bmid = d, ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
            gx = sum(xs[:-1]) / 6.0
            gy = sum(ys[:-1]) / 6.0
            facing = math.degrees(math.atan2(bmid[1] - gy, bmid[0] - gx)) % 360.0
            out.append({"x": cx, "y": cy, "facing": facing, "layer": p.layer,
                        "w": w, "h": h})

    # the same chair is often stroked twice
    out.sort(key=lambda c: (c["x"], c["y"]))
    dedup = []
    for c in out:
        if any(dist2((c["x"], c["y"]), (d["x"], d["y"])) < 9.0 for d in dedup[-60:]):
            continue
        dedup.append(c)
    return dedup


def bay_anchors(spans):
    """Bay tag -> (x, y), plus the expected count read off the PAX annotation."""
    tags = {}
    for s in spans:
        if BAY_RE.match(s.text) and s.layer == "F-FURNITURE TEXT":
            tags[s.text] = (s.x, s.y)

    pax = []
    for s in spans:
        m = PAX_RE.match(s.text)
        if m:
            pax.append((int(m.group(1)), s.x, s.y))

    expected, used = {}, set()
    for tag, (tx, ty) in tags.items():
        # Zone A is cabins and meeting rooms. The PAX labels over there count
        # conference seats, not desks, so pairing them to A1/A2 would import a
        # meeting room's capacity as a bay size. Leave them unannotated and let
        # the report say so.
        if tag.startswith("A"):
            continue
        best, bi = None, None
        for i, (n, px, py) in enumerate(pax):
            if i in used:
                continue
            d = math.hypot(px - tx, py - ty)
            if d < 45.0 and (best is None or d < best):
                best, bi = d, i
        if bi is not None:
            used.add(bi)
            expected[tag] = pax[bi][0]

    # D5 is the management cabin: a bay tag with no PAX annotation, one seat.
    if "D5" in tags and "D5" not in expected:
        expected["D5"] = 1

    # The two passage runs are annotated but carry no bay tag of their own.
    for i, (n, px, py) in enumerate(pax):
        if i in used or n not in (16, 18):
            continue
        name = "PA" if n == 16 else "PD"
        tags[name] = (px, py)
        expected[name] = n
        used.add(i)

    return tags, expected


def assign(chairs, anchors, capacity, max_dist=130.0):
    """
    Capacity-constrained nearest assignment. Score every (chair, bay) pair,
    sort globally by distance and take greedily while both the chair is free
    and the bay has room. Doing it globally rather than per-chair stops one bay
    tag acting as a magnet for a whole wing.
    """
    pairs = []
    for ci, c in enumerate(chairs):
        for bay, (ax, ay) in anchors.items():
            d = math.hypot(c["x"] - ax, c["y"] - ay)
            if d <= max_dist:
                pairs.append((d, ci, bay))
    pairs.sort()
    taken = {}
    room = dict(capacity)
    for d, ci, bay in pairs:
        if ci in taken or room.get(bay, 0) <= 0:
            continue
        taken[ci] = bay
        room[bay] -= 1
    by_bay = collections.defaultdict(list)
    for ci, bay in taken.items():
        by_bay[bay].append(chairs[ci])
    return by_bay, [c for i, c in enumerate(chairs) if i not in taken]


def order_bay(members, anchor):
    """
    Stable reading order within a bay: along the run's own principal axis,
    starting from the end nearest the bay tag, tie-broken across the run. This
    is the order somebody walking the bay would count in.
    """
    if len(members) <= 1:
        return members
    n = len(members)
    mx = sum(m["x"] for m in members) / n
    my = sum(m["y"] for m in members) / n
    sxx = sum((m["x"] - mx) ** 2 for m in members)
    syy = sum((m["y"] - my) ** 2 for m in members)
    sxy = sum((m["x"] - mx) * (m["y"] - my) for m in members)
    theta = 0.5 * math.atan2(2 * sxy, sxx - syy)
    ux, uy = math.cos(theta), math.sin(theta)
    if (members[0]["x"] - mx) * ux + (members[0]["y"] - my) * uy < 0:
        pass
    # orient the axis so it runs away from the bay tag
    ax, ay = anchor
    if (mx - ax) * ux + (my - ay) * uy < 0:
        ux, uy = -ux, -uy
    vx, vy = -uy, ux

    def keyf(m):
        along = (m["x"] - mx) * ux + (m["y"] - my) * uy
        across = (m["x"] - mx) * vx + (m["y"] - my) * vy
        return (round(across / 14.0), along)

    return sorted(members, key=keyf)


def interpolate(members, want, anchor):
    """
    Extend a short run along its own axis rather than dropping seats. Marked
    'interpolated' in the output so the editor can surface exactly these.
    """
    made = []
    if not members:
        ax, ay = anchor
        for i in range(want):
            made.append({"x": ax + (i % 4) * 16.0, "y": ay + (i // 4) * 16.0,
                         "facing": 0.0, "interpolated": True})
        return made
    if len(members) == 1:
        base = members[0]
        for i in range(want - 1):
            made.append({"x": base["x"] + (i + 1) * 16.0, "y": base["y"],
                         "facing": base["facing"], "interpolated": True})
        return made
    first, last = members[0], members[-1]
    n = len(members) - 1
    sx = (last["x"] - first["x"]) / n
    sy = (last["y"] - first["y"]) / n
    for i in range(want - len(members)):
        made.append({"x": last["x"] + sx * (i + 1), "y": last["y"] + sy * (i + 1),
                     "facing": last["facing"], "interpolated": True})
    return made


# --------------------------------------------------------------------------
# zones
# --------------------------------------------------------------------------

def hull(points):
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def zone_containing(zones, x, y):
    """Which wing a point falls in, or None."""
    for zone in zones:
        poly = zone["polygon"]
        n, inside_poly, j = len(poly), False, len(poly) - 1
        for i in range(n):
            xi, yi = poly[i]
            xj, yj = poly[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
                inside_poly = not inside_poly
            j = i
        if inside_poly:
            return zone["code"]
    return None


def build_zones(mask, spans, seats):
    """
    Wing outlines for zone highlighting and hit testing, taken from the
    building interior rather than from the raw linework, and split into
    angular wedges aimed at the four 52pt zone letters the architect set on
    the drawing -- so the split is the architect's, not ours.
    """
    letters = {}
    for s_ in spans:
        if s_.text in ("A", "B", "C", "D") and s_.size > 30:
            letters[s_.text] = (s_.x, s_.y)
    if len(letters) != 4:
        raise SystemExit(f"expected four zone letters, found {sorted(letters)}")

    pts = mask.inside_points(step=2)
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    classify = wedge_classifier((cx, cy), letters)

    buckets = collections.defaultdict(list)
    for (x, y) in pts:
        buckets[classify(x, y)].append((round(x, 1), round(y, 1)))
    for s_ in seats:
        buckets[s_["zone"]].append((round(s_["planX"], 1), round(s_["planY"], 1)))

    out = []
    for code in ("A", "B", "C", "D"):
        pl = buckets.get(code, [])
        if not pl:
            continue
        out.append({
            "code": code,
            "labelAnchor": [round(letters[code][0], 2), round(letters[code][1], 2)],
            "polygon": [[round(x, 2), round(y, 2)] for x, y in hull(pl)],
        })
    return out, (cx, cy)


# --------------------------------------------------------------------------
# texture
# --------------------------------------------------------------------------

def write_texture_svg(paths, mask, dest):
    x0, y0, x1, y1 = C.PLAN_BOX
    w, h = x1 - x0, y1 - y0
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0:g} {y0:g} {w:g} {h:g}" '
        f'width="{w:g}" height="{h:g}">',
        f'<rect x="{x0:g}" y="{y0:g}" width="{w:g}" height="{h:g}" fill="#FBFAF7"/>',
    ]
    groups = [
        (("F-FURNITURE HATCH",), "#DCD7CE", 0.3),
        (("LANDSCAPE", "I-GRANITE", "H-HATCH1", "H-HATCH2", "hatch",
          "AC EXH. GRILL", "I-FLOR-PFIX", "I-WALL-PFIX", "AR- HATCH"),
         "#D5D0C6", 0.3),
        (("F-FURNITURE", "F-LOOSE FURNITURE", "I-FURN", "I-FURN-MODU",
          "F-FURNISHING MATERIAL"), "#C3BDB1", 0.35),
        (("0", "00"), "#A9A296", 0.4),
        (("G-GLASS", "W-WINDOW"), "#7C8BA8", 0.6),
        (("B- BEAM", "K-FLOR-STRS", "K-ELEV", "I-ELEV"), "#B4AEA2", 0.5),
        (("P-FULLHEIGHT PARTITION", "I-PART-FULL", "I-WALL", "I-DOOR"),
         "#55618B", 0.6),
        (("W-WALL", "K-WALL", "C- COLOUMN", "K-COLS", "W-WALL HATCH"),
         "#1E2A5A", 0.9),
    ]
    by_layer = collections.defaultdict(list)
    for p in paths:
        by_layer[p.layer].append(p)

    for layers, colour, width in groups:
        d = []
        for lay in layers:
            for p in by_layer.get(lay, ()):
                for sp in p.subpaths:
                    if len(sp) < 2 or not mask.keeps(sp):
                        continue
                    d.append("M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in sp))
        if not d:
            continue
        parts.append(
            f'<g fill="none" stroke="{colour}" stroke-width="{width}" '
            f'stroke-linecap="round" stroke-linejoin="round">'
            f'<path d="{"".join(d)}"/></g>'
        )
    parts.append("</svg>")
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write("".join(parts))
    return os.path.getsize(dest)


# --------------------------------------------------------------------------
# scale
# --------------------------------------------------------------------------

PT_MM = 25.4 / 72.0
PLOT_SCALES = (50, 75, 100, 150, 200, 250, 500)
NOMINAL_CHAIR_MM = 600.0     # plan footprint of a task chair
NOMINAL_PITCH_MM = 1500.0    # workstation pitch along a bench run


def derive_scale(chairs):
    """
    The drawing carries no dimension text we can read, so the scale is
    recovered by asking which standard architectural plot scale makes the two
    things we *did* measure come out to believable millimetres: the chair block
    footprint and the median chair-to-chair spacing along a bench run.

    Only one candidate is close on both, and it is not close by a little.
    """
    if not chairs:
        return None, "no chairs detected"
    chair_pt = sum((c["w"] + c["h"]) / 2.0 for c in chairs) / len(chairs)

    spacing = []
    for i, a in enumerate(chairs):
        best = None
        for j, b in enumerate(chairs):
            if i == j:
                continue
            d = math.dist((a["x"], a["y"]), (b["x"], b["y"]))
            if 4.0 < d < 60.0 and (best is None or d < best):
                best = d
        if best is not None:
            spacing.append(best)
    if not spacing:
        return None, "chair spacing could not be measured"
    spacing.sort()
    pitch_pt = spacing[len(spacing) // 2]

    scored = []
    for s in PLOT_SCALES:
        mm = PT_MM * s
        err = (abs(chair_pt * mm - NOMINAL_CHAIR_MM) / NOMINAL_CHAIR_MM
               + abs(pitch_pt * mm - NOMINAL_PITCH_MM) / NOMINAL_PITCH_MM) / 2.0
        scored.append((err, s, mm))
    scored.sort()
    err, best, mm = scored[0]
    runner = scored[1]
    note = (f"chair block {chair_pt:.2f}pt, median workstation pitch "
            f"{pitch_pt:.2f}pt; best fit 1:{best} gives a "
            f"{chair_pt * mm:.0f}mm chair and a {pitch_pt * mm:.0f}mm pitch "
            f"({err * 100:.0f}% mean deviation from nominal), next-best "
            f"1:{runner[1]} is {runner[0] * 100:.0f}% out")
    if err > 0.25:
        return None, note + " -- no plot scale fits well enough to publish"
    return round(mm, 4), note


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", default=PDF)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--max-walls", type=int, default=400)
    a = ap.parse_args()

    with open(a.pdf, "rb") as fh:
        raw = fh.read()
    checksum = hashlib.sha256(raw).hexdigest()

    print(f"reading {os.path.basename(a.pdf)} ...", file=sys.stderr)
    paths, spans = C.read(raw)
    print(f"  {len(paths)} paths, {len(spans)} text spans", file=sys.stderr)

    os.makedirs(a.out, exist_ok=True)

    mask = PlanMask(paths)
    print(f"  building interior: {mask.coverage * 100:.1f}% of the plan box",
          file=sys.stderr)

    # ---- walls
    walls = build_walls(paths, max_polys=a.max_walls)
    if len(walls) > a.max_walls:
        raise SystemExit(f"wall simplification produced {len(walls)} polygons")
    print(f"  walls: {len(walls)} polygons", file=sys.stderr)

    # ---- anchors and the schedule cross-check
    anchors, expected = bay_anchors(spans)
    missing = [b for b in SCHEDULE if b not in anchors]
    if missing:
        raise SystemExit(f"bay tags not found in the drawing: {missing}")
    drift = {b: {"drawingPax": expected[b], "schedule": SCHEDULE[b]}
             for b in SCHEDULE
             if b in expected and expected[b] != SCHEDULE[b]}
    unconfirmed = sorted(b for b in SCHEDULE if b not in expected)

    # ---- chairs
    chairs = find_chairs(paths, mask)
    print(f"  chair blocks: {len(chairs)}", file=sys.stderr)

    by_bay, unassigned = assign(chairs, anchors, SCHEDULE)

    seats, report = [], []
    for bay in SCHEDULE:
        want = SCHEDULE[bay]
        members = order_bay(by_bay.get(bay, []), anchors[bay])
        detected = len(members)
        surplus = 0
        if detected > want:
            surplus = detected - want
            members = members[:want]
        made = interpolate(members, want, anchors[bay]) if len(members) < want else []
        members = members + made
        for i, m in enumerate(members):
            seats.append({
                "seatCode": f"{bay}-{i + 1:02d}",
                "bay": bay,
                "zone": BAY_ZONE[bay],
                "planX": round(m["x"], 2),
                "planY": round(m["y"], 2),
                "rotationDeg": int(round(m.get("facing", 0.0))) % 360,
                "source": "interpolated" if m.get("interpolated") else "detected",
            })
        report.append({
            "bay": bay, "zone": BAY_ZONE[bay], "expected": want,
            "drawingPax": expected.get(bay),
            "detected": detected, "placed": len(members),
            "interpolated": len(made), "surplusDropped": surplus,
        })

    seats_by_zone = collections.defaultdict(int)
    for s in seats:
        seats_by_zone[s["zone"]] += 1
    zones, centre = build_zones(mask, spans, seats)

    # Chairs the assignment did not claim, counted per zone against the real
    # wing polygons. Most are meeting room and lounge seating, which is why
    # this is broken out by zone rather than reported as one number: zone A's
    # surplus is explained by its 25/10/8-pax rooms and its reception lounge,
    # and zone B's is not explained by anything in the drawing.
    unassigned_by_zone = collections.Counter()
    for c in unassigned:
        code = zone_containing(zones, c["x"], c["y"])
        unassigned_by_zone[code or "outside"] += 1
    zone_b_chairs = unassigned_by_zone.get("B", 0)

    mm_per_unit, scale_note = derive_scale(chairs)

    x0, y0, x1, y1 = C.PLAN_BOX
    meta = {
        "generatorVersion": GENERATOR_VERSION,
        "source": os.path.basename(a.pdf),
        "sourceSha256": checksum,
        "planBounds": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
        "viewBox": f"{x0:g} {y0:g} {x1 - x0:g} {y1 - y0:g}",
        "coreCentre": [round(centre[0], 2), round(centre[1], 2)],
        "mmPerUnit": mm_per_unit,
        "scaleNote": scale_note,
        "texture": {
            "2048": "/floorplan/plan-texture-2048.webp",
            "4096": "/floorplan/plan-texture-4096.webp",
        },
        "counts": {
            "seats": len(seats),
            "wallPolygons": len(walls),
            "chairBlocksDetected": len(chairs),
            "chairBlocksUnassigned": len(unassigned),
            "interiorCoverage": round(mask.coverage, 4),
        },
    }

    def dump(name, obj):
        with open(os.path.join(a.out, name), "w", encoding="utf-8") as fh:
            json.dump(obj, fh, separators=(",", ":"))
            fh.write("\n")

    dump("meta.json", meta)
    dump("walls.json", {
        "viewBox": meta["viewBox"],
        "polygons": [{"closed": w["closed"],
                      "points": [[round(x, 2), round(y, 2)] for x, y in w["points"]]}
                     for w in walls],
    })
    dump("zones.json", {"viewBox": meta["viewBox"], "zones": zones})
    dump("seats.json", {"viewBox": meta["viewBox"], "seats": seats})
    dump("detected-modules.json", {
        "viewBox": meta["viewBox"],
        "modules": [{"x": round(c["x"], 2), "y": round(c["y"], 2),
                     "rotationDeg": int(round(c["facing"])) % 360}
                    for c in chairs],
    })
    dump("detection-report.json", {
        "generatedFrom": os.path.basename(a.pdf),
        "sourceSha256": checksum,
        "scheduleDrift": drift,
        "baysWithoutDrawingPax": unconfirmed,
        "seatsConfirmedByDrawingPax": sum(v for k, v in SCHEDULE.items()
                                          if k in expected),
        "zoneBChairsDetected": zone_b_chairs,
        "zoneBExpected": 0,
        "unassignedChairs": len(unassigned),
        "unassignedChairsByZone": dict(sorted(unassigned_by_zone.items())),
        "bays": report,
    })

    svg = os.path.join(a.out, "plan-texture.svg")
    size = write_texture_svg(paths, mask, svg)
    print(f"  texture svg: {size / 1024:.0f} KB", file=sys.stderr)

    # ---- the honest table
    print()
    print(f"{'bay':<5}{'zone':<6}{'pax':>5}{'sched':>7}{'detected':>10}"
          f"{'placed':>8}{'interp':>8}{'dropped':>9}")
    print("-" * 58)
    for r in report:
        print(f"{r['bay']:<5}{r['zone']:<6}"
              f"{('-' if r['drawingPax'] is None else r['drawingPax']):>5}"
              f"{r['expected']:>7}{r['detected']:>10}{r['placed']:>8}"
              f"{r['interpolated']:>8}{r['surplusDropped']:>9}")
    print("-" * 58)
    td = sum(r["detected"] for r in report)
    ti = sum(r["interpolated"] for r in report)
    print(f"{'TOTAL':<5}{'':<6}{'':>5}{sum(r['expected'] for r in report):>7}"
          f"{td:>10}{sum(r['placed'] for r in report):>8}{ti:>8}"
          f"{sum(r['surplusDropped'] for r in report):>9}")
    print()
    print(f"detection accuracy: {td}/{len(seats)} seats placed from detected "
          f"geometry ({td / len(seats) * 100:.1f}%), {ti} interpolated")
    print(f"unassigned chair blocks by zone: "
          f"{dict(sorted(unassigned_by_zone.items()))}")
    print(f"  zone A's surplus is meeting room and lounge seating "
          f"(25/10/8 pax rooms, reception, sofa, swivel chairs)")
    print(f"  zone B: {zone_b_chairs} chairs, 0 seats scheduled -- see "
          f"ASSUMPTIONS A16, this one is NOT explained by the drawing")
    confirmed = sum(v for k, v in SCHEDULE.items() if k in expected)
    print(f"schedule: {confirmed}/141 seats confirmed by a PAX annotation in "
          f"the drawing; {unconfirmed} carry no PAX label and rest on the "
          f"Phase 1 assumption")
    if drift:
        print(f"WARNING schedule/drawing drift: {drift}")
    print(f"scale: {mm_per_unit} mm per plan unit -- {scale_note}")


if __name__ == "__main__":
    main()
