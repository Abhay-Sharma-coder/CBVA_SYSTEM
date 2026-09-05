#!/usr/bin/env python3
"""
Minimal, dependency-free PDF content-stream reader for the CBVA floor plan.

Why this exists instead of PyMuPDF: the extraction needs exactly three things
from this one drawing -- layer-tagged path geometry, layer-tagged text with
positions, and the block transforms -- and all three are recoverable from the
page content streams with nothing but zlib. Keeping it stdlib means
`npm run build:floorplan` works on a clean checkout with no pip step.

The drawing is 09 -R8 - NB -FURNITURE LAYOUT - 12-06-2025.pdf, plotted from
AutoCAD 2021, MediaBox [0 0 1684 1191], /Contents an array of 14 streams that
MUST be concatenated in declaration order because the graphics state carries
across them.

Coordinate spaces, in order:
  content  raw operand numbers, ~0..53000, meaningless until the CTM is applied
  user     PDF user space, 1684 x 1191, origin bottom-left, y UP
  plan     what everything downstream uses: y DOWN (so it matches SVG and the
           viewBox the Phase 1 assets already carry), cropped to PLAN_BOX
"""
import math
import re
import zlib

MEDIA_W, MEDIA_H = 1684.0, 1191.0

# Plan region on the A2 sheet, in plan coordinates (y down). Excludes the
# title block on the right. Same box the Phase 1 assets were cut to, so the
# viewBox stays "85 95 1285 970" and nothing already committed shifts.
PLAN_BOX = (85.0, 95.0, 1370.0, 1065.0)


# --------------------------------------------------------------------------
# object soup
# --------------------------------------------------------------------------

def _streams_by_objnum(data):
    out = {}
    for m in re.finditer(rb"(?:^|[\r\n])(\d+) 0 obj(.*?)endobj", data, re.S):
        num, body = int(m.group(1)), m.group(2)
        s = re.search(rb"stream[\r\n]+(.*?)endstream", body, re.S)
        if not s:
            continue
        raw = s.group(1)
        if b"/FlateDecode" in body:
            try:
                raw = zlib.decompress(raw)
            except zlib.error:
                continue
        out[num] = raw
    return out


def page_content(data):
    """The /Contents streams, concatenated in declaration order."""
    streams = _streams_by_objnum(data)
    m = re.search(rb"/Type\s*/Page[^s].{0,4000}?/Contents\s*\[([^\]]*)\]", data, re.S)
    if m:
        nums = [int(n) for n in re.findall(rb"(\d+) 0 R", m.group(1))]
    else:
        m = re.search(rb"/Type\s*/Page[^s].{0,4000}?/Contents\s*(\d+) 0 R", data, re.S)
        nums = [int(m.group(1))] if m else []
    return b"\n".join(streams[n] for n in nums if n in streams)


def layer_names(data):
    """'/ocN' -> CAD layer name, via the page /Properties dict and the OCGs."""
    ocg = {}
    for m in re.finditer(rb"(?:^|[\r\n])(\d+) 0 obj\s*<<([^>]*?)/Type\s*/OCG(.*?)>>", data, re.S):
        blk = m.group(2) + m.group(3)
        nm = re.search(rb"/Name\s*\(([^)]*)\)", blk)
        if nm:
            ocg[int(m.group(1))] = nm.group(1).decode("latin1")
    props = re.search(rb"/Properties\s*<<(.*?)>>", data, re.S)
    out = {}
    if props:
        for name, num in re.findall(rb"/(oc\d+)\s+(\d+) 0 R", props.group(1)):
            n = ocg.get(int(num))
            if n:
                out["/" + name.decode()] = n
    return out


def tounicode_cmap(data):
    """glyph id -> character, from the /ToUnicode CMap."""
    ref = re.search(rb"/ToUnicode\s*(\d+) 0 R", data)
    if not ref:
        return {}
    obj = re.search(rb"(?:^|[\r\n])" + ref.group(1) + rb" 0 obj(.*?)endobj", data, re.S)
    if not obj:
        return {}
    st = re.search(rb"stream[\r\n]+(.*?)endstream", obj.group(1), re.S)
    if not st:
        return {}
    raw = st.group(1)
    try:
        raw = zlib.decompress(raw)
    except zlib.error:
        pass
    text = raw.decode("latin1")
    uni = {}
    for blk in re.findall(r"beginbfchar(.*?)endbfchar", text, re.S):
        for a, b in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", blk):
            uni[int(a, 16)] = "".join(chr(int(b[i:i + 4], 16)) for i in range(0, len(b), 4))
    for blk in re.findall(r"beginbfrange(.*?)endbfrange", text, re.S):
        for a, b, c in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", blk):
            lo, hi, dst = int(a, 16), int(b, 16), int(c, 16)
            for k in range(lo, hi + 1):
                uni[k] = chr(dst + k - lo)
    return uni


# --------------------------------------------------------------------------
# tokenizer
# --------------------------------------------------------------------------

_DELIM = b"()<>[]{}/%"
_WS = b"\x00\t\n\x0c\r "


def tokenize(buf):
    """Yield (kind, value). kind in {'num','name','str','hex','op','arr'}."""
    i, n = 0, len(buf)
    while i < n:
        c = buf[i:i + 1]
        if c in _WS:
            i += 1
            continue
        if c == b"%":
            j = i
            while j < n and buf[j:j + 1] not in b"\r\n":
                j += 1
            i = j
            continue
        if c == b"(":
            depth, j, out = 1, i + 1, bytearray()
            while j < n and depth:
                ch = buf[j:j + 1]
                if ch == b"\\":
                    out += buf[j:j + 2]
                    j += 2
                    continue
                if ch == b"(":
                    depth += 1
                elif ch == b")":
                    depth -= 1
                    if not depth:
                        j += 1
                        break
                out += ch
                j += 1
            yield ("str", bytes(out))
            i = j
            continue
        if buf[i:i + 2] == b"<<":
            yield ("op", b"<<")
            i += 2
            continue
        if buf[i:i + 2] == b">>":
            yield ("op", b">>")
            i += 2
            continue
        if c == b"<":
            j = buf.find(b">", i)
            if j < 0:
                break
            yield ("hex", buf[i + 1:j])
            i = j + 1
            continue
        if c in b"[]":
            yield ("arr", c)
            i += 1
            continue
        if c == b"/":
            j = i + 1
            while j < n and buf[j:j + 1] not in _WS and buf[j:j + 1] not in _DELIM:
                j += 1
            yield ("name", buf[i:j])
            i = j
            continue
        j = i
        while j < n and buf[j:j + 1] not in _WS and buf[j:j + 1] not in _DELIM:
            j += 1
        if j == i:
            i += 1
            continue
        word = buf[i:j]
        i = j
        try:
            yield ("num", float(word))
        except ValueError:
            yield ("op", word)


# --------------------------------------------------------------------------
# matrices
# --------------------------------------------------------------------------

IDENT = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def mul(m, n):
    a, b, c, d, e, f = m
    A, B, C, D, E, F = n
    return (a * A + b * C, a * B + b * D,
            c * A + d * C, c * B + d * D,
            e * A + f * C + E, e * B + f * D + F)


def apply(m, x, y):
    a, b, c, d, e, f = m
    return (a * x + c * y + e, b * x + d * y + f)


def invert(m):
    a, b, c, d, e, f = m
    det = a * d - b * c
    if abs(det) < 1e-12:
        return IDENT
    return (d / det, -b / det, -c / det, a / det,
            (c * f - d * e) / det, (b * e - a * f) / det)


def rotation_deg(m):
    """Rotation of a matrix expressed in PLAN space (y down), 0-360 clockwise."""
    return math.degrees(math.atan2(-m[1], m[0])) % 360.0


def scale_of(m):
    return math.hypot(m[0], m[1]), math.hypot(m[2], m[3])


def to_plan(x, y):
    """PDF user space (y up) -> plan space (y down)."""
    return (x, MEDIA_H - y)


def in_plan_box(x, y):
    x0, y0, x1, y1 = PLAN_BOX
    return x0 <= x <= x1 and y0 <= y <= y1


# --------------------------------------------------------------------------
# the interpreter
# --------------------------------------------------------------------------

class Path:
    """
    One painted path.

    `stroke` and `fill` are DeviceRGB triples in 0..1. They are retained
    because in this drawing colour is not decoration -- it is a key. The
    architect's legend assigns a stroke colour per furniture type, and
    P-FULLHEIGHT PARTITION carries the real room dividers in black alongside
    5,012 orange hatch paths that are not walls at all. Without the colour
    those two are indistinguishable; with it the layer separates cleanly.

    Every colour in this file is a plain 3-operand DeviceRGB `RG`/`rg`: there
    is not one `sc`, `scn`, `SCN`, `g`, `G`, `k` or `K` operator in the whole
    content stream, which is why three lines of tracking is enough.
    """

    __slots__ = ("layer", "ctm", "subpaths", "local", "painted", "stroke", "fill")

    def __init__(self, layer, ctm, subpaths, local, painted,
                 stroke=(0.0, 0.0, 0.0), fill=(0.0, 0.0, 0.0)):
        self.layer = layer          # CAD layer name
        self.ctm = ctm              # matrix in force when the path was painted
        self.subpaths = subpaths    # [[(x, y), ...]] in PLAN space
        self.local = local          # the same points, pre-CTM
        self.painted = painted      # 'S' stroked / 'f' filled
        self.stroke = stroke        # DeviceRGB 0..1, in force at paint time
        self.fill = fill            # DeviceRGB 0..1, in force at paint time

    def stroke_hex(self):
        return "#%02X%02X%02X" % tuple(
            max(0, min(255, int(round(c * 255.0)))) for c in self.stroke
        )

    def fill_hex(self):
        return "#%02X%02X%02X" % tuple(
            max(0, min(255, int(round(c * 255.0)))) for c in self.fill
        )


class Span:
    __slots__ = ("layer", "x", "y", "text", "size", "in_plan")

    def __init__(self, layer, x, y, text, size, in_plan):
        self.layer, self.x, self.y = layer, x, y
        self.text, self.size = text, size
        # False for the title block and sheet notes. They are not part of the
        # floor, but they carry the schedule -- the sheet states the 141 total
        # and what it excludes -- so they are returned rather than discarded.
        self.in_plan = in_plan


def _bezier(p0, p1, p2, p3, steps=6):
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1.0 - t
        out.append((
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        ))
    return out


PAINT_OPS = (b"S", b"s", b"f", b"F", b"f*", b"B", b"B*", b"b", b"b*", b"n")
FILL_OPS = (b"f", b"F", b"f*", b"B", b"B*", b"b", b"b*")


def read(data, want_layers=None, want_text=True):
    """Interpret the page content. Returns (paths, spans)."""
    names = layer_names(data)
    uni = tounicode_cmap(data)
    content = page_content(data)

    paths, spans = [], []
    ctm = IDENT
    # PDF's initial colour is black in both channels.
    stroke = fill = (0.0, 0.0, 0.0)
    gstack = []
    oc_stack = []
    layer = None
    mc_depth = 0

    cur, sub, start = [], [], None
    operands = []
    tm = IDENT
    in_text = False
    font_size = 1.0

    def flush(painted):
        nonlocal cur, sub
        if sub and len(sub) > 1:
            cur.append(sub)
        if cur and (want_layers is None or layer in want_layers):
            plan, keep = [], False
            for sp in cur:
                pts = []
                for (x, y) in sp:
                    px, py = to_plan(*apply(ctm, x, y))
                    pts.append((px, py))
                    if not keep and in_plan_box(px, py):
                        keep = True
                plan.append(pts)
            if keep:
                paths.append(Path(layer, ctm, plan, cur, painted, stroke, fill))
        cur, sub = [], []

    for kind, val in tokenize(content):
        if kind == "num":
            operands.append(val)
            continue
        if kind in ("name", "str", "hex", "arr"):
            operands.append((kind, val))
            continue

        op = val

        if op == b"q":
            # Colour rides the stack WITH the ctm. The drawing sets RG inside
            # nested q/Q blocks, so a bare global would leak one block's colour
            # into the next and mis-attribute paths wholesale.
            gstack.append((ctm, stroke, fill))
        elif op == b"Q":
            if gstack:
                ctm, stroke, fill = gstack.pop()
        elif op == b"RG" and len(operands) >= 3:
            nums = [o for o in operands if isinstance(o, float)]
            if len(nums) >= 3:
                stroke = tuple(nums[-3:])
        elif op == b"rg" and len(operands) >= 3:
            nums = [o for o in operands if isinstance(o, float)]
            if len(nums) >= 3:
                fill = tuple(nums[-3:])
        elif op == b"cm" and len(operands) >= 6:
            nums = [o for o in operands if isinstance(o, float)]
            if len(nums) >= 6:
                ctm = mul(tuple(nums[-6:]), ctm)
        elif op == b"BDC":
            mc_depth += 1
            tag = None
            for o in operands:
                if isinstance(o, tuple) and o[0] == "name" and o[1].startswith(b"/oc"):
                    tag = o[1].decode()
            if tag:
                layer = names.get(tag, tag)
                oc_stack.append((mc_depth, layer))
        elif op in (b"BMC", b"BX"):
            mc_depth += 1
        elif op in (b"EMC", b"EX"):
            while oc_stack and oc_stack[-1][0] >= mc_depth:
                oc_stack.pop()
            layer = oc_stack[-1][1] if oc_stack else None
            mc_depth = max(0, mc_depth - 1)

        elif op == b"m" and len(operands) >= 2:
            if sub and len(sub) > 1:
                cur.append(sub)
            start = (float(operands[-2]), float(operands[-1]))
            sub = [start]
        elif op == b"l" and len(operands) >= 2 and sub:
            sub.append((float(operands[-2]), float(operands[-1])))
        elif op in (b"c", b"v", b"y") and sub:
            p0 = sub[-1]
            nums = [o for o in operands if isinstance(o, float)]
            if op == b"c" and len(nums) >= 6:
                p1, p2, p3 = (nums[-6], nums[-5]), (nums[-4], nums[-3]), (nums[-2], nums[-1])
            elif op == b"v" and len(nums) >= 4:
                p1, p2, p3 = p0, (nums[-4], nums[-3]), (nums[-2], nums[-1])
            elif len(nums) >= 4:
                p1 = (nums[-4], nums[-3])
                p3 = (nums[-2], nums[-1])
                p2 = p3
            else:
                operands = []
                continue
            sub.extend(_bezier(p0, p1, p2, p3))
        elif op == b"h":
            if sub and start:
                sub.append(start)
        elif op == b"re" and len(operands) >= 4:
            nums = [o for o in operands if isinstance(o, float)]
            if len(nums) >= 4:
                x, y, w, h = nums[-4:]
                if sub and len(sub) > 1:
                    cur.append(sub)
                start = (x, y)
                cur.append([(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)])
                sub = []
        elif op in PAINT_OPS:
            if op in (b"s", b"b", b"b*") and sub and start:
                sub.append(start)
            flush("f" if op in FILL_OPS else "S")
            start = None

        elif op == b"BT":
            in_text, tm = True, IDENT
        elif op == b"ET":
            in_text = False
        elif op == b"Tf":
            nums = [o for o in operands if isinstance(o, float)]
            if nums:
                font_size = nums[-1]
        elif op == b"Tm" and len(operands) >= 6:
            nums = [o for o in operands if isinstance(o, float)]
            if len(nums) >= 6:
                tm = tuple(nums[-6:])
        elif op in (b"Tj", b"TJ") and want_text and in_text:
            chunks = [o for o in operands if isinstance(o, tuple) and o[0] == "hex"]
            if chunks:
                text = ""
                for _, h in chunks:
                    hs = h.decode("latin1")
                    text += "".join(uni.get(int(hs[i:i + 4], 16), "")
                                    for i in range(0, len(hs), 4))
                if text.strip():
                    full = mul(tm, ctm)
                    px, py = to_plan(*apply(full, 0.0, 0.0))
                    spans.append(Span(layer, px, py, text.strip(),
                                      font_size * (abs(full[0]) or 1.0),
                                      in_plan_box(px, py)))

        operands = []

    return paths, spans


def load(pdf_path, **kw):
    with open(pdf_path, "rb") as fh:
        return read(fh.read(), **kw)
