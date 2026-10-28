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
import suiteleaf_merge as merging
import suiteleaf_sources
import suiteleaf_verify
from suiteleaf_families import (APPROXIMATE_SCRIPTS, FACES, NOTO_SYMBOLS, SYMBOL_FACES, donors_for, gf_donor, merges_for,
                                 zapf_dingbats)
from suiteleaf_shaping import Shaper, char_script, clusters, ligature_contexts, same_run, text_chars, total, worker_count

REPO = Path(__file__).resolve().parents[2]
DEFAULT_OFFICE = "/Applications/Microsoft Word.app/Contents/Resources/DFonts"
SRC = suiteleaf_sources.DEFAULT_CACHE
# Scripts Office fonts do not kern by default; pairs of thousands of ideographs are skipped.
UNKERNED = {"Hani", "Hira", "Kana", "Hang", "Bopo"}
COMMON = {"Zyyy", "Zinh", "Zzzz", None}
# Worker processes for shaping-heavy steps; the build sets it, and every helper works without it.
POOL = None
_SHAPERS = {}
# Donor families each SuiteLeaf family has used so far, so its other faces try them first.
DONORS_USED = {}


def _shaper(key, source, units=None):
    if key not in _SHAPERS:
        if len(_SHAPERS) > 3:
            _SHAPERS.clear()
        _SHAPERS[key] = Shaper(source, units)
    return _SHAPERS[key]


def _chunks(items, n=None):
    n = n or worker_count()
    size = max(1, -(-len(items) // n))
    return [items[i:i + size] for i in range(0, len(items), size)]


def _map(fn, jobs):
    return list(POOL.map(fn, jobs)) if POOL else [fn(j) for j in jobs]


def _pairs_job(args):
    office_path, units, pool, firsts, adv = args
    sh = _shaper(("office", office_path, units), office_path, units)
    out = {}
    for a in firsts:
        for b in pool:
            d = total(sh, chr(a) + chr(b)) - adv[a] - adv[b]
            if d:
                out[(a, b)] = d
    return out


def _fixes_job(args):
    office_path, units, key, data, texts = args
    osh = _shaper(("office", office_path, units), office_path, units)
    ssh = _shaper(("font", key), data)
    return [boundary_fixes(osh, ssh, t) for t in texts]


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
    """Hints are drawn for the original scale, so they go; so do device-specific tables."""
    for tag in ("fpgm", "prep", "cvt ", "hdmx", "LTSH", "VDMX", "kern", "DSIG", "STAT", "MVAR", "HVAR", "vhea", "vmtx", "gasp"):
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


def add_ligatures(font, office, office_path, units, cmap):
    """Office ligatures become ligatures here too, drawn from our own letters, so the
    clusters and the kerning against them can match. Returns {name: (glyphs, class)}."""
    osh = Shaper(office_path, units)
    buf = io.BytesIO()
    font.save(buf)
    ours = Shaper(buf.getvalue())
    ocd = office["GDEF"].table.GlyphClassDef.classDefs if "GDEF" in office and office["GDEF"].table.GlyphClassDef else {}
    hmtx = font["hmtx"].metrics
    ligatures, texts = {}, []
    marks = [c for c in sorted(cmap) if unicodedata.category(chr(c)) == "Mn" and c in (office.getBestCmap() or {})]
    for text in ligature_contexts(office):
        if any(ord(ch) not in cmap for ch in text):
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
        texts.append(text)
    append_glyphs(font, list(ligatures))
    # Combining marks after which the Office face does not form a ligature, and what it forms instead:
    # a shorter ligature of ours, or none.
    by_office_glyph = {glyph: name for name, (_, _, (_, glyph)) in ligatures.items()}
    for name, (parts, cls, (text, lig_glyph)) in list(ligatures.items()):
        breaks = []
        for m in marks:
            infos = osh.shape(text + chr(m)).glyph_infos
            if all(i.cluster == 0 for i in infos):
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


def ligature_rules(ligatures, cmap):
    """One contextual lookup for our ligatures, longest first; before a mark that stops one in Office, ours
    forms what Office forms instead (a shorter ligature, or none)."""
    lines, classes = ["lookup SLliga {"], {}

    def mark_class(marks):
        key = tuple(marks)
        if key not in classes:
            classes[key] = f"@SLbreak{len(classes)}"
        return classes[key]

    for name, (parts, _, breaks) in sorted(ligatures.items(), key=lambda kv: -len(kv[1][0])):
        seq = " ".join(_g(p) + "'" for p in parts)
        outcomes = defaultdict(list)
        for m, instead in breaks:
            outcomes[instead].append(m)
        for instead, marks in outcomes.items():
            if instead is None:
                lines.append(f"  ignore sub {seq} {mark_class(marks)};")
            else:
                k = len(ligatures[instead][0])
                head = " ".join(_g(p) + "'" for p in parts[:k])
                tail = " ".join(_g(p) for p in parts[k:])
                lines.append(f"  sub {head} {tail} {mark_class(marks)} by {_g(instead)};")
        lines.append(f"  sub {seq} by {_g(name)};")
    defs = [f"{cls} = [{' '.join(_g(cmap[m]) for m in key)}];" for key, cls in classes.items()]
    return defs + lines + ["} SLliga;"]


def draw_ligature(font, name, parts, widths, advance):
    """A ligature glyph from component outlines, only moved: each starts where the
    components' own advances, spread over the ligature's advance, put it."""
    total, x, shifts = sum(widths) or 1, 0, []
    for w in widths:
        shifts.append(round(x * advance / total))
        x += w
    if "glyf" in font:
        glyf = font["glyf"]
        pen = TTGlyphPen(None)
        for part, dx in zip(parts, shifts):
            glyf[part].draw(TransformPen(pen, (1, 0, 0, 1, dx, 0)), glyf)
        glyf[name] = pen.glyph()
        glyf[name].recalcBounds(glyf)
        return
    cff = font["CFF "].cff
    top = cff[cff.fontNames[0]]
    cs = top.CharStrings
    pen = T2CharStringPen(width=None, glyphSet=None)
    for part, dx in zip(parts, shifts):
        cs[part].draw(TransformPen(pen, (1, 0, 0, 1, dx, 0)))
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


def office_pairs(office_path, chars, units, exclude=()):
    """Office spacing for ordered pairs beyond the two advances: kerning and two-letter ligatures.

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
            jobs.append((office_path, units, pool, firsts, adv))
    for members in big:
        for firsts in _chunks(members):
            jobs.append((office_path, units, punct, firsts, adv))
        jobs.append((office_path, units, members, punct, adv))
    deltas = {}
    for part in _map(_pairs_job, jobs):
        deltas.update(part)
    return deltas


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


def pairs_fea(cmap, deltas):
    """Office pair spacing as kerning between the characters' glyphs."""
    lines = FEA_HEADER + ["lookup SLpairs useExtension {"]
    n = 0
    for (a, b), d in sorted(deltas.items()):
        if a in cmap and b in cmap:
            if n and n % 1500 == 0:
                lines.append("  subtable;")
            lines.append(f"  pos {_g(cmap[a])} {_g(cmap[b])} {d};")
            n += 1
    lines += ["} SLpairs;", "feature kern { lookup SLpairs; } kern;"]
    return "\n".join(lines) if n else None


def _lookup_fea(name, rules):
    return "\n".join(FEA_HEADER + [f"lookup {name} useExtension {{"] + rules
                      + [f"}} {name};", f"feature kern {{ lookup {name}; }} kern;"])


def fixes_fea(pair_fix, contexts):
    """Corrections found by shaping, as separate feature files: kerning between shaped glyphs, then contexts."""
    out = []
    # A pair that moves its second glyph makes HarfBuzz skip that glyph as the start of
    # the next pair, so those pairs get a lookup of their own.
    for idx, name in ((0, "SLpairfix"), (1, "SLpairfix2")):
        pairs = []
        for (a, b, i), d in sorted(pair_fix.items()):
            if i == idx and d:
                if pairs and len(pairs) % 1501 == 1500:
                    pairs.append("  subtable;")
                pairs.append(f"  pos {_g(a)} {_g(b)} {d};" if idx == 0
                             else f"  pos {_g(a)} <0 0 0 0> {_g(b)} <0 0 {d} 0>;")
        if pairs:
            out.append(_lookup_fea(name, pairs))
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
        lines = []
        for ctx, mark, d in sorted(group, key=lambda r: -len(r[0])):
            parts = [_g(name) + ("'" if i == mark else "") for i, name in enumerate(ctx)]
            parts[mark] += f" {d}"
            lines.append(f"  pos {' '.join(parts)};")
        out.append(_lookup_fea(f"SLcontext{n}", lines))
    return out


def _compile_job(args):
    order, fea = args
    gpos = merging.compile_layout(order, fea)
    work = TTFont()
    work.setGlyphOrder(order)
    work["GPOS"] = gpos
    return gpos.compile(work)


def assemble(font, keep_donor_layout, pairs_gpos, width_fix, pair_fix, contexts):
    """The font with Office widths, measured pair spacing, and the corrections so far."""
    f = copy.deepcopy(font)
    if not keep_donor_layout and "GPOS" in f:
        del f["GPOS"]
    for name, r in width_fix.items():
        adv, lsb = f["hmtx"][name]
        f["hmtx"][name] = (adv + r, lsb)
    if pairs_gpos is not None:
        merging.graft_layout(f, pairs_gpos)
    order = f.getGlyphOrder()
    for data in _map(_compile_job, [(order, fea) for fea in fixes_fea(pair_fix, contexts)]):
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


def set_glyph_classes(font, office, ocmap, new_cmap, added, keep_layout=False):
    """HarfBuzz zeroes mark advances by glyph class, so classes follow the Office face. Without glyph
    classes in the Office face, HarfBuzz takes them from Unicode; ours do too unless we keep the source's
    own shaping, which needs its classes."""
    if "GDEF" not in office or not office["GDEF"].table.GlyphClassDef:
        if not keep_layout and "GDEF" in font:
            font["GDEF"].table.GlyphClassDef = None
        return
    ocd = office["GDEF"].table.GlyphClassDef.classDefs
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
    font["head"].unitsPerEm = out_upem
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
    ligatures, decompose = ({}, []) if keep_layout else add_ligatures(font, office, office_path, out_upem, new_cmap)
    variants = add_script_variants(font, office_path, out_upem, new_cmap, merged_chars)
    added += [copy_name for pairs in variants.values() for _, copy_name in pairs]
    set_glyph_classes(font, office, ocmap, new_cmap, added, keep_layout or bool(scripts))
    set_line_metrics(font, office, style, k)
    if ligatures:
        fea = "\n".join(FEA_HEADER + decompose_rules(decompose) + ligature_rules(ligatures, new_cmap)
                        + ["feature liga { lookup SLliga; } liga;"])
        merging.graft_layout(font, merging.compile_layout(font.getGlyphOrder(), fea, "GSUB"))
        if "GDEF" in font and font["GDEF"].table.GlyphClassDef:
            for name, (_, cls, _) in ligatures.items():
                font["GDEF"].table.GlyphClassDef.classDefs[name] = cls
    graft_script_variants(font, variants)

    chars = text_chars(new_cmap)
    deltas = office_pairs(office_path, chars, out_upem, exclude=merged_chars)
    log(f"{family} {style}: {len(deltas)} pair spacings measured")
    fea = pairs_fea(new_cmap, deltas)
    if has_feature(office, "GPOS", "mark") and not (scripts or keep_layout) and 32 in new_cmap:
        # HarfBuzz recomposes base + mark sequences differently when a font has no mark feature.
        mark = f"lookup SLmark {{ pos {_g(new_cmap[32])} 0; }} SLmark;\nfeature mark {{ lookup SLmark; }} mark;"
        fea = f"{fea}\n{mark}" if fea else "\n".join(FEA_HEADER + [mark])
    pairs_gpos = merging.compile_layout(font.getGlyphOrder(), fea) if fea else None
    keep_donor = bool(scripts)
    width_fix, pair_fix, rules = Counter(), Counter(), Rules()
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

    # Scripts that only come close keep width and pair fixes; their contextual forms
    # would need a context rule for nearly every letter sequence.
    approximate = set(APPROXIMATE_SCRIPTS.get(family, ()))
    loose = {p for p in probes if any(char_script(ord(ch)) in approximate for ch in p)}

    # Fix what pairs cannot express (ligatures, contextual forms, the source's own
    # substitutions) at every cluster boundary the Office face has. A one-glyph text
    # fixes that glyph's width; a two-glyph text, their kerning; longer texts, a context.
    for _ in range(16):
        key = hash(data)
        results = _map(_fixes_job, [(office_path, out_upem, key, data, chunk) for chunk in _chunks(probes)])
        changed, seen = 0, set()
        for text, text_fixes in zip(probes, (f for part in results for f in part)):
            for seq, idx, r in text_fixes:
                if (seq, idx) in seen or (len(seq) > 2 and text in loose):
                    continue
                seen.add((seq, idx))
                changed += 1
                if len(seq) == 1:
                    width_fix[seq[0]] += r
                elif len(seq) == 2:
                    pair_fix[(seq[0], seq[1], idx)] += r
                else:
                    base = rules.get((seq, idx))
                    rules[(seq, idx)] = (matching_rule_value(rules, seq, idx) if base is None else base) + r
        log(f"{family} {style}: {changed} corrections; {len(width_fix)} widths, {len(pair_fix)} pairs, {len(rules)} contexts")
        if not changed:
            break
        data = assemble(font, keep_donor, pairs_gpos, width_fix, pair_fix, rules)
    else:
        log(f"{family} {style}: spacing corrections did not settle; verification will report the difference")

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
    """A symbol font from scratch: OFL Noto glyphs at the Office face's codes, widths, and line metrics."""
    from fontTools.fontBuilder import FontBuilder
    office_dir, work, (office_file, table, family, style) = args
    office_path = os.path.join(office_dir, office_file)
    office = TTFont(office_path)
    symbol = next(t for t in office["cmap"].tables if t.platformID == 3 and t.platEncID == 0)
    codes = dict(symbol.cmap)
    dmap = zapf_dingbats() if table == "ZAPF DINGBATS" else {int(k): v for k, v in dingbat_tables()[table].items()}
    if table == "WINGDINGS":
        dmap.setdefault(0xFF, 0x229E)  # the Windows logo has no Unicode character; squared plus is closest
    target = {code: dmap.get(code & 0xFF) for code in codes}
    ogs = office.getGlyphSet()
    inked = [c for c in codes if fill.bounds(ogs, codes[c])]
    donors = [dict(gf_donor(src, *d), map=target) for d in NOTO_SYMBOLS]
    picks = fill.choose(fill.Office(office_path), [c for c in inked if target.get(c)], donors, "symbol", POOL, worker_count())

    names = {code: f"sl.code{code:04X}" for code in sorted(codes)}
    order = [".notdef"] + list(names.values())
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    metrics = {".notdef": (office["hmtx"][office.getGlyphOrder()[0]][0], 0)}
    used = Counter()
    for code, name in names.items():
        pick = picks.get(code)
        pen = TTGlyphPen(None)
        if pick:
            donor = fill.donor_font(*pick["donor"]["font"])
            rec = DecomposingRecordingPen(donor[1])
            donor[1][pick["glyph"]].draw(rec)
            rec.replay(TransformPen(Cu2QuPen(pen, max_err=0.5, reverse_direction=False), pick["transform"]))
            d = pick["donor"]
            used[(d["name"], d["license"], d["notice"])] += 1
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
    name_font(font, family, style, "Glyphs from the Noto fonts, Copyright The Noto Project Authors. Built by SuiteLeaf: "
                                   "scaled and positioned to another font's layout.")
    font["name"].setName("This Font Software is licensed under the SIL Open Font License, Version 1.1.", 13, 3, 1, 0x409)
    font["name"].setName("https://openfontlicense.org", 14, 3, 1, 0x409)
    path = Path(work) / f"{family.replace(' ', '')}-{style.replace(' ', '')}.ttf"
    font.save(path)
    return {"office": office_file, "office_path": office_path, "family": family, "style": style, "path": str(path),
            "script": "symbol", "donors": [list(k) + [v] for k, v in used.items()],
            "unfilled": [hex(c) for c in inked if c not in picks]}


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
        checks = executor.map(suiteleaf_verify.check, [r["office_path"] for r in results], [r["path"] for r in results],
                              [r["script"] for r in results], [r.get("approximate", ()) for r in results])
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
