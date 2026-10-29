"""Check that installed SuiteLeaf faces lay out Latin text exactly as their Office faces.

Latin text is every Latin-script character the Office face has, with the punctuation, digits,
symbols, and combining accents used around it. Each face is shaped as a browser shapes it
(HarfBuzz's default features), with kerning on and off, and compared glyph by glyph: every character
alone, every pair, each letter with one or two accents, ligatures with every neighbor, and real words
from the system's word list.

    python scripts/fonts/suiteleaf_latin.py [--jobs N] [FAMILY ...]
"""
import argparse
import itertools
import json
import sys
import tempfile
import unicodedata
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import uharfbuzz as hb
from fontTools.ttLib import TTFont

import suiteleaf_build as build
from suiteleaf_families import FACES
from suiteleaf_install import omitted, slug
from suiteleaf_shaping import char_script, ligature_contexts, text_chars, worker_count

OUT = Path(__file__).resolve().parents[2] / "apps/web/src/fonts"
COMMON = ("Zyyy", "Zinh", "Zzzz", None)
# Common characters Latin text uses: ASCII and Latin-1 punctuation, spacing and combining accents,
# general punctuation such as quotes and dashes, currency signs, and the trade mark sign.
AROUND_LATIN = [(0x20, 0x36F), (0x2010, 0x203A), (0x20A0, 0x20BF), (0x2122, 0x2122)]
ACCENT_BASES = "aeiouAEIOU"
KERN_MARKS = [0x301, 0x323, 0x308]
KERNED_PAIRS = 500
EXAMPLES = 8
WORD_LIST = Path("/usr/share/dict/words")


def _words(count=25000):
    """A fixed sample of the system's word list, some capitalized, where there is one."""
    if not WORD_LIST.exists():
        return []
    words = sorted({w.strip() for w in WORD_LIST.read_text().splitlines() if w.strip()})
    sample = words[::max(1, len(words) // count)][:count]
    return sample + [w.capitalize() for w in sample[1::5]]


WORDS = _words()


def latin_chars(cmap):
    out = []
    for c in text_chars(cmap):
        if omitted(c):
            continue
        script = char_script(c)
        if script == "Latn" or (script in COMMON and any(a <= c <= b for a, b in AROUND_LATIN)):
            out.append(c)
    return out


class Layout:
    """Glyph positions of shaped text, in the font's units."""

    def __init__(self, path, kern=True):
        self.face = hb.Face(hb.Blob.from_file_path(str(path)))
        self.font = hb.Font(self.face)
        self.upem = self.face.upem
        self.features = {} if kern else {"kern": False}

    def __call__(self, text):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.font, buf, self.features)
        x, out = 0, []
        for info, p in zip(buf.glyph_infos, buf.glyph_positions):
            out.append((info.cluster, x + p.x_offset, p.y_offset))
            x += p.x_advance
        return out, x


def texts_for(office_font, chars):
    marks = [c for c in chars if 0x300 <= c <= 0x36F]
    singles = [chr(c) for c in chars]
    yield from singles
    for a, b in itertools.product(singles, repeat=2):
        yield a + b
    bases = [b for b in ACCENT_BASES if ord(b) in chars]
    for base, m1, m2 in itertools.product(bases, marks, marks):
        yield base + chr(m1) + chr(m2)
    for lig in ligature_contexts(office_font):
        if all(ord(ch) in chars for ch in lig):
            for c in singles:
                yield c + lig
                yield lig + c
    # Real words, where letters change with their neighbours (Segoe Script's contextual alternates).
    for word in WORDS:
        if all(ord(ch) in chars for ch in word):
            yield word


def cluster_starts(positions):
    starts = {}
    for cluster, x, y in positions:
        starts.setdefault(cluster, (x, y))
    return starts


def placed_marks(text, rp, cp):
    """The glyphs whose positions must agree: all of them when both fonts draw as many, else the
    typed marks at the end (one font may draw the letter before them precomposed, the other split)."""
    if len(rp) == len(cp):
        return rp, cp
    k = len(text) - len(text.rstrip("".join(ch for ch in text if unicodedata.category(ch) in ("Mn", "Me"))))
    if not k or min(len(rp), len(cp)) <= k:
        return [], []
    return rp[-k:], cp[-k:]


def compare(office_path, path):
    """For one face, with kerning on and off (documents kern only from a size up, and by default never):
    texts whose clusters start elsewhere or end elsewhere ('different': where carets and line breaks
    fall), and texts drawn with as many glyphs but an accent placed elsewhere ('marks'). A precomposed
    letter one font draws as base and accent is the same layout."""
    on, off = (_compare(office_path, path, kern) for kern in (True, False))
    out = {k: on[k] + off[k] for k in ("texts", "different", "marks")}
    for k in ("examples", "mark_examples"):
        out[k] = (on[k] + [f"{e} unkerned" for e in off[k]])[:EXAMPLES]
    return {"chars": on["chars"], "missing": on["missing"], **out}


def _compare(office_path, path, kern):
    office_font = TTFont(office_path)
    chars = latin_chars(office_font.getBestCmap() or {})
    ours = set(TTFont(path).getBestCmap() or {})
    missing = [c for c in chars if c not in ours]
    chars = [c for c in chars if c in ours]
    ref, cand = Layout(office_path, kern), Layout(path, kern)
    scale = ref.upem / cand.upem
    tol = 0 if ref.upem == cand.upem else 1
    near = lambda a, b: abs(a[0] - b[0] * scale) <= tol and abs(a[1] - b[1] * scale) <= tol
    different, marks, examples, mark_examples, count = 0, 0, [], [], 0
    alone, kerned = {}, []

    def texts():
        yield from texts_for(office_font, set(chars))
        # The pairs the Office face kerns most, with a mark between: kerning may reach across it.
        between = [chr(m) for m in KERN_MARKS if m in chars]
        for _, a, b in sorted(kerned, reverse=True)[:KERNED_PAIRS]:
            for m in between:
                yield a + m + b

    for text in texts():
        count += 1
        (rp, rx), (cp, cx) = ref(text), cand(text)
        if len(text) == 1:
            alone[text] = rx
        elif len(text) == 2 and text[0] in alone and text[1] in alone and text.isalpha():
            if rx != alone[text[0]] + alone[text[1]]:
                kerned.append((abs(rx - alone[text[0]] - alone[text[1]]), text[0], text[1]))
        rs, cs = cluster_starts(rp), cluster_starts(cp)
        if abs(rx - cx * scale) > tol or rs.keys() != cs.keys() or not all(near(rs[k], cs[k]) for k in rs):
            different += 1
            if len(examples) < EXAMPLES:
                examples.append(" ".join(f"U+{ord(ch):04X}" for ch in text))
        elif not all(near(a[1:], b[1:]) for a, b in zip(*placed_marks(text, rp, cp))):
            marks += 1
            if len(mark_examples) < EXAMPLES:
                mark_examples.append(" ".join(f"U+{ord(ch):04X}" for ch in text))
    return {"chars": len(chars), "texts": count, "different": different, "marks": marks, "missing": len(missing),
            "examples": examples, "mark_examples": mark_examples}


def _job(args):
    family, style, office_file, index, woff2 = args
    with tempfile.TemporaryDirectory() as work:
        office_path = build.office_face_path(build.DEFAULT_OFFICE, work, office_file, index)
        font = TTFont(woff2)
        font.flavor = None
        plain = Path(work) / "face.ttf"
        font.save(plain)
        return family, style, compare(office_path, plain)


def installed_faces(families=()):
    for office_file, index, _, _, family, style, _ in FACES:
        woff2 = OUT / f"{slug(family, style)}.woff2"
        if woff2.exists() and (not families or family in families):
            yield family, style, office_file, index, str(woff2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("families", nargs="*", help="Only these families, such as 'SuiteLeaf Willow'")
    parser.add_argument("--jobs", type=int, default=worker_count())
    parser.add_argument("--report", help="Write every face's result to this JSON file")
    args = parser.parse_args()
    jobs = list(installed_faces(args.families))
    print(f"{len(jobs)} installed faces", flush=True)
    results, failed = [], 0
    with ProcessPoolExecutor(args.jobs, max_tasks_per_child=8) as executor:
        for family, style, r in executor.map(_job, jobs):
            results.append({"family": family, "style": style, **r})
            ok = not r["different"] and not r["marks"] and not r["missing"]
            failed += not ok
            print(f"{'ok  ' if ok else 'FAIL'} {family} {style}: {r['chars']} characters, {r['texts']} texts, "
                  f"{r['different']} laid out differently {r['examples'][:3]}, {r['marks']} with accents placed "
                  f"differently {r['mark_examples'][:2]}, {r['missing']} missing", flush=True)
    if args.report:
        Path(args.report).write_text(json.dumps(results, indent=1))
    print(f"{failed} of {len(jobs)} faces differ")
    sys.exit(1 if failed else 0)
