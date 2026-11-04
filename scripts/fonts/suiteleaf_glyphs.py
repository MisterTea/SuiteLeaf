"""Glyph and table edits on a SuiteLeaf face being built.

Outlines are moved, copied, and drawn from components; the character map and glyph order follow
the glyphs added; hinting goes; and the naming, glyph-class, and line-metric tables are set from
the Office face.
"""
import copy
import os
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables import otTables, ttProgram

import suiteleaf_merge as merging


def mark_glyphs(font):
    """Our mark glyphs: those classed as marks, and the glyphs of combining characters and their copies
    (a face placing marks by HarfBuzz's fallback keeps the Office classes, which may call marks bases)."""
    gdef = font["GDEF"].table.GlyphClassDef if "GDEF" in font else None
    marks = {name for name, kind in gdef.classDefs.items() if kind == 3} if gdef else set()
    combining = {g for c, g in font.getBestCmap().items() if unicodedata.category(chr(c)) in ("Mn", "Me")}
    return marks | combining | {name for name in font.getGlyphOrder() if ".sl" in name and name.split(".sl")[0] in combining}


def office_face_path(office_dir, work, office_file, index):
    """A path HarfBuzz and fontTools can open as one face; collection faces are copied out to `work`."""
    path = os.path.join(office_dir, office_file)
    if not office_file.lower().endswith(".ttc"):
        return path
    out = Path(work) / f"office-{Path(office_file).stem}-{index}.ttf"
    if not out.exists():
        TTFont(path, fontNumber=index).save(out)
    return str(out)


def height_factor(office, font):
    """How much larger the source draws its glyphs, from the median ink height of shared letters
    (capitals and lowercase, else ideographs, else any shared character)."""
    oc, sc = office.getBestCmap(), font.getBestCmap()
    ogs, sgs = office.getGlyphSet(), font.getGlyphSet()

    def height(gs, name):
        pen = BoundsPen(gs)
        gs[name].draw(pen)
        return pen.bounds[3] - pen.bounds[1] if pen.bounds else 0

    for sample in (list(range(0x41, 0x5B)) + list(range(0x61, 0x7B)), list(range(0x4E00, 0x4F00)), sorted(oc)):
        ratios = []
        for cp in sample:
            if cp in oc and cp in sc:
                a, b = height(ogs, oc[cp]) / office["head"].unitsPerEm, height(sgs, sc[cp]) / font["head"].unitsPerEm
                if a > 0 and b > 0:
                    ratios.append(b / a)
        if len(ratios) >= 10:
            ratios.sort()
            return ratios[len(ratios) // 2]
    return 1.0


def size_factor(office, font):
    """How much larger the source draws its glyphs, from the median width ratio of shared letters."""
    oc, sc = office.getBestCmap(), font.getBestCmap()
    ratios = []
    for cp in list(range(0x41, 0x5B)) + list(range(0x61, 0x7B)) + list(range(0x0E01, 0x0E2F)):
        if cp in oc and cp in sc:
            a = office["hmtx"][oc[cp]][0] / office["head"].unitsPerEm
            b = font["hmtx"][sc[cp]][0] / font["head"].unitsPerEm
            if a > 0 and b > 0:
                ratios.append(b / a)
    ratios.sort()
    return ratios[len(ratios) // 2]


def strip_hinting(font):
    """Hints are drawn for the original scale, so they go; so do device-specific tables, and Apple's layout
    tables, which HarfBuzz would follow instead of the OpenType layout built here (the web fonts drop them)."""
    for tag in ("fpgm", "prep", "cvt ", "hdmx", "LTSH", "VDMX", "kern", "DSIG", "STAT", "MVAR", "HVAR", "vhea", "vmtx", "gasp",
                "morx", "mort", "kerx", "trak", "ankr", "feat", "just", "opbd", "prop", "lcar", "bsln"):
        if tag in font:
            del font[tag]
    # Unhinted outlines: smooth at every size.
    font["gasp"] = newTable("gasp")
    font["gasp"].version = 1
    font["gasp"].gaspRange = {0xFFFF: 0x000A}
    if "glyf" in font:
        for name in font.getGlyphOrder():
            g = font["glyf"][name]
            if hasattr(g, "program"):
                g.program = ttProgram.Program()
                g.program.fromBytecode(b"")


def decompose_glyf(font):
    glyf, gs = font["glyf"], font.getGlyphSet()
    for name in font.getGlyphOrder():
        if glyf[name].isComposite():
            rec = DecomposingRecordingPen(gs)
            gs[name].draw(rec)
            pen = TTGlyphPen(None)
            rec.replay(pen)
            glyf[name] = pen.glyph()


def outline_copy_shift(font, name, dx, new_name=None, sx=1.0, skew=0.0):
    """Move a glyph sideways by dx, or copy it to new_name and move the copy. The outline can
    also be stretched by sx and slanted by skew (x grows by skew * y) before the move."""
    target = new_name or name
    if "glyf" in font:
        g = copy.deepcopy(font["glyf"][name])
        if g.isComposite():
            rec = DecomposingRecordingPen(font.getGlyphSet())
            font.getGlyphSet()[name].draw(rec)
            pen = TTGlyphPen(None)
            rec.replay(pen)
            g = pen.glyph()
        if g.numberOfContours > 0 and (dx or sx != 1 or skew):
            c = g.coordinates
            for i in range(len(c)):
                x, y = c[i]
                c[i] = (round(sx * x + skew * y + dx), y)
        font["glyf"][target] = g
        if hasattr(g, "coordinates"):
            g.recalcBounds(font["glyf"])
        return
    cff = font["CFF "].cff
    cs = cff[cff.fontNames[0]].CharStrings
    original = cs[name]
    pen = T2CharStringPen(width=None, glyphSet=None)
    original.draw(TransformPen(pen, (sx, 0, skew, 1, dx, 0)))
    moved = pen.getCharString(private=original.private, globalSubrs=original.globalSubrs)
    if new_name and new_name not in cs.charStrings:
        if cs.charStringsAreIndexed:
            cs.charStrings[new_name] = len(cs.charStringsIndex)
            cs.charStringsIndex.append(moved)
        else:
            cs.charStrings[new_name] = moved
    if cs.charStringsAreIndexed:
        cs.charStringsIndex[cs.charStrings[target]] = moved
    else:
        cs.charStrings[target] = moved


def has_feature(font, tag, feature):
    return tag in font and any(fr.FeatureTag == feature for fr in font[tag].table.FeatureList.FeatureRecord)


def set_cmap(font, cmap):
    """Point every Unicode cmap subtable at `cmap`, adding a full-range one when characters lie above U+FFFF."""
    tables = font["cmap"].tables
    if max(cmap, default=0) > 0xFFFF and not any(t.format == 12 for t in tables):
        from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
        table = CmapSubtable.newSubtable(12)
        table.platformID, table.platEncID, table.language, table.cmap = 3, 10, 0, {}
        tables.append(table)
    for table in tables:
        if table.isUnicode() or (table.platformID == 3 and table.platEncID in (1, 10)):
            table.cmap = {c: n for c, n in cmap.items() if table.format != 4 or c <= 0xFFFF}


def reference_copy(font, source, name, advance=None):
    """Another glyph drawn like `source`: a TrueType composite referring to it, or a copy of a CFF outline.
    Given another advance, the drawing is centered in it."""
    width, lsb = font["hmtx"][source]
    dx = round((advance - width) / 2) if advance is not None else 0
    if "glyf" in font:
        pen = TTGlyphPen(font.getGlyphSet())
        pen.addComponent(source, (1, 0, 0, 1, dx, 0))
        font["glyf"][name] = pen.glyph()
    else:
        outline_copy_shift(font, source, dx, name)
    font["hmtx"][name] = (width if advance is None else advance, lsb + dx)


def split_by_class(font, cmap, ocmap, ocd):
    """Characters sharing one of our glyphs whose Office glyphs are of different classes (a combining
    grapheme joiner, a mark that attachment looks past, drawn like a space) get a glyph of their own."""
    if not ocd:
        return
    by_glyph = defaultdict(list)
    for c, g in sorted(cmap.items()):
        if c in ocmap:
            by_glyph[g].append(c)
    added = []
    for g, chars in by_glyph.items():
        first = ocd.get(ocmap[chars[0]], 0)
        for c in chars[1:]:
            if ocd.get(ocmap[c], 0) != first:
                name = f"{g}.slc{c:04X}"
                reference_copy(font, g, name)
                cmap[c] = name
                added.append(name)
    if added:
        append_glyphs(font, added)
        set_cmap(font, cmap)


def split_by_spacing(font, cmap, deltas):
    """Characters sharing one of our glyphs that the Office face spaces differently against others
    (a no-break space it does not kern after a comma) get a glyph of their own."""
    spacing = defaultdict(set)
    for (a, b), d in deltas.items():
        spacing[a].add(("after", b, d))
        spacing[b].add(("before", a, d))
    by_glyph = defaultdict(list)
    for c, g in sorted(cmap.items()):
        by_glyph[g].append(c)
    classes = font["GDEF"].table.GlyphClassDef.classDefs if "GDEF" in font and font["GDEF"].table.GlyphClassDef else None
    added = []
    for g, chars in by_glyph.items():
        for c in chars[1:]:
            if spacing[c] != spacing[chars[0]]:
                name = f"{g}.slk{c:04X}"
                reference_copy(font, g, name)
                if classes is not None and g in classes:
                    classes[name] = classes[g]
                cmap[c] = name
                added.append(name)
    if added:
        append_glyphs(font, added)
        set_cmap(font, cmap)


def append_glyphs(font, names):
    """Add glyphs already drawn into glyf or CFF to the glyph order."""
    order = font.getGlyphOrder()
    order = order + [n for n in names if n not in set(order)]
    font.setGlyphOrder(order)
    if "glyf" in font:
        font["glyf"].glyphOrder = order
    else:
        font["CFF "].cff[font["CFF "].cff.fontNames[0]].charset = list(order)
    merging.keep_glyph_names(font)


def draw_ligature(font, name, parts, widths, advance, offsets=None):
    """A ligature glyph from component outlines, only moved: each starts where the
    components' own advances, spread over the ligature's advance, put it, or at `offsets`."""
    shifts = offsets
    if shifts is None:
        total, x, shifts = sum(widths) or 1, 0, []
        for w in widths:
            shifts.append((round(x * advance / total), 0))
            x += w
    if "glyf" in font:
        glyf = font["glyf"]
        pen = TTGlyphPen(None)
        for part, (dx, dy) in zip(parts, shifts):
            glyf[part].draw(TransformPen(pen, (1, 0, 0, 1, dx, dy)), glyf)
        glyf[name] = pen.glyph()
        glyf[name].recalcBounds(glyf)
        return
    cff = font["CFF "].cff
    top = cff[cff.fontNames[0]]
    cs = top.CharStrings
    pen = T2CharStringPen(width=None, glyphSet=None)
    for part, (dx, dy) in zip(parts, shifts):
        cs[part].draw(TransformPen(pen, (1, 0, 0, 1, dx, dy)))
    first = cs[parts[0]]
    charstring = pen.getCharString(private=first.private, globalSubrs=first.globalSubrs)
    if cs.charStringsAreIndexed:
        cs.charStrings[name] = len(cs.charStringsIndex)
        cs.charStringsIndex.append(charstring)
    else:
        cs.charStrings[name] = charstring
    top.charset.append(name)


def glyph_bounds(font, name):
    """Bounds from the outline itself; a TrueType glyph set would apply the stored side bearing."""
    if "glyf" in font:
        g = font["glyf"][name]
        g.recalcBounds(font["glyf"])
        return (g.xMin, g.yMin, g.xMax, g.yMax) if g.numberOfContours else None
    gs = font.getGlyphSet()
    bp = BoundsPen(gs)
    gs[name].draw(bp)
    return bp.bounds


def name_font(font, family, style, notice):
    ribbi = style in ("Regular", "Bold", "Italic", "Bold Italic")
    italic = "Italic" in style
    weight_word = style.replace("Italic", "").strip()
    ps = f"{family.replace(' ', '')}-{style.replace(' ', '')}"
    values = {1: family if ribbi else f"{family} {weight_word}", 2: style if ribbi else ("Italic" if italic else "Regular"),
              3: f"{ps};SuiteLeaf", 4: f"{family} {style}" if style != "Regular" else family, 5: "Version 1.000", 6: ps}
    if not ribbi:
        values.update({16: family, 17: style})
    n = font["name"]
    n.names = [r for r in n.names if r.nameID in (13, 14)]
    for nid, value in values.items():
        n.setName(value, nid, 3, 1, 0x409)
        n.setName(value, nid, 1, 0, 0)
    n.setName(notice, 0, 3, 1, 0x409)


def set_glyph_classes(font, ocd, ocmap, new_cmap, added, keep_layout=False):
    """HarfBuzz zeroes mark advances by glyph class, so classes follow the Office face's, as HarfBuzz
    uses them (ocd). Without them, HarfBuzz zeroes no mark in a font with positioning, so ours (which
    has kerning) has none either, unless we keep the source's own shaping, which needs its classes."""
    if not ocd:
        if not keep_layout and "GDEF" in font:
            font["GDEF"].table.GlyphClassDef = None
        return
    if "GDEF" not in font or not font["GDEF"].table.GlyphClassDef:
        gdef = newTable("GDEF")
        gdef.table = otTables.GDEF()
        gdef.table.Version = 0x00010000
        gdef.table.GlyphClassDef = otTables.GlyphClassDef()
        common = Counter(ocd.values()).most_common(1)[0][0]
        gdef.table.GlyphClassDef.classDefs = {n: common for n in font.getGlyphOrder()}
        gdef.table.AttachList = gdef.table.LigCaretList = gdef.table.MarkAttachClassDef = None
        font["GDEF"] = gdef
    cd = font["GDEF"].table.GlyphClassDef.classDefs
    for name in added:
        cd[name] = cd.get(name.rsplit(".sl", 1)[0], 0)
    for c, name in new_cmap.items():
        cls = ocd.get(ocmap[c], 0)
        if cls:
            cd[name] = cls
        else:
            cd.pop(name, None)


def set_line_metrics(font, office, style, k):
    for tag, attrs in (("hhea", ("ascent", "descent", "lineGap")),
                       ("OS/2", ("usWinAscent", "usWinDescent", "sTypoAscender", "sTypoDescender", "sTypoLineGap"))):
        for a in attrs:
            setattr(font[tag], a, getattr(office[tag], a) * k)
    font["OS/2"].usWeightClass = office["OS/2"].usWeightClass
    keep = 0b1100001 | 0x80  # italic, bold, regular, USE_TYPO_METRICS
    font["OS/2"].fsSelection = (font["OS/2"].fsSelection & ~keep) | (office["OS/2"].fsSelection & keep)
    font["head"].macStyle = office["head"].macStyle
    if style in ("Bold", "Bold Italic") and font["OS/2"].usWeightClass < 700:
        # A single-face Office family named "Bold" is filed as regular; SuiteLeaf names it Bold.
        font["OS/2"].usWeightClass = 700
        font["OS/2"].fsSelection = (font["OS/2"].fsSelection & ~0x40) | 0x20
        font["head"].macStyle |= 1
