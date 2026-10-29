"""HarfBuzz helpers shared by the SuiteLeaf font build and its checks."""
import os
import unicodedata

import uharfbuzz as hb


class Shaper:
    """Shapes text with HarfBuzz's default features at the font's own units."""

    def __init__(self, path_or_bytes, units=None, index=0, features=None):
        """`units` reports positions in another units-per-em, such as a font built at a multiple of this one;
        `features` turns default features on or off ({"kern": False} lays text out unkerned)."""
        blob = hb.Blob(path_or_bytes) if isinstance(path_or_bytes, bytes) else hb.Blob.from_file_path(str(path_or_bytes))
        self.face = hb.Face(blob, index)
        self.font = hb.Font(self.face)
        self.units = units or self.face.upem
        self.font.scale = (self.units, self.units)
        self.features = features or {}

    def shape(self, text, preserve=False):
        """`preserve` keeps the glyphs of hidden characters (a soft hyphen), which HarfBuzz otherwise
        swaps for a space once it has positioned them."""
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        if preserve:
            buf.flags = hb.BufferFlags.PRESERVE_DEFAULT_IGNORABLES
        hb.shape(self.font, buf, self.features)
        return buf



def worker_count():
    """Worker processes for the build: SUITELEAF_JOBS, else one per 6 GB of memory (each holds whole fonts), at most one per core."""
    if os.environ.get("SUITELEAF_JOBS"):
        return max(1, int(os.environ["SUITELEAF_JOBS"]))
    memory = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    return max(1, min(os.cpu_count() or 1, memory // (6 << 30)))

def total(shaper, text):
    return sum(p.x_advance for p in shaper.shape(text).glyph_positions)


def text_chars(cmap):
    """Characters that appear in text: no controls, private use, or unassigned code points."""
    return sorted(c for c in cmap if c >= 0x20 and not 0x7F <= c <= 0x9F and not 0xE000 <= c <= 0xF8FF
                  and unicodedata.category(chr(c)) != "Cn")


def char_script(c):
    buf = hb.Buffer()
    buf.add_str(chr(c))
    buf.guess_segment_properties()
    return buf.script


def same_run(chars, script="Latn"):
    """Characters a browser shapes in the same run as text of `script`."""
    # HarfBuzz reports no script at all for spaces and other common characters.
    return [c for c in chars if char_script(c) in (script, "Zyyy", "Zinh", "Zzzz", None)]


def ligature_lookups(font):
    """{character string: index of the lookup that forms it} for a font's default ligatures
    (liga/clig/rlig), spelled with each glyph's plainest character. Each lookup runs over the whole
    text before the next, so the order decides which of two overlapping ligatures forms."""
    rev = {}
    for cp, g in sorted((font.getBestCmap() or {}).items()):
        rev.setdefault(g, cp)
    out = {}
    if "GSUB" not in font:
        return out
    table = font["GSUB"].table
    for fr in table.FeatureList.FeatureRecord:
        if fr.FeatureTag not in ("liga", "clig", "rlig"):
            continue
        for li in fr.Feature.LookupListIndex:
            for st in table.LookupList.Lookup[li].SubTable:
                st = getattr(st, "ExtSubTable", st)
                for first, ligs in getattr(st, "ligatures", {}).items():
                    for lig in ligs:
                        seq = [first] + list(lig.Component)
                        if all(g in rev for g in seq):
                            text = "".join(chr(rev[g]) for g in seq)
                            out[text] = min(out.get(text, li), li)
    return out


def ligature_contexts(font):
    """Character strings for a font's default ligatures (liga/clig/rlig), spelled with each glyph's plainest character."""
    return sorted(ligature_lookups(font))


def glyph_classes(font, path):
    """The font's glyph classes as HarfBuzz uses them: none when the font has none, or when HarfBuzz
    ignores them (it does for some Office fonts whose classes are wrong, such as Courier New and Tahoma)
    and takes classes from Unicode instead."""
    if "GDEF" not in font or not font["GDEF"].table.GlyphClassDef:
        return {}
    if not hb.Face(hb.Blob.from_file_path(str(path))).has_layout_glyph_classes:
        return {}
    return font["GDEF"].table.GlyphClassDef.classDefs


def joined_modifiers(shaper, chars):
    """Runs of modifier letters and symbols the Office face draws as one glyph without a ligature
    feature (tone letters become contours), two or three long."""
    mods = [c for c in chars if unicodedata.category(chr(c)) in ("Lm", "Sk")]
    one = lambda text: len(shaper.shape(text).glyph_infos) == 1
    pairs = [chr(a) + chr(b) for a in mods for b in mods if one(chr(a) + chr(b))]
    joining = sorted({ord(ch) for p in pairs for ch in p})
    triples = [chr(a) + chr(b) + chr(c) for a in joining for b in joining for c in joining if one(chr(a) + chr(b) + chr(c))]
    return pairs + triples


def clusters(shaper, text):
    """Glyph names, the pen position at each cluster start, the glyph before each cluster, the end,
    whether the glyphs run right to left (HarfBuzz returns them in visual order), and their advances."""
    buf = shaper.shape(text)
    names = [shaper.font.glyph_to_string(i.codepoint) for i in buf.glyph_infos]
    x, starts, glyph_before = 0, {}, {}
    for n, (info, p) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
        if info.cluster not in starts:
            starts[info.cluster] = x + p.x_offset
            glyph_before[info.cluster] = n - 1
        x += p.x_advance
    infos = buf.glyph_infos
    return names, starts, glyph_before, x, len(infos) > 1 and infos[0].cluster > infos[-1].cluster, \
        [p.x_advance for p in buf.glyph_positions]
