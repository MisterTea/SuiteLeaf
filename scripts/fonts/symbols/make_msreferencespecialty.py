"""Write msreferencespecialty.svg: SuiteLeaf's drawings for MS Reference Specialty.

Fractions, overlined numbers, stacked numbers, long divisions, radicals, and vectors are set in Arimo
(metric-compatible with Arial) into the rows of ink the Office glyph has: each row's text is scaled to
the row's height and centered on it, and each rule is a rectangle where the Office glyph draws one. The
other marks are drawn by hand below, in the face's units (y down from the ascent, 2074).

    python scripts/fonts/symbols/make_msreferencespecialty.py [OFFICE_FONT]
"""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from fontTools.pens.basePen import BasePen
from fontTools.pens.transformPen import TransformPen
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import suiteleaf_svg  # noqa: E402
import suiteleaf_symbols  # noqa: E402

OFFICE = "/Applications/Microsoft Word.app/Contents/Resources/DFonts/MS Reference Specialty.ttf"
OUT = Path(__file__).with_name("msreferencespecialty.svg")
UNIT = 8  # font units per pixel when measuring the Office glyph
FONT = "Arimo"

# Rows of text, top to bottom; rules between them are found in the Office glyph.
ROWS = {
    0xF069: ["3"], 0xF06A: ["4"], 0xF06B: ["7"], 0xF06F: ["500"], 0xF072: ["18"],
    0xF073: ["1", "10"], 0xF074: ["1", "100"], 0xF075: ["1", "12"], 0xF076: ["1", "15750"], 0xF077: ["1", "16"],
    0xF078: ["1", "18"], 0xF079: ["1", "2"], 0xF07A: ["1", "200"], 0xF07B: ["1", "200000"], 0xF07C: ["1", "243"],
    0xF07D: ["1", "27"], 0xF07E: ["1", "28"], 0xF07F: ["1", "2π"], 0xF080: ["1", "3"], 0xF081: ["1", "32"],
    0xF082: ["1", "4"], 0xF083: ["1", "5"], 0xF084: ["1", "5000"], 0xF085: ["1", "6"], 0xF086: ["1", "60"],
    0xF087: ["1", "7"], 0xF088: ["1", "8"], 0xF089: ["1", "81"], 0xF08A: ["1", "9"], 0xF08B: ["1", "a"],
    0xF08C: ["1", "n"], 0xF08D: ["10", "71"], 0xF08E: ["12", "4"], 0xF08F: ["14", "07"], 0xF090: ["16", "19"],
    0xF091: ["2", "10"], 0xF092: ["2", "3"], 0xF093: ["2", "7"], 0xF094: ["3", "2"], 0xF095: ["3", "4"],
    0xF096: ["3", "8"], 0xF097: ["4", "3"], 0xF098: ["4", "5"], 0xF099: ["5", "6"], 0xF09A: ["5", "8"],
    0xF09B: ["6", "8"], 0xF09C: ["7", "3"], 0xF09D: ["7", "8"], 0xF09E: ["8", "4"], 0xF09F: ["8", "5"],
    0xF0A0: ["8", "9"], 0xF0A1: ["a", "b"], 0xF0A2: ["c", "d"], 0xF0A3: ["c", "λ"], 0xF0A4: ["d", "c"],
    0xF0A5: ["n", "k"], 0xF0A6: ["1", "0"], 0xF0A7: ["1", "1"], 0xF0A8: ["14", "7"], 0xF0A9: ["17", "8"],
    0xF0AA: ["2", "1"], 0xF0AB: ["2", "2"], 0xF0AC: ["2", "4"], 0xF0AD: ["2", "8"], 0xF0AE: ["23", "11"],
    0xF0AF: ["235", "92"], 0xF0B0: ["238", "92"], 0xF0B1: ["238", "93"], 0xF0B2: ["24", "11"], 0xF0B3: ["24", "12"],
    0xF0B4: ["3", "2"], 0xF0B5: ["3", "4"], 0xF0B6: ["3", "8"], 0xF0B7: ["35", "17"], 0xF0B8: ["4", "2"],
    0xF0B9: ["4", "4"], 0xF0BA: ["4", "8"], 0xF0BB: ["5", "8"], 0xF0BC: ["6", "4"], 0xF0BD: ["6", "8"],
    0xF0BE: ["9", "8"], 0xF0BF: ["A", "Z"], 0xF0C0: ["n", "k"],
    0xF0C6: ["s-a"], 0xF0C7: [")("], 0xF0C8: ["s-b"], 0xF0C9: ["s-c"], 0xF0CA: [")"],
}
# Pieces side by side in one row, each over its own run of the row's ink (counted in clusters of ink).
PIECES = {
    0xF06C: [("text", "2", 1), ("paren", None, 1), ("text", "21", 2)],
    0xF070: [("digitparen", "4", 1), ("text", "12", 2)],
    0xF071: [("digitparen", "6", 1), ("text", "39", 2)],
    0xF0C1: [("radical", None, 1), ("text", "-1", 2)],
    0xF0C2: [("radical", None, 1), ("text", "16", 2)],
    0xF0C3: [("radical", None, 1), ("text", "2", 1)],
    0xF0C4: [("radical", None, 1), ("text", "5", 1)],
    0xF0C5: [("radical", None, 1), ("text", "s(", 2)],
    0xF0CB: [("radical", None, 1), ("text", "xy", 2)],
}
# Letters under an arrow.
VECTORS = {0xF024: "AB", 0xF041: "OA", 0xF042: "OB"}

HAND = {
    # Six dots in three columns, and three rules
    0xF023: '<rect x="185" y="1012" width="208" height="208"/><rect x="753" y="1012" width="208" height="208"/><rect x="185" y="1866" width="208" height="208"/><rect x="753" y="1866" width="208" height="208"/>'
            '<rect x="1321" y="1012" width="208" height="208"/><rect x="1321" y="1866" width="208" height="208"/>',
    0xF03A: '<rect x="0" y="752" width="2458" height="152"/><rect x="0" y="1121" width="2458" height="152"/>'
            '<rect x="0" y="1490" width="2458" height="152"/>',
    # Two arrows from about one point, apart
    0xF026: '<g fill="none" stroke="black" stroke-width="90"><path d="M150 1250L1880 640M150 1550L1880 2120"/>'
            '<path d="M1689 871L1880 640L1586 580M1587 2186L1880 2120L1684 1893"/></g>',
    # Pairs of arrows: diverging, parallel, converging
    0xF027: '<g fill="none" stroke="black" stroke-width="90"><path d="M120 900L1900 900M120 1300L1900 2050"/>'
            '<path d="M1643 1055L1900 900L1643 745M1603 2093L1900 2050L1723 1808"/></g>',
    0xF028: '<g fill="none" stroke="black" stroke-width="90"><path d="M120 640L1900 1240M120 1320L1900 1920"/>'
            '<path d="M1607 1304L1900 1240L1706 1011M1607 1984L1900 1920L1706 1691"/></g>',
    0xF029: '<g fill="none" stroke="black" stroke-width="90"><path d="M120 1260L1900 640M120 1920L1900 1320"/>'
            '<path d="M1708 871L1900 640L1606 579M1706 1549L1900 1320L1607 1256"/></g>',
    0xF02A: '<g fill="none" stroke="black" stroke-width="90"><path d="M120 900L1900 900M120 2050L1900 1300"/>'
            '<path d="M1643 1055L1900 900L1643 745M1723 1542L1900 1300L1603 1257"/></g>',
    0xF02B: '<g fill="none" stroke="black" stroke-width="90"><path d="M120 640L1900 1260M120 2100L1900 1480"/>'
            '<path d="M1606 1321L1900 1260L1708 1029M1708 1711L1900 1480L1606 1419"/></g>',
    0xF02C: '<g fill="none" stroke="black" stroke-width="90"><path d="M120 640L1900 1240M120 1840L1900 1840"/>'
            '<path d="M1607 1304L1900 1240L1706 1011M1643 1995L1900 1840L1643 1685"/></g>',
    0xF02D: '<g fill="none" stroke="black" stroke-width="90"><path d="M120 1240L1900 640M120 1840L1900 1840"/>'
            '<path d="M1706 869L1900 640L1607 576M1643 1995L1900 1840L1643 1685"/></g>',
    # A tall mark with a cap
    0xF02E: '<rect x="120" y="358" width="160" height="770"/><rect x="-12" y="358" width="415" height="110"/>',
    # Breves under a bar, a smile over a bar, a smile; a pair of smiles under a bar; a small smile; a bracket hook
    0xF02F: '<rect x="147" y="1322" width="943" height="90"/>'
            '<path fill="none" stroke="black" stroke-width="90" d="M330 1412A288 288 0 0 0 906 1412"/>',
    0xF030: '<path fill="none" stroke="black" stroke-width="90" d="M330 1496A288 288 0 0 0 906 1496"/>'
            '<rect x="147" y="1984" width="943" height="90"/>',
    0xF031: '<path fill="none" stroke="black" stroke-width="90" d="M223 1496A395 395 0 0 0 1014 1496"/>',
    0xF032: '<rect x="164" y="608" width="230" height="1466"/><rect x="1084" y="608" width="230" height="1466"/>'
            '<rect x="164" y="1180" width="1150" height="200"/><rect x="164" y="1660" width="1150" height="160"/>',
    0xF033: '<rect x="148" y="1470" width="1845" height="90"/>'
            '<path fill="none" stroke="black" stroke-width="90" d="M310 1560A325 325 0 0 0 960 1560M1181 1560A325 325 0 0 0 1831 1560"/>',
    0xF034: '<path fill="none" stroke="black" stroke-width="90" d="M223 1634A395 395 0 0 0 1014 1634"/>',
    0xF035: '<path fill="none" stroke="black" stroke-width="140" stroke-linejoin="miter" '
            'd="M116 2073V1115H1231V2003H560V1560H840V1800"/>',
    0xF036: '<path fill="none" stroke="black" stroke-width="130" d="M170 1296A505 505 0 0 1 1180 1296"/><circle cx="675" cy="1110" r="95"/>',
    0xF037: '<g fill="none" stroke="black" stroke-width="80"><circle cx="608" cy="1497" r="390"/><circle cx="1196" cy="1497" r="390"/></g>',
    # A crown
    0xF03B: '<path fill="none" stroke="black" stroke-width="90" stroke-linejoin="miter" d="M190 1220L480 1560L810 1180L1140 1560L1430 1220V2030H190Z"/>',
    # A smile hanging below the line
    0xF03C: '<path fill="none" stroke="black" stroke-width="90" d="M229 2074A395 395 0 0 0 1020 2074"/>',
    # Zigzag rules crossed by a stroke, and plain zigzag rules
    0xF03D: '<path d="M0 948L300 778L600 948L900 778L1200 948L1200 1245L900 1075L600 1245L300 1075L0 1245Z"/>'
            '<rect x="560" y="638" width="80" height="779"/>',
    0xF03E: '<path d="M0 948L300 778L600 948L900 778L1200 948L1500 778L1700 891L1700 1188L1500 1075L1200 1245L900 1075L600 1245L300 1075L0 1245Z"/>'
            '<rect x="1010" y="638" width="80" height="779"/>',
    # Prime-like ticks
    0xF03F: '<polygon points="110,608 285,608 230,1128 160,1128"/>',
    0xF040: '<polygon points="640,599 820,599 520,920 420,920"/><rect x="115" y="1300" width="966" height="135"/>',
    0xF043: '<rect x="148" y="1984" width="1845" height="90"/>'
            '<path fill="none" stroke="black" stroke-width="90" d="M310 1560A325 325 0 0 0 960 1560M1181 1560A325 325 0 0 0 1831 1560"/>'
            '<path fill="none" stroke="black" stroke-width="80" d="M420 1300L760 1230"/>',
    # Crossed strokes over a pair of feet
    0xF044: '<path fill="none" stroke="black" stroke-width="90" d="M260 680L1100 2060M1630 680L790 2060M700 1460L260 2060M1180 1460L1630 2060"/>',
    0xF046: '<path d="M0 948L300 778L600 948L900 778L1200 948L1200 1245L900 1075L600 1245L300 1075L0 1245Z"/>',
    0xF047: '<path d="M0 948L300 778L600 948L900 778L1200 948L1500 778L1700 891L1700 1188L1500 1075L1200 1245L900 1075L600 1245L300 1075L0 1245Z"/>',
    # A circle with a dot and an arrow out of its top
    0xF048: '<g fill="none" stroke="black" stroke-width="90"><circle cx="913" cy="1820" r="520"/><path d="M913 1300V300"/>'
            '<path d="M640 600L913 260L1186 600"/></g><circle cx="913" cy="1820" r="90"/>',
}
# Empty boxes the face draws where a symbol is missing.
for _code in range(0xF049, 0xF069):
    HAND[_code] = '<path fill-rule="evenodd" d="M256 794H1280V2074H256Z M290 828V2040H1246V828Z"/>'


class _Flatten(BasePen):
    def __init__(self, contours, glyphs):
        super().__init__(glyphs)
        self.contours, self.current = contours, []

    def _moveTo(self, p):
        self.current = [p]

    def _lineTo(self, p):
        self.current.append(p)

    def _curveToOne(self, p1, p2, p3):
        p0 = self.current[-1]
        for i in range(1, 9):
            t = i / 8
            m = 1 - t
            self.current.append((m**3 * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t**3 * p3[0],
                                 m**3 * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t**3 * p3[1]))

    def _qCurveToOne(self, p1, p2):
        p0 = self.current[-1]
        for i in range(1, 9):
            t = i / 8
            m = 1 - t
            self.current.append((m * m * p0[0] + 2 * m * t * p1[0] + t * t * p2[0], m * m * p0[1] + 2 * m * t * p1[1] + t * t * p2[1]))

    def _closePath(self):
        if len(self.current) > 2:
            self.contours.append(self.current)
        self.current = []

    _endPath = _closePath


def ink(office, code, x0, width, height):
    """The Office glyph as a boolean image in SVG units / UNIT, from x0."""
    contours = []
    office.gs[office.cmap[code]].draw(TransformPen(_Flatten(contours, office.gs), (1 / UNIT, 0, 0, -1 / UNIT, -x0 / UNIT, ASCENT / UNIT)))
    acc = np.zeros((height, width), bool)
    for c in contours:
        im = Image.new("1", (width, height), 0)
        ImageDraw.Draw(im).polygon(c, fill=1)
        acc ^= np.array(im, bool)
    return acc


def layout(office, code):
    """(rules [(x0, y0, x1, y1)], rows [(x0, y0, x1, y1, clusters)]) of the Office glyph, in SVG units."""
    b = suiteleaf_symbols.fill.bounds(office.gs, office.cmap[code])
    x0 = b[0] - 2 * UNIT
    width, height = int((b[2] - b[0]) / UNIT) + 5, int(office.font["hhea"].ascent + office.font["hhea"].descent + 800) // UNIT
    a = ink(office, code, x0, width, height)
    cols = np.where(a.any(0))[0]
    span = cols.max() - cols.min() + 1
    rules, rows = [], []
    # A rule: rows of one long run of ink, together no thicker than a stroke, with little ink just above
    # and below it (not the flat foot of a digit).
    long = [r for r in range(height) if a[r].sum() >= 0.6 * span and _runs(a[r]) == 1]
    for group in _groups(long):
        if len(group) * UNIT <= 200:
            xs = np.where(a[group].any(0))[0]
            near = [r for r in (group[0] - 1, group[-1] + 1) if 0 <= r < height]
            if any(a[r, xs.min():xs.max() + 1].sum() > 0.25 * len(xs) for r in near):
                continue
            rules.append((x0 + xs.min() * UNIT, group[0] * UNIT, x0 + (xs.max() + 1) * UNIT, (group[-1] + 1) * UNIT))
            a[group] = False
    for group in _groups([r for r in range(height) if a[r].any()]):
        band = a[group]
        xs = np.where(band.any(0))[0]
        clusters = [(x0 + g[0] * UNIT, x0 + (g[-1] + 1) * UNIT) for g in _groups(list(xs))]
        rows.append((x0 + xs.min() * UNIT, group[0] * UNIT, x0 + (xs.max() + 1) * UNIT, (group[-1] + 1) * UNIT, clusters))
    LAST[code] = (a, x0)
    return rules, rows


LAST = {}


def box_below(code, y, left=None, right=None):
    """The ink box of the glyph's rest from y down (between x = left and right), after layout()."""
    a, x0 = LAST[code]
    part = a.copy()
    part[: int(y / UNIT)] = False
    if left is not None:
        part[:, : max(0, int((left - x0) / UNIT))] = False
    if right is not None:
        part[:, int((right - x0) / UNIT):] = False
    ys, xs = np.where(part)
    return (x0 + xs.min() * UNIT, ys.min() * UNIT, x0 + (xs.max() + 1) * UNIT, (ys.max() + 1) * UNIT)


def _runs(row):
    return int(np.diff(np.concatenate([[0], row.astype(int), [0]])).clip(0).sum())


def _groups(indices):
    out = []
    for i in indices:
        if out and i == out[-1][-1] + 1:
            out[-1].append(i)
        else:
            out.append([i])
    return out


def text_box(text):
    """The ink box (x0, y0, x1, y1) of the text at 1000 units, from its origin, y down."""
    el = ET.Element("text", {"font-family": FONT, "font-size": "1000"})
    el.text = text
    return suiteleaf_svg._shape(el, "text", {"font-family": FONT, "font-size": "1000"}).bounds


def fit(text, box, align="center"):
    """A text element whose ink fills the box's height, centered (or left-aligned) in it, on its bottom."""
    x0, y0, x1, y1 = box
    t = text_box(text)
    size = 1000 * (y1 - y0) / (t[3] - t[1])
    s = size / 1000
    x = x0 - t[0] * s if align == "left" else (x0 + x1) / 2 - (t[0] + t[2]) / 2 * s
    y = y1 - t[3] * s
    return f'<text font-family="{FONT}" font-size="{size:.0f}" x="{x:.0f}" y="{y:.0f}">{text}</text>'


def rect(r):
    return f'<rect x="{r[0]:.0f}" y="{r[1]:.0f}" width="{r[2] - r[0]:.0f}" height="{r[3] - r[1]:.0f}"/>'


def symbol(code, office):
    if code in HAND:
        return HAND[code]
    rules, rows = layout(office, code)
    parts = [rect(r) for r in rules]
    if code in ROWS:
        texts = ROWS[code]
        if len(rows) != len(texts):
            raise ValueError(f"{code:04X}: {len(rows)} rows of ink for {texts}")
        parts += [fit(text, row[:4]) for text, row in zip(texts, rows)]
    elif code in PIECES:
        (rx0, ry0, rx1, ry1, clusters), = rows
        top = max([ry0] + [r[3] + 100 for r in rules])
        i = 0
        for kind, text, count in PIECES[code]:
            cx0, cx1 = clusters[i][0], clusters[i + count - 1][1]
            i += count
            if kind == "text":
                parts.append(fit(text, box_below(code, top, cx0, cx1)))
            elif kind == "digitparen":
                # A digit and the bracket it touches, in one run of ink: the digit takes its left three quarters.
                split = cx0 + (cx1 - cx0) * 0.74
                digits = box_below(code, top, clusters[-1][0], rx1)
                parts.append(fit(text, (cx0, digits[1], split - (cx1 - cx0) * 0.06, digits[3])))
                w = cx1 - split
                parts.append(f'<path fill="none" stroke="black" stroke-width="{w * 0.4:.0f}" '
                             f'd="M{split + w * 0.2:.0f} {ry0:.0f}Q{cx1:.0f} {(ry0 + ry1) / 2:.0f} {split + w * 0.2:.0f} {ry1:.0f}"/>')
            elif kind == "paren":
                w = cx1 - cx0
                parts.append(f'<path fill="none" stroke="black" stroke-width="{w * 0.4:.0f}" '
                             f'd="M{cx0 + w * 0.2:.0f} {ry0:.0f}Q{cx1:.0f} {(ry0 + ry1) / 2:.0f} {cx0 + w * 0.2:.0f} {ry1:.0f}"/>')
            elif kind == "radical":
                # The radical sign, half as wide as the row is tall, and its bar (a rule where the Office
                # glyph's bar stands apart from the sign).
                w = (ry1 - ry0) * 0.55
                stroke = 110
                bar = "" if rules else f"H{rx1:.0f}"
                y_top = (rules[0][1] + rules[0][3]) / 2 if rules else ry0 + stroke / 2
                parts.append(f'<path fill="none" stroke="black" stroke-width="{stroke}" stroke-linejoin="miter" '
                             f'd="M{rx0:.0f} {ry0 + (ry1 - ry0) * 0.58:.0f}L{rx0 + w * 0.3:.0f} {ry0 + (ry1 - ry0) * 0.5:.0f}'
                             f'L{rx0 + w * 0.62:.0f} {ry1 - stroke / 2:.0f}L{rx0 + w:.0f} {y_top:.0f}{bar}"/>')
                top = (rules[0][3] if rules else ry0 + stroke) + 100
                clusters = [(rx0 + w + 60, rx1)] * 4
                i = 0
    elif code in VECTORS:
        (sx0, sy0, sx1, sy1), = rules
        mid = (sy0 + sy1) / 2
        head = rows[0]
        half = mid - head[1]
        parts.append(f'<path fill="none" stroke="black" stroke-width="{sy1 - sy0:.0f}" stroke-linejoin="miter" '
                     f'd="M{head[0]:.0f} {mid - half + (sy1 - sy0) / 2:.0f}L{sx1:.0f} {mid:.0f}L{head[0]:.0f} {mid + half - (sy1 - sy0) / 2:.0f}"/>')
        parts.append(fit(VECTORS[code], box_below(code, mid + half + 60)))
    else:
        return None
    return "".join(parts)


def _digit_top(rows, rules, ry0):
    """Where the row's text starts: below the rule over it, if any."""
    under = [r[3] for r in rules if r[3] <= ry0 + 400]
    return max([ry0] + [u + 1.2 * UNIT * 8 for u in under]) if under else ry0


ASCENT = 0


def main(path=OFFICE):
    global ASCENT
    office = suiteleaf_symbols.Office(path)
    ASCENT = office.font["hhea"].ascent
    height = ASCENT + office.font["hhea"].descent * -1 if office.font["hhea"].descent < 0 else ASCENT + office.font["hhea"].descent
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             "<!-- Generated by make_msreferencespecialty.py: SuiteLeaf's drawings for MS Reference Specialty. Units are",
             f"     font units (2048 per em), y down from the ascent ({ASCENT}). -->",
             '<svg xmlns="http://www.w3.org/2000/svg">']
    for code in office.inked():
        body = symbol(code, office)
        if body is None:
            continue
        adv = office.font["hmtx"][office.cmap[code]][0]
        lines.append(f'  <symbol id="u{code:04X}" viewBox="0 0 {adv} {height}">{body}</symbol>')
    lines.append("</svg>")
    OUT.write_text("\n".join(lines) + "\n")
    print(f"wrote {OUT}: {len(lines) - 5} symbols")


if __name__ == "__main__":
    main(*sys.argv[1:])
