"""Fill characters a SuiteLeaf font lacks with glyphs from compatible open fonts.

Donor outlines are only scaled and moved. A text donor is scaled once so its cap
height matches the Office face; a symbol donor is scaled per glyph to the Office
glyph's height. Each glyph is centered in the Office advance. The donor chosen for
a block of characters (Greek, Cyrillic, box drawing, ...) is the one whose glyphs,
placed exactly as they will be, overlap the Office glyphs most.
"""
import unicodedata
from functools import lru_cache
import numpy as np
from fontTools.ttLib import TTFont
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen

PX = 64
CANVAS = 160
BASE = 120


def block(cp):
    name = unicodedata.name(chr(cp), "")
    return name.split(" ")[0] if name else "OTHER"


@lru_cache(maxsize=16)
def donor_font(path, index=0, coords=None):
    font = TTFont(path, fontNumber=index)
    gs = font.getGlyphSet(location=dict(coords)) if coords else font.getGlyphSet()
    return font, gs, font.getBestCmap(), font["head"].unitsPerEm


def ink_top(font, gs, cmap, chars="HIEX"):
    for ch in chars:
        g = cmap.get(ord(ch))
        if g:
            bp = BoundsPen(gs)
            gs[g].draw(bp)
            if bp.bounds:
                return bp.bounds[3]
    return None


def bounds(gs, name):
    bp = BoundsPen(gs)
    gs[name].draw(bp)
    return bp.bounds


def raster_from(gs, name, transform):
    """Rasterize glyph `name` from a glyph set under an affine transform (font units -> pixels)."""
    from fontTools.pens.basePen import BasePen
    from PIL import Image, ImageDraw
    contours, current = [], []

    class Flatten(BasePen):
        def _moveTo(self, p):
            current.clear()
            current.append(p)

        def _lineTo(self, p):
            current.append(p)

        def _curveToOne(self, p1, p2, p3):
            p0 = current[-1]
            for t in np.linspace(0, 1, 9)[1:]:
                mt = 1 - t
                current.append((mt**3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t**3 * p3[0],
                                mt**3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t**3 * p3[1]))

        def _closePath(self):
            if len(current) > 2:
                contours.append(list(current))
            current.clear()

        _endPath = _closePath

    pen = Flatten(gs)
    gs[name].draw(TransformPen(pen, transform))
    # Even-odd fill: XOR each contour so counters stay open.
    acc = np.zeros((CANVAS, CANVAS), dtype=bool)
    for c in contours:
        im = Image.new("1", (CANVAS, CANVAS), 0)
        ImageDraw.Draw(im).polygon([(x, BASE - y) for x, y in c], fill=1, outline=1)
        acc ^= np.array(im, dtype=bool)
    return acc


def iou(a, b):
    union = (a | b).sum()
    return 1.0 if union == 0 else float((a & b).sum() / union)


class Office:
    def __init__(self, path):
        self.path = str(path)
        self.font = TTFont(path)
        self.gs = self.font.getGlyphSet()
        self.cmap = self.font.getBestCmap() or {}
        if not self.cmap:
            for t in self.font["cmap"].tables:
                if t.platformID == 3 and t.platEncID == 0:
                    self.cmap = dict(t.cmap)
        self.upem = self.font["head"].unitsPerEm
        self.cap = ink_top(self.font, self.gs, self.cmap)

    def advance(self, cp):
        return self.font["hmtx"][self.cmap[cp]][0]

    def raster(self, cp):
        s = PX / self.upem
        return raster_from(self.gs, self.cmap[cp], (s, 0, 0, s, 8, 0))


def placement(office, cp, donor, gname, mode):
    """Affine transform (donor units -> Office units) that scales and centers the donor glyph."""
    dfont, dgs, dcmap, dupem = donor
    adv = office.advance(cp)
    if mode == "symbol":
        ob, db = bounds(office.gs, office.cmap[cp]), bounds(dgs, gname)
        if not db or not ob:
            return None
        s = (ob[3] - ob[1]) / max(db[3] - db[1], 1)
        if (db[2] - db[0]) * s > adv * 0.98:
            s = adv * 0.98 / max(db[2] - db[0], 1)
        dx = (adv - (db[2] - db[0]) * s) / 2 - db[0] * s
        dy = (ob[1] + ob[3]) / 2 - (db[1] + db[3]) / 2 * s
        return (s, 0, 0, s, dx, dy)
    dcap = ink_top(dfont, dgs, dcmap)
    s = (office.cap / dcap) if office.cap and dcap else office.upem / dupem
    dadv = dfont["hmtx"][gname][0] * s
    return (s, 0, 0, s, (adv - dadv) / 2, 0)


# Blocks with at least this many characters are scored across the worker pool.
PARALLEL_MIN = 200


def score_glyphs(office, donor, cps, mapping, mode):
    """(character, donor glyph, placement, overlap with the Office glyph) for each character the donor has."""
    scores = []
    for cp in cps:
        gname = donor[2].get(mapping.get(cp, cp))
        if not gname or cp not in office.cmap:
            continue
        t = placement(office, cp, donor, gname, mode)
        if t is None:
            continue
        s = PX / office.upem
        a = office.raster(cp)
        b = raster_from(donor[1], gname, (t[0] * s, 0, 0, t[3] * s, t[4] * s + 8, t[5] * s))
        if a.any() and not bounds(donor[1], gname):
            continue  # an empty donor glyph for a character the Office face draws
        scores.append((cp, gname, t, iou(a, b)))
    return scores


_WORKER_OFFICES = {}
# Workers keep few fonts open: several builds run at once and CJK donors are large.
_worker_donor = lru_cache(maxsize=3)(donor_font.__wrapped__)


def _score_job(args):
    office_path, font_spec, cps, mapping, mode = args
    if office_path not in _WORKER_OFFICES:
        if len(_WORKER_OFFICES) >= 2:
            _WORKER_OFFICES.clear()
        _WORKER_OFFICES[office_path] = Office(office_path)
    return score_glyphs(_WORKER_OFFICES[office_path], _worker_donor(*font_spec), cps, mapping, mode)


# A donor whose glyphs overlap the Office glyphs at least this well (on average) takes them without
# trying the rest; ideographs overlap less across designs than letters and symbols do.
GOOD_ENOUGH = {"text": 0.5, "symbol": 0.4}
GOOD_ENOUGH_IDEOGRAPHS = 0.35
IDEOGRAPH_BLOCKS = {"CJK", "HANGUL", "HIRAGANA", "KATAKANA", "IDEOGRAPHIC"}
# How close to good enough (or to the best donor) a family already in the font needs to be.
USED_FAMILY_SLACK = 0.75


def choose(office, missing, donors, mode, pool=None, workers=1, preferred=None):
    """Pick a donor glyph and placement for each missing character.

    Families in `preferred` (those that already gave glyphs to this font family) are tried first, then
    the rest in order; the first whose glyphs are good enough takes them. When none is, the best one does.
    `preferred` grows as families are used, so fewer families end up in a font. Large blocks are scored
    on `pool`.
    """
    preferred = [] if preferred is None else preferred
    groups = {}
    for cp in missing:
        groups.setdefault(cp if mode == "symbol" else block(cp), []).append(cp)
    picks = {}
    for key, cps in groups.items():
        enough = GOOD_ENOUGH_IDEOGRAPHS if mode == "text" and key in IDEOGRAPH_BLOCKS else GOOD_ENOUGH[mode]
        todo = list(cps)
        while todo:
            order = sorted(range(len(donors)), key=lambda i: (preferred.index(donors[i]["name"])
                                                              if donors[i]["name"] in preferred else len(preferred), i))
            best, best_used = None, None
            for i in order:
                d = donors[i]
                used = d["name"] in preferred
                mapping = d.get("map", {})
                if pool is not None and len(todo) >= PARALLEL_MIN:
                    size = -(-len(todo) // (2 * workers))
                    jobs = [(office.path, d["font"], todo[k:k + size], mapping, mode) for k in range(0, len(todo), size)]
                    scores = [x for part in pool.map(_score_job, jobs) for x in part]
                else:
                    scores = score_glyphs(office, donor_font(*d["font"]), todo, mapping, mode)
                if not scores:
                    continue
                # Covering the block matters more than a slightly better shape.
                value = sum(x[3] for x in scores) / len(todo)
                if best is None or value > best[0]:
                    best = (value, d, scores)
                if used and (best_used is None or value > best_used[0]):
                    best_used = (value, d, scores)
                # A family the font already uses only has to come close to good enough.
                if sum(x[3] for x in scores) / len(scores) >= enough * (USED_FAMILY_SLACK if used else 1):
                    best = (value, d, scores)
                    break
            else:
                # Nothing was good enough: a family already in use still wins if it is nearly the best.
                if best_used and best_used[0] >= USED_FAMILY_SLACK * best[0]:
                    best = best_used
            if not best:
                break
            for cp, gname, t, score in best[2]:
                picks[cp] = {"donor": best[1], "glyph": gname, "transform": t, "iou": score}
            if best[1]["name"] not in preferred:
                preferred.append(best[1]["name"])
            todo = [cp for cp in todo if cp not in picks]
    return picks


def add_glyph(font, name, donor, gname, transform, advance):
    """Copy a donor outline into `font` under `name`, scaled and moved by `transform`."""
    _, dgs, _, _ = donor
    rec = DecomposingRecordingPen(dgs)
    dgs[gname].draw(rec)
    if "glyf" in font:
        pen = TTGlyphPen(None)
        rec.replay(TransformPen(Cu2QuPen(pen, max_err=0.5, reverse_direction=False), transform))
        font["glyf"][name] = pen.glyph()
        font["glyf"][name].recalcBounds(font["glyf"])
        lsb = getattr(font["glyf"][name], "xMin", 0)
    else:
        cff = font["CFF "].cff
        top = cff[cff.fontNames[0]]
        cs = top.CharStrings
        pen = T2CharStringPen(width=None, glyphSet=None)
        rec.replay(TransformPen(pen, transform))
        any_glyph = cs[top.charset[0]]
        charstring = pen.getCharString(private=any_glyph.private, globalSubrs=any_glyph.globalSubrs)
        if cs.charStringsAreIndexed:
            cs.charStrings[name] = len(cs.charStringsIndex)
            cs.charStringsIndex.append(charstring)
        else:
            cs.charStrings[name] = charstring
        top.charset.append(name)
        b = BoundsPen(None)
        rec.replay(TransformPen(b, transform))
        lsb = round(b.bounds[0]) if b.bounds else 0
    font["hmtx"].metrics[name] = (advance, int(round(lsb)))


def add_blank(font, name, advance):
    if "glyf" in font:
        font["glyf"][name] = TTGlyphPen(None).glyph()
    else:
        cff = font["CFF "].cff
        top = cff[cff.fontNames[0]]
        cs = top.CharStrings
        any_glyph = cs[top.charset[0]]
        pen = T2CharStringPen(width=None, glyphSet=None)
        charstring = pen.getCharString(private=any_glyph.private, globalSubrs=any_glyph.globalSubrs)
        if cs.charStringsAreIndexed:
            cs.charStrings[name] = len(cs.charStringsIndex)
            cs.charStringsIndex.append(charstring)
        else:
            cs.charStrings[name] = charstring
        top.charset.append(name)
    font["hmtx"].metrics[name] = (advance, 0)


def canonical_alias(cp, cmap):
    """A character whose canonical decomposition is a single other character the font has."""
    d = unicodedata.decomposition(chr(cp))
    if d and not d.startswith("<") and " " not in d:
        target = int(d, 16)
        return cmap.get(target)
    return None
