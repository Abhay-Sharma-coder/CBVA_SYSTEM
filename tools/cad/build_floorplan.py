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

GENERATOR_VERSION = 4

# The shell. I-DOOR is deliberately absent: those are the swing arcs, and they
# are noise in 2D and wrong in 3D.
WALL_LAYERS = {
    "W-WALL", "K-WALL", "P-FULLHEIGHT PARTITION", "C- COLOUMN", "K-COLS",
    "I-WALL", "I-PART-FULL", "B- BEAM",
}
GLAZING_LAYERS = {"G-GLASS", "W-WINDOW"}

# Generator 3 splits the shell into three classes, because Phase 4 extrudes
# them at different heights and in different materials. Chaining runs PER
# CLASS, so a partition never welds itself onto a structural wall and inherit
# its height. Glazing was previously dropped entirely -- it only reached the
# baked texture -- because in 2D it is a line like any other. In 3D it is the
# difference between a room and a box.
#
# The budgets are per class so one noisy class cannot eat the allowance and
# silently truncate another. Generator 2's single budget was 400; the classes
# chain to 97 / 157 / 280 naturally, and truncating glazing to fit 400 threw
# away 45% of its length -- a curtain wall with holes in it. The 400 existed
# because SVGLoader and ExtrudeGeometry choke on CAD complexity; Phase 4
# extrudes these as merged segment boxes (ADR-030), where 534 chains is three
# draw calls and ~25k triangles. So the ceiling moves to 600 and stays honest.
#
# THE PARTITION FILTER (ADR-042). P-FULLHEIGHT PARTITION is 6,444 paths and
# 97% of them are not partitions. Measured from the PDF, by stroke colour:
#
#     #FF4405  5,012 paths  len 34,916  x 562-1263, y 355-996  (C and D only)
#     #0037DD  1,152 paths  len  1,473  a narrow vertical band
#     #000000    200 paths  len  9,347  x 169-1279, y 191-976  (whole floor)
#     #006EDD     52 paths  len    351
#     #8AB85C     28 paths  len    398  one 31x31 unit symbol
#
# The 200 black paths are the real full-height room dividers -- ~47 units each
# and spread over the whole floor. The orange is the dot fill of the solid
# rapid-rail benches, at 7 units a path; the blue is finer fill again. Flat on
# a drawing they are texture. Extruded to 1.35 m they are a thicket of walls
# through the middle of every workstation bay.
#
# The filter runs on the class's INPUT, not inside build_walls(): by the time
# that function is chaining, paths have been dissolved into an edge graph keyed
# only on coordinate and the colour is gone.
#
# Only the extruded shell filters. The baked texture still paints every colour
# on this layer -- it is the architect's drawing and nothing is deleted from
# it -- and planmask still rasterises the whole layer, because narrowing the
# flood fill's input would move interiorCoverage and with it coreCentre and
# every zone hull.
# Scoped to P-FULLHEIGHT PARTITION alone. I-PART-FULL is 12 paths stroked
# #595959, all of them real partition, and a blanket black test would drop
# them -- the colour key belongs to the one layer that carries a key.
def real_partitions(path):
    if path.layer != "P-FULLHEIGHT PARTITION":
        return True
    return path.stroke_hex() == "#000000"


WALL_CLASSES = (
    ("wall", {"W-WALL", "K-WALL", "C- COLOUMN", "K-COLS", "I-WALL", "B- BEAM"}, 150, None),
    ("partition", {"P-FULLHEIGHT PARTITION", "I-PART-FULL"}, 200, real_partitions),
    ("glazing", GLAZING_LAYERS, 300, None),
)

# ---------------------------------------------------------------------------
# STATIC FURNITURE (ADR-044)
#
# The renderer draws a mesh only where a BOOKABLE SEAT exists, so zones A and B
# -- a 25-person boardroom, four meeting rooms, two lounges, eight foldable
# tables on castors and a run of storage credenzas -- come out as bare floor.
# That is a rendering gap, not a data gap: there are no seats to add.
#
# So: massing for the furniture that is not a desk, from the drawing's own
# layers rather than modelled by hand.
#
#   F-LOOSE FURNITURE   A 1035  B 427   the soft furniture, and the tables
#   LANDSCAPE           A 3341  D 916   planters
#   I-FURN-MODU         B   67           zone B's modular furniture
#
# Each chain is reduced to its minimum-area ORIENTED bounding box. Massing, not
# outline extrusion: ExtrudeGeometry needs a simple closed shape and most of
# these chains are open polylines, which is the same reason ADR-030 gives for
# the walls. A slab is enough -- the baked drawing underneath already carries
# the real linework at full fidelity, so each box sits on its own drawn
# footprint and reads as the thing it covers.
#
# The one non-obvious rule is the size split inside F-LOOSE FURNITURE. A
# boardroom table and a visitor's chair are the same layer and want different
# heights, and the drawing does not label them. 40 plan units (2.82 m) is the
# threshold: nothing anybody sits ON is that long, and every table in zones A
# and B is longer. It is a guess about height only -- see ASSUMPTIONS A23.
FURNITURE_TABLE_UNITS = 40.0

FURNITURE_CLASSES = (
    ("loose", {"F-LOOSE FURNITURE"}, 600),
    ("planter", {"LANDSCAPE"}, 300),
    ("modular", {"I-FURN-MODU"}, 100),
)

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


def oriented_box(points):
    """
    Minimum-area oriented bounding box, by rotating calipers over the polygon's
    own edge directions. Returns (cx, cy, w, h, deg) or None.

    Axis-aligned boxes are wrong here: this building is a cruciform and its two
    side wings are drawn at 45 degrees, so an axis-aligned box round a sofa in
    zone B is half again too big and points the wrong way.
    """
    if len(points) < 2:
        return None
    best = None
    seen = set()
    for i in range(len(points)):
        ax, ay = points[i]
        bx, by = points[(i + 1) % len(points)]
        dx, dy = bx - ax, by - ay
        if math.hypot(dx, dy) < 1e-6:
            continue
        a = round(math.atan2(dy, dx) % math.pi, 4)
        if a in seen:
            continue
        seen.add(a)
        c, sn = math.cos(-a), math.sin(-a)
        us = [(x * c - y * sn, x * sn + y * c) for x, y in points]
        x0 = min(u[0] for u in us); x1 = max(u[0] for u in us)
        y0 = min(u[1] for u in us); y1 = max(u[1] for u in us)
        area = (x1 - x0) * (y1 - y0)
        if best is None or area < best[0]:
            cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
            c2, s2 = math.cos(a), math.sin(a)
            best = (area, cx * c2 - cy * s2, cx * s2 + cy * c2,
                    x1 - x0, y1 - y0, math.degrees(a))
    return best[1:] if best else None


def build_furniture(paths, mask):
    """Static furniture massing: one oriented box per chained outline."""
    out = []
    for name, layers, budget in FURNITURE_CLASSES:
        chains = build_walls(paths, layers=layers, snap=1.0, simplify=1.0,
                             min_length=6.0, max_polys=100000)
        boxes = []
        for ch in chains:
            box = oriented_box(ch["points"])
            if box is None:
                continue
            cx, cy, w, h, deg = box
            # Outside the shell is the sheet's legend and title block.
            if not mask.contains(cx, cy):
                continue
            # Sub-100 mm slivers are linework, not furniture.
            if w < 2.0 or h < 2.0:
                continue
            kind = name
            if name == "loose":
                kind = "table" if max(w, h) >= FURNITURE_TABLE_UNITS else "seating"
            boxes.append({
                "kind": kind,
                "x": round(cx, 2), "y": round(cy, 2),
                "w": round(w, 2), "h": round(h, 2),
                "rotationDeg": round(deg % 180.0, 1),
            })
        if len(boxes) > budget:
            raise SystemExit(
                f"furniture class {name} produced {len(boxes)} boxes (budget {budget})")
        out.extend(boxes)
        print(f"  furniture {name}: {len(boxes)} boxes (budget {budget})",
              file=sys.stderr)
    out.sort(key=lambda b: (b["kind"], b["x"], b["y"]))
    return out


# --------------------------------------------------------------------------
# walls
# --------------------------------------------------------------------------

def is_hatch(points, min_points=6, reversal_share=0.8):
    """
    A chain that doubles back on itself at nearly every vertex is a hatch fill,
    not a wall.

    Generator 2 shipped one of these as the LONGEST polygon in walls.json: 61
    points and 971 plan units of 45-degree zig-zag inside a 35-unit box, in
    zone A. Flat on the drawing it is invisible; extruded it is a thicket.

    Measured over all 252 polygons the two populations do not overlap. That
    chain reverses at 100% of its vertices; the five longest real walls
    (598-908 units) reverse at 0-40%. Short three-point "out and back" stubs
    are left alone -- as extruded ribbons they harmlessly overlap themselves,
    and they are real wall.
    """
    if len(points) < min_points:
        return False
    total = reversals = 0
    for a, b, c in zip(points, points[1:], points[2:]):
        ux, uy = b[0] - a[0], b[1] - a[1]
        vx, vy = c[0] - b[0], c[1] - b[1]
        lu, lv = math.hypot(ux, uy), math.hypot(vx, vy)
        if lu < 1e-9 or lv < 1e-9:
            continue
        total += 1
        if (ux * vx + uy * vy) / (lu * lv) < -0.7:   # turn sharper than 135 deg
            reversals += 1
    return total > 0 and reversals / total >= reversal_share


def build_walls(paths, layers=WALL_LAYERS, snap=1.0, simplify=1.2,
                min_length=10.0, max_polys=400, keep=None):
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
        if p.layer not in layers:
            continue
        if keep is not None and not keep(p):
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
            if is_hatch(pts):
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
    spans = [s for s in spans if s.in_plan]
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


ROOM_TAG_RE = re.compile(r"^A[3-9]$")


def room_labels(spans):
    """
    Zone A's room tags and their PAX, which `bay_anchors` deliberately throws
    away.

    That guard is right: pairing a zone-A PAX to a bay would import a meeting
    room's capacity as a desk count, and A3's 25 would become 25 bookable
    desks. But it throws away the drawing's own room schedule with it, and the
    3D view has no way to say why a whole wing has no desks in it.

    So this reads the same spans and keeps them separately. It NEVER feeds seat
    detection. Every tag pairs to a PAX annotation within 33 plan units:

        A3 -> 25 (18.6)   A9 -> 10 (32.2)   A8 -> 7 (25.9)
        A7 ->  5 (25.3)   A6 ->  5 (25.9)

    A4 (storage) and A5 (lounge) carry no PAX, correctly, and come back with
    pax = None.
    """
    spans = [s for s in spans if s.in_plan]
    tags = {}
    for s in spans:
        t = s.text.strip()
        if ROOM_TAG_RE.match(t) and s.layer == "F-FURNITURE TEXT":
            tags[t] = (s.x, s.y)

    pax = []
    for s in spans:
        m = PAX_RE.match(s.text.strip())
        if m:
            pax.append((int(m.group(1)), s.x, s.y))

    out, used = [], set()
    for tag in sorted(tags):
        tx, ty = tags[tag]
        best, bi = None, None
        for i, (n, px, py) in enumerate(pax):
            if i in used:
                continue
            d = math.hypot(px - tx, py - ty)
            if d < 35.0 and (best is None or d < best):
                best, bi = d, i
        n = None
        if bi is not None:
            used.add(bi)
            n = pax[bi][0]
        out.append({"bayCode": tag, "pax": n,
                    "planX": round(tx, 2), "planY": round(ty, 2)})
    return out


def workstation_pax(spans):
    """
    The `8 PAX` on the A1/A2 workstation run.

    The build has claimed since Phase 2 that A1 and A2 carry no PAX label and
    rest on the Phase 1 assumption -- `baysWithoutDrawingPax: ["A1","A2"]`,
    `seatsConfirmedByDrawingPax: 133`. That is wrong, and it is wrong for the
    same reason the room schedule was missing: `bay_anchors` skips EVERY tag
    beginning with A, so it never saw the one zone-A annotation that IS a desk
    count. It sits 19.1 units from the A2 tag and reads 8, which is exactly
    A1 + A2 in the bay schedule.

    Reported, not applied. It confirms the pair's total of 8; how those 8 split
    between A1 and A2 is still ours (ASSUMPTIONS A2/A12), so nothing downstream
    changes -- only the claim about what the drawing confirms.
    """
    spans = [s for s in spans if s.in_plan]
    a2 = next(((s.x, s.y) for s in spans
               if s.text.strip() == "A2" and s.layer == "F-FURNITURE TEXT"), None)
    if a2 is None:
        return None
    for s in spans:
        m = PAX_RE.match(s.text.strip())
        if m and math.hypot(s.x - a2[0], s.y - a2[1]) < 35.0:
            return int(m.group(1))
    return None


SHEET_TOTAL_RE = re.compile(r"TOTAL WORKING PEOPLE", re.I)
PAX_ONLY_RE = re.compile(r"^(\d+)\s*PAX\.?$", re.I)


def sheet_headcount(spans):
    """
    The drawing's own headline figure, from the title block:

        TOTAL WORKING PEOPLE =   141 PAX
        NOTE: CONFERENCE AREA AND CAFETERIA NOT INCLUDED.

    This is a third, independent confirmation of 141 -- the first being the
    per-bay PAX annotations summing to it, the second the furniture schedule.
    It also states in the client's own words why the boardroom and conference
    rooms are not in the count, which is the question anyone at CBVA would ask
    first on seeing zone A drawn with no seats.
    """
    label = next((s for s in spans if SHEET_TOTAL_RE.search(s.text)), None)
    if label is None:
        return None, None
    # The figure is set as a separate run on the same baseline.
    best, total = None, None
    for s in spans:
        m = PAX_ONLY_RE.match(s.text)
        if not m or abs(s.y - label.y) > 3.0 or s.x < label.x:
            continue
        d = s.x - label.x
        if best is None or d < best:
            best, total = d, int(m.group(1))
    note = next(
        (s.text for s in spans if "NOT INCLUDED" in s.text.upper()), None
    )
    return total, note


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
    for s_ in (s for s in spans if s.in_plan):
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
    ap.add_argument("--max-walls", type=int, default=600)
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

    # ---- walls, one chained run per class
    walls = []
    for name, layers, budget, keep in WALL_CLASSES:
        got = build_walls(paths, layers=layers, max_polys=budget, keep=keep)
        if len(got) > budget:
            raise SystemExit(f"{name} simplification produced {len(got)} polygons")
        for w in got:
            w["layer"] = name
        walls.extend(got)
        print(f"  {name}: {len(got)} polygons (budget {budget})", file=sys.stderr)
    if len(walls) > a.max_walls:
        raise SystemExit(f"wall simplification produced {len(walls)} polygons")
    print(f"  walls: {len(walls)} polygons", file=sys.stderr)

    # ---- static furniture, one oriented box per chained outline
    furniture = build_furniture(paths, mask)
    print(f"  furniture: {len(furniture)} boxes", file=sys.stderr)

    # ---- anchors and the schedule cross-check
    anchors, expected = bay_anchors(spans)
    missing = [b for b in SCHEDULE if b not in anchors]
    if missing:
        raise SystemExit(f"bay tags not found in the drawing: {missing}")
    drift = {b: {"drawingPax": expected[b], "schedule": SCHEDULE[b]}
             for b in SCHEDULE
             if b in expected and expected[b] != SCHEDULE[b]}
    unconfirmed = sorted(b for b in SCHEDULE if b not in expected)

    # ---- the sheet's own total
    sheet_total, sheet_note = sheet_headcount(spans)
    if sheet_total is not None and sheet_total != sum(SCHEDULE.values()):
        raise SystemExit(
            f"the drawing's title block says {sheet_total} working people but "
            f"the bay schedule sums to {sum(SCHEDULE.values())}"
        )

    # ---- zone A's room schedule, kept apart from seat detection
    rooms = room_labels(spans)
    ws_pax = workstation_pax(spans)
    print("  zone A rooms: " + ", ".join(
        f"{r['bayCode']}={r['pax'] if r['pax'] is not None else '-'}" for r in rooms),
        file=sys.stderr)
    print(f"  A1+A2 workstation run PAX annotation: {ws_pax}", file=sys.stderr)

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
            "furnitureBoxes": len(furniture),
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
        "polygons": [{"layer": w["layer"], "closed": w["closed"],
                      "points": [[round(x, 2), round(y, 2)] for x, y in w["points"]]}
                     for w in walls],
    })
    dump("zones.json", {"viewBox": meta["viewBox"], "zones": zones})
    dump("furniture.json", {"viewBox": meta["viewBox"], "items": furniture})
    dump("rooms.json", {"viewBox": meta["viewBox"], "rooms": rooms})
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
        "sheetTotalWorkingPeople": sheet_total,
        "sheetExclusionNote": sheet_note,
        "scheduleDrift": drift,
        "baysWithoutDrawingPax": unconfirmed,
        "workstationRunPax": ws_pax,
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
    if sheet_total is not None:
        print(f"the drawing's title block states TOTAL WORKING PEOPLE = "
              f"{sheet_total} PAX, matching the bay schedule")
    if sheet_note:
        print(f'  and, verbatim: "{sheet_note}"')
    confirmed = sum(v for k, v in SCHEDULE.items() if k in expected)
    print(f"schedule: {confirmed}/141 seats confirmed by a PAX annotation in "
          f"the drawing; {unconfirmed} carry no PAX label and rest on the "
          f"Phase 1 assumption")
    if drift:
        print(f"WARNING schedule/drawing drift: {drift}")
    print(f"scale: {mm_per_unit} mm per plan unit -- {scale_note}")


if __name__ == "__main__":
    main()
