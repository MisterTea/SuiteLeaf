"""HarfBuzz helpers shared by the SuiteLeaf font build and its checks."""
import os
import unicodedata

import uharfbuzz as hb


class Shaper:
    """Shapes text with HarfBuzz's default features at the font's own units."""

    def __init__(self, path_or_bytes, units=None, index=0):
        """`units` reports positions in another units-per-em, such as a font built at a multiple of this one."""
        blob = hb.Blob(path_or_bytes) if isinstance(path_or_bytes, bytes) else hb.Blob.from_file_path(str(path_or_bytes))
        self.face = hb.Face(blob, index)
        self.font = hb.Font(self.face)
        self.units = units or self.face.upem
        self.font.scale = (self.units, self.units)

    def shape(self, text):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.font, buf)
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


def ligature_contexts(font):
    """Character strings for a font's default ligatures (liga/clig/rlig), spelled with each glyph's plainest character."""
    rev = {}
    for cp, g in sorted((font.getBestCmap() or {}).items()):
        rev.setdefault(g, cp)
    out = []
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
                            out.append("".join(chr(rev[g]) for g in seq))
    return sorted(set(out))


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
