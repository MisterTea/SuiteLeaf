"""Build the SuiteLeaf fonts: open outlines laid out exactly like Microsoft Office fonts.

Each SuiteLeaf face starts from an open font. Its outlines are only scaled and
moved sideways inside their advance. Advance widths, pair spacing (kerning and
ligature spacing), glyph classes, and line metrics are taken from the Office face,
so HarfBuzz lays out text in both identically. Characters the open font lacks come
from license-compatible donor fonts, scaled and centered the same way; scripts
with contextual forms (Arabic, Hebrew) are merged whole from a donor and their
widths are learned by shaping text in both fonts.

The Office fonts are read from a local Microsoft Office installation and are never
copied; only their layout numbers are used. Every face must pass
suiteleaf_verify.check before anything is written to --out.

    pip install -r scripts/fonts/requirements.txt
    python scripts/fonts/suiteleaf_build.py [--office DIR] [--out apps/web/src/fonts] [FAMILY ...]
"""
import argparse
import copy
import io
import json
import math
import os
import subprocess
import sys
import tempfile
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.scaleUpem import scale_upem
from fontTools.ttLib.tables import otTables, ttProgram
from fontTools.ttLib.tables.otBase import OTLOffsetOverflowError
from fontTools.varLib import instancer

import suiteleaf_fill as fill
import suiteleaf_marks as marking
import suiteleaf_merge as merging
import suiteleaf_port as porting
import suiteleaf_sources
import suiteleaf_verify
from suiteleaf_families import (APPROXIMATE_SCRIPTS, FACES, NOTO_SYMBOLS, SYMBOL_FACES, donors_for, gf_donor, merges_for,
                                 zapf_dingbats)
from suiteleaf_shaping import (Shaper, char_script, clusters, glyph_classes, joined_modifiers, ligature_contexts,
                               ligature_lookups, same_run, text_chars, total, worker_count)

REPO = Path(__file__).resolve().parents[2]
DEFAULT_OFFICE = "/Applications/Microsoft Word.app/Contents/Resources/DFonts"
SRC = suiteleaf_sources.DEFAULT_CACHE
# Scripts Office fonts do not kern by default; pairs of thousands of ideographs are skipped.
UNKERNED = {"Hani", "Hira", "Kana", "Hang", "Bopo"}
COMMON = {"Zyyy", "Zinh", "Zzzz", None}
# Scripts whose letters take combining marks in text; marks are measured on their letters.
MARKED_SCRIPTS = {"Latn", "Grek", "Cyrl"} | COMMON
# Worker processes for shaping-heavy steps; the build sets it, and every helper works without it.
POOL = None
# Our ligature glyph: the index of the Office lookup that forms its ligature.
LIGATURE_ORDER = {}
# Our ligature glyph: the text it stands for.
LIGATURE_TEXT = {}
# (glyph before, ligature glyph, its letters' glyphs): a presentation-form ligature split after that glyph.
LIGATURE_SPLITS = []
# Our ligature glyph: (its components' glyphs, {mark: [(x, y) on each component]}), where the Office face
# forms it across a mark between its letters.
LIGATURE_ACROSS = {}
_SHAPERS = {}
# Donor families each SuiteLeaf family has used so far, so its other faces try them first.
DONORS_USED = {}


def _shaper(key, source, units=None, features=None):
    if key not in _SHAPERS:
        if len(_SHAPERS) > 3:
            _SHAPERS.clear()
        _SHAPERS[key] = Shaper(source, units, features=features)
    return _SHAPERS[key]


def _chunks(items, n=None):
    n = n or worker_count()
    size = max(1, -(-len(items) // n))
    return [items[i:i + size] for i in range(0, len(items), size)]


def _map(fn, jobs):
    return list(POOL.map(fn, jobs)) if POOL else [fn(j) for j in jobs]


def _pairs_job(args):
    office_path, units, pool, firsts, adv, kern = args
    sh = _shaper(("office", office_path, units, kern), office_path, units, None if kern else {"kern": False})
    out = {}
    for a in firsts:
        for b in pool:
            pos = sh.shape(chr(a) + chr(b)).glyph_positions
            d = sum(p.x_advance for p in pos) - adv[a] - adv[b]
            # What of it the second glyph takes (a narrower alternate), moving where its cluster starts.
            second = (pos[1].x_offset, pos[1].x_advance - adv[b]) if len(pos) == 2 else (0, 0)
            if d or second != (0, 0):
                out[(a, b)] = (d, second)
    return out


def _fixes_job(args):
    office_path, units, key, data, texts, kern = args
    features = None if kern else {"kern": False}
    osh = _shaper(("office", office_path, units, kern), office_path, units, features)
    ssh = _shaper(("font", key, kern), data, None, features)
    return [boundary_fixes(osh, ssh, t) for t in texts]


def mark_glyphs(font):
    """Our mark glyphs: those classed as marks, and the glyphs of combining characters and their copies
    (a face placing marks by HarfBuzz's fallback keeps the Office classes, which may call marks bases)."""
    gdef = font["GDEF"].table.GlyphClassDef if "GDEF" in font else None
    marks = {name for name, kind in gdef.classDefs.items() if kind == 3} if gdef else set()
    combining = {g for c, g in font.getBestCmap().items() if unicodedata.category(chr(c)) in ("Mn", "Me")}
    return marks | combining | {name for name in font.getGlyphOrder() if ".sl" in name and name.split(".sl")[0] in combining}


def _accent_job(args):
    """Texts whose marks sit elsewhere than in the Office face: {(glyphs before, mark glyph): {(dx, dy): n}}.
    Each text reports its first misplaced mark; where ours draws a letter with more glyphs (the Office
    face draws Ố's two marks as one glyph), only the marks typed after it. Texts laid out differently are
    left to the other corrections."""
    office_path, units, key, data, texts = args
    osh = _shaper(("office", office_path, units), office_path, units)
    ssh = _shaper(("font", key), data)
    marks = mark_glyphs(TTFont(io.BytesIO(data)))
    out = defaultdict(Counter)

    def placed(buf):
        x, at = 0, []
        for p in buf.glyph_positions:
            at.append((x + p.x_offset, p.y_offset))
            x += p.x_advance
        return at, x

    for text in texts:
        ob, sb = osh.shape(text), ssh.shape(text)
        (oat, ox), (sat, sx) = placed(ob), placed(sb)
        if ox != sx:
            continue
        # The glyphs the lookups saw: a hidden character's own, not the space shown for it.
        names = [ssh.font.glyph_to_string(g.codepoint) for g in ssh.shape(text, preserve=True).glyph_infos]
        if len(names) != len(sat):
            continue
        if len(oat) == len(sat):
            compared = [(i, i) for i in range(len(oat))]
        elif len(oat) > len(sat):
            continue
        else:
            k = len(text) - len(text.rstrip("".join(ch for ch in text if unicodedata.category(ch) in ("Mn", "Me"))))
            if not k or min(len(oat), len(sat)) <= k:
                continue
            compared = [(len(oat) - k + j, len(sat) - k + j) for j in range(k)]
        for o, s in compared:
            if oat[o] != sat[s]:
                # Only marks move; a letter placed elsewhere is the kerning's to fix.
                if names[s] in marks:
                    # Everything from the base: the marks between may sit differently on each base.
                    context = tuple(names[:s + 1])
                    out[context][(oat[o][0] - sat[s][0], oat[o][1] - sat[s][1])] += 1
                break
    return out


def hidden_fea(office_path, units, data, chars):
    """The glyph after a soft hyphen. HarfBuzz hides it once the text is positioned, and an Office face's
    `kern` table had moved the next glyph by half the pair's kerning (its other half is on the hidden
    glyph), and a mark after it kept no advance; our kerning is all on the first glyph, so the next glyph
    moves by itself here."""
    unkerned = {"kern": False}
    shapers = {kern: (Shaper(office_path, units, features=None if kern else unkerned), Shaper(data, features=None if kern else unkerned))
               for kern in (True, False)}
    moves = {"dist": defaultdict(set), "kern": defaultdict(set)}
    hyphen = None
    for c in chars:
        text = "\u00ad" + chr(c)
        found = {}
        for kern, (osh, ssh) in shapers.items():
            ob, sb = osh.shape(text), ssh.shape(text)
            if len(ob.glyph_positions) != 2 or len(sb.glyph_positions) != 2:
                break
            o, s = ob.glyph_positions[1], sb.glyph_positions[1]
            found[kern] = (o.x_offset - s.x_offset, o.y_offset - s.y_offset, o.x_advance - s.x_advance)
            if unicodedata.category(chr(c)) in ("Mn", "Me"):
                # Where a mark sits is the accent fixes' to say; only its advance is ours.
                found[kern] = (0, 0, found[kern][2])
        if len(found) < 2:
            continue
        # What moves unkerned moves in `dist`, which browsers keep with kerning off; kerning adds the rest.
        kept = found[False]
        names = [shapers[True][1].font.glyph_to_string(g.codepoint) for g in shapers[True][1].shape(text, preserve=True).glyph_infos]
        hyphen = names[0]
        for feature, move in (("dist", kept), ("kern", tuple(a - b for a, b in zip(found[True], kept)))):
            if move != (0, 0, 0):
                moves[feature][move].add(names[1])
    if not any(moves.values()):
        return None
    lines = list(FEA_HEADER)
    for feature, by_move in moves.items():
        if by_move:
            name = f"SLhidden{feature}"
            lines += [f"lookup {name} useExtension {{"]
            lines += [f"  pos {_g(hyphen)} [{' '.join(_g(g) for g in sorted(glyphs))}]' <{dx} {dy} {da} 0>;"
                      for (dx, dy, da), glyphs in sorted(by_move.items())]
            lines += [f"}} {name};", f"feature {feature} {{ lookup {name}; }} {feature};"]
    return "\n".join(lines)


# Scripts whose letters do not join: a different glyph after another is an alternate, not a joining form.
CASED_SCRIPTS = {"Latn", "Grek", "Cyrl", "Armn", "Geor"}
# Pairs of letters probed with a mark between, for each of kerned and unkerned text.
KERNED_PROBES = 500
# Accent rules feaLib packs into one subtable at a time, and the most rules of base classes, which take a
# subtable each, that a lookup's 16-bit subtable offsets hold.
ACCENT_RULES = 1000
GROUPED_ACCENT_RULES = 6000


def accent_fea(accents, order, marks):
    """Feature code moving marks by the fixes found ({(glyphs before, mark): (dx, dy)}). Each rule names
    every glyph before the mark from the base on, longest first, all in one lookup so that a mark matches
    one rule at most. A context whose fix came to nothing keeps a rule moving nothing where a shorter one
    would match it, and a context starting with a mark (U+FE20 then U+0361, typed alone) holds only where
    nothing comes before it."""
    moved = {context for context, delta in accents.items() if delta != (0, 0)}
    kept = {context: delta for context, delta in accents.items()
            if delta != (0, 0) or any(context[-n:] in moved for n in range(2, len(context)))}
    if not kept:
        return None
    # The bases with the same fix after the same marks share a rule, unless that leaves more rules than
    # subtables fit: then every rule names single glyphs, which feaLib packs many to a subtable.
    groups = defaultdict(set)
    for context, delta in kept.items():
        groups[(context[1:], delta)].add(context[0])
    grouped = len(groups) <= GROUPED_ACCENT_RULES
    entries = list(groups.items()) if grouped else [((context[1:], delta), {context[0]}) for context, delta in kept.items()]
    # Rules share named lookups, one for each distance across and one for each up (feaLib would give every
    # inline value a lookup of its own); a fix that came to nothing takes one moving nothing.
    moves, moved_marks = {}, defaultdict(set)

    def move(axis, distance):
        name = moves.setdefault((axis, distance), f"SLmove{axis}{len(moves)}")
        # A context of one glyph is a mark alone at the start of a text: that mark moves.
        moved_marks[name].update({rest[-1]} if rest else firsts)
        return f"lookup {name}"

    target = lambda entry: entry[0][0][-1] if entry[0][0] else min(entry[1])
    rules, starts = [], []
    for (rest, (dx, dy)), firsts in sorted(entries, key=lambda kv: (target(kv), -len(kv[0][0]), kv[0], sorted(kv[1]))):
        lookups = " ".join(move(axis, d) for axis, d in (("x", dx), ("y", dy)) if d) or move("x", 0)
        first = f"[{' '.join(_g(g) for g in sorted(firsts))}]" if grouped else _g(next(iter(firsts)))
        parts = [first] + [_g(g) for g in rest[:-1]] + [_g(rest[-1]) + "'"] if rest else [first + "'"]
        for at_start in (True, False):
            # Seen at the start of a text only: after a letter, those marks are another context.
            starting = sorted(g for g in firsts if (g in marks) == at_start)
            if not starting:
                continue
            if grouped:
                parts[0] = f"[{' '.join(_g(g) for g in starting)}]" + ("'" if not rest else "")
            if at_start:
                starts += [f"  ignore pos @SLany {' '.join(parts)};", f"  pos {' '.join(parts)} {lookups};"]
            else:
                rules.append(f"  pos {' '.join(parts)} {lookups};")
    lines = list(FEA_HEADER) + [f"@SLany = [{' '.join(_g(g) for g in order)}];"]
    for (axis, distance), name in moves.items():
        value = f"<{distance} 0 0 0>" if axis == "x" else f"<0 {distance} 0 0>"
        lines.append(f"lookup {name} useExtension {{ pos [{' '.join(_g(g) for g in sorted(moved_marks[name]))}] {value}; }} {name};")
    # Rules of single glyphs pack into glyph-keyed subtables; the start rules name a class and stand apart.
    # feaLib weighs a subtable per rule too, so each group stays small enough to count.
    chunks = [rules[i:i + ACCENT_RULES] for i in range(0, len(rules), ACCENT_RULES)] + ([starts] if starts else [])
    body = [line for n, chunk in enumerate(chunks) for line in (["  subtable;"] if n else []) + chunk]
    lines += ["lookup SLaccents useExtension {"] + body + ["} SLaccents;", "feature mark { lookup SLaccents; } mark;"]
    return "\n".join(lines)


def _learn_job(args):
    office_path, units, key, data, texts, names = args
    osh = _shaper(("office", office_path, units), office_path, units)
    ssh = _shaper(("font", key), data)
    seen = defaultdict(Counter)
    for text in texts:
        ob, sb = osh.shape(text), ssh.shape(text)
        if [i.cluster for i in ob.glyph_infos] != [i.cluster for i in sb.glyph_infos]:
            continue
        for info, op in zip(sb.glyph_infos, ob.glyph_positions):
            name = ssh.font.glyph_to_string(info.codepoint)
            if name in names:
                seen[name][op.x_advance] += 1
    return seen


def log(message):
    print(message, file=sys.stderr, flush=True)


def src(path):
    return str(Path(SRC) / path)


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


# Features that form ligatures; carried over, they replace our own ligature rules.
LIGATURE_FEATURES = ("ccmp", "rlig", "liga", "clig")


def port_office_layout(font, office_path, units, cmap, features):
    """The Office face's lookups for `features` carried over onto our glyphs (suiteleaf_port): substitution
    is grafted here; positioning is returned for each assembly, which rebuilds it."""
    added = []

    def add_copy(base, name, advance):
        reference_copy(font, base, name, advance)
        added.append(name)

    def add_ligature(parts, name, advance):
        draw_ligature(font, name, parts, [font["hmtx"][p][0] for p in parts], advance)
        bounds = glyph_bounds(font, name)
        font["hmtx"][name] = (advance, int(round(bounds[0])) if bounds else 0)
        added.append(name)

    # Each ligature as the Office face forms it before contextual alternates change it ("rt" before its
    # final form), and as it ends up (a run only the alternates join, like "oft").
    ligatures = {}
    before = Shaper(office_path, units, features={f: False for f in features if f not in LIGATURE_FEATURES})
    after = Shaper(office_path, units)
    for ours, text in LIGATURE_TEXT.items():
        for shaper in (before, after):
            buf = shaper.shape(text)
            if len(buf.glyph_infos) == 1:
                ligatures.setdefault(shaper.font.glyph_to_string(buf.glyph_infos[0].codepoint), ours)
                # As wide as the Office glyph it now stands for, which the alternates may swap.
                font["hmtx"][ours] = (buf.glyph_positions[0].x_advance, font["hmtx"][ours][1])
                break
    # A character the Office face draws with a ligature's glyph (ﬁ) is drawn with ours, so the carried
    # lookups that change that glyph change it too.
    office_cmap = TTFont(office_path).getBestCmap() or {}
    moved = {c: ligatures[g] for c, g in office_cmap.items() if g in ligatures and c in cmap and cmap[c] != ligatures[g]}
    if moved:
        cmap.update(moved)
        set_cmap(font, cmap)
    _, tables = porting.port_layout(font, office_path, units, cmap, ligatures, features, add_copy, add_ligature)
    append_glyphs(font, added)
    for table in tables.values():
        porting.sort_coverages(table.table, font.getGlyphID)
    if "GDEF" in font and font["GDEF"].table.GlyphClassDef:
        classes = font["GDEF"].table.GlyphClassDef.classDefs
        for name in added:
            classes[name] = classes.get(name.split(".slo")[0], 2 if name.startswith("sl.ligo") else 1)
    if "GSUB" in tables:
        merging.graft_by_script(font, tables["GSUB"])
    return tables


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


def add_ligatures(font, office, office_path, units, cmap, latin_only=False):
    """Office ligatures become ligatures here too, drawn from our own letters, so the
    clusters and the kerning against them can match. Returns {name: (glyphs, class)}.
    latin_only leaves other scripts to a source whose own shaping is kept."""
    osh = Shaper(office_path, units)
    buf = io.BytesIO()
    font.save(buf)
    ours = Shaper(buf.getvalue())
    ocd = glyph_classes(office, office_path)
    hmtx = font["hmtx"].metrics
    ligatures, texts = {}, []
    marks = [c for c in sorted(cmap) if unicodedata.category(chr(c)) == "Mn" and c in (office.getBestCmap() or {})]
    order = ligature_lookups(office)
    LIGATURE_ORDER.clear()
    LIGATURE_TEXT.clear()
    LIGATURE_SPLITS.clear()
    LIGATURE_ACROSS.clear()
    # Runs of two or three letters the Office face draws as one glyph by contextual alternates, not a
    # ligature lookup ("oft" at a word's end in Segoe Script); they go first, being longest.
    office_cmap = office.getBestCmap() or {}
    letters = [c for c in range(0x41, 0x7B) if chr(c).isalpha() and c in cmap and c in office_cmap]
    one = lambda text: len(osh.shape(text).glyph_infos) == 1
    runs = [chr(a) + chr(b) for a in letters for b in letters if chr(a) + chr(b) not in order and one(chr(a) + chr(b))]
    runs += [chr(a) + chr(b) + chr(c) for a in letters for b in letters for c in letters
             if chr(a) + chr(b) + chr(c) not in order and one(chr(a) + chr(b) + chr(c))]
    # A letter and a spacing accent or modifier drawn as one glyph (ɔ and an acute in Meiryo).
    modifiers = [c for c in sorted(cmap) if unicodedata.category(chr(c)) in ("Sk", "Lm") and c in office_cmap]
    latin_letters = [c for c in sorted(cmap) if unicodedata.category(chr(c)).startswith("L") and c in office_cmap
                     and char_script(c) == "Latn"]
    runs += [chr(a) + chr(b) for a in latin_letters for b in modifiers
             if chr(a) + chr(b) not in order and chr(a) + chr(b) not in runs and one(chr(a) + chr(b))]
    for text in sorted(order) + joined_modifiers(osh, sorted(cmap)) + runs:
        if any(ord(ch) not in cmap for ch in text):
            continue
        if latin_only and any(char_script(ord(ch)) not in {"Latn"} | COMMON for ch in text):
            continue
        obuf, sbuf = osh.shape(text), ours.shape(text)
        if len(obuf.glyph_infos) != 1 or len(sbuf.glyph_infos) != len(text):
            continue
        # The glyphs our substitutions (contextual forms) leave for each character, in reading order;
        # invisible characters are hidden after shaping, so they keep their own glyph.
        rtl = sbuf.glyph_infos[0].cluster > sbuf.glyph_infos[-1].cluster
        shaped = [ours.font.glyph_to_string(i.codepoint) for i in sbuf.glyph_infos]
        shaped = shaped[::-1] if rtl else shaped
        parts = [cmap[ord(ch)] if unicodedata.category(ch) == "Cf" else shaped[n] for n, ch in enumerate(text)]
        visual = parts[::-1] if rtl else parts
        name = f"sl.lig{len(ligatures)}"
        advance = obuf.glyph_positions[0].x_advance
        draw_ligature(font, name, visual, [hmtx[p][0] for p in visual], advance)
        b = glyph_bounds(font, name)
        hmtx[name] = (advance, int(round(b[0])) if b else 0)
        lig_glyph = obuf.glyph_infos[0].codepoint
        ligatures[name] = (parts, ocd.get(osh.font.glyph_to_string(lig_glyph), 2), (text, lig_glyph))
        LIGATURE_ORDER[name] = order.get(text, -2 if text in runs else len(order) + 1000)
        LIGATURE_TEXT[name] = text
        texts.append(text)
    # A letter and a mark the Office face draws as one glyph, a composite of the two, where ours draws two
    # (h and an acute in Nyala, or ẖ, which ours decomposes): ours draws its own two the same way, before
    # ligatures, as the Office face composes them before it forms any.
    office_order = office.getGlyphOrder()
    scale = units / office["head"].unitsPerEm
    for b in sorted(cmap):
        if not unicodedata.category(chr(b)).startswith("L") or b not in office_cmap or "glyf" not in office:
            continue
        if latin_only and char_script(b) not in {"Latn"} | COMMON:
            continue
        for m in marks:
            text = chr(b) + chr(m)
            obuf, sbuf = osh.shape(text), ours.shape(text)
            if len(obuf.glyph_infos) != 1 or len(sbuf.glyph_infos) != 2:
                continue
            glyph = office["glyf"][office_order[obuf.glyph_infos[0].codepoint]]
            parts = glyph.components if glyph.isComposite() else []
            if len(parts) != 2 or parts[0].glyphName != office_cmap[b] or (parts[0].x, parts[0].y) != (0, 0):
                continue
            shaped = [ours.font.glyph_to_string(i.codepoint) for i in sbuf.glyph_infos]
            name = f"sl.lig{len(ligatures)}"
            advance = obuf.glyph_positions[0].x_advance
            draw_ligature(font, name, shaped, None, advance, [(0, 0), (round(parts[1].x * scale), round(parts[1].y * scale))])
            hmtx[name] = (advance, hmtx[shaped[0]][1])
            lig_glyph = obuf.glyph_infos[0].codepoint
            ligatures[name] = (shaped, ocd.get(osh.font.glyph_to_string(lig_glyph), 1), (text, lig_glyph))
            LIGATURE_ORDER[name] = -1
            LIGATURE_TEXT[name] = text
            texts.append(text)
    append_glyphs(font, list(ligatures))
    # A character the Office face draws with a ligature's glyph (ﬂ) is drawn with ours, so the ligature
    # kerns and joins the same either way it is typed.
    by_glyph = {lig_glyph: name for name, (_, _, (_, lig_glyph)) in ligatures.items()}
    moved = {c: by_glyph[office.getGlyphID(g)] for c, g in office_cmap.items()
             if office.getGlyphID(g) in by_glyph and c in cmap and cmap[c] != by_glyph[office.getGlyphID(g)]}
    if moved:
        cmap.update(moved)
        set_cmap(font, cmap)
    # After some letters the Office face spells such a character out (f and ﬂ draw as ff and l, as "ffl"
    # does): ours splits it there, before its ligatures form.
    for c, lig in sorted(moved.items()):
        spelled = unicodedata.normalize("NFKD", chr(c))
        if not all(ord(ch) in cmap for ch in spelled):
            continue
        glyphs = lambda text: [i.codepoint for i in osh.shape(text).glyph_infos]
        for p in letters:
            together = glyphs(chr(p) + chr(c))
            if together == glyphs(chr(p) + spelled) and together != glyphs(chr(p)) + glyphs(chr(c)):
                # A mark between may not stop it (f, an acute and ﬂ draw as ff with the acute, and l).
                between = glyphs(chr(p) + "\u0301" + chr(c))
                across = (0x301 in cmap and between == glyphs(chr(p) + "\u0301" + spelled)
                          and between != glyphs(chr(p) + "\u0301") + glyphs(chr(c)))
                LIGATURE_SPLITS.append((cmap[p], lig, [cmap[ord(ch)] for ch in spelled], across))
    # Combining marks and letters after which the Office face does not form a ligature, and what it forms
    # instead: a shorter ligature of ours, or none.
    by_office_glyph = {glyph: name for name, (_, _, (_, glyph)) in ligatures.items()}
    # Two letters the Office face joins across a mark between them (f, an acute and f draw as ff, the acute
    # over the first f): ours joins them too, each mark on the component it follows.
    for name, (parts, _, (text, lig_glyph)) in ligatures.items():
        if len(text) != 2 or len(parts) != 2 or not all(unicodedata.category(ch) in ("Lu", "Ll", "Lt", "Lo") for ch in text):
            continue
        if any(other[0] == parts for other in LIGATURE_ACROSS.values()):
            continue
        anchors = {}
        for m in marks:
            if marking.invisible(m):
                continue
            alone = [i.codepoint for i in osh.shape(chr(m)).glyph_infos]
            found = []
            # After the ligature, the mark may compose with its last letter instead (fl and an acute are f and ĺ).
            for t in (text[0] + chr(m) + text[1], text + chr(m)):
                buf = osh.shape(t)
                if len(alone) != 1 or [i.codepoint for i in buf.glyph_infos] != [lig_glyph] + alone:
                    found.append(None)
                    continue
                p = buf.glyph_positions
                found.append((p[0].x_advance + p[1].x_offset, p[1].y_offset))
            if found[0] is not None:
                anchors[m] = found
        if anchors:
            LIGATURE_ACROSS[name] = (parts, anchors)
    for name, (parts, cls, (text, lig_glyph)) in list(ligatures.items()):
        breaks = []
        for m in marks + letters:
            infos = osh.shape(text + chr(m)).glyph_infos
            if all(i.cluster == 0 for i in infos) or (len(infos) > 1 and infos[1].cluster >= len(text)):
                continue  # still one ligature (perhaps a variant glyph, like one with a dotless j)
            first = infos[0].codepoint
            instead = by_office_glyph.get(first)
            if instead and ligatures[instead][0] != parts and parts[:len(ligatures[instead][0])] == ligatures[instead][0]:
                breaks.append((m, instead))
            else:
                breaks.append((m, None))
        ligatures[name] = (parts, cls, breaks)
    # Precomposed letters the Office face splits into base and marks before another mark, so that its
    # ligatures still form (ḧ + acute becomes h + diaeresis + acute, and ﬀ + h ligates).
    components = {ch for text in texts for ch in text}
    decompose = []
    for c in sorted(cmap):
        d = unicodedata.decomposition(chr(c))
        if not d or d.startswith("<"):
            continue
        parts_cp = [int(x, 16) for x in d.split()]
        if chr(parts_cp[0]) not in components or not all(x in cmap for x in parts_cp):
            continue
        split = [m for m in marks if len(osh.shape(chr(c) + chr(m)).glyph_infos) > 2]
        if split:
            decompose.append((cmap[c], [cmap[x] for x in parts_cp], [cmap[m] for m in split]))
    return ligatures, decompose


# OpenType script tags HarfBuzz may use for a script (Indic scripts have two shapers).
OT_TAGS = {"Deva": ["deva", "dev2"], "Beng": ["beng", "bng2"], "Guru": ["guru", "gur2"], "Gujr": ["gujr", "gjr2"],
           "Orya": ["orya", "ory2"], "Taml": ["taml", "tml2"], "Telu": ["telu", "tel2"], "Knda": ["knda", "knd2"],
           "Mlym": ["mlym", "mlm2"], "Mymr": ["mymr", "mym2"], "Hira": ["kana"], "Kana": ["kana"]}


def add_script_variants(font, office_path, units, cmap, skip):
    """Common characters (spaces, punctuation) the Office face draws differently inside one script's
    text get their own copy at that width, chosen for that script only. Returns {script: [(glyph, copy)]}."""
    osh = Shaper(office_path, units)
    chars = text_chars(cmap)
    common = [c for c in chars if char_script(c) in COMMON]
    letters = defaultdict(list)
    for c in chars:
        script = char_script(c)
        if script not in COMMON and script != "Latn" and c not in skip and unicodedata.category(chr(c)).startswith("L"):
            letters[script].append(c)

    def last_glyph(text):
        buf = osh.shape(text)
        for info in buf.glyph_infos:
            if info.cluster == len(text) - 1:
                return info.codepoint, osh.font.get_glyph_h_advance(info.codepoint)
        return None, None

    hmtx, rules, names = font["hmtx"].metrics, defaultdict(list), []
    for script, members in letters.items():
        if len(members) < 10:
            continue
        sample = members[:: max(1, len(members) // 5)][:5]
        for c in common:
            alone = last_glyph(chr(c))[0]
            seen = {last_glyph(chr(x) + chr(c)) for x in sample}
            if len(seen) != 1:
                continue
            gid, advance = seen.pop()
            if gid is None or gid == alone or c not in cmap:
                continue
            base, copy_name = cmap[c], f"{cmap[c]}.sl{script.lower()}"
            outline_copy_shift(font, base, round((advance - hmtx[base][0]) / 2), copy_name)
            b = glyph_bounds(font, copy_name)
            hmtx[copy_name] = (advance, int(round(b[0])) if b else 0)
            names.append(copy_name)
            rules[script].append((base, copy_name))
    append_glyphs(font, names)
    return dict(rules)


def graft_script_variants(font, rules):
    for script, pairs in rules.items():
        tags = OT_TAGS.get(script, [script.lower()])
        fea = "\n".join([f"languagesystem {t} dflt;" for t in ["DFLT"] + tags] + [f"lookup SLscript{script} {{"]
                        + [f"  sub {_g(a)} by {_g(b)};" for a, b in pairs]
                        + [f"}} SLscript{script};", f"feature rclt {{ lookup SLscript{script}; }} rclt;"])
        merging.graft_for_scripts(font, merging.compile_layout(font.getGlyphOrder(), fea, "GSUB"), tags)


def decompose_rules(decompose):
    """Feature code splitting precomposed letters before the marks after which the Office face splits them."""
    if not decompose:
        return []
    lines = ["lookup SLsplit {"] + [f"  sub {_g(glyph)} by {' '.join(_g(p) for p in parts)};" for glyph, parts, _ in decompose]
    lines += ["} SLsplit;", "lookup SLdecompose {"]
    for n, (glyph, _, marks) in enumerate(decompose):
        lines.insert(0, f"@SLsplitmarks{n} = [{' '.join(_g(m) for m in marks)}];")
        lines.append(f"  sub {_g(glyph)}' lookup SLsplit @SLsplitmarks{n};")
    return lines + ["} SLdecompose;", "feature ccmp { lookup SLdecompose; } ccmp;"]


def ligature_rules(ligatures, cmap, swapped=None):
    """Contextual lookups for our ligatures, one for each Office lookup they come from, in its order, and
    longest first within each; before a mark that stops one in Office, ours forms what Office forms
    instead (a shorter ligature, or none). A component also matches the copies that stand for its swaps
    ({glyph: [copies]}). -> (lines, lookup names)"""
    swapped = swapped or {}
    part = lambda p: f"[{' '.join(_g(g) for g in [p] + swapped[p])}]" if swapped.get(p) else _g(p)
    lines, classes, names = [], {}, []

    def mark_class(marks):
        key = tuple(marks)
        if key not in classes:
            classes[key] = f"@SLbreak{len(classes)}"
        return classes[key]

    # The shorter ligature formed instead gets a lookup of its own: one with the longer ligature in it
    # would form that one, reaching past the context.
    only = {}

    def only_lookup(instead):
        if instead not in only:
            only[instead] = f"SLligaonly{len(only)}"
        return only[instead]

    groups = defaultdict(list)
    for name in ligatures:
        groups[LIGATURE_ORDER.get(name, 0)].append(name)
    body = []
    for n, (_, members) in enumerate(sorted(groups.items())):
        lookup = f"SLliga{n}"
        names.append(lookup)
        body.append(f"lookup {lookup} {{")
        for name in sorted(members, key=lambda m: -len(ligatures[m][0])):
            parts, _, breaks = ligatures[name]
            seq = " ".join(part(p) + "'" for p in parts)
            outcomes = defaultdict(list)
            for m, instead in breaks:
                outcomes[instead].append(m)
            for instead, marks in outcomes.items():
                if instead is None:
                    body.append(f"  ignore sub {seq} {mark_class(marks)};")
                else:
                    k = len(ligatures[instead][0])
                    head = " ".join(part(p) + "'" + (f" lookup {only_lookup(instead)}" if i == 0 else "")
                                    for i, p in enumerate(parts[:k]))
                    tail = " ".join(part(p) for p in parts[k:])
                    body.append(f"  sub {head} {tail} {mark_class(marks)};")
            body.append(f"  sub {seq} by {_g(name)};")
        body.append(f"}} {lookup};")
    defs = [f"{cls} = [{' '.join(_g(cmap[m]) for m in key)}];" for key, cls in classes.items()]
    defs += [f"lookup {lookup} {{ sub {' '.join(part(p) for p in ligatures[instead][0])} by {_g(instead)}; }} {lookup};"
             for instead, lookup in only.items()]
    return defs + body, names


def across_rules(cmap, swapped, copies):
    """Our two-letter ligatures formed across one or two of the marks between the letters that the Office
    face forms them across (LIGATURE_ACROSS); a mark matches as its copies too. -> (lines, lookup names)"""
    if not LIGATURE_ACROSS:
        return [], []
    part = lambda p: f"[{' '.join(_g(g) for g in [p] + swapped[p])}]" if swapped.get(p) else _g(p)
    lines = ["lookup SLligmarksform {", "  lookupflag IgnoreMarks;"]
    lines += [f"  sub {part(a)} {part(b)} by {_g(name)};" for name, ((a, b), _) in sorted(LIGATURE_ACROSS.items())]
    lines += ["} SLligmarksform;", "lookup SLligmarks {"]
    for name, ((a, b), anchors) in sorted(LIGATURE_ACROSS.items()):
        names = {cmap[m] for m in anchors if m in cmap}
        names |= {n for n, source in copies.items() if source in names and ".slm" in n}
        between = f"[{' '.join(_g(g) for g in sorted(names))}]"
        lines += [f"  sub {part(a)}' lookup SLligmarksform {between}' {part(b)}';",
                  f"  sub {part(a)}' lookup SLligmarksform {between}' {between}' {part(b)}';"]
    return lines + ["} SLligmarks;"], ["SLligmarks"]


def ligature_mark_fea(cmap):
    """Marks on the component of a ligature they follow, where the Office face joins the ligature across them."""
    marks = sorted({m for _, anchors in LIGATURE_ACROSS.values() for m in anchors if m in cmap})
    if not marks:
        return []
    lines = [f"markClass {_g(cmap[m])} <anchor 0 0> @SLligmark{m:04X};" for m in marks]
    lines.append("lookup SLligmarkpos {")
    for name, (_, anchors) in sorted(LIGATURE_ACROSS.items()):
        on = [" ".join(f"<anchor {round(anchors[m][k][0])} {round(anchors[m][k][1])}> mark @SLligmark{m:04X}"
                       for m in marks if m in anchors and anchors[m][k]) or "<anchor NULL>" for k in range(2)]
        lines.append(f"  pos ligature {_g(name)} {on[0]} ligComponent {on[1]};")
    return lines + ["} SLligmarkpos;", "feature mark { lookup SLligmarkpos; } mark;"]


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


def office_pairs(office_path, chars, units, exclude=(), kern=True):
    """Office spacing for ordered pairs beyond the two advances: kerning and two-letter ligatures, or
    without kerning (kern false) what of it stays when text is not kerned. -> ({pair: spacing}, {pair:
    (offset, advance change) of the second glyph, where the Office face draws it otherwise after the first})

    Browsers shape each script separately, so only pairs within one script (plus
    punctuation and other common characters) can meet.
    """
    sh = Shaper(office_path, units)
    groups, rare = defaultdict(list), defaultdict(list)
    common = []
    for c in chars:
        if c in exclude:
            continue
        s = char_script(c)
        if s in COMMON:
            common.append(c)
        else:
            (rare if s in UNKERNED else groups)[s].append(c)
    # CJK scripts rarely kern; measure one only when a sample of its pairs shows kerning. A large one
    # (Han, Hangul syllables) is measured against CJK punctuation only.
    punct = [c for c in common if 0x3000 <= c <= 0x303F or 0xFF00 <= c <= 0xFFEF]
    big = []
    for s, members in rare.items():
        sample = members[:: max(1, len(members) // 40)][:40]
        others = sample + common[:: max(1, len(common) // 120)][:120]
        if not any(total(sh, chr(a) + chr(b)) != total(sh, chr(a)) + total(sh, chr(b))
                   for a in sample for b in others if b != a) and \
           not any(total(sh, chr(b) + chr(a)) != total(sh, chr(a)) + total(sh, chr(b)) for a in sample for b in others[len(sample):]):
            continue
        if len(members) <= 3000:
            groups[s] = members
        else:
            big.append(members)
    adv = {c: total(sh, chr(c)) for g in list(groups.values()) + big + [common] for c in g}
    jobs = []
    for members in list(groups.values()) or [[]]:
        pool = members + common
        for firsts in _chunks(pool):
            jobs.append((office_path, units, pool, firsts, adv, kern))
    for members in big:
        for firsts in _chunks(members):
            jobs.append((office_path, units, punct, firsts, adv, kern))
        jobs.append((office_path, units, members, punct, adv, kern))
    deltas, seconds = {}, {}
    for part in _map(_pairs_job, jobs):
        for pair, (d, second) in part.items():
            if d:
                deltas[pair] = d
            if second != (0, 0):
                seconds[pair] = second
    return deltas, seconds


def boundary_fixes(osh, ssh, text):
    """Advance corrections so our glyphs reach every Office cluster boundary, and the end, together.

    Boundaries are visited left to right on the page, which for right-to-left text
    is the reverse of character order; the fixes come back in reading order.
    """
    _, ostarts, _, oend, _, _ = clusters(osh, text)
    names, sstarts, before, send, rtl, advances = clusters(ssh, text)

    def carrier(i):
        # A zero-width glyph (a mark) cannot take a correction: HarfBuzz zeroes mark advances.
        while i > 0 and advances[i] == 0:
            i -= 1
        return i

    fixes, carried = [], 0
    shared = sorted((k for k in ostarts if k in sstarts and before[k] >= 0), key=lambda k: sstarts[k])
    for k in shared + [None]:
        target = oend if k is None else ostarts[k]
        ours = (send if k is None else sstarts[k]) + carried
        r = target - ours
        if r:
            idx = carrier(len(names) - 1 if k is None else before[k])
            fixes.append((tuple(names), idx, r))
            carried += r
    # Lookups match glyphs in reading order.
    if rtl:
        fixes = [(seq[::-1], len(seq) - 1 - idx, r) for seq, idx, r in fixes]
    return fixes


class Rules(dict):
    """Context rules keyed by (glyph sequence, marked index), also indexed by the marked glyph."""

    def __init__(self):
        super().__init__()
        self.by_glyph = defaultdict(set)

    def __setitem__(self, key, value):
        super().__setitem__(key, value)
        ctx, mark = key
        self.by_glyph[ctx[mark]].add(key)


def matching_rule_value(rules, seq, idx):
    """The value the longest existing rule already gives this glyph in this context."""
    best, best_len = 0, -1
    for ctx, mark in rules.by_glyph.get(seq[idx], ()):
        value = rules[(ctx, mark)]
        if len(ctx) <= best_len:
            continue
        start = idx - mark
        if start >= 0 and start + len(ctx) <= len(seq) and tuple(seq[start:start + len(ctx)]) == ctx:
            best, best_len = value, len(ctx)
    return best


CONTEXT_LOOKUP_RULES = 7000
# The most a glyph is stretched or squeezed toward its Office advance.
MAX_STRETCH = 1.25
FEA_HEADER = ["languagesystem DFLT dflt;", "languagesystem latn dflt;", "languagesystem thai dflt;"]


def _g(name):
    return "\\" + name


def pairs_fea(cmap, pairs, skip_marks=None, joined=(), unkerned=None):
    """Office pair spacing as kerning between the characters' glyphs (`pairs` and `unkerned` as
    office_pairs gives them). Pairs of the scripts the Office face kerns across marks ({script: bool};
    Latin's answer for the rest) go in a lookup that skips marks, except pairs it joins into a ligature,
    which a mark between breaks. The spacing a pair keeps unkerned (a ligature's width, a mark the Office
    face draws wide) is in `dist`, which browsers keep with kerning off; only the rest is kerning. Where the
    Office face draws the second glyph otherwise (a narrower alternate), that glyph moves and takes its
    part, so its cluster starts where the Office face's does; marks keep theirs on the glyph before."""
    skip_marks = skip_marks or {}
    (deltas, seconds), (kept_deltas, kept_seconds) = pairs, unkerned or ({}, {})
    rules = defaultdict(list)
    for (a, b) in sorted(deltas.keys() | kept_deltas.keys() | seconds.keys() | kept_seconds.keys()):
        composed = unicodedata.normalize("NFC", chr(a) + chr(b))
        if len(composed) == 1 and ord(composed) in cmap:
            continue  # the Office face's one precomposed glyph is ours too, not spacing
        if a in cmap and b in cmap:
            mark = unicodedata.category(chr(b)) in ("Mn", "Me")
            script = char_script(a) if char_script(a) not in COMMON else char_script(b)
            # Spacing before a mark is for that mark alone, never one past another (a joiner between).
            skip = skip_marks.get(script, skip_marks.get("Latn", False)) and (a, b) not in joined and not mark
            # A second glyph drawn otherwise is an alternate (Gabriola's Latin and Cyrillic); joining scripts'
            # forms are their own shaping's.
            cased = all(char_script(c) in CASED_SCRIPTS | COMMON for c in (a, b))
            on, off = ((0, 0) if mark or not cased else s.get((a, b), (0, 0)) for s in (seconds, kept_seconds))
            first_on, first_off = deltas.get((a, b), 0) - on[1], kept_deltas.get((a, b), 0) - off[1]
            for feature, first, (x, advance) in (("dist", first_off, off),
                                                 ("kern", first_on - first_off, (on[0] - off[0], on[1] - off[1]))):
                if first:
                    rules[(feature, skip, False)].append(f"  pos {_g(cmap[a])} {_g(cmap[b])} {first};")
                if x or advance:
                    rules[(feature, skip, True)].append(f"  pos {_g(cmap[a])} {_g(cmap[b])}' <{x} 0 {advance} 0>;")
    lines, features = list(FEA_HEADER), defaultdict(list)
    for feature, prefix in (("dist", "SLspacing"), ("kern", "SLpairs")):
        for skip in (False, True):
            for second in (False, True):
                if not rules[(feature, skip, second)]:
                    continue
                name = prefix + ("second" if second else "") + ("across" if skip else "")
                lines += [f"lookup {name} useExtension {{"] + (["  lookupflag IgnoreMarks;"] if skip else [])
                for n, rule in enumerate(rules[(feature, skip, second)]):
                    if n and n % 1500 == 0:
                        lines.append("  subtable;")
                    lines.append(rule)
                lines.append(f"}} {name};")
                features[feature].append(name)
    if not features:
        return None
    return "\n".join(lines + [f"feature {tag} {{ {' '.join(f'lookup {n};' for n in names)} }} {tag};" for tag, names in features.items()])


def _lookup_fea(name, rules, feature="kern"):
    return "\n".join(FEA_HEADER + [f"lookup {name} useExtension {{"] + rules
                      + [f"}} {name};", f"feature {feature} {{ lookup {name}; }} {feature};"])


def fixes_fea(pair_fix, contexts, feature="kern"):
    """Corrections found by shaping, as separate feature files: kerning between shaped glyphs, then contexts;
    those found unkerned are in `dist`, which browsers keep with kerning off."""
    out = []
    suffix = "" if feature == "kern" else feature
    # A pair that moves its second glyph makes HarfBuzz skip that glyph as the start of
    # the next pair, so those pairs get a lookup of their own.
    for idx, name in ((0, f"SLpairfix{suffix}"), (1, f"SLpairfix2{suffix}")):
        pairs = []
        for (a, b, i), d in sorted(pair_fix.items()):
            if i == idx and d:
                if pairs and len(pairs) % 1501 == 1500:
                    pairs.append("  subtable;")
                pairs.append(f"  pos {_g(a)} {_g(b)} {d};" if idx == 0
                             else f"  pos {_g(a)} <0 0 0 0> {_g(b)} <0 0 {d} 0>;")
        if pairs:
            out.append(_lookup_fea(name, pairs, feature))
    # Only the first matching rule in a lookup applies, so all rules for one glyph share
    # a lookup; glyphs are packed into lookups small enough for 16-bit offsets. A zero
    # rule still matters: it keeps a shorter rule from applying.
    by_glyph = defaultdict(list)
    for (ctx, mark), d in contexts.items():
        by_glyph[ctx[mark]].append((ctx, mark, d))
    groups, size = [], CONTEXT_LOOKUP_RULES
    for glyph in sorted(by_glyph, key=lambda g: -len(by_glyph[g])):
        if len(by_glyph[glyph]) > CONTEXT_LOOKUP_RULES:
            raise RuntimeError(f"{len(by_glyph[glyph])} context rules for {glyph}; too many for one lookup")
        if size + len(by_glyph[glyph]) > CONTEXT_LOOKUP_RULES:
            groups.append([])
            size = 0
        groups[-1] += by_glyph[glyph]
        size += len(by_glyph[glyph])
    for n, group in enumerate(groups):
        # Each change of advance is one named lookup the rules share: feaLib gives every inline value its own.
        changes, changed, lines = {}, defaultdict(set), []
        for k, (ctx, mark, d) in enumerate(sorted(group, key=lambda r: -len(r[0]))):
            name = changes.setdefault(d, f"SLadvance{suffix}{n}x{len(changes)}")
            changed[name].add(ctx[mark])
            parts = [_g(g) + ("'" if i == mark else "") for i, g in enumerate(ctx)]
            parts[mark] += f" lookup {name}"
            # Rules of single glyphs pack many to a subtable; feaLib weighs a subtable per rule too.
            if k and k % ACCENT_RULES == 0:
                lines.append("  subtable;")
            lines.append(f"  pos {' '.join(parts)};")
        named = [f"lookup {name} useExtension {{ pos [{' '.join(_g(g) for g in sorted(changed[name]))}] <0 0 {d} 0>; }} {name};"
                 for d, name in changes.items()]
        out.append("\n".join(FEA_HEADER + named) + "\n" + _lookup_fea(f"SLcontext{suffix}{n}", lines, feature)[len("\n".join(FEA_HEADER)) + 1:])
    return out


def _compile_job(args):
    order, fea = args
    gpos = merging.compile_layout(order, fea)
    work = TTFont()
    work.setGlyphOrder(order)
    work["GPOS"] = gpos
    try:
        return gpos.compile(work)
    except OTLOffsetOverflowError:
        # Rules that move marks each get a lookup of their own from feaLib; those outgrow 16-bit offsets.
        merging.promote_extensions(gpos.table, "GPOS")
        return gpos.compile(work)


def assemble(font, keep_donor_layout, pairs_gpos, width_fix, pair_fix, contexts, accents=None, extra=(), unkerned=None):
    """The font with Office widths, measured pair spacing, and the corrections so far, mark placement
    included; `extra` is more positioning feature code, `unkerned` the (pair, context) corrections that
    hold with kerning off."""
    f = copy.deepcopy(font)
    if not keep_donor_layout and "GPOS" in f:
        del f["GPOS"]
    for name, r in width_fix.items():
        adv, lsb = f["hmtx"][name]
        f["hmtx"][name] = (adv + r, lsb)
    if pairs_gpos is not None:
        merging.graft_layout(f, pairs_gpos)
    order = f.getGlyphOrder()
    feas = (fixes_fea(*unkerned, "dist") if unkerned else []) + fixes_fea(pair_fix, contexts)
    if accents:
        fea = accent_fea(accents, order, mark_glyphs(f))
        if fea:
            feas.append(fea)
    feas += list(extra)
    for data in _map(_compile_job, [(order, fea) for fea in feas]):
        gpos = newTable("GPOS")
        gpos.decompile(data, f)
        merging.graft_layout(f, gpos)
    buf = io.BytesIO()
    try:
        f.save(buf)
    except OTLOffsetOverflowError:
        # The source's own lookups plus ours outgrow 16-bit offsets: make every lookup an extension.
        for tag in ("GPOS", "GSUB"):
            if tag in f:
                merging.promote_extensions(f[tag].table, tag)
        buf = io.BytesIO()
        f.save(buf)
    return buf.getvalue()


def learn_advances(office_path, units, data, probes, names):
    """Widths for glyphs only reached through substitutions, from the Office face's shaping of the same text."""
    key = hash(data)
    seen = defaultdict(Counter)
    for part in _map(_learn_job, [(office_path, units, key, data, chunk, names) for chunk in _chunks(probes)]):
        for name, counts in part.items():
            seen[name].update(counts)
    return {n: c.most_common(1)[0][0] for n, c in seen.items()}


def prune_ligatures(font, office_shaper):
    """Drop the font's own default ligatures where the Office face keeps separate clusters (caret stops)."""
    if "GSUB" not in font:
        return
    rev = {}
    for cp, g in sorted((font.getBestCmap() or {}).items()):
        rev.setdefault(g, cp)
    table = font["GSUB"].table
    for fr in table.FeatureList.FeatureRecord:
        if fr.FeatureTag not in ("liga", "clig", "dlig", "rlig"):
            continue
        for li in fr.Feature.LookupListIndex:
            for st in table.LookupList.Lookup[li].SubTable:
                st = getattr(st, "ExtSubTable", st)
                ligatures = getattr(st, "ligatures", {})
                for first, ligs in list(ligatures.items()):
                    keep = []
                    for lig in ligs:
                        seq = [first] + list(lig.Component)
                        if all(g in rev for g in seq):
                            text = "".join(chr(rev[g]) for g in seq)
                            if len(set(i.cluster for i in office_shaper.shape(text).glyph_infos)) > 1:
                                continue
                        keep.append(lig)
                    if keep:
                        ligatures[first] = keep
                    else:
                        del ligatures[first]


def drop_latin_swaps(font):
    """Take Latin letters out of the font's own `ccmp` swaps (Noto's i for dotless i before an accent): a
    face keeping its source's shaping swaps them as the Office face does instead."""
    if "GSUB" not in font:
        return
    latin = {g for c, g in (font.getBestCmap() or {}).items() if char_script(c) == "Latn"}
    table = font["GSUB"].table
    todo = [li for fr in table.FeatureList.FeatureRecord if fr.FeatureTag == "ccmp" for li in fr.Feature.LookupListIndex]
    seen = set()

    def called(obj, depth=0):
        if depth > 6:
            return
        if hasattr(obj, "SequenceIndex") and hasattr(obj, "LookupListIndex"):
            todo.append(obj.LookupListIndex)
            return
        for value in vars(obj).values() if hasattr(obj, "__dict__") else ():
            for item in value if isinstance(value, list) else [value]:
                if hasattr(item, "__dict__") and not isinstance(item, (str, bytes)):
                    called(item, depth + 1)

    while todo:
        li = todo.pop()
        if li in seen:
            continue
        seen.add(li)
        for st in table.LookupList.Lookup[li].SubTable:
            st = getattr(st, "ExtSubTable", st)
            mapping = getattr(st, "mapping", None)
            if mapping is not None:
                for g in latin & set(mapping):
                    del mapping[g]
            else:
                called(st)


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


def build(args):
    office_dir, work, (office_file, index, source, coords, family, style, options) = args
    # options: True/False (keep the source's own substitutions, as complex scripts need), or a dict
    # with keep_layout, fit (match letter height and stretch toward the Office widths), slant
    # (degrees, for a face the source has no italic of), and script (the verification sample).
    opts = options if isinstance(options, dict) else {"keep_layout": options}
    keep_layout, fit = opts.get("keep_layout", False), opts.get("fit", False)
    skew = math.tan(math.radians(opts.get("slant", 0)))
    office_path = office_face_path(office_dir, work, office_file, index)
    office = TTFont(office_path)
    font = TTFont(src(source))
    original_notice = font["name"].getDebugName(0) or ""
    if coords:
        font = instancer.instantiateVariableFont(font, coords)
    strip_hinting(font)
    o_upem, s_upem = office["head"].unitsPerEm, font["head"].unitsPerEm
    factor = height_factor(office, font) if fit else size_factor(office, font) if keep_layout else 1.0
    if abs(factor - 1) < 0.02:
        factor = 1.0
    # Build at a whole multiple of the Office units when the source is much finer, so outlines keep their precision.
    k = max(1, s_upem // o_upem) if s_upem >= 2 * o_upem else 1
    out_upem = o_upem * k
    scale_upem(font, round(out_upem / factor))
    merging.set_units(font, out_upem)
    if "glyf" in font:
        decompose_glyf(font)

    ocmap, scmap = office.getBestCmap(), font.getBestCmap()
    office_adv = lambda c: office["hmtx"][ocmap[c]][0] * k
    office_glyphs = office.getGlyphSet()

    def office_blank(c):
        pen = BoundsPen(office_glyphs)
        office_glyphs[ocmap[c]].draw(pen)
        return pen.bounds is None
    source_glyphs = font.getGlyphSet()

    def source_blank(c):
        pen = BoundsPen(source_glyphs)
        source_glyphs[scmap[c]].draw(pen)
        return pen.bounds is None

    # A source glyph left empty where the Office face draws something counts as missing.
    want = {c: office_adv(c) for c in ocmap if c in scmap and not (source_blank(c) and not office_blank(c))}

    # One output glyph per distinct Office advance of each source glyph, centered in it.
    order, added = list(font.getGlyphOrder()), []
    hmtx, new_cmap = dict(font["hmtx"].metrics), {}
    by_glyph = {}
    for c in sorted(want):
        by_glyph.setdefault(scmap[c], []).append(c)
    for g, cps in by_glyph.items():
        widths = {}
        for c in cps:
            widths.setdefault(want[c], []).append(c)
        old = font["hmtx"][g][0]
        for n, (w, group) in enumerate(sorted(widths.items(), key=lambda kv: -len(kv[1]))):
            name = g if n == 0 else f"{g}.sl{n}"
            sx = min(max(w / old, 1 / MAX_STRETCH), MAX_STRETCH) if fit and old > 0 and w > 0 else 1.0
            outline_copy_shift(font, g, round((w - sx * old) / 2), None if n == 0 else name, sx, skew)
            if n:
                added.append(name)
            hmtx[name] = (w, 0)
            for c in group:
                new_cmap[c] = name

    # Characters the source lacks: whole scripts from a donor, canonical aliases, blank spaces, donor glyphs.
    missing = [c for c in text_chars(ocmap) if c not in new_cmap]
    merges = merges_for(family, style)
    scripts = {s: cps for s, cps in merging.letters_by_script(missing).items() if s in merges}
    merged_chars = {c for cps in scripts.values() for c in cps}
    used, remaining = Counter(), []
    for c in missing:
        if c in merged_chars:
            continue
        w = office_adv(c)
        alias = fill.canonical_alias(c, scmap)
        if alias and alias in hmtx:
            name = f"{alias}.sla{c:04X}"
            outline_copy_shift(font, alias, round((w - hmtx[alias][0]) / 2), name)
        elif (unicodedata.category(chr(c)) in ("Zs", "Zl", "Zp") or (unicodedata.category(chr(c)) == "Cf" and c != 0xAD)
              or 0xFE00 <= c <= 0xFE0F or 0xE0100 <= c <= 0xE01EF or office_blank(c)):
            # Shaping hides format characters and variation selectors, so only their width matters;
            # a soft hyphen can show at a line end.
            name = f"space.sl{c:04X}"
            fill.add_blank(font, name, w)
        else:
            remaining.append(c)
            continue
        added.append(name)
        hmtx[name] = (w, 0)
        new_cmap[c] = name
    if remaining:
        # The whole-script donors also cover the symbols and punctuation of their blocks.
        script_donors = [{"font": (src(path), 0, coords), "name": name, "license": "OFL-1.1", "notice": path.split("/")[1]}
                         for path, coords, name in merges.values()]
        picks = fill.choose(fill.Office(office_path), remaining, donors_for(src, family, style) + script_donors, "text",
                            POOL, worker_count(), DONORS_USED.setdefault(family, []))
        for c, pick in sorted(picks.items()):
            name = f"sl.uni{c:04X}"
            t = tuple(v * k for v in pick["transform"])
            fill.add_glyph(font, name, fill.donor_font(*pick["donor"]["font"]), pick["glyph"], t, office_adv(c))
            added.append(name)
            hmtx[name] = (office_adv(c), 0)
            new_cmap[c] = name
            d = pick["donor"]
            used[(d["name"], d["license"], d.get("notice", ""))] += 1

    font.setGlyphOrder(order + added)
    if "CFF " in font:
        font["CFF "].cff[font["CFF "].cff.fontNames[0]].charset = list(order + added)
    if "glyf" in font:
        font["glyf"].glyphOrder = order + added
    font["hmtx"].metrics = hmtx
    for name in order + added:
        b = glyph_bounds(font, name)
        hmtx[name] = (hmtx[name][0], int(round(b[0])) if b else 0)
    font["hmtx"].metrics = hmtx
    merging.keep_glyph_names(font)
    set_cmap(font, new_cmap)
    # The Office face decides kerning and ligature spacing.
    if not keep_layout:
        for tag in ("GSUB", "GPOS"):
            if tag in font:
                del font[tag]
    else:
        prune_ligatures(font, Shaper(office_path, out_upem))
        drop_latin_swaps(font)
        if "GPOS" in font:
            for fr in font["GPOS"].table.FeatureList.FeatureRecord:
                if fr.FeatureTag == "kern":
                    fr.Feature.LookupListIndex = []
                    fr.Feature.LookupCount = 0

    merged_names = set()
    office_fill = fill.Office(office_path) if scripts else None
    for script, cps in scripts.items():
        path, donor_coords, donor_name = merges[script]
        prefix = f"sl{script[:2].lower()}."
        donor = merging.prepare(src(path), donor_coords, cps, office_fill, out_upem, prefix)
        merged_names |= set(donor.getGlyphOrder())
        font = merging.merge(font, donor)
        cmap = font.getBestCmap()
        for c in cps:
            if c in cmap:
                name = cmap[c]
                shift = round((office_adv(c) - font["hmtx"][name][0]) / 2)
                if 0xFB50 <= c <= 0xFDFF or 0xFE70 <= c <= 0xFEFF:
                    # A presentation form keeps its own width apart from the contextual form it shares a glyph with.
                    name = f"{name}.slp{c:04X}"
                    outline_copy_shift(font, cmap[c], shift, name)
                    append_glyphs(font, [name])
                else:
                    outline_copy_shift(font, name, shift)
                b = glyph_bounds(font, name)
                font["hmtx"][name] = (office_adv(c), int(round(b[0])) if b else 0)
                new_cmap[c] = name
        used[(donor_name, "OFL-1.1", path.split("/")[1])] += sum(c in cmap for c in cps)
    if scripts:
        set_cmap(font, new_cmap)
        merging.keep_glyph_names(font)
    ligatures, decompose = add_ligatures(font, office, office_path, out_upem, new_cmap, latin_only=keep_layout)
    variants = add_script_variants(font, office_path, out_upem, new_cmap, merged_chars)
    added += [copy_name for pairs in variants.values() for _, copy_name in pairs]
    office_classes = glyph_classes(office, office_path)
    split_by_class(font, new_cmap, ocmap, office_classes)
    # Where HarfBuzz uses no classes from the Office face (Tahoma), it takes marks from Unicode in every
    # script; ours keeps no classes either, merged scripts included, so HarfBuzz does the same in it.
    set_glyph_classes(font, office_classes, ocmap, new_cmap, added, keep_layout or (bool(scripts) and bool(office_classes)))
    set_line_metrics(font, office, style, k)
    port = opts.get("port", ()) if isinstance(opts, dict) else ()
    if ligatures and "GDEF" in font and font["GDEF"].table.GlyphClassDef:
        for name, (_, cls, _) in ligatures.items():
            font["GDEF"].table.GlyphClassDef.classDefs[name] = cls
    graft_script_variants(font, variants)
    ported = {}
    if port:
        ported = port_office_layout(font, office_path, out_upem, new_cmap, port)
        log(f"{family} {style}: carried over the Office face's {', '.join(port)} lookups")

    chars = text_chars(new_cmap)
    pairs = office_pairs(office_path, chars, out_upem, exclude=merged_chars)
    deltas = pairs[0]
    log(f"{family} {style}: {len(deltas)} pair spacings measured")
    split_by_spacing(font, new_cmap, deltas)
    mark_gpos, copies = [], {}
    # A face keeping its source's shaping (Dubai's Arabic) has only its Latin marks placed as Office's.
    # Arabic's own harakat are of the inherited script too.
    marked = {"Latn"} | COMMON if keep_layout else MARKED_SCRIPTS
    alphabetic = [c for c in chars if c not in merged_chars and char_script(c) in marked
                  and not (keep_layout and 0x600 <= c < 0x900)]
    if alphabetic:
        mark_gpos, mark_gsub, copies, report = marking.mark_fea(office_classes, ocmap, office_path, out_upem, new_cmap,
                                                                alphabetic, "GPOS" in office)
        log(f"{family} {style}: marks {report}")
        for name, (source_glyph, advance, _) in copies.items():
            reference_copy(font, source_glyph, name, advance)
        append_glyphs(font, list(copies))
        if copies and "GDEF" in font and font["GDEF"].table.GlyphClassDef:
            classes = font["GDEF"].table.GlyphClassDef.classDefs
            for name, (source_glyph, advance, office_class) in copies.items():
                # A mark copy is classed like the Office glyph it stands for; a copy with an advance of its
                # own is spacing (a widened letter, or a mark drawn as one).
                classes[name] = (office_class or classes.get(source_glyph, 3)) if advance is None else 1
        if mark_gsub:
            merging.graft_layout(font, merging.compile_layout(font.getGlyphOrder(), "\n".join(FEA_HEADER + mark_gsub), "GSUB"))
    # Our ligatures, after the marks: a letter the Office face swaps before a mark (ị before a grave) still
    # joins its ligatures as the copy that stands for the swap.
    swapped = defaultdict(list)
    for name, (source_glyph, _, _) in copies.items():
        if ".slb" in name:
            swapped[source_glyph].append(name)
    if ligatures:
        # Ligature lookups carried over from the Office face form our ligatures instead of our own rules.
        rules, lookups = ([], []) if set(port) & set(LIGATURE_FEATURES) else ligature_rules(ligatures, new_cmap, swapped)
        if not lookups:
            LIGATURE_ACROSS.clear()
        across_lines, across_lookups = across_rules(new_cmap, swapped, {n: source for n, (source, _, _) in copies.items()})
        rules, lookups = across_lines + rules, across_lookups + lookups
        for across, name in ((True, "SLligasplitmarks"), (False, "SLligasplit")):
            splits = [f"  sub {_g(before)} {_g(lig)}' by {' '.join(_g(p) for p in parts)};"
                      for before, lig, parts, a in LIGATURE_SPLITS if a == across]
            if splits and lookups:
                flag = ["  lookupflag IgnoreMarks;"] if across else []
                rules = [f"lookup {name} {{"] + flag + splits + [f"}} {name};"] + rules
                lookups = [name] + lookups
        layout = decompose_rules(decompose) + rules
        if layout:
            fea = "\n".join(FEA_HEADER + layout
                            + ([f"feature liga {{ {' '.join(f'lookup {n};' for n in lookups)} }} liga;"] if lookups else []))
            merging.graft_layout(font, merging.compile_layout(font.getGlyphOrder(), fea, "GSUB"))
    if not keep_layout:
        # Where the Office face composes and decomposes before it forms ligatures (a dotless i before a
        # mark leaves "ffi" unjoined), ours does too.
        if "GSUB" in font and "GSUB" in office:
            first = lambda tag: min((i for fr in office["GSUB"].table.FeatureList.FeatureRecord if fr.FeatureTag == tag
                                     for i in fr.Feature.LookupListIndex), default=None)
            if first("ccmp") is not None and first("liga") is not None and first("ccmp") < first("liga"):
                merging.lookups_first(font["GSUB"].table, {"ccmp"})
    skip_marks = marking.kerning_skips_marks(Shaper(office_path, out_upem), deltas, marking.marks_of(office_classes, ocmap, chars))
    log(f"{family} {style}: kerning across marks {skip_marks}")
    joined = {(ord(t[0]), ord(t[1])) for t in ligature_contexts(office) if len(t) == 2}
    unkerned = office_pairs(office_path, chars, out_upem, exclude=merged_chars, kern=False)
    if "GPOS" in ported:
        # The Office face's own kerning is carried over; measured spacing stays only where a mark follows.
        keep = lambda measured: {p: v for p, v in measured.items() if unicodedata.category(chr(p[1])) in ("Mn", "Me")}
        pairs, unkerned = (keep(pairs[0]), keep(pairs[1])), (keep(unkerned[0]), keep(unkerned[1]))
    fea = pairs_fea(new_cmap, pairs, skip_marks, joined, unkerned)
    if mark_gpos:
        fea = "\n".join([fea or "\n".join(FEA_HEADER)] + mark_gpos)
    elif has_feature(office, "GPOS", "mark") and not (scripts or keep_layout) and 32 in new_cmap:
        # HarfBuzz recomposes base + mark sequences differently when a font has no mark feature.
        mark = f"lookup SLmark {{ pos {_g(new_cmap[32])} 0; }} SLmark;\nfeature mark {{ lookup SLmark; }} mark;"
        fea = f"{fea}\n{mark}" if fea else "\n".join(FEA_HEADER + [mark])
    elif not fea and "GPOS" in office and not (scripts or keep_layout) and 32 in new_cmap:
        # Without positioning HarfBuzz places marks by its fallback, which the Office face, having some, never
        # gets: ours has some too, moving nothing.
        fea = "\n".join(FEA_HEADER + [f"lookup SLnone {{ pos {_g(new_cmap[32])} 0; }} SLnone;", "feature dist { lookup SLnone; } dist;"])
    lig_marks = ligature_mark_fea(new_cmap) if ligatures else []
    if lig_marks:
        fea = "\n".join([fea or "\n".join(FEA_HEADER)] + lig_marks)
    pairs_gpos = merging.compile_layout(font.getGlyphOrder(), fea) if fea else None
    if "GPOS" in ported:
        holder = TTFont()
        holder.setGlyphOrder(font.getGlyphOrder())
        if pairs_gpos is not None:
            holder["GPOS"] = pairs_gpos
        merging.graft_by_script(holder, ported["GPOS"])
        pairs_gpos = holder["GPOS"]
    keep_donor = bool(scripts)
    width_fix, pair_fix, rules = Counter(), Counter(), Rules()
    unkerned_fix = (Counter(), Rules())
    data = assemble(font, keep_donor, pairs_gpos, width_fix, pair_fix, rules)

    probes = {chr(c) for c in chars}
    runs = {}
    for lig in ligature_contexts(office):
        probes.add(lig)
        if merging.script_of(ord(lig[0])):
            continue  # merged scripts get their own probes below
        script = char_script(ord(lig[0]))
        script = "Latn" if script in COMMON else script
        if script not in runs:
            runs[script] = same_run(chars, script)
        for c in runs[script]:
            probes.add(chr(c) + lig)
            probes.add(lig + chr(c))
    if keep_layout:
        probes |= {chr(a) + chr(b) for a in chars for b in chars}
        # Indic conjuncts: consonant, virama, consonant.
        for virama in (0x094D, 0x09CD, 0x0A4D, 0x0ACD, 0x0B4D, 0x0BCD, 0x0C4D, 0x0CCD, 0x0D4D, 0x0DCA):
            if virama in new_cmap:
                block = virama & ~0x7F
                consonants = [c for c in chars if c & ~0x7F == block and unicodedata.category(chr(c)) == "Lo"]
                probes |= {chr(a) + chr(virama) + chr(b) for a in consonants for b in consonants}
    # The pairs of letters spaced most, kerned and not, with a mark between: their spacing may reach across.
    between = [m for m in (0x301, 0x323, 0x308) if m in new_cmap]
    # Ranked as suiteleaf_latin.py ranks them, ties and all.
    latin_letter = lambda c: chr(c).isalpha() and char_script(c) == "Latn"
    letter_pairs = lambda measured: sorted((p for p in measured if latin_letter(p[0]) and latin_letter(p[1])),
                                           key=lambda p: (abs(measured[p]), chr(p[0]), chr(p[1])), reverse=True)[:KERNED_PROBES]
    spaced = set(letter_pairs(deltas)) | set(letter_pairs(unkerned[0]))
    probes |= {chr(a) + chr(m) + chr(b) for a, b in spaced for m in between}
    # A letter the Office face draws otherwise before some characters (Cambria's f before an ascender) is
    # kerned as itself where a mark comes between, or a precomposed letter drawn as it and a mark.
    osh = Shaper(office_path, out_upem)
    latin_chars = [c for c in chars if char_script(c) in {"Latn"} | COMMON and c not in merged_chars]
    plain_letters = [c for c in latin_chars if chr(c).isalpha() and len(unicodedata.normalize("NFD", chr(c))) == 1]
    alone = {c: osh.shape(chr(c)).glyph_infos[0].codepoint for c in plain_letters}
    variant = [(x, y) for x in plain_letters for y in latin_chars if osh.shape(chr(x) + chr(y)).glyph_infos[0].codepoint != alone[x]]
    built_on = defaultdict(list)
    for c in latin_chars:
        nfd = unicodedata.normalize("NFD", chr(c))
        if len(nfd) > 1 and len(osh.shape(chr(c)).glyph_infos) > 1:
            built_on[ord(nfd[0])].append(c)
    probes |= {chr(x) + chr(m) + chr(y) for x, y in variant for m in between}
    probes |= {chr(d) + chr(y) for x, y in variant for d in built_on.get(x, ())}
    # And the letter before it kerns with what it is drawn as there (t and Cambria's f before an i).
    probes |= {chr(w) + chr(x) + chr(y) for x, y in variant for w in range(0x41, 0x7B) if chr(w).isalpha() and w in new_cmap}
    script_probes = set()
    for cps in scripts.values():
        script_probes |= merging.script_probes(cps)
    probes |= script_probes
    probes = sorted((p for p in probes if all(ord(ch) in new_cmap for ch in p)), key=len)
    log(f"{family} {style}: {len(probes)} probe texts")

    if merged_names:
        # Contextual forms have no character of their own; take their widths from the Office shaping.
        single = sorted(p for p in probes if len(p) == 1)
        learned = learn_advances(office_path, out_upem, data, single + sorted(script_probes), merged_names)
        for name, adv in learned.items():
            font["hmtx"][name] = (adv, font["hmtx"][name][1])
        data = assemble(font, keep_donor, pairs_gpos, width_fix, pair_fix, rules)

    def assembled(accents=None, extra=()):
        return assemble(font, keep_donor, pairs_gpos, width_fix, pair_fix, rules, accents, extra, unkerned_fix)

    # Scripts that only come close keep width and pair fixes; their contextual forms
    # would need a context rule for nearly every letter sequence.
    approximate = set(APPROXIMATE_SCRIPTS.get(family, ()))
    loose = {p for p in probes if any(char_script(ord(ch)) in approximate for ch in p)}

    # Fix what pairs cannot express (ligatures, contextual forms, the source's own
    # substitutions) at every cluster boundary the Office face has. A one-glyph text
    # fixes that glyph's width; a two-glyph text, their kerning; longer texts, a context. Unkerned
    # first: what those fixes do holds with kerning off; kerned text then takes what kerning adds.
    tries = Counter()
    for kern, (kern_pairs, kern_rules) in ((False, unkerned_fix), (True, (pair_fix, rules))):
        for _ in range(16):
            key = hash(data)
            results = _map(_fixes_job, [(office_path, out_upem, key, data, chunk, kern) for chunk in _chunks(probes)])
            changed, seen = 0, set()
            for text, text_fixes in zip(probes, (f for part in results for f in part)):
                for seq, idx, r in text_fixes:
                    if (seq, idx) in seen or (len(seq) > 2 and text in loose):
                        continue
                    seen.add((seq, idx))
                    # A fix that changed nothing the last times will not: the verification reports it.
                    tries[(kern, seq, idx)] += 1
                    if tries[(kern, seq, idx)] > 3:
                        continue
                    changed += 1
                    if len(seq) == 1 and not kern:
                        width_fix[seq[0]] += r
                    elif len(seq) == 1:
                        # A glyph only kerning changes alone (the Office face's kerning moves it by itself).
                        kern_rules[(seq, idx)] = kern_rules.get((seq, idx), 0) + r
                    elif len(seq) == 2:
                        kern_pairs[(seq[0], seq[1], idx)] += r
                    else:
                        base = kern_rules.get((seq, idx))
                        kern_rules[(seq, idx)] = (matching_rule_value(kern_rules, seq, idx) if base is None else base) + r
            log(f"{family} {style}: {changed} corrections {'kerned' if kern else 'unkerned'}; {len(width_fix)} widths, "
                f"{len(kern_pairs)} pairs, {len(kern_rules)} contexts")
            if not changed:
                break
            data = assembled()
        else:
            log(f"{family} {style}: spacing corrections did not settle; verification will report the difference")

    # The glyph after a soft hyphen.
    hidden = []
    if 0xAD in new_cmap and 0xAD in ocmap and not keep_layout:
        after = [c for c in chars if char_script(c) in {"Latn"} | COMMON and c not in merged_chars]
        fea = hidden_fea(office_path, out_upem, data, after)
        if fea:
            log(f"{family} {style}: kerning after a soft hyphen moved")
            hidden = [fea]
            data = assembled(None, hidden)

    # Marks placed exactly where the Office face places them: every Latin letter with each mark and each
    # pair of marks is shaped in both, and each misplaced mark is moved after the glyphs before it.
    accents = {}
    # A face keeping its source's shaping (an Arabic one) has its Latin marks placed the same way.
    if (mark_gpos or keep_layout or keep_donor or "GPOS" in office) and not os.environ.get("SUITELEAF_NO_ACCENT_FIXES"):
        latin = [c for c in chars if char_script(c) in {"Latn"} | COMMON and c not in merged_chars]
        combining = [c for c in latin if unicodedata.category(chr(c)) in ("Mn", "Me") and not marking.invisible(c)]
        # A character the Office face draws as a mark (MS Sans Serif's superscript i) sits on what comes before.
        mark_names = mark_glyphs(TTFont(io.BytesIO(data)))
        drawn_as_marks = [c for c in latin if new_cmap.get(c) in mark_names and c not in combining and not marking.invisible(c)]
        letters = [c for c in latin if unicodedata.category(chr(c)).startswith("L")]
        texts = [chr(b) + chr(m) for b in latin for m in combining + drawn_as_marks]
        # Two marks on a plain letter; a precomposed one with two more is a stack of three.
        plain = [b for b in letters if len(unicodedata.normalize("NFD", chr(b))) == 1]
        texts += [chr(b) + chr(m1) + chr(m2) for b in plain for m1 in combining for m2 in combining]
        ligatures = [lig for lig in ligature_contexts(office) if all(ord(ch) in latin for ch in lig)]
        texts += [lig + chr(m) for lig in ligatures for m in combining]
        texts += [lig + chr(m1) + chr(m2) for lig in ligatures for m1 in combining for m2 in combining]
        # Where fixes for every stack do not fit, those on the letters suiteleaf_latin.py stacks marks on.
        vowels = {ord(v) for v in "aeiouAEIOU"}
        fewer = [t for t in texts if len(t) == 2 or (len(t) == 3 and ord(t[0]) in vowels) or t[:-1] in ligatures]
        unfixed = data
        for attempt in (texts, fewer):
            data, accents, fitted = unfixed, {}, True
            for _ in range(6):
                key = hash(data)
                found = defaultdict(Counter)
                for part in _map(_accent_job, [(office_path, out_upem, key, data, chunk) for chunk in _chunks(attempt, 4 * worker_count())]):
                    for context, deltas in part.items():
                        found[context].update(deltas)
                log(f"{family} {style}: {sum(sum(d.values()) for d in found.values())} marks placed elsewhere, {len(found)} contexts")
                if not found:
                    break
                tried = dict(accents)
                for context, deltas in found.items():
                    dx, dy = deltas.most_common(1)[0][0]
                    old_dx, old_dy = tried.get(context, (0, 0))
                    tried[context] = (old_dx + dx, old_dy + dy)
                try:
                    data = assembled(tried, hidden)
                except OTLOffsetOverflowError:
                    log(f"{family} {style}: too many accent fixes to fit")
                    fitted = False
                    break
                accents = tried
            if fitted or attempt is fewer:
                break

    out = TTFont(io.BytesIO(data))
    name_font(out, family, style, f"{original_notice} Modified by SuiteLeaf: outlines scaled and centered; widths, "
                                  f"kerning, ligatures, glyph classes, and line metrics set to match another font's layout.")
    path = Path(work) / f"{family.replace(' ', '')}-{style.replace(' ', '')}.ttf"
    out.save(path)
    script = opts.get("script", "thai" if keep_layout else "latin")
    return {"office": office_file, "office_path": office_path, "family": family, "style": style, "path": str(path),
            "script": script, "approximate": list(APPROXIMATE_SCRIPTS.get(family, ())),
            "donors": [list(k) + [v] for k, v in used.items()]}


def dingbat_tables():
    script = "process.stdout.write(JSON.stringify(require('dingbat-to-unicode/dist/dingbats.js').default))"
    return json.loads(subprocess.check_output(["node", "-e", script], cwd=REPO))


def build_symbol(args):
    """A symbol font from scratch, at the Office face's codes, widths, and line metrics: each symbol the
    best-matching glyph of the open fonts we have, or our own drawing (suiteleaf_symbols)."""
    from fontTools.fontBuilder import FontBuilder
    import suiteleaf_svg
    import suiteleaf_symbols
    office_dir, work, (office_file, table, family, style) = args
    office_path = os.path.join(office_dir, office_file)
    office = TTFont(office_path)
    symbol = next(t for t in office["cmap"].tables if t.platformID == 3 and t.platEncID == 0)
    codes = dict(symbol.cmap)
    picks = suiteleaf_symbols.choose(suiteleaf_symbols.Office(office_path), table, suiteleaf_symbols.drawings_name(office_file))

    names = {code: f"sl.code{code:04X}" for code in sorted(codes)}
    order = [".notdef"] + list(names.values())
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    metrics = {".notdef": (office["hmtx"][office.getGlyphOrder()[0]][0], 0)}
    used = Counter()
    for code, name in names.items():
        pick = picks.get(code)
        pen = TTGlyphPen(None)
        if pick and pick[0] == "svg":
            pen = None
            glyphs[name] = suiteleaf_svg.glyph(pick[1], office["hhea"].ascent)
            used[suiteleaf_symbols.OUR_DRAWINGS] += 1
            for credit in suiteleaf_symbols.text_credits(pick[1]):
                used[credit] += 1
        elif pick:
            _, d, drawable, transform, _ = pick
            rec = DecomposingRecordingPen(fill.donor_font(*d["font"])[1])
            drawable.draw(rec)
            rec.replay(TransformPen(Cu2QuPen(pen, max_err=0.5, reverse_direction=False), transform))
            used[(d["name"], d["license"], d["notice"])] += 1
        if pen is not None:
            glyphs[name] = pen.glyph()
        metrics[name] = (office["hmtx"][codes[code]][0], 0)
    fb = FontBuilder(office["head"].unitsPerEm, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({})
    fb.setupGlyf(glyphs)
    for name in order:
        g = fb.font["glyf"][name]
        g.recalcBounds(fb.font["glyf"])
        metrics[name] = (metrics[name][0], g.xMin if g.numberOfContours else 0)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=office["hhea"].ascent, descent=office["hhea"].descent)
    fb.font["hhea"].lineGap = office["hhea"].lineGap
    fb.setupOS2()
    fb.font["OS/2"] = copy.deepcopy(office["OS/2"])
    fb.font["OS/2"].achVendID = "SLF "
    fb.font["OS/2"].fsType = 0
    fb.setupPost()
    fb.setupNameTable({"familyName": family, "styleName": style})
    font = fb.font
    font["head"].macStyle = office["head"].macStyle
    # The same character map layout as the Office face, pointing at our glyphs.
    by_glyph = {}
    for code, g in codes.items():
        by_glyph.setdefault(g, names[code])
    cmap = copy.deepcopy(office["cmap"])
    for t in cmap.tables:
        t.cmap = {c: by_glyph[g] for c, g in t.cmap.items() if g in by_glyph}
    font["cmap"] = cmap
    name_font(font, family, style, "Glyphs from open fonts (credited in the license file) and drawings by SuiteLeaf. "
                                   "Built by SuiteLeaf: scaled and positioned to another font's layout.")
    font["name"].setName("Each glyph keeps the license of the font it comes from; SuiteLeaf's own drawings are under "
                         "the SIL Open Font License, Version 1.1. See the license file that comes with the font.", 13, 3, 1, 0x409)
    font["name"].setName("https://openfontlicense.org", 14, 3, 1, 0x409)
    path = Path(work) / f"{family.replace(' ', '')}-{style.replace(' ', '')}.ttf"
    font.save(path)
    return {"office": office_file, "office_path": office_path, "family": family, "style": style, "path": str(path),
            "script": "symbol", "donors": [list(k) + [v] for k, v in used.items()]}


def _run(args):
    return build_symbol(args) if len(args[2]) == 4 else build(args)


if __name__ == "__main__":
    import suiteleaf_install
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("families", nargs="*", help="Only these families, such as 'SuiteLeaf Teak'")
    parser.add_argument("--office", default=DEFAULT_OFFICE, help="Folder with the Microsoft Office fonts")
    parser.add_argument("--cache", default=os.environ.get("SUITELEAF_FONT_CACHE", str(suiteleaf_sources.DEFAULT_CACHE)))
    parser.add_argument("--work", default=os.path.join(tempfile.gettempdir(), "suiteleaf-fonts"))
    parser.add_argument("--out", default=str(REPO / "apps/web/src/fonts"))
    parser.add_argument("--no-install", action="store_true", help="Build and verify only")
    args = parser.parse_args()
    SRC = suiteleaf_sources.fetch(args.cache)
    Path(args.work).mkdir(parents=True, exist_ok=True)
    jobs = [f for f in SYMBOL_FACES + FACES if not args.families or (f[2] if len(f) == 4 else f[4]) in args.families]
    # One face at a time, each using every core for its shaping.
    from concurrent.futures import ProcessPoolExecutor
    with ProcessPoolExecutor(worker_count(), max_tasks_per_child=64) as executor:
        POOL = executor
        results, errors = [], []
        for f in jobs:
            try:
                results.append(_run((args.office, args.work, f)))
            except Exception as e:
                import traceback
                traceback.print_exc()
                errors.append((f[2] if len(f) == 4 else f[4], f[3] if len(f) == 4 else f[5], repr(e)))
        # Characters the web fonts leave out (CJK) are not missing here either.
        checks = executor.map(suiteleaf_verify.check, [r["office_path"] for r in results], [r["path"] for r in results],
                              [r["script"] for r in results], [r.get("approximate", ()) for r in results],
                              [suiteleaf_install.OMIT] * len(results))
        for r, c in zip(results, checks):
            r["check"] = c
    failures = []
    for r in results:
        print(f"{r['family']} {r['style']}: {'ok' if r['check']['ok'] else 'FAILED'} {r['check']['layout']} "
              f"texts={r['check']['texts']} different={r['check']['texts_different']} missing={r['check']['missing']} "
              f"blank={r['check'].get('blank', 0)} "
              f"donors={[(d[0], d[3]) for d in r['donors']]}")
        if not r["check"]["ok"]:
            failures.append(r)
    json.dump(results, open(Path(args.work) / "results.json", "w"), indent=1, default=str)
    # A family is installed only when every one of its faces built and matches.
    broken = {r["family"] for r in failures} | {family for family, _, _ in errors}
    for family, style, error in errors:
        print(f"{family} {style}: ERROR {error}")
    if not args.no_install:
        ready = [r for r in results if r["family"] not in broken]
        if ready:
            suiteleaf_install.install(ready, args.office, SRC, args.out)
    if broken:
        sys.exit(f"Not installed (some faces fail): {', '.join(sorted(broken))}")
