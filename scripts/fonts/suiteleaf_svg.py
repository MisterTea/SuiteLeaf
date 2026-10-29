"""Glyphs drawn as SVG, for symbols no open font has.

Each symbol font has an SVG file of `<symbol id="uF041">` elements, one for each code it draws itself.
A symbol's user units are the font's units, with y running down from the ascent, so its viewBox is
`0 0 advance ascent+descent`. Shapes are painted in document order: a black fill or stroke adds ink, a
white one takes it away. Supported: path, rect, circle, ellipse, line, polyline, polygon, and text set
in one of TEXT_FONTS (shaped with HarfBuzz), inside groups with transforms; fill, fill-rule, stroke,
stroke-width, stroke-linecap, stroke-linejoin and stroke-miterlimit, as attributes or in `style`.
"""
import math
import re
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path

import pathops
import uharfbuzz as hb
from fontTools.misc.transform import Transform
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path

SVG_DIR = Path(__file__).resolve().parent / "symbols"
NS = "{http://www.w3.org/2000/svg}"
# Fonts a symbol's text may be set in: family -> (path in the font cache, variable instance).
TEXT_FONTS = {
    "Arimo": ("gf/arimo/Arimo[wght].ttf", {"wght": 400}),
    "Arimo Bold": ("gf/arimo/Arimo[wght].ttf", {"wght": 700}),
    "Tinos": ("gf/tinos/Tinos-Regular.ttf", None),
    "Tinos Italic": ("gf/tinos/Tinos-Italic.ttf", None),
    "Tinos Bold": ("gf/tinos/Tinos-Bold.ttf", None),
    "Noto Sans": ("gf/notosans/NotoSans[wdth,wght].ttf", {"wdth": 100, "wght": 400}),
    "Noto Serif": ("gf/notoserif/NotoSerif[wdth,wght].ttf", {"wdth": 100, "wght": 400}),
    "Noto Sans Math": ("gf/notosansmath/NotoSansMath-Regular.ttf", None),
    "Noto Sans Symbols 2": ("gf/notosanssymbols2/NotoSansSymbols2-Regular.ttf", None),
    "Noto Sans JP Bold": ("gf/notosansjp/NotoSansJP[wght].ttf", {"wght": 700}),
}
CAPS = {"butt": pathops.LineCap.BUTT_CAP, "round": pathops.LineCap.ROUND_CAP, "square": pathops.LineCap.SQUARE_CAP}
JOINS = {"miter": pathops.LineJoin.MITER_JOIN, "round": pathops.LineJoin.ROUND_JOIN, "bevel": pathops.LineJoin.BEVEL_JOIN}
INHERITED = ("fill", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
             "font-family", "font-size", "text-anchor", "letter-spacing")
KAPPA = 0.5522847498


def symbols(name):
    """{code: symbol element} from symbols/NAME.svg."""
    path = SVG_DIR / f"{name}.svg"
    if not path.exists():
        return {}
    root = ET.parse(path).getroot()
    return {int(el.get("id")[1:], 16): el for el in root.iter(f"{NS}symbol")}


def _number(value, default=0.0):
    if value is None:
        return default
    return float(re.match(r"\s*([-+]?[\d.]+(?:e[-+]?\d+)?)", value).group(1))


def _transform(text):
    t = Transform()
    for name, args in re.findall(r"(\w+)\s*\(([^)]*)\)", text or ""):
        v = [float(x) for x in re.split(r"[\s,]+", args.strip()) if x]
        if name == "translate":
            t = t.translate(v[0], v[1] if len(v) > 1 else 0)
        elif name == "scale":
            t = t.scale(v[0], v[1] if len(v) > 1 else v[0])
        elif name == "rotate":
            if len(v) == 3:
                t = t.translate(v[1], v[2]).rotate(math.radians(v[0])).translate(-v[1], -v[2])
            else:
                t = t.rotate(math.radians(v[0]))
        elif name == "skewX":
            t = t.skew(math.radians(v[0]), 0)
        elif name == "skewY":
            t = t.skew(0, math.radians(v[0]))
        elif name == "matrix":
            t = t.transform(v)
    return t


def _style(el, parent):
    style = dict(parent)
    for key in INHERITED:
        if el.get(key) is not None:
            style[key] = el.get(key)
    for item in (el.get("style") or "").split(";"):
        if ":" in item:
            k, v = item.split(":", 1)
            style[k.strip()] = v.strip()
    return style


def _ellipse(pen, cx, cy, rx, ry):
    kx, ky = rx * KAPPA, ry * KAPPA
    pen.moveTo((cx + rx, cy))
    pen.curveTo((cx + rx, cy + ky), (cx + kx, cy + ry), (cx, cy + ry))
    pen.curveTo((cx - kx, cy + ry), (cx - rx, cy + ky), (cx - rx, cy))
    pen.curveTo((cx - rx, cy - ky), (cx - kx, cy - ry), (cx, cy - ry))
    pen.curveTo((cx + kx, cy - ry), (cx + rx, cy - ky), (cx + rx, cy))
    pen.closePath()


def _points(text):
    v = [float(x) for x in re.split(r"[\s,]+", (text or "").strip()) if x]
    return list(zip(v[::2], v[1::2]))


@lru_cache(maxsize=None)
def _text_font(family):
    from suiteleaf_fill import donor_font
    import suiteleaf_sources
    path, coords = TEXT_FONTS[family]
    full = str(Path(suiteleaf_sources.DEFAULT_CACHE) / path)
    font, gs, cmap, upem = donor_font(full, 0, tuple(sorted(coords.items())) if coords else None)
    hbfont = hb.Font(hb.Face(hb.Blob.from_file_path(full)))
    if coords:
        hbfont.set_variations(coords)
    return gs, upem, hbfont, font


def _draw_text(pen, el, style):
    family = style.get("font-family", "Arimo").strip("'\"")
    size = _number(style.get("font-size"), 1000)
    gs, upem, hbfont, font = _text_font(family)
    buf = hb.Buffer()
    buf.add_str("".join(el.itertext()))
    buf.guess_segment_properties()
    hb.shape(hbfont, buf)
    s = size / upem
    spacing = _number(style.get("letter-spacing"), 0)
    width = sum(p.x_advance for p in buf.glyph_positions) * s + spacing * max(len(buf.glyph_infos) - 1, 0)
    anchor = style.get("text-anchor", "start")
    x = _number(el.get("x")) - (width / 2 if anchor == "middle" else width if anchor == "end" else 0)
    y = _number(el.get("y"))
    order = font.getGlyphOrder()
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        # Glyph units are y-up; the symbol's are y-down from the baseline at y.
        t = (s, 0, 0, -s, x + pos.x_offset * s, y - pos.y_offset * s)
        gs[order[info.codepoint]].draw(TransformPen(pen, t))
        x += pos.x_advance * s + spacing


def _shape(el, tag, style):
    """The element's outline in its own user units, as an unsimplified path."""
    path = pathops.Path()
    pen = path.getPen()
    if tag == "path":
        parse_path(el.get("d", ""), pen)
    elif tag == "rect":
        x, y, w, h = (_number(el.get(k)) for k in ("x", "y", "width", "height"))
        rx = _number(el.get("rx"), _number(el.get("ry"), 0))
        ry = _number(el.get("ry"), rx)
        if rx or ry:
            rx, ry = min(rx, w / 2), min(ry, h / 2)
            kx, ky = rx * (1 - KAPPA), ry * (1 - KAPPA)
            pen.moveTo((x + rx, y))
            pen.lineTo((x + w - rx, y))
            pen.curveTo((x + w - kx, y), (x + w, y + ky), (x + w, y + ry))
            pen.lineTo((x + w, y + h - ry))
            pen.curveTo((x + w, y + h - ky), (x + w - kx, y + h), (x + w - rx, y + h))
            pen.lineTo((x + rx, y + h))
            pen.curveTo((x + kx, y + h), (x, y + h - ky), (x, y + h - ry))
            pen.lineTo((x, y + ry))
            pen.curveTo((x, y + ky), (x + kx, y), (x + rx, y))
            pen.closePath()
        else:
            pen.moveTo((x, y))
            pen.lineTo((x + w, y))
            pen.lineTo((x + w, y + h))
            pen.lineTo((x, y + h))
            pen.closePath()
    elif tag == "circle":
        r = _number(el.get("r"))
        _ellipse(pen, _number(el.get("cx")), _number(el.get("cy")), r, r)
    elif tag == "ellipse":
        _ellipse(pen, _number(el.get("cx")), _number(el.get("cy")), _number(el.get("rx")), _number(el.get("ry")))
    elif tag == "line":
        pen.moveTo((_number(el.get("x1")), _number(el.get("y1"))))
        pen.lineTo((_number(el.get("x2")), _number(el.get("y2"))))
        pen.endPath()
    elif tag in ("polyline", "polygon"):
        pts = _points(el.get("points"))
        if pts:
            pen.moveTo(pts[0])
            for p in pts[1:]:
                pen.lineTo(p)
            pen.closePath() if tag == "polygon" else pen.endPath()
    elif tag == "text":
        _draw_text(pen, el, style)
    return path


def _paint(color):
    color = (color or "").strip().lower()
    if color in ("", "none", "transparent"):
        return None
    if color in ("white", "#fff", "#ffffff", "rgb(255,255,255)"):
        return "white"
    return "black"


def _closed(path):
    out = pathops.Path()
    pen = out.getPen()
    path.draw(_ClosingPen(pen))
    return out


class _ClosingPen:
    def __init__(self, pen):
        self.pen = pen

    def moveTo(self, p):
        self.pen.moveTo(p)

    def lineTo(self, p):
        self.pen.lineTo(p)

    def curveTo(self, *p):
        self.pen.curveTo(*p)

    def qCurveTo(self, *p):
        self.pen.qCurveTo(*p)

    def closePath(self):
        self.pen.closePath()

    def endPath(self):
        self.pen.closePath()


def render(symbol, ascent):
    """The symbol's ink as a simplified path in font units (y up)."""
    ink = pathops.Path()
    device = Transform(1, 0, 0, -1, 0, ascent)

    def walk(el, transform, style):
        tag = el.tag.replace(NS, "")
        style = _style(el, style)
        transform = transform.transform(_transform(el.get("transform")))
        if tag in ("g", "symbol", "svg"):
            for child in el:
                walk(child, transform, style)
            return
        if tag not in ("path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text"):
            return
        nonlocal ink
        local = _shape(el, tag, style)
        fill = _paint(style.get("fill", "black"))
        if tag in ("line", "polyline"):
            fill = None
        if fill:
            region = _closed(local)
            region.fillType = pathops.FillType.EVEN_ODD if style.get("fill-rule") == "evenodd" else pathops.FillType.WINDING
            region = pathops.simplify(region).transform(*transform)
            ink = pathops.op(ink, region, pathops.PathOp.UNION if fill == "black" else pathops.PathOp.DIFFERENCE)
        stroke = _paint(style.get("stroke"))
        if stroke:
            outline = pathops.Path()
            local.draw(outline.getPen())
            outline.stroke(_number(style.get("stroke-width"), 1), CAPS[style.get("stroke-linecap", "butt")],
                           JOINS[style.get("stroke-linejoin", "miter")], _number(style.get("stroke-miterlimit"), 4))
            # Round caps and joins come out as conics, which pens cannot draw.
            outline.convertConicsToQuads()
            outline = pathops.simplify(outline).transform(*transform)
            ink = pathops.op(ink, outline, pathops.PathOp.UNION if stroke == "black" else pathops.PathOp.DIFFERENCE)

    walk(symbol, device, {})
    return pathops.simplify(ink, clockwise=True)


def text_families(symbol):
    """The TEXT_FONTS families the symbol's text is set in, whose outlines its glyph copies."""
    out = set()

    def walk(el, style):
        style = _style(el, style)
        if el.tag.replace(NS, "") == "text":
            out.add(style.get("font-family", "Arimo").strip("'\""))
        for child in el:
            walk(child, style)

    walk(symbol, {})
    return out


def glyph(symbol, ascent):
    """A TrueType glyph of the symbol."""
    pen = TTGlyphPen(None)
    render(symbol, ascent).draw(Cu2QuPen(pen, max_err=0.5, reverse_direction=False))
    return pen.glyph()
