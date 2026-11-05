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
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.scaleUpem import scale_upem
from fontTools.ttLib.tables.otBase import OTLOffsetOverflowError
from fontTools.varLib import instancer

import suiteleaf_fill as fill
import suiteleaf_marks as marking
import suiteleaf_measure as measuring
import suiteleaf_merge as merging
import suiteleaf_sources
import suiteleaf_verify
from suiteleaf_families import (APPROXIMATE_SCRIPTS, FACES, NOTO_SYMBOLS, SYMBOL_FACES, donors_for, gf_donor, merges_for,
                                 zapf_dingbats)
from suiteleaf_glyphs import (append_glyphs, decompose_glyf, glyph_bounds, has_feature, height_factor, mark_glyphs,
                              name_font, office_face_path, outline_copy_shift, reference_copy, set_cmap,
                              set_glyph_classes, set_line_metrics, size_factor, split_by_class, split_by_spacing,
                              strip_hinting)
from suiteleaf_ligatures import (LIGATURE_ACROSS, LIGATURE_FEATURES, LIGATURE_SPLITS, across_rules, add_ligatures,
                                 add_script_variants, decompose_rules, drop_latin_swaps, graft_script_variants,
                                 ligature_mark_fea, ligature_rules, port_office_layout, prune_ligatures)
from suiteleaf_measure import COMMON, _accent_job, _chunks, _fixes_job, _map, learn_advances, office_pairs
from suiteleaf_positioning import FEA_HEADER, Rules, _g, assemble, hidden_fea, matching_rule_value, pairs_fea
from suiteleaf_shaping import Shaper, char_script, glyph_classes, ligature_contexts, same_run, text_chars, worker_count

REPO = Path(__file__).resolve().parents[2]
DEFAULT_OFFICE = "/Applications/Microsoft Word.app/Contents/Resources/DFonts"
SRC = suiteleaf_sources.DEFAULT_CACHE
# Scripts whose letters take combining marks in text; marks are measured on their letters.
MARKED_SCRIPTS = {"Latn", "Grek", "Cyrl"} | COMMON
# Pairs of letters probed with a mark between, for each of kerned and unkerned text.
KERNED_PROBES = 500
# The most a glyph is stretched or squeezed toward its Office advance.
MAX_STRETCH = 1.25
# Donor families each SuiteLeaf family has used so far, so its other faces try them first.
DONORS_USED = {}


def log(message):
    print(message, file=sys.stderr, flush=True)


def src(path):
    return str(Path(SRC) / path)


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
                            measuring.POOL, worker_count(), DONORS_USED.setdefault(family, []))
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
    from suiteleaf_math import copy_math_metrics
    copy_math_metrics(out, office)
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
        measuring.POOL = executor
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
