"""Merge a whole script (Arabic, Hebrew) from a donor font, with its joining and mark rules.

Contextual forms in these scripts change shape and width with their neighbors, so
single glyphs are not enough. The donor is cut down to the script, scaled so its
letters match the Office letters' height, and merged with its own GSUB and GPOS.
The build then sets widths by shaping text in both fonts and adds SuiteLeaf's
spacing rules beside the donor's, instead of replacing them.
"""
import copy
import io
import os
import statistics
import tempfile
import unicodedata

from fontTools import subset
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.merge import Merger, Options
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.scaleUpem import scale_upem
from fontTools.ttLib.tables import otTables
from fontTools.varLib import instancer

import suiteleaf_fill as fill

SCRIPTS = {"ARABIC": "arab", "HEBREW": "hebr"}
LAYOUT = ["ccmp", "locl", "isol", "init", "medi", "fina", "rlig", "liga", "calt", "rclt", "mark", "mkmk", "curs"]


def keep_glyph_names(font):
    """Store glyph names (post format 2); SuiteLeaf's spacing rules refer to glyphs by name."""
    post = font["post"]
    if post.formatType != 2.0:
        post.formatType = 2.0
        post.extraNames = []
        post.mapping = {}


def script_of(cp):
    first = unicodedata.name(chr(cp), "?").split()[0]
    if first.startswith("ARABIC"):
        return "ARABIC"
    return first if first in SCRIPTS else None


def letters_by_script(chars, minimum=20):
    """Characters of each script the face has enough letters of to need its joining rules."""
    found = {}
    for c in chars:
        s = script_of(c)
        if s:
            found.setdefault(s, []).append(c)
    return {s: cps for s, cps in found.items() if sum(unicodedata.category(chr(c)) == "Lo" for c in cps) >= minimum}


def _height(gs, cmap, cps):
    hs = []
    for c in cps:
        g = cmap.get(c)
        b = g and fill.bounds(gs, g)
        if b and b[3] > b[1]:
            hs.append(b[3] - b[1])
    return statistics.median(hs) if hs else None


def prepare(path, coords, cps, office, out_upem, prefix):
    """The donor cut to `cps`, letters scaled to the Office height, glyph names prefixed."""
    font = TTFont(path)
    if coords:
        font = instancer.instantiateVariableFont(font, dict(coords))
    letters = [c for c in cps if unicodedata.category(chr(c)) == "Lo"]
    oh = _height(office.gs, office.cmap, letters)
    dh = _height(font.getGlyphSet(), font.getBestCmap(), letters)
    s = (oh / office.upem) / (dh / font["head"].unitsPerEm)
    opts = subset.Options()
    opts.layout_features = LAYOUT
    opts.drop_tables += ["kern", "STAT", "MVAR", "HVAR", "fvar", "gvar", "avar"]
    opts.hinting = False
    opts.glyph_names = True
    opts.notdef_outline = False
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=[c for c in cps if c in font.getBestCmap()])
    sub.subset(font)
    scale_upem(font, round(out_upem * s))
    font["head"].unitsPerEm = out_upem
    # Rename every glyph before merging so names never collide with the base font.
    buf = io.BytesIO()
    keep_glyph_names(font)
    font.save(buf)
    renamed = TTFont(io.BytesIO(buf.getvalue()), lazy=True)
    renamed.setGlyphOrder([prefix + n for n in renamed.getGlyphOrder()])
    for tag in renamed.keys():
        renamed[tag]
    renamed.lazy = False
    keep_glyph_names(renamed)
    return renamed


def merge(base, donor):
    """Merge donor into base (both TrueType, same units per em); returns the merged font."""
    with tempfile.TemporaryDirectory() as tmp:
        a, b = os.path.join(tmp, "base.ttf"), os.path.join(tmp, "donor.ttf")
        keep_glyph_names(base)
        base.save(a)
        donor.save(b)
        merged = Merger(Options(drop_tables=["vmtx", "vhea"])).merge([a, b])
        out = io.BytesIO()
        keep_glyph_names(merged)
        merged.save(out)
    return TTFont(io.BytesIO(out.getvalue()))


def _shift_lookup_refs(table, offset):
    """Chaining lookups point at other lookups by index; move those indices by `offset`."""
    seen = set()

    def visit(obj):
        if id(obj) in seen or not hasattr(obj, "__dict__"):
            return
        seen.add(id(obj))
        for key, value in vars(obj).items():
            if key.endswith("LookupRecord") and isinstance(value, list):
                for rec in value:
                    rec.LookupListIndex += offset
            elif isinstance(value, list):
                for item in value:
                    visit(item)
            elif hasattr(value, "__dict__"):
                visit(value)

    for lookup in table.LookupList.Lookup:
        visit(lookup)


def promote_extensions(table, tag):
    """Wrap every lookup's subtables in extension subtables, whose 32-bit offsets cannot overflow."""
    ext_type, ext_class = (9, otTables.ExtensionPos) if tag == "GPOS" else (7, otTables.ExtensionSubst)
    for lookup in table.LookupList.Lookup:
        if lookup.LookupType == ext_type:
            continue
        wrapped = []
        for sub in lookup.SubTable:
            ext = ext_class()
            ext.Format = 1
            ext.ExtensionLookupType = lookup.LookupType
            ext.ExtSubTable = sub
            wrapped.append(ext)
        lookup.SubTable = wrapped
        lookup.SubTableCount = len(wrapped)
        lookup.LookupType = ext_type


def compile_layout(glyph_order, fea, tag="GPOS"):
    """A GPOS or GSUB table compiled from feature code against just a glyph order."""
    work = TTFont()
    work.setGlyphOrder(list(glyph_order))
    addOpenTypeFeaturesFromString(work, fea, tables=[tag])
    return work[tag]


def graft_for_scripts(font, layout, scripts):
    """Add a GSUB/GPOS table's lookups to the font, under the given script tags only.

    Each script gets its own feature records, so other scripts never see these lookups;
    where a script's language system already has the feature tag, the lookups join it.
    """
    tag = layout.tableTag
    if tag not in font:
        empty = newTable(tag)
        empty.table = getattr(otTables, tag)()
        empty.table.Version = 0x00010000
        for part, cls in (("ScriptList", otTables.ScriptList), ("FeatureList", otTables.FeatureList), ("LookupList", otTables.LookupList)):
            setattr(empty.table, part, cls())
        empty.table.ScriptList.ScriptRecord, empty.table.FeatureList.FeatureRecord, empty.table.LookupList.Lookup = [], [], []
        font[tag] = empty
    src, dst = copy.deepcopy(layout.table), font[tag].table
    offset = len(dst.LookupList.Lookup)
    _shift_lookup_refs(src, offset)
    dst.LookupList.Lookup += src.LookupList.Lookup
    dst.LookupList.LookupCount = len(dst.LookupList.Lookup)
    features = [(fr.FeatureTag, [i + offset for i in fr.Feature.LookupListIndex]) for fr in src.FeatureList.FeatureRecord]
    records = dst.FeatureList.FeatureRecord
    for script in scripts:
        sr = next((r for r in dst.ScriptList.ScriptRecord if r.ScriptTag == script), None)
        if sr is None:
            sr = otTables.ScriptRecord()
            sr.ScriptTag = script
            sr.Script = otTables.Script()
            sr.Script.LangSysRecord, sr.Script.LangSysCount = [], 0
            sr.Script.DefaultLangSys = None
            dst.ScriptList.ScriptRecord.append(sr)
        if sr.Script.DefaultLangSys is None:
            ls = otTables.DefaultLangSys()
            ls.ReqFeatureIndex, ls.LookupOrder, ls.FeatureIndex = 0xFFFF, None, []
            sr.Script.DefaultLangSys = ls
        for ls in [sr.Script.DefaultLangSys] + [lr.LangSys for lr in sr.Script.LangSysRecord]:
            for ftag, lookups in features:
                have = next((records[i] for i in ls.FeatureIndex if records[i].FeatureTag == ftag), None)
                if have is not None:
                    have.Feature.LookupListIndex = sorted(set(have.Feature.LookupListIndex) | set(lookups))
                    have.Feature.LookupCount = len(have.Feature.LookupListIndex)
                    continue
                fr = otTables.FeatureRecord()
                fr.FeatureTag = ftag
                fr.Feature = otTables.Feature()
                fr.Feature.FeatureParams = None
                fr.Feature.LookupListIndex, fr.Feature.LookupCount = list(lookups), len(lookups)
                records.append(fr)
                ls.FeatureIndex = list(ls.FeatureIndex) + [len(records) - 1]
            ls.FeatureCount = len(ls.FeatureIndex)
    # Feature records sorted by tag, as the specification asks.
    order = sorted(range(len(records)), key=lambda i: records[i].FeatureTag)
    remap = {old: new for new, old in enumerate(order)}
    for sr in dst.ScriptList.ScriptRecord:
        for ls in [sr.Script.DefaultLangSys] + [lr.LangSys for lr in sr.Script.LangSysRecord]:
            if ls is not None:
                ls.FeatureIndex = sorted(remap[i] for i in ls.FeatureIndex)
                if ls.ReqFeatureIndex != 0xFFFF:
                    ls.ReqFeatureIndex = remap[ls.ReqFeatureIndex]
    dst.FeatureList.FeatureRecord = [records[i] for i in order]
    dst.FeatureList.FeatureCount = len(records)
    dst.ScriptList.ScriptRecord.sort(key=lambda r: r.ScriptTag)
    dst.ScriptList.ScriptCount = len(dst.ScriptList.ScriptRecord)


def graft_layout(font, layout):
    """Add another GPOS or GSUB table's lookups to the font's own, inside features of the same tag.

    HarfBuzz applies only the first feature record of a tag in each language system,
    so new lookups join the existing feature rather than a second one.
    """
    tag = layout.tableTag
    src = copy.deepcopy(layout.table)
    if tag not in font:
        font[tag] = newTable(tag)
        font[tag].table = src
        return
    dst = font[tag].table
    offset = len(dst.LookupList.Lookup)
    _shift_lookup_refs(src, offset)
    dst.LookupList.Lookup += src.LookupList.Lookup
    dst.LookupList.LookupCount = len(dst.LookupList.Lookup)
    records = dst.FeatureList.FeatureRecord
    tags = set()
    for fr in src.FeatureList.FeatureRecord:
        lookups = [i + offset for i in fr.Feature.LookupListIndex]
        tags.add(fr.FeatureTag)
        same = [r for r in records if r.FeatureTag == fr.FeatureTag]
        for r in same:
            r.Feature.LookupListIndex = sorted(set(r.Feature.LookupListIndex) | set(lookups))
            r.Feature.LookupCount = len(r.Feature.LookupListIndex)
        if not same:
            fr.Feature.LookupListIndex = lookups
            fr.Feature.LookupCount = len(lookups)
            records.append(fr)

    def langsystems(table):
        for sr in table.ScriptList.ScriptRecord:
            if sr.Script.DefaultLangSys:
                yield sr.Script.DefaultLangSys
            for lr in sr.Script.LangSysRecord:
                yield lr.LangSys

    def default_langsys():
        ls = otTables.DefaultLangSys()
        ls.ReqFeatureIndex = 0xFFFF
        ls.LookupOrder = None
        ls.FeatureIndex = []
        return ls

    existing = {sr.ScriptTag for sr in dst.ScriptList.ScriptRecord}
    for sr in src.ScriptList.ScriptRecord:
        if sr.ScriptTag not in existing:
            new = otTables.ScriptRecord()
            new.ScriptTag = sr.ScriptTag
            new.Script = otTables.Script()
            new.Script.LangSysRecord = []
            new.Script.LangSysCount = 0
            dst.ScriptList.ScriptRecord.append(new)
    # A script with no default language system would hide the grafted features from its text.
    for sr in dst.ScriptList.ScriptRecord:
        if getattr(sr.Script, "DefaultLangSys", None) is None:
            sr.Script.DefaultLangSys = default_langsys()
    dst.ScriptList.ScriptRecord.sort(key=lambda sr: sr.ScriptTag)
    dst.ScriptList.ScriptCount = len(dst.ScriptList.ScriptRecord)

    # Every language system gets the grafted features, then feature records are sorted by tag.
    order = sorted(range(len(records)), key=lambda i: records[i].FeatureTag)
    remap = {old: new for new, old in enumerate(order)}
    for ls in langsystems(dst):
        have = {records[i].FeatureTag for i in ls.FeatureIndex}
        extra = [i for i, r in enumerate(records) if r.FeatureTag in tags and r.FeatureTag not in have]
        ls.FeatureIndex = sorted(remap[i] for i in list(ls.FeatureIndex) + extra)
        ls.FeatureCount = len(ls.FeatureIndex)
        if ls.ReqFeatureIndex != 0xFFFF:
            ls.ReqFeatureIndex = remap[ls.ReqFeatureIndex]
    dst.FeatureList.FeatureRecord = [records[i] for i in order]
    dst.FeatureList.FeatureCount = len(records)


def script_probes(cps):
    """Texts that show every contextual form and every pair of a script's letters."""
    # Presentation forms are already joined and shape on their own; single-character probes cover them.
    letters = [c for c in cps if unicodedata.category(chr(c)) in ("Lo", "Lm") and not 0xFB1D <= c <= 0xFEFF]
    probes = {chr(a) + chr(b) for a in letters for b in letters}
    joiner = "\u0628" if any(0x600 <= c <= 0x6FF for c in letters) else None
    if joiner:
        probes |= {joiner + chr(c) + joiner for c in letters}
    return probes
