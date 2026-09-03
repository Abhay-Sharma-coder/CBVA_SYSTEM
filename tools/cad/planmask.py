"""
Inside-the-building mask.

The sheet carries hatch keys, material swatches and a scale bar sitting in the
empty wedges between the four wings. They are inside PLAN_BOX but they are not
the floor, and left in they poison both the baked texture and the zone
outlines. So: rasterise the wall and glazing layers, flood fill inwards from
the sheet border, and treat whatever the flood cannot reach as the building.

Measured: the shell is watertight -- the interior comes out at 57-58% of the
plan box and barely moves as the closing dilation is varied, which is what a
cruciform plate should do and what a leaking outline would not.
"""
import math

import cadparse as C

MASK_LAYERS = {
    "W-WALL", "K-WALL", "P-FULLHEIGHT PARTITION", "C- COLOUMN", "K-COLS",
    "I-WALL", "I-PART-FULL", "B- BEAM", "G-GLASS", "W-WINDOW", "W-WALL HATCH",
}


class PlanMask:
    def __init__(self, paths, cell=2.0, dilate=2):
        x0, y0, x1, y1 = C.PLAN_BOX
        self.x0, self.y0, self.cell = x0, y0, cell
        self.w = int((x1 - x0) / cell) + 2
        self.h = int((y1 - y0) / cell) + 2
        w, h = self.w, self.h

        wall = bytearray(w * h)
        for p in paths:
            if p.layer not in MASK_LAYERS:
                continue
            for sp in p.subpaths:
                for a, b in zip(sp, sp[1:]):
                    steps = max(1, int(max(abs(b[0] - a[0]),
                                           abs(b[1] - a[1])) / cell) + 1)
                    for k in range(steps + 1):
                        t = k / steps
                        cx = int((a[0] + (b[0] - a[0]) * t - x0) / cell)
                        cy = int((a[1] + (b[1] - a[1]) * t - y0) / cell)
                        if 0 <= cx < w and 0 <= cy < h:
                            wall[cy * w + cx] = 1

        closed = bytearray(wall)
        for _ in range(dilate):
            nxt = bytearray(closed)
            for y in range(1, h - 1):
                r = y * w
                for x in range(1, w - 1):
                    if closed[r + x]:
                        continue
                    if (closed[r + x - 1] or closed[r + x + 1]
                            or closed[r - w + x] or closed[r + w + x]):
                        nxt[r + x] = 1
            closed = nxt

        outside = bytearray(w * h)
        stack = []
        for x in range(w):
            for y in (0, h - 1):
                i = y * w + x
                if not closed[i] and not outside[i]:
                    outside[i] = 1
                    stack.append((x, y))
        for y in range(h):
            for x in (0, w - 1):
                i = y * w + x
                if not closed[i] and not outside[i]:
                    outside[i] = 1
                    stack.append((x, y))
        while stack:
            x, y = stack.pop()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h:
                    i = ny * w + nx
                    if not outside[i] and not closed[i]:
                        outside[i] = 1
                        stack.append((nx, ny))

        inside = bytearray(1 if not outside[i] else 0 for i in range(w * h))

        # The flood cannot reach pockets that the dilated shell happens to seal
        # off, and a couple of the sheet's hatch keys sit in exactly such a
        # pocket between two wings. The building is one connected plate, so
        # keep the largest component and drop the islands.
        self.inside = self._largest_component(inside, w, h)
        self.coverage = sum(self.inside) / float(w * h)

    @staticmethod
    def _largest_component(inside, w, h):
        seen = bytearray(w * h)
        best, best_cells = 0, None
        for start in range(w * h):
            if inside[start] and not seen[start]:
                seen[start] = 1
                cells, stack = [start], [start]
                while stack:
                    i = stack.pop()
                    x, y = i % w, i // w
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h:
                            j = ny * w + nx
                            if inside[j] and not seen[j]:
                                seen[j] = 1
                                cells.append(j)
                                stack.append(j)
                if len(cells) > best:
                    best, best_cells = len(cells), cells
        out = bytearray(w * h)
        for i in (best_cells or ()):
            out[i] = 1
        return out

    def contains(self, x, y):
        cx = int((x - self.x0) / self.cell)
        cy = int((y - self.y0) / self.cell)
        if not (0 <= cx < self.w and 0 <= cy < self.h):
            return False
        return bool(self.inside[cy * self.w + cx])

    def keeps(self, subpath):
        return any(self.contains(x, y) for x, y in subpath)

    def inside_points(self, step=2):
        """Sample the interior, in plan coordinates."""
        pts = []
        for cy in range(0, self.h, step):
            row = cy * self.w
            for cx in range(0, self.w, step):
                if self.inside[row + cx]:
                    pts.append((self.x0 + cx * self.cell,
                                self.y0 + cy * self.cell))
        return pts


def wedge_classifier(centre, directions):
    """
    Assign a point to whichever named direction it sits closest to in angle,
    as seen from the plate centre. The four wings radiate on the diagonals, so
    angular wedges split them cleanly where an axis-aligned quadrant test does
    not.
    """
    bearings = {k: math.atan2(v[1] - centre[1], v[0] - centre[0])
                for k, v in directions.items()}

    def classify(x, y):
        a = math.atan2(y - centre[1], x - centre[0])
        best, bk = None, None
        for k, b in bearings.items():
            d = abs((a - b + math.pi) % (2 * math.pi) - math.pi)
            if best is None or d < best:
                best, bk = d, k
        return bk

    return classify
