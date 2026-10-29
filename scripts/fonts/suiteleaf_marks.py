"""Combining marks drawn and placed as the Office face draws and places them, measured from its shaping.

The Office face may draw a mark with another glyph depending on what comes before it (a flatter accent
over a capital, another over a preceding accent). Each such Office glyph gets a glyph here, a copy of
our mark, chosen by the same preceding glyph. Measuring texts outward from each base (base, base and
mark, base and two marks) says which glyph the Office face uses for each mark and where it puts it:
on the base (mark-to-base anchors) or on the mark before it (mark-to-mark anchors). Marks whose
offsets differ by one vector on the same bases share an anchor class.

Precomposed letters the Office face splits into base and mark before another mark are split here,
and letters it swaps for another of its letters before a mark (i for dotless i) are swapped.
"""
import unicodedata
from collections import Counter, defaultdict

from fontTools.ttLib import TTFont

from suiteleaf_shaping import Shaper

# Marks stacked on a base: base, then up to this many marks.
DEPTH = 3
# Texts measured for each mark glyph that a further mark may follow.
WITNESSES = 3
# Letters often kerned against the letter before them.
KERN_PROBES = "TVWYAvwyfj"


def invisible(c):
    """Spaces and default-ignorable characters, which HarfBuzz may draw with the space glyph."""
    return (unicodedata.category(chr(c)) in ("Zs", "Zl", "Zp", "Cf", "Cc") or c in (0x034F, 0x115F, 0x1160, 0x3164, 0xFFA0)
            or 0x180B <= c <= 0x180F or 0xFE00 <= c <= 0xFE0F or 0xE0100 <= c <= 0xE01EF)


def marks_of(classes, office_cmap, chars, attached=()):
    """Characters the Office face treats as marks: by its glyph classes as HarfBuzz uses them, else Unicode's
    and those its mark lookups attach (`attached` glyphs: Tahoma's rhotic hook U+02DE)."""
    if classes:
        return [c for c in chars if classes.get(office_cmap.get(c)) == 3]
    return [c for c in chars if unicodedata.category(chr(c)) in ("Mn", "Me") or office_cmap.get(c) in attached]


def attached_glyphs(office_path):
    """Glyphs the Office face's mark-to-base and mark-to-mark lookups attach."""
    font = TTFont(office_path)
    if "GPOS" not in font:
        return set()
    out = set()
    for lookup in font["GPOS"].table.LookupList.Lookup:
        for st in lookup.SubTable:
            st = st.ExtSubTable if lookup.LookupType == 9 else st
            for attr in ("MarkCoverage", "Mark1Coverage"):
                coverage = getattr(st, attr, None)
                if coverage is not None:
                    out.update(coverage.glyphs)
    return out


ABOVE = {228, 230, 232, 234}
BELOW = {202, 218, 220, 222, 233, 240}


def _side(c):
    """Above, below, or neither (overlays), by canonical combining class."""
    ccc = unicodedata.combining(chr(c))
    return "above" if ccc in ABOVE else "below" if ccc in BELOW else "other"


def _g(name):
    return "\\" + name


def _in_subtables(rules, size=200):
    """Rules split into subtables, which HarfBuzz tries in order, as it tries the rules of one."""
    out = []
    for n, rule in enumerate(rules):
        if n and n % size == 0:
            out.append("  subtable;")
        out.append(rule)
    return out


def _anchor(p):
    return f"<anchor {round(p[0])} {round(p[1])}>"


class Marks:
    def __init__(self, office_path, units, cmap, bases, marks, classes):
        self.sh = Shaper(office_path, units)
        self.classes = classes
        self.cmap = cmap
        self.marks = marks
        self.nominal = {}
        for c in bases + marks:
            infos = self.sh.shape(chr(c)).glyph_infos
            if len(infos) == 1:
                self.nominal[c] = infos[0].codepoint
        # HarfBuzz draws invisible characters with the space glyph; no letter is swapped for those.
        self.by_glyph = {}
        for c, g in sorted(self.nominal.items()):
            if not invisible(c):
                self.by_glyph.setdefault(g, c)
        self.mark_glyphs = {self.nominal[m] for m in marks if m in self.nominal}
        # Marks that block composing a base with a mark on the other side.
        self.blockers = {"above": [x for x in (0x0331, 0x0332, 0x0320, 0x0329) if x in marks],
                         "below": [x for x in (0x0305, 0x030D, 0x0304) if x in marks]}
        self.copies = {}            # our copy name: our glyph it copies
        self.widths = {}            # our copy name: its advance, where it differs from the glyph it copies
        self.advances = defaultdict(set)  # mark copy: its advances where measured
        self.office_glyph = {}            # mark copy: the Office glyph it stands for
        self.placed = defaultdict(dict)   # mark glyph: {base glyph: (x, y)}
        self.stacked = defaultdict(lambda: defaultdict(set))  # mark glyph: {previous mark glyph: {(x, y)}}
        self.after = defaultdict(set)     # mark copy: glyphs it follows
        self.outcomes = defaultdict(Counter)  # (glyph before, mark): {our glyph for the mark: times seen}
        self.outcomes2 = defaultdict(Counter)  # (base, mark before, mark): the same, where the base matters
        self.joined = defaultdict(Counter)     # (base, mark): {our glyph for the mark after a joiner: times seen}
        self.swaps = defaultdict(set)     # (base glyph, other base glyph): marks
        self.swap_between = defaultdict(set)  # (base glyph, other base glyph): marks it still swaps across
        self.splits = defaultdict(lambda: defaultdict(set))  # base glyph: {(parts): marks before which it splits so}
        self.split_glyphs = {}            # precomposed letter: the Office glyphs it splits into
        self.always = {}                  # base glyph: (parts) the Office face draws it as, alone too
        self.late = defaultdict(dict)     # mark glyph after other marks: {base glyph: (x, y)}
        self.free = defaultdict(dict)     # mark glyph: {base glyph: (x, y)} with something between them
        self.seen_after = {}              # (base, mark before, mark): where it sat relative to the base
        self.loose = defaultdict(set)     # mark glyph: bases the Office face leaves it unattached on
        self.ahead = defaultdict(Counter)  # (mark glyph, mark after it): {our glyph for the first: times seen}
        self.direct = {}                  # (base, mark) drawn as two glyphs: (our base glyph, Office glyphs)
        self.decomposed = set()           # precomposed letters drawn as base and marks even alone
        self.through = defaultdict(set)   # (base, mark, its glyph there): marks on the other side it keeps it across
        self.conflicts = 0

    def shape(self, text):
        buf = self.sh.shape(text)
        return [i.codepoint for i in buf.glyph_infos], buf.glyph_positions

    def base_name(self, b, glyph, advance):
        """Our glyph for the base the Office face drew with `glyph`: another letter's, its own, or a copy
        of its own as wide as the Office glyph, which marks may sit on elsewhere (a dotless i with a bar)."""
        other = self.by_glyph.get(glyph)
        if other == b:
            return self.cmap[b], False
        if other is not None and other in self.cmap and glyph not in self.mark_glyphs:
            return self.cmap[other], True
        if glyph != self.nominal.get(b) and other is None:
            name = f"{self.cmap[b]}.slb{glyph}"
            self.copies[name] = self.cmap[b]
            self.widths[name] = advance
            return name, True
        return self.cmap[b], False

    def held(self, text, advance):
        """Whether a base and mark drawn where the base's advance ends keep it there when a letter after
        them kerns the base: the mark is attached, not drawn after the base."""
        for z in KERN_PROBES:
            buf = self.sh.shape(text + z)
            pos = buf.glyph_positions
            if len(pos) == 3 and pos[0].x_advance != advance:
                return pos[1].x_offset == advance - pos[0].x_advance
        return False

    def partial_split(self, parts, glyphs):
        """What a precomposed letter (its canonical `parts`) is drawn as with the Office `glyphs`: a letter
        keeping its first marks and its other marks, or the characters whose glyphs those are.
        -> (head character, [mark characters]) or None"""
        n = len(glyphs) - 1
        if 1 <= n < len(parts) - 1:
            tail = parts[len(parts) - n:]
            head = unicodedata.normalize("NFC", "".join(map(chr, parts[:len(parts) - n])))
            if (len(head) == 1 and ord(head) in self.cmap and all(p in self.nominal for p in tail)
                    and glyphs[0] == self.nominal.get(ord(head))):
                return ord(head), tail
        drawn = [self.by_glyph.get(g) for g in glyphs]
        if (drawn[0] is not None and drawn[0] in self.cmap
                and all(c is not None and c in self.nominal and c in self.marks for c in drawn[1:])):
            return drawn[0], drawn[1:]
        return None

    def mark_name(self, m, glyph):
        """Our glyph for mark m drawn with the Office glyph: our mark, another mark's own glyph, or a copy.
        Without classes HarfBuzz uses (Courier New, Tahoma), a mark keeps its one glyph."""
        if glyph == self.nominal.get(m) or not self.classes:
            return self.cmap[m]
        if glyph in self.mark_glyphs:
            # A canonically equivalent mark (U+0340 for U+0300) is drawn with the other's own glyph.
            other = self.by_glyph[glyph]
            if other in self.cmap and unicodedata.normalize("NFD", chr(m)) == chr(other):
                return self.cmap[other]
        name = f"{self.cmap[m]}.slm{glyph}"
        self.copies[name] = self.cmap[m]
        self.office_glyph[name] = glyph
        return name

    def measure(self, bases):
        """Base and one mark for every pair; then further marks after each mark glyph found, on a few
        of the texts that produced it, up to DEPTH marks."""
        witnesses = defaultdict(list)   # our mark glyph: [(text, Office glyphs, positions)]
        swapped_by = []                 # (base, mark, Office glyph, our glyph) where the mark swaps the base
        triggers = []                   # the same, for every swap, the composed ones too
        for b in bases:
            # A precomposed letter the Office face draws as base and marks even alone (Cambria's á), or as a
            # letter keeping some marks and the others (Ǭ as Ǫ and a macron).
            parts = [ord(ch) for ch in unicodedata.normalize("NFD", chr(b))]
            glyphs, pos = self.shape(chr(b)) if b not in self.nominal else ([], [])
            tail = parts[len(parts) - len(glyphs) + 1:] if 1 < len(glyphs) <= len(parts) else []
            head = unicodedata.normalize("NFC", "".join(map(chr, parts[:len(parts) - len(tail)]))) if tail else ""
            if not (len(head) == 1 and ord(head) in self.cmap) and len(glyphs) > 1:
                # Not by its canonical parts (ẚ as a and a combining half ring): by the characters whose glyphs it draws.
                drawn = [self.by_glyph.get(g) for g in glyphs]
                if drawn[0] is not None and all(c is not None and c in self.nominal and c in self.marks for c in drawn[1:]):
                    head, tail = chr(drawn[0]), drawn[1:]
            if (len(head) == 1 and ord(head) in self.cmap and all(p in self.cmap and p in self.nominal for p in tail)
                    and glyphs[0] not in self.mark_glyphs):
                # The base as the Office face draws it there (a dotless i under a grave).
                base, _ = self.base_name(ord(head), glyphs[0], pos[0].x_advance)
                self.always[self.cmap[b]] = (base,) + tuple(self.mark_name(p, g) for p, g in zip(tail, glyphs[1:]))
                # Its glyphs come from that substitution, not from what precedes each mark.
                self.decomposed.add(chr(b))
                for i, p in enumerate(tail, 1):
                    self.record(chr(b), glyphs, pos, base, i, witnesses if i == len(tail) else None, p,
                                before=tail[i - 2] if i > 1 else None, counted=False)
            if b not in self.nominal:
                continue
            for m in self.marks:
                if m not in self.nominal:
                    continue
                text = chr(b) + chr(m)
                glyphs, pos = self.shape(text)
                # Where the mark sits on the base when nothing composes or splits them, which another
                # mark between them can cause: a combining grapheme joiner, looked past, shows it.
                self.blocked(b, m)
                if len(glyphs) >= 3 and glyphs[0] != self.nominal[b]:
                    parts = [ord(ch) for ch in unicodedata.normalize("NFD", chr(b))]
                    # HarfBuzz orders marks by combining class; only an order it leaves alone says
                    # which glyph is which mark.
                    classes = [unicodedata.combining(chr(c)) for c in parts[1:] + [m]]
                    # Or its own substitution splits the letter, which normalizing had composed again (the
                    # face has it), keeping the parts' order (Cambria Math's À and a grave below).
                    # Only a glyph of another of these marks says they moved (Ģ's cedilla may be a comma below's).
                    drawn = [self.by_glyph.get(g) for g in glyphs[1:]]
                    typed = parts[1:] + [m]
                    in_order = (all(d is None or d == p or d not in typed for d, p in zip(drawn, typed))
                                or self.split_glyphs.get(b) == glyphs[:-1])
                    if (len(parts) == len(glyphs) - 1 and all(p in self.cmap for p in parts)
                            and all(p in self.nominal for p in parts[1:]) and (classes == sorted(classes) or in_order)):
                        base, _ = self.base_name(parts[0], glyphs[0], pos[0].x_advance)
                        names = (base,) + tuple(self.mark_name(p, g) for p, g in zip(parts[1:], glyphs[1:]))
                        self.splits[self.cmap[b]][names].add(self.cmap[m])
                        self.split_glyphs.setdefault(b, glyphs[:-1])
                        for i, p in enumerate(parts[1:], 1):
                            self.record(text, glyphs, pos, base, i, None, p, before=parts[i - 1] if i > 1 else None,
                                        counted=False)
                        self.record(text, glyphs, pos, base, len(parts), witnesses, before=parts[-1])
                    elif self.by_glyph.get(glyphs[-1]) in (None, m) and all(p in self.cmap for p in parts):
                        split = self.partial_split(parts, glyphs[:-1])
                        if split:
                            # Drawn as a letter keeping some marks and the others (Ǭ as Ǫ and a macron), or as
                            # the characters whose glyphs it draws (ẚ as a and a half ring).
                            head, tail = split
                            base, _ = self.base_name(head, glyphs[0], pos[0].x_advance)
                            names = (base,) + tuple(self.mark_name(p, g) for p, g in zip(tail, glyphs[1:-1]))
                            for i, p in enumerate(tail, 1):
                                self.record(text, glyphs, pos, base, i, None, p, before=tail[i - 2] if i > 1 else None,
                                            counted=False)
                            self.record(text, glyphs, pos, base, len(glyphs) - 1, witnesses, before=tail[-1])
                        else:
                            # Drawn with a glyph for two of its marks (Ố's circumflex and acute): ours splits it
                            # all, and the mark typed after is placed where the Office face puts it.
                            names = tuple(self.cmap[p] for p in parts)
                        self.splits[self.cmap[b]][names].add(self.cmap[m])
                    continue
                if len(glyphs) == 1:
                    continue
                # A mark that decomposes (U+0344 is a diaeresis and an acute) draws a glyph for each part.
                parts = [ord(ch) for ch in unicodedata.normalize("NFD", chr(m))]
                if len(parts) > 1 and len(glyphs) == 1 + len(parts) and all(p in self.nominal for p in parts):
                    # Where normalizing composes its first part with the base (a and U+0344 are ä and an acute),
                    # its glyphs say nothing of what follows the base otherwise.
                    base, _ = self.base_name(b, glyphs[0], pos[0].x_advance)
                    composes = unicodedata.normalize("NFC", chr(b) + chr(parts[0])) != chr(b) + chr(parts[0])
                    for j, part in enumerate(parts):
                        self.record(text, glyphs, pos, base, 1 + j, witnesses if j == len(parts) - 1 else None, part,
                                    before=parts[j - 1] if j else None, counted=not composes)
                    continue
                if len(glyphs) != 2:
                    continue
                nfc = unicodedata.normalize("NFC", text)
                composed = len(nfc) == 2 and nfc != text and all(ord(ch) in self.cmap for ch in nfc) and ord(nfc[0]) in self.nominal
                # HarfBuzz composes only what changes the glyphs (it keeps a singleton like U+1FEF).
                if composed and glyphs[0] != self.nominal[b] and (
                        glyphs[0] == self.nominal[ord(nfc[0])] or self.by_glyph.get(glyphs[0]) is None):
                    # Normalizing composed the mark with the base and left another (ä and a dot below
                    # become ạ and a diaeresis); ours normalizes the same way.
                    b2, m2 = ord(nfc[0]), ord(nfc[1])
                    base, swapped = self.base_name(b2, glyphs[0], pos[0].x_advance)
                    if swapped:
                        self.swaps[(self.cmap[b2], base)].add(self.cmap[m2])
                        triggers.append((b2, m2, glyphs[0], base))
                    self.record(nfc, glyphs, pos, base, 1, witnesses)
                    continue
                base, swapped = self.base_name(b, glyphs[0], pos[0].x_advance)
                if swapped:
                    self.swaps[(self.cmap[b], base)].add(self.cmap[m])
                    swapped_by.append((b, m, glyphs[0], base))
                    triggers.append((b, m, glyphs[0], base))
                self.direct[(b, m)] = (base, glyphs)
                self.record(text, glyphs, pos, base, 1, witnesses)
        # The marks the Office face still swaps the base across, coming between it and the mark (a mark
        # below before a mark above); others keep it (a dotted i before a comma below and a dot above).
        for b, trigger, glyph, base in triggers:
            for x in self.marks:
                text = chr(b) + chr(x) + chr(trigger)
                # Only where normalizing keeps the mark before the trigger (it may compose with the base).
                if x == trigger or x not in self.nominal or not unicodedata.normalize("NFD", text).endswith(chr(x) + chr(trigger)):
                    continue
                glyphs, _ = self.shape(text)
                if len(glyphs) == 3 and glyphs[0] == glyph:
                    self.swap_between[(self.cmap[b], base)].add(self.cmap[x])
        # A mark the Office face draws with a glyph of its own after a base may keep it across a mark on the
        # other side (Ṿ's acute is V's capital one after a dot below, not after a macron below).
        sides = {s: [x for x in self.marks if x in self.nominal and _side(x) == s] for s in ("above", "below")}
        for (b, m), (base, glyphs) in self.direct.items():
            name = self.mark_name(m, glyphs[1])
            if ".slm" not in name or _side(m) not in sides:
                continue
            for x in sides["below" if _side(m) == "above" else "above"]:
                text = chr(b) + chr(x) + chr(m)
                if not unicodedata.normalize("NFD", text).endswith(chr(x) + chr(m)):
                    continue
                g, _ = self.shape(text)
                if len(g) == 3 and g[0] == glyphs[0] and g[2] == glyphs[1]:
                    # Ours draws the mark between with its own glyph, or the copy chosen after the base.
                    self.through[(base, self.cmap[m], name)] |= {self.cmap[x], self.mark_name(x, g[1])}
        # A mark on the other side, which comes first, sits on the glyph the swap gives.
        for b, trigger, glyph, base in swapped_by:
            for m in self.marks:
                if m not in self.nominal or _side(m) in (None, _side(trigger)):
                    continue
                text = chr(b) + chr(m) + chr(trigger)
                if unicodedata.normalize("NFC", text) != text:
                    continue
                glyphs, pos = self.shape(text)
                if len(glyphs) == 3 and glyphs[0] == glyph and (glyphs[1] in self.mark_glyphs or glyphs[1] not in self.by_glyph):
                    self.record(text, glyphs, pos, base, 1, None, m)
                    self.record(text, glyphs, pos, base, 2, None, trigger, before=m)
        frontier = dict(witnesses)
        for depth in range(2, DEPTH + 1):
            found = defaultdict(list)
            for name, texts in frontier.items():
                # Texts on letters first, plain ones before accented: what marks are stacked on.
                letter_first = sorted(texts, key=lambda t: (not unicodedata.category(t[0][0]).startswith("L"),
                                                            unicodedata.decomposition(t[0][0]) != "", ord(t[0][0])))
                # Every letter the Office face draws as base and mark gets one more: what follows its mark
                # may depend on the letter (after ḟ's dot an acute stays its own glyph, unattached).
                chosen = letter_first[:WITNESSES] + [t for t in letter_first[WITNESSES:] if depth == 2 and t[0] in self.decomposed]
                for text, glyphs, pos, base in chosen:
                    for m in self.marks:
                        more, mpos = self.shape(text + chr(m))
                        # A mark that decomposes (U+0344 is a diaeresis and an acute) adds a glyph for each part.
                        parts = [ord(ch) for ch in unicodedata.normalize("NFD", chr(m))]
                        if any(p not in self.cmap for p in parts):
                            continue
                        if len(more) != len(glyphs) + len(parts):
                            continue
                        last = ord(unicodedata.normalize("NFD", text)[-1])
                        i = len(glyphs) - 1
                        # Only where the marks keep their order (HarfBuzz sorts them by combining class), each
                        # glyph is still its own mark's (a, a grave below and a grave may draw as a, grave, grave
                        # below), and the new mark composes nothing the Office face has (Ü and a macron are Ǖ).
                        composed = unicodedata.normalize("NFC", text + chr(m))
                        kept = (unicodedata.normalize("NFD", text + chr(m)).endswith(chr(last) + chr(m))
                                and self.by_glyph.get(more[i]) in (None, last) and self.by_glyph.get(more[i + 1]) in (None, m)
                                and (composed == unicodedata.normalize("NFC", text) + chr(m)
                                     or not all(self.sh.font.get_nominal_glyph(ord(ch)) for ch in composed)))
                        if i > 0 and len(parts) == 1 and last in self.cmap and unicodedata.combining(chr(last)) and kept:
                            if more[:i] == glyphs[:i] and more[i] != glyphs[i]:
                                # The mark before drawn otherwise ahead of this one (Dubai's macron before a grave).
                                self.ahead[(self.mark_name(last, glyphs[i]), self.cmap[m])][self.mark_name(last, more[i])] += 1
                                self.record(text + chr(m), more, mpos, base, i, None, last, counted=False)
                                self.record(text + chr(m), more, mpos, base, i + 1, found, m, before=last)
                                continue
                            if more[:len(glyphs)] == glyphs:
                                self.ahead[(self.mark_name(last, glyphs[i]), self.cmap[m])][self.mark_name(last, glyphs[i])] += 1
                        if more[:len(glyphs)] != glyphs:
                            continue
                        for j, part in enumerate(parts):
                            i = len(glyphs) + j
                            self.record(text + chr(m), more, mpos, base, i, found if j == len(parts) - 1 else None, part,
                                        before=parts[j - 1] if j else last)
            frontier = found

    def blocked(self, b, m):
        """Where the Office face puts mark m on base b with something between them that composes and splits
        nothing: a combining grapheme joiner, which it looks past, and a mark on the other side of the base,
        after which it may draw m with another glyph (an accent over a capital that keeps its own accent)."""
        texts = [chr(b) + "\u034f" + chr(m)]
        # Not where the base and the mark between compose or reorder into another base and mark.
        texts += [chr(b) + chr(x) + chr(m) for x in self.blockers.get(_side(m), ())
                  if unicodedata.normalize("NFC", chr(b) + chr(x)) == chr(b) + chr(x)
                  and len(self.shape(chr(b) + chr(x))[0]) == 2][:1]
        found = set()
        for text in texts:
            glyphs, pos = self.shape(text)
            if len(glyphs) != 3:
                continue
            # The mark between may move it; it only tells where a glyph the joiner did not show sits.
            if text[1] != "\u034f" and glyphs[2] in found:
                continue
            found.add(glyphs[2])
            if (pos[2].x_offset, pos[2].y_offset) == (0, 0):
                self.loose[self.mark_name(m, glyphs[2])].add(self.base_name(b, glyphs[0], pos[0].x_advance)[0])
                if text[1] == "\u034f":
                    # Loose on the base: where a mark between puts it says nothing of where it sits here.
                    return
                continue
            base, swapped = self.base_name(b, glyphs[0], pos[0].x_advance)
            # A base the joiner's own normalizing gives (a Kelvin sign is a K before any mark) is no swap.
            normalized = self.by_glyph.get(glyphs[0]) == ord(unicodedata.normalize("NFD", chr(b))[0])
            if swapped and text[1] == "\u034f" and not normalized:
                self.swaps[(self.cmap[b], base)].add(self.cmap[m])
            name = self.mark_name(m, glyphs[2])
            # Which glyph follows the base across a joiner, or follows the mark between them.
            if text[1] == "\u034f":
                self.joined[(base, m)][name] += 1
            else:
                self.outcomes[(self.mark_name(ord(text[1]), glyphs[1]), m)][name] += 1
            x = pos[0].x_advance + pos[1].x_advance + pos[2].x_offset - pos[0].x_offset
            self.free[name].setdefault(base, (x, pos[2].y_offset - pos[0].y_offset))

    def record(self, text, glyphs, pos, base, i, witnesses, m=None, before=None, counted=True):
        """The mark glyph at index i (mark m, else the last character typed or the mark drawn with that
        glyph): which glyph, after what (the mark `before` it, when a split gave it), and where relative
        to the base and the glyph before it. A glyph the mark after it chose is not `counted` as the one
        drawn after the glyph before."""
        if m is None and i == len(glyphs) - 1:
            m = ord(text[-1])
        if m is None:
            m = self.by_glyph.get(glyphs[i])
            if m is None:
                return
        name = self.mark_name(m, glyphs[i])
        if name in self.copies and ".slm" in name:
            self.advances[name].add(pos[i].x_advance)
        x = [0]
        for p in pos:
            x.append(x[-1] + p.x_advance)
        at = lambda k: (x[k] + pos[k].x_offset, pos[k].y_offset)
        mine, base_at = at(i), at(0)
        if i == 1:
            previous = base
        else:
            pm = before or self.by_glyph.get(glyphs[i - 1])
            if pm is None and i - 1 == len(glyphs) - 2:
                pm = ord(text[-2])
            if pm is None or pm not in self.cmap:
                return
            previous = self.mark_name(pm, glyphs[i - 1])
        if counted:
            self.outcomes[(previous, m)][name] += 1
        if counted and i == 2:
            self.outcomes2[(base, previous, m)][name] += 1
        if (pos[i].x_offset, pos[i].y_offset) == (0, 0):
            if i == 1 and len(text) == 2 and len(glyphs) == 2 and self.held(text, pos[0].x_advance):
                # Attached where the base's advance ends: kerning after it leaves it there.
                self.placed[name][base] = (mine[0] - base_at[0], mine[1] - base_at[1])
            elif i == 1:
                # Drawn where the base's advance leaves it: loose on this base, as with a joiner between.
                self.loose[name].add(base)
        elif i == 1:
            self.placed[name][base] = (mine[0] - base_at[0], mine[1] - base_at[1])
        else:
            prev_at = at(i - 1)
            self.stacked[name][previous].add((mine[0] - prev_at[0], mine[1] - prev_at[1]))
            self.late[name][base] = (mine[0] - base_at[0], mine[1] - base_at[1])
            self.seen_after[(base, previous, name)] = self.late[name][base]
            on_base = self.placed.get(name, {}).get(base)
            if on_base is not None and on_base == self.late[name][base]:
                self.stacked[name][previous].add(None)
        if witnesses is not None:
            witnesses[name].append((text, glyphs, pos, base))


def _classes(placed):
    """Group marks whose placements differ by one vector on the same bases.
    -> [(mark anchors {mark: (x, y)}, base anchors {base: (x, y)})]"""
    classes = []
    for m in sorted((m for m in placed if placed[m]), key=lambda m: (-len(placed[m]), m)):
        offsets = placed[m]
        for marks, bases, ref in classes:
            if offsets.keys() != placed[ref].keys():
                continue
            shift = {(placed[ref][b][0] - offsets[b][0], placed[ref][b][1] - offsets[b][1]) for b in offsets}
            if len(shift) == 1:
                marks[m] = shift.pop()
                break
        else:
            classes.append(({m: (0, 0)}, dict(offsets), m))
    return [(marks, bases) for marks, bases, _ in classes]


def _attach(kind, placed, prefix):
    """One lookup per anchor class, so each base carries only the anchors it has. -> (lines, lookups)"""
    lines, lookups = [], []
    for n, (marks, bases) in enumerate(_classes(placed)):
        cls, name = f"@{prefix}{n}", f"{prefix}{n}"
        lines += [f"markClass [{_g(g)}] {_anchor(a)} {cls};" for g, a in sorted(marks.items())]
        lines.append(f"lookup {name} {{")
        lines += [f"  pos {kind} {_g(b)} {_anchor(p)} mark {cls};" for b, p in sorted(bases.items())]
        lines.append(f"}} {name};")
        lookups.append(name)
    return lines, lookups


def _fallback_widths(k, cmap, marks):
    """HarfBuzz's fallback takes away the advance of every mark after a base in the Office face. Ours keeps
    the advances; spacing measured between characters takes the first mark's away from the glyph before
    it, and this takes each later mark's away from the mark before it (a decomposed U+0344's acute)."""
    by_width = defaultdict(set)
    for m in marks:
        if m in k.nominal:
            by_width[k.sh.font.get_glyph_h_advance(k.nominal[m])].add(cmap[m])
    for name, glyph in k.office_glyph.items():
        by_width[k.sh.font.get_glyph_h_advance(glyph)].add(name)
    mark_names = set().union(*by_width.values()) if by_width else set()
    bases = sorted({g for g in cmap.values() if g not in mark_names} | {n for n in k.copies if ".slb" in n})
    if not bases or not any(w for w in by_width):
        return []
    lines = [f"@SLfallbackbase = [{' '.join(_g(g) for g in bases)}];",
             f"@SLfallbackmark = [{' '.join(_g(g) for g in sorted(mark_names))}];", "lookup SLmarkwidths {"]
    for w, names in sorted(by_width.items()):
        if w:
            after = f"[{' '.join(_g(g) for g in sorted(names))}]"
            lines += [f"  pos @SLfallbackbase @SLfallbackmark @SLfallbackmark' {after} <0 0 {-w} 0>;",
                      f"  pos @SLfallbackbase @SLfallbackmark' {after} <0 0 {-w} 0>;"]
    return lines + ["} SLmarkwidths;", "feature dist { lookup SLmarkwidths; } dist;"]


def mark_fea(classes, office_cmap, office_path, units, cmap, chars, office_positions=True):
    """Feature code drawing and placing marks as the Office face does; `classes` are the Office face's
    glyph classes as HarfBuzz uses them. An Office face without positioning (office_positions false) gets
    HarfBuzz's fallback for marks, which ours, having kerning, must spell out.
    -> (GPOS lines, GSUB lines, {copy name: (glyph it copies, advance or None, glyph class or None)}, report)"""
    attached = attached_glyphs(office_path) if office_positions and not classes else ()
    marks = [c for c in (marks_of(classes, office_cmap, chars, attached) if office_positions else marks_of({}, office_cmap, chars))
             if c in cmap and not invisible(c)]
    mark_set = set(marks)
    # Marks attach to spaces (an accent shown alone) but not to format characters.
    bases = [c for c in chars if c in cmap and c not in mark_set and (not invisible(c) or unicodedata.category(chr(c)) == "Zs")]
    k = Marks(office_path, units, cmap, bases, marks, classes)
    k.measure(bases)
    # Each mark after each glyph takes the glyph the Office face drew most often there; where that depends
    # on the base before the glyph too, the base and glyph decide.
    narrow = defaultdict(set)   # our glyph for the mark: (base, glyph before) after which it is drawn
    keep = set()                # (base, glyph before, mark) after which the mark keeps its own glyph
    for (previous, m), seen in k.outcomes.items():
        name = seen.most_common(1)[0][0]
        if name in k.copies and ".slm" in name:
            k.after[name].add(previous)
        if len(seen) > 1:
            for (b, p2, m2), seen2 in k.outcomes2.items():
                if (p2, m2) != (previous, m):
                    continue
                own = seen2.most_common(1)[0][0]
                if own != name:
                    if own in k.copies and ".slm" in own:
                        narrow[own].add((b, previous))
                    else:
                        keep.add((b, previous, cmap[m]))
    # A mark glyph the Office face always draws with the same advance is spacing (an iota after a capital).
    # Where HarfBuzz uses no classes, it zeroes no mark: each copy has its Office glyph's own advance.
    for name, glyph in k.office_glyph.items():
        if not classes:
            k.widths[name] = k.sh.font.get_glyph_h_advance(glyph)
        elif len(k.advances[name]) == 1 and 0 not in k.advances[name]:
            k.widths[name] = next(iter(k.advances[name]))

    # The anchor is where a mark sits on the base with something between them; where the Office face puts
    # it elsewhere right after the base, that is a fix for that pair.
    fixes = {}
    for name, free in k.free.items():
        for b, p in free.items():
            direct = k.placed[name].get(b)
            if direct is not None and direct != p:
                fixes[(b, name)] = (direct[0] - p[0], direct[1] - p[1])
            k.placed[name][b] = p
    # A mark stacks on one on the same side (above on above); after a mark on the other side it sits on
    # the base, even where the two keep the same distance on the bases measured.
    char_of = {g: c for c, g in cmap.items()}
    char_of.update({n: char_of.get(g) for n, g in k.copies.items()})
    side = lambda name: _side(char_of[name]) if char_of.get(name) is not None else None
    stacked, on_base = {}, defaultdict(dict)
    for name, by_prev in k.stacked.items():
        kept = {prev: next(iter(v)) for prev, v in by_prev.items()
                if len(v) == 1 and None not in v and side(prev) == side(name)}
        k.conflicts += sum(1 for v in by_prev.values() if len(v) > 1 and None not in v)
        if kept:
            stacked[name] = kept
        if len(kept) < len(by_prev):
            # After some marks the Office face puts this one on the base: where it was seen there, and on
            # every other base through the anchor class whose anchors those positions fit.
            for b, p in k.late[name].items():
                if b not in k.placed.get(name, {}):
                    on_base[name][b] = p
    classes_now = _classes(k.placed)
    for name, seen in on_base.items():
        best = None
        for marks_in_class, anchors in classes_now:
            common = [b for b in seen if b in anchors]
            shifts = {(anchors[b][0] - seen[b][0], anchors[b][1] - seen[b][1]) for b in common}
            if common and len(shifts) == 1 and (best is None or len(common) > best[0]):
                best = (len(common), shifts.pop(), anchors)
        placed = k.placed[name]
        for b, p in seen.items():
            # Not on a base the Office face leaves the mark loose after (it moves with the kerning there).
            if b not in k.loose[name]:
                placed.setdefault(b, p)
        if best:
            _, (dx, dy), anchors = best
            for b, (x, y) in anchors.items():
                if b not in k.loose[name]:
                    placed.setdefault(b, (x - dx, y - dy))
    # After another mark, a mark on the base where its anchor does not put it: a fix for that sequence.
    after_mark = defaultdict(dict)
    for (b, previous, name), p in k.seen_after.items():
        if previous in stacked.get(name, {}):
            continue
        anchor = k.placed.get(name, {}).get(b)
        if anchor is not None:
            after_mark[(previous, name)][b] = (p[0] - anchor[0], p[1] - anchor[1])
    for (previous, name), by_base in after_mark.items():
        for b, d in by_base.items():
            if d != (0, 0):
                fixes[(b, previous, name)] = d
    gpos, gsub = [], []
    lines, base_lookups = _attach("base", k.placed, "SLmk")
    gpos += lines
    if office_positions:
        lines, mark_lookups = _attach("mark", stacked, "SLmm")
    else:
        # HarfBuzz's fallback for a font without positioning: our marks keep the Office face's classes and
        # advances (kerning measured against them takes the advance away after a glyph), and a mark
        # stacks on the one before it as on a base.
        lines, stack_lookups = _attach("base", stacked, "SLmm")
        base_lookups += stack_lookups
        mark_lookups = []
        lines += _fallback_widths(k, cmap, marks)
    gpos += lines
    if fixes:
        # Each move is one named lookup the rules share: feaLib would give every inline value its own.
        moves, moved = {}, defaultdict(set)
        rules = []
        for context, (dx, dy) in sorted(fixes.items()):
            *before, name = context
            move = moves.setdefault((round(dx), round(dy)), f"SLmarkfixmove{len(moves)}")
            moved[move].add(name)
            rules.append(f"  pos {' '.join(_g(g) for g in before)} {_g(name)}' lookup {move};")
        for (dx, dy), move in moves.items():
            gpos.append(f"lookup {move} {{ pos [{' '.join(_g(g) for g in sorted(moved[move]))}] <{dx} {dy} 0 0>; }} {move};")
        gpos += ["lookup SLmarkfix {"] + rules + ["} SLmarkfix;"]
        (mark_lookups if office_positions else base_lookups).append("SLmarkfix")
    if base_lookups:
        gpos.append(f"feature mark {{ {' '.join(f'lookup {n};' for n in base_lookups)} }} mark;")
    if mark_lookups:
        gpos.append(f"feature mkmk {{ {' '.join(f'lookup {n};' for n in mark_lookups)} }} mkmk;")

    lookups = []
    if k.always:
        # First of all: what the Office face never draws precomposed, ours does not either.
        gsub.append("lookup SLmarkalways {")
        gsub += [f"  sub {_g(g)} by {' '.join(_g(p) for p in parts)};" for g, parts in sorted(k.always.items())]
        gsub.append("} SLmarkalways;")
        lookups.append("SLmarkalways")
    if k.splits:
        # A letter may split otherwise before other marks (ị keeps its dot before a horn, not before a
        # grave): a lookup of parts for each of its ways.
        ways = max(len(by_parts) for by_parts in k.splits.values())
        for n in range(ways):
            gsub.append(f"lookup SLmarksplitparts{n} {{")
            gsub += [f"  sub {_g(g)} by {' '.join(_g(p) for p in sorted(by_parts)[n])};"
                     for g, by_parts in sorted(k.splits.items()) if n < len(by_parts)]
            gsub.append(f"}} SLmarksplitparts{n};")
        gsub.append("lookup SLmarksplit {")
        gsub += [f"  sub {_g(g)}' lookup SLmarksplitparts{n} [{' '.join(_g(m) for m in sorted(by_parts[parts]))}];"
                 for g, by_parts in sorted(k.splits.items()) for n, parts in enumerate(sorted(by_parts))]
        gsub.append("} SLmarksplit;")
        lookups.append("SLmarksplit")
    if k.swaps:
        # Marks are reordered by combining class, so a mark below may come between the letter and the
        # mark above that makes the Office face swap it; it looks past the marks it was seen to swap
        # across, and invisible ones (a combining grapheme joiner).
        gsub.append("lookup SLswap {")
        joiners_too = {g for c, g in cmap.items() if invisible(c) and unicodedata.category(chr(c)) == "Mn"}
        for (g, other), ms in sorted(k.swaps.items()):
            after = f"[{' '.join(_g(m) for m in sorted(ms))}]"
            others = sorted((k.swap_between.get((g, other), set()) | joiners_too) - set(ms))
            between = f"[{' '.join(_g(m) for m in others)}]" if others else None
            gsub.append(f"  sub {_g(g)}' {after} by {_g(other)};")
            if between:
                gsub += [f"  sub {_g(g)}' {between} {after} by {_g(other)};",
                         f"  sub {_g(g)}' {between} {between} {after} by {_g(other)};"]
        gsub.append("} SLswap;")
        lookups.append("SLswap")
    ahead = {key: seen.most_common(1)[0][0] for key, seen in k.ahead.items()}
    ahead = {key: name for key, name in ahead.items() if name != key[0]}
    if ahead:
        # A mark drawn otherwise ahead of the next one, before the next is chosen by it; the first may be
        # still its own glyph, the one the next lookup draws it with.
        gsub.append("lookup SLmarkahead {")
        for (mine, following), name in sorted(ahead.items()):
            drawn = sorted({mine, k.copies.get(mine, mine)})
            gsub.append(f"  sub [{' '.join(_g(g) for g in drawn)}]' {_g(following)} by {_g(name)};")
        gsub.append("} SLmarkahead;")
        lookups.append("SLmarkahead")
    through = defaultdict(list)     # (mark, our glyph for it, marks between): bases whose choice it keeps
    for (b, mark, name), between in k.through.items():
        through[(mark, name, tuple(sorted(between)))].append(b)
    joiners = sorted(g for c, g in cmap.items() if invisible(c) and unicodedata.category(chr(c)) == "Mn")
    joined = defaultdict(set)       # our mark copy: bases after which, and a joiner, it is drawn
    for (b, m), seen in k.joined.items():
        name = seen.most_common(1)[0][0]
        if joiners and name in k.copies and ".slm" in name:
            joined[name].add(b)
    if k.after or narrow or through or joined:
        gsub.append("lookup SLmarkglyphs {")
        for (mark, name, between), bs in sorted(through.items()):
            gsub.append(f"  sub [{' '.join(_g(b) for b in sorted(bs))}] [{' '.join(_g(g) for g in between)}] "
                        f"{_g(mark)}' by {_g(name)};")
        # Each mark copy after the glyphs the Office face draws it after; a mark before it has been
        # chosen already, since the lookup works from the start of the text.
        for b, previous, mark in sorted(keep):
            gsub.append(f"  ignore sub {_g(b)} {_g(previous)} {_g(mark)}';")
        for name, contexts in sorted(narrow.items()):
            for b, previous in sorted(contexts):
                gsub.append(f"  sub {_g(b)} {_g(previous)} {_g(k.copies[name])}' by {_g(name)};")
        for name, previous in sorted(k.after.items()):
            context = f"[{' '.join(_g(p) for p in sorted(previous))}]"
            gsub.append(f"  sub {context} {_g(k.copies[name])}' by {_g(name)};")
        # After a combining grapheme joiner, the glyph the Office face draws there (it may keep the base's
        # choice, or draw the mark's own glyph).
        for name, bs in sorted(joined.items()):
            gsub.append(f"  sub [{' '.join(_g(b) for b in sorted(bs))}] [{' '.join(_g(j) for j in joiners)}] "
                        f"{_g(k.copies[name])}' by {_g(name)};")
        start = gsub.index("lookup SLmarkglyphs {") + 1
        gsub[start:] = _in_subtables(gsub[start:])
        gsub.append("} SLmarkglyphs;")
        lookups.append("SLmarkglyphs")
    if lookups:
        gsub.append(f"feature ccmp {{ {' '.join(f'lookup {n};' for n in lookups)} }} ccmp;")
    report = {"marks": len(marks), "bases": len(bases), "copies": len(k.copies),
              "base_classes": len(base_lookups), "stack_classes": len(mark_lookups),
              "splits": len(k.splits), "always": len(k.always), "swaps": sum(len(v) for v in k.swaps.values()),
              "ahead": len(ahead), "conflicts": k.conflicts,
              "fixes": len(fixes)}
    office_class = lambda name: classes.get(k.sh.font.glyph_to_string(k.office_glyph[name])) if name in k.office_glyph else None
    return gpos, gsub, {name: (g, k.widths.get(name), office_class(name)) for name, g in k.copies.items()}, report


def kerning_skips_marks(sh, deltas, marks):
    """The scripts whose letters the Office face kerns across a combining mark between them:
    {script: whether it does}, from its most kerned pairs."""
    from suiteleaf_shaping import char_script
    combining = [c for c in marks if unicodedata.category(chr(c)) == "Mn" and not invisible(c)]
    if not combining:
        return {}
    m = 0x301 if 0x301 in combining else combining[0]
    total = lambda t: sum(p.x_advance for p in sh.shape(t).glyph_positions)
    votes = defaultdict(Counter)
    for (a, b), d in sorted(deltas.items(), key=lambda kv: -abs(kv[1])):
        if not (unicodedata.category(chr(a)).startswith("L") and unicodedata.category(chr(b)).startswith("L")):
            continue
        script = char_script(a)
        if sum(votes[script].values()) >= 40:
            continue
        if len(sh.shape(chr(a) + chr(b)).glyph_infos) != 2 or len(sh.shape(chr(a) + chr(m)).glyph_infos) != 2:
            continue  # a ligature, which a mark between breaks, or a letter the mark composes with
        votes[script][total(chr(a) + chr(m) + chr(b)) == total(chr(a) + chr(m)) + total(chr(b)) + d] += 1
    return {script: v[True] > v[False] for script, v in votes.items()}
