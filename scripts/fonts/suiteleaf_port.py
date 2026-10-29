"""Office layout lookups carried over onto our glyphs, for faces whose letters change with their neighbours.

A face like Segoe Script draws each letter with one of several alternates chosen by the letters around
it, and kerns the alternates. Measuring text can only sample that; carrying the Office face's own
contextual-alternate and kerning lookups over makes our glyphs follow it in any text. Each Office glyph
those lookups reach becomes one of ours: a character's glyph, one of our ligatures, or, for an
alternate, a copy of our glyph for the letter it stands for, as wide as the Office alternate.
"""
import io

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.ttLib.scaleUpem import scale_upem
from fontTools.ttLib.tables.otBase import BaseTable


def _single_mappings(table):
    """(source, alternate) pairs of the table's single substitutions."""
    for lookup in table.LookupList.Lookup:
        for st in lookup.SubTable:
            st = st.ExtSubTable if lookup.LookupType == 7 else st
            for src, dst in getattr(st, "mapping", {}).items():
                if isinstance(dst, str):
                    yield src, dst
            for src, alts in getattr(st, "alternates", {}).items():
                for dst in alts:
                    yield src, dst


# Lists that run in step with a subtable's Coverage, one entry for each of its glyphs.
PARALLEL = ("PairSet", "ChainSubRuleSet", "SubRuleSet", "ChainPosRuleSet", "PosRuleSet", "Value")


def sort_coverages(table, glyph_id):
    """Coverage must list glyphs in glyph ID order (HarfBuzz searches it); renamed glyphs keep the Office
    face's order, so each coverage is sorted again, with the lists that follow it."""
    seen = set()

    def visit(obj):
        if id(obj) in seen or not isinstance(obj, BaseTable):
            return
        seen.add(id(obj))
        coverage = getattr(obj, "Coverage", None)
        if coverage is not None and getattr(coverage, "glyphs", None):
            order = sorted(range(len(coverage.glyphs)), key=lambda i: glyph_id(coverage.glyphs[i]))
            for attr in PARALLEL:
                items = getattr(obj, attr, None)
                if isinstance(items, list) and len(items) == len(coverage.glyphs):
                    setattr(obj, attr, [items[i] for i in order])
            coverage.glyphs = [coverage.glyphs[i] for i in order]
        if getattr(obj, "PairValueRecord", None):
            obj.PairValueRecord.sort(key=lambda r: glyph_id(r.SecondGlyph))
        # A context rule of coverages, one for each glyph it matches, has nothing in step with them.
        for key in ("BacktrackCoverage", "InputCoverage", "LookAheadCoverage"):
            for item in getattr(obj, key, None) or []:
                item.glyphs.sort(key=glyph_id)
        for key, value in vars(obj).items():
            if isinstance(value, list):
                for item in value:
                    visit(item)
            elif key != "Coverage":
                visit(value)

    for lookup in table.LookupList.Lookup:
        visit(lookup)


def _ligature_outputs(table):
    """(components, ligature) of the table's ligature substitutions."""
    for lookup in table.LookupList.Lookup:
        for st in lookup.SubTable:
            st = st.ExtSubTable if lookup.LookupType == 7 else st
            for first, ligatures in getattr(st, "ligatures", {}).items():
                for lig in ligatures:
                    yield [first] + list(lig.Component), lig.LigGlyph


def _subset(office_path, features, glyphs, closure):
    office = TTFont(office_path)
    opts = subset.Options()
    opts.layout_features = list(features)
    opts.layout_closure = closure
    opts.glyph_names = True
    opts.notdef_outline = False
    opts.name_IDs, opts.name_languages = [], []
    opts.hinting = False
    sub = subset.Subsetter(opts)
    sub.populate(glyphs=sorted(glyphs))
    sub.subset(office)
    return office


def port_layout(font, office_path, units, cmap, ligature_glyphs, features, add_copy, add_ligature):
    """Graft the Office face's lookups for `features` (such as calt and kern) onto `font`.

    cmap: our {character: glyph}; ligature_glyphs: {Office glyph name: our ligature glyph};
    add_copy(base glyph, name, advance) draws a copy of our glyph; add_ligature(glyphs, name, advance) draws
    a ligature of ours for one only the carried lookups form (s_s inside a word in Segoe Script).
    -> ({Office glyph: our glyph}, {"GSUB"/"GPOS": table in our glyph names})"""
    office = TTFont(office_path)
    office_cmap = office.getBestCmap() or {}
    scale = units / office["head"].unitsPerEm
    names = {g: cmap[c] for c, g in sorted(office_cmap.items(), reverse=True) if c in cmap}
    names.update(ligature_glyphs)
    # Everything the lookups can reach from our characters' and ligatures' glyphs.
    reached = _subset(office_path, features, names, closure=True)
    hmtx = reached["hmtx"].metrics
    sources = list(_single_mappings(reached["GSUB"].table)) if "GSUB" in reached else []
    joins = list(_ligature_outputs(reached["GSUB"].table)) if "GSUB" in reached else []
    grew = True
    while grew:
        grew = False
        for src, dst in sources:
            if src in names and dst not in names:
                base = names[src].split(".slo")[0]
                names[dst] = f"{base}.slo{len(names)}"
                add_copy(base, names[dst], round(hmtx[dst][0] * scale))
                grew = True
        for parts, lig in joins:
            if lig not in names and all(p in names for p in parts):
                names[lig] = f"sl.ligo{len(names)}"
                add_ligature([names[p] for p in parts], names[lig], round(hmtx[lig][0] * scale))
                grew = True
    # Two Office glyphs drawn with one of ours would collide in the glyph order: the first keeps it.
    taken, kept = set(), {}
    for g in reached.getGlyphOrder():
        if g in names and names[g] not in taken:
            kept[g] = names[g]
            taken.add(names[g])
    ported = _subset(office_path, features, kept, closure=False)
    if units != ported["head"].unitsPerEm:
        scale_upem(ported, units)
    buf = io.BytesIO()
    ported.save(buf)
    # Read the lookups back with our glyph names in place of the Office face's.
    renamed = TTFont(io.BytesIO(buf.getvalue()))
    order = [kept.get(g, f".slo.unused{n}") for n, g in enumerate(ported.getGlyphOrder())]
    renamed.setGlyphOrder(order)
    tables = {tag: renamed[tag] for tag in ("GSUB", "GPOS") if tag in renamed}
    return kept, tables
