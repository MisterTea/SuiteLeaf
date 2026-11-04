"""Substitutions for a SuiteLeaf face: ligatures drawn from our own letters, script variants, and
the Office face's substitution lookups carried over.

Office ligatures become ligatures here too, formed in the Office lookups' order and broken where the
Office face breaks them, so clusters and the kerning against them match. The source's own ligatures
and swaps are cut back where the Office face keeps letters apart.
"""
import io
import unicodedata
from collections import defaultdict

from fontTools.ttLib import TTFont

import suiteleaf_marks as marking
import suiteleaf_merge as merging
import suiteleaf_port as porting
from suiteleaf_glyphs import append_glyphs, draw_ligature, glyph_bounds, outline_copy_shift, reference_copy, set_cmap
from suiteleaf_measure import COMMON
from suiteleaf_positioning import _g
from suiteleaf_shaping import Shaper, char_script, glyph_classes, joined_modifiers, ligature_lookups, text_chars

# Our ligature glyph: the index of the Office lookup that forms its ligature.
LIGATURE_ORDER = {}
# Our ligature glyph: the text it stands for.
LIGATURE_TEXT = {}
# (glyph before, ligature glyph, its letters' glyphs): a presentation-form ligature split after that glyph.
LIGATURE_SPLITS = []
# Our ligature glyph: (its components' glyphs, {mark: [(x, y) on each component]}), where the Office face
# forms it across a mark between its letters.
LIGATURE_ACROSS = {}
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
