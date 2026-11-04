"""Positioning feature code for a SuiteLeaf face, and the face assembled with it.

Pair spacing, the corrections found by shaping, mark placement, and the glyph after a soft hyphen
are written as feature code, compiled on the worker pool, and grafted onto a copy of the face.
"""
import copy
import io
import unicodedata
from collections import defaultdict

from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables.otBase import OTLOffsetOverflowError

import suiteleaf_merge as merging
from suiteleaf_glyphs import mark_glyphs
from suiteleaf_measure import COMMON, _map
from suiteleaf_shaping import Shaper, char_script

CONTEXT_LOOKUP_RULES = 7000
FEA_HEADER = ["languagesystem DFLT dflt;", "languagesystem latn dflt;", "languagesystem thai dflt;"]
# Scripts whose letters do not join: a different glyph after another is an alternate, not a joining form.
CASED_SCRIPTS = {"Latn", "Grek", "Cyrl", "Armn", "Geor"}
# Accent rules feaLib packs into one subtable at a time, and the most rules of base classes, which take a
# subtable each, that a lookup's 16-bit subtable offsets hold.
ACCENT_RULES = 1000
GROUPED_ACCENT_RULES = 6000


def _g(name):
    return "\\" + name


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
