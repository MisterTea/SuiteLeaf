"""Check that a SuiteLeaf font lays out text exactly like its Office face.

A face passes when
  - every character the Office face has is in the SuiteLeaf font,
  - advance widths, pair spacing, and line metrics are identical (layout score exact),
  - in every sample text, each cluster starts at the same position and the line ends
    at the same position (the repo's English word list, accented Latin, Greek,
    Cyrillic, box drawing, Thai, and each Office ligature beside every character),
  - the font passes the OpenType Sanitizer that browsers run on web fonts.

    python scripts/fonts/suiteleaf_verify.py OFFICE_FONT SUITELEAF_FONT [--script latin|thai|symbol]
"""
import argparse
import itertools
import re
import sys
import unicodedata
from pathlib import Path

import uharfbuzz as hb
from fontTools.ttLib import TTFont

from suiteleaf_shaping import Shaper, char_script, ligature_contexts, same_run, text_chars

REPO = Path(__file__).resolve().parents[2]
PAIR_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:-'\"()/!?"
THAI_SAMPLE = "กขคงจฉชซญดตถทนบปผพฟมยรลวศสหอฮ"
BLOCKS = {
    "latin": [(0x20, 0x7E), (0xA0, 0x17F)],
    "thai": [(0x0E00, 0x0E7F), (0x20, 0x7E)],
    "symbol": [(0x20, 0xFF)],
    # Complex scripts: the script's block and ASCII.
    **{code: [block, (0x20, 0x7E)] for code, block in {
        "hebr": (0x0590, 0x05FF), "arab": (0x0600, 0x06FF), "deva": (0x0900, 0x097F), "taml": (0x0B80, 0x0BFF),
        "telu": (0x0C00, 0x0C7F), "knda": (0x0C80, 0x0CFF), "mlym": (0x0D00, 0x0D7F), "mymr": (0x1000, 0x109F),
        "tibt": (0x0F00, 0x0FFF), "ethi": (0x1200, 0x137F), "mong": (0x1800, 0x18AF), "tale": (0x1950, 0x197F),
        "talu": (0x1980, 0x19DF), "yiii": (0xA000, 0xA48F)}.items()},
}
SAMPLES = [
    "The quick brown fox jumps over the lazy dog. 0123456789",
    "Sphinx of black quartz, judge my vow! (AVATAR) \"Wolf\" -- 'Typography'",
    "Größe façade naïve résumé coöperate jalapeño Ærøskøbing Œuvre — €£¥ ©®™ ½¼¾ ±×÷ ¡¿",
    "Łódź Žluťoučký kůň úpěl ďábelské ódy Ş ţ İstanbul Ğ ő ű ĳ Ŀ ŉ ſ",
    "office affluent fluffy afflict waffle chiffon efficient offhand coffee jiffy fjord",
    "Η γρήγορη καφέ αλεπού πηδάει πάνω από το τεμπέλικο σκυλί. ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ ἀρχὴ ἐν ᾠδῇ",
    "Съешь же ещё этих мягких французских булок, да выпей чаю. ЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ ґєії",
    "┌──┬──┐ │░▒▓│ ├──┼──┤ └──┴──┘ ■□▪▫▲►▼◄○● ⅛⅜⅝⅞ ₀₁₂₃ ⁰¹²³ ƒǺǻǼǽǾǿ ẀẁẂẃẄẅỲỳ",
    "الخط العربي جميل جدا، وهو فن قديم يكتب من اليمين إلى اليسار. ١٢٣٤٥٦٧٨٩٠ لا إله إلا الله",
    "فارسی: پچژگ کی؟ اردو: ٹڈڑں ے ۔ بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
    "שלום עולם! עברית נכתבת מימין לשמאל, גם עם ניקוד: שָׁלוֹם וּבְרָכָה",
    "日本語の文章です。ひらがな、カタカナ、漢字を混ぜて書きます。①②③ ㍻ ㌔ 〔括弧〕 ＡＢＣ１２３",
    "ꓡꓲ-ꓢꓴ ꓟꓲ ꓠꓬ ꓐꓳ ꓔꓯ",
    "हिन्दी भाषा में लिखा गया यह वाक्य संयुक्ताक्षर क्ष त्र ज्ञ श्र द्ध र्क दिखाता है। १२३४५",
    "தமிழ் மொழி மிகவும் பழமையான மொழிகளில் ஒன்றாகும். க்ஷ ஸ்ரீ கொ கோ கை",
    "తెలుగు భాష ద్రావిడ భాషలలో ఒకటి. క్ష్మ స్త్ర ర్క కొ కో",
    "ಕನ್ನಡ ಭಾಷೆಯು ದ್ರಾವಿಡ ಭಾಷೆಗಳಲ್ಲಿ ಒಂದು. ಕ್ಷ ಸ್ತ್ರ ರ್ಕ ಕೊ ಕೋ",
    "മലയാളം ഭാഷ കേരളത്തിലെ പ്രധാന ഭാഷയാണ്. ക്ഷ ന്റെ കൊ കോ",
    "မြန်မာဘာသာစကားသည် တိဘက်-မြန်မာ ဘာသာစကားမိသားစုဝင် ဖြစ်သည်။",
    "བོད་ཀྱི་སྐད་ཡིག་ནི་རྒྱ་ཆེན་པོ་ཡིན། སྒྲུབ་",
    "ኢትዮጵያ በአፍሪካ ቀንድ የምትገኝ ሀገር ናት። ፩፪፫",
    "ꆈꌠꁱꂷ ꀉꂿꄚꑍ ꏃꆈꌠ",
    "ᠮᠣᠩᠭᠣᠯ ᠪᠢᠴᠢᠭ ᠤᠯᠤᠰ",
    "ᥖᥭᥰ ᥖᥬᥳ ᥑᥨᥒᥰ ᥐᥣᥴ",
    "ᦟᦲᧄ ᦺᦑ ᦟᦹᧉ ᦵᦉᦲ",
]
THAI_TEXT = [
    "สวัสดีครับ ภาษาไทยเป็นภาษาที่สวยงาม",
    "กรุงเทพมหานคร อมรรัตนโกสินทร์ มหินทรายุธยา",
    "น้ำ ผู้ใหญ่ ก็ได้ ที่นี่ ไม้เอก ไม้โท ไม้ตรี ไม้จัตวา ำ ั ิ ี ึ ื ุ ู",
]


def words():
    source = REPO / "apps/web/src/editors/english-words.ts"
    return re.findall(r"[A-Za-z']+", source.read_text()) if source.exists() else []


class Metrics:
    def __init__(self, path):
        self.face = hb.Face(hb.Blob.from_file_path(str(path)))
        self.font = hb.Font(self.face)
        self.upem = self.face.upem
        self.font.scale = (self.upem, self.upem)
        self.cmap = set(self.face.unicodes)
        tt = TTFont(path, lazy=True)
        h, o, u = tt["hhea"], tt["OS/2"], self.upem
        self.hhea = (h.ascent / u, -h.descent / u, h.lineGap / u)
        self.win = (o.usWinAscent / u, o.usWinDescent / u)

    def gid(self, cp):
        g = self.font.get_nominal_glyph(cp)
        if g is None and cp < 0x100:
            g = self.font.get_nominal_glyph(0xF000 + cp)
        return g

    def advance(self, cp):
        """The character's advance once shaped: the glyph a font substitutes is what text uses."""
        if self.gid(cp) is None:
            return None
        buf = hb.Buffer()
        buf.add_str(chr(cp))
        buf.guess_segment_properties()
        hb.shape(self.font, buf)
        return sum(p.x_advance for p in buf.glyph_positions) / self.upem

    def drawn(self, text):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.font, buf, {"kern": True})
        x, out = 0.0, []
        for p in buf.glyph_positions:
            out.append(((x + p.x_offset) / self.upem, p.y_offset / self.upem))
            x += p.x_advance
        return out, x / self.upem


def layout(office_path, path, script, skip=()):
    """Widths, pair spacing, and line metrics; `exact` only when all three are identical. Characters of
    the `skip` scripts (those allowed to come close rather than exact) are left out."""
    ref, cand = Metrics(office_path), Metrics(path)
    tol = 1.0 / ref.upem + 0.5 / cand.upem
    if script == "symbol":
        chars = [c for c in range(0x20, 0x100) if ref.gid(c)]
    else:
        chars = [c for c in sorted(ref.cmap) if any(a <= c <= b for a, b in BLOCKS[script])
                 and unicodedata.category(chr(c)) != "Cn" and char_script(c) not in skip]
    width_errors, widths_exact = [], True
    for c in chars:
        a, b = ref.advance(c), cand.advance(c)
        if a is None or b is None:
            width_errors.append(1.0)
            widths_exact = False
            continue
        same = abs(a - b) <= tol
        widths_exact &= same
        width_errors.append(0.0 if same else min(1.0, abs(a - b) / a) if a > 0 else 1.0)

    sample = THAI_SAMPLE if script == "thai" else PAIR_CHARS
    sample = [ch for ch in sample if ref.gid(ord(ch)) and cand.gid(ord(ch))]
    off, total, kern_exact = 0.0, 0.0, True
    for a, b in itertools.product(sample, repeat=2):
        (rp, rx), (cp, cx) = ref.drawn(a + b), cand.drawn(a + b)
        delta = abs((rx - ref.advance(ord(a)) - ref.advance(ord(b))) - (cx - cand.advance(ord(a)) - cand.advance(ord(b))))
        if len(rp) == len(cp) == 2:
            delta += abs((rp[1][0] - ref.advance(ord(a))) - (cp[1][0] - cand.advance(ord(a))))
            delta += abs(rp[0][0] - cp[0][0]) + sum(abs(p[1] - q[1]) for p, q in zip(rp, cp))
        if delta > tol:
            kern_exact = False
            off += delta
        total += rx

    def closeness(x, y):
        diff = sum(abs(p - q) for p, q in zip(x, y))
        return 1.0 if diff <= 2 * tol * len(x) else max(0.0, 1 - diff / sum(x))

    lines = min(closeness(ref.hhea, cand.hhea), closeness(ref.win, cand.win))
    widths = 1 - sum(width_errors) / len(width_errors) if width_errors else 0.0
    kerning = max(0.0, 1 - off / total) if total else 0.0
    exact = widths_exact and kern_exact and lines == 1.0
    return {"exact": exact, "widths": widths, "kerning": kerning, "lines": lines}


def cluster_positions(shaper, text):
    """Pen position at each cluster start, and the line end, in ems."""
    buf = shaper.shape(text)
    upem = shaper.units
    x, starts = 0, {}
    for info, p in zip(buf.glyph_infos, buf.glyph_positions):
        starts.setdefault(info.cluster, ((x + p.x_offset) / upem, p.y_offset / upem))
        x += p.x_advance
    return starts, x / upem


def text_check(office_path, path, samples):
    """Texts whose cluster starts or line end differ. Ligatures merge clusters, so only shared starts count."""
    o, s = Shaper(office_path), Shaper(path)
    tol = 0.5 / o.units + 0.5 / s.units
    near = lambda a, b: abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol
    bad = []
    for text in samples:
        (co, xo), (cs, xs) = cluster_positions(o, text), cluster_positions(s, text)
        if abs(xo - xs) > tol or set(co) - set(cs) or any(not near(co[k], cs[k]) for k in set(co) & set(cs)):
            bad.append(text[:40])
    return bad


def sanitizes(path):
    import ots
    return ots.sanitize(str(path), "/dev/null", capture_output=True).returncode == 0


def blank_glyphs(office, path):
    """Characters the Office face draws but this font leaves empty."""
    from fontTools.pens.boundsPen import BoundsPen
    font = TTFont(path)
    ocmap, cmap = office.getBestCmap() or {}, font.getBestCmap() or {}
    ogs, gs = office.getGlyphSet(), font.getGlyphSet()

    def inked(glyphs, name):
        pen = BoundsPen(glyphs)
        glyphs[name].draw(pen)
        return pen.bounds is not None

    # Shaping hides format characters and other default ignorables, so only visible characters count.
    ignorable = lambda c: (0x180B <= c <= 0x180F or 0xFE00 <= c <= 0xFE0F or 0xE0100 <= c <= 0xE01EF
                           or c in (0x034F, 0x115F, 0x1160, 0x3164, 0xFFA0))
    visible = [c for c in sorted(set(ocmap) & set(cmap))
               if unicodedata.category(chr(c)) not in ("Cf", "Cc", "Co", "Zs", "Zl", "Zp") and not ignorable(c)]
    return [c for c in visible if inked(ogs, ocmap[c]) and not inked(gs, cmap[c])]


def check(office_path, path, script, approximate=(), omit=()):
    """Exact layout of every text, except texts in the `approximate` scripts, which are only counted.
    Characters in the `omit` ranges were left out of the font on purpose and do not count as missing."""
    office = TTFont(office_path)
    if script == "symbol":
        texts = ["".join(chr(c) for c in range(0x20, 0x100))]
        texts += [chr(a) + chr(b) for a in range(0x20, 0x100) for b in range(0x20, 0x100, 7)]
        missing = []
    else:
        ours = set(TTFont(path).getBestCmap())
        missing = [c for c in text_chars(office.getBestCmap()) if c not in ours and not any(a <= c <= b for a, b in omit)]
        # Browsers shape each script separately, so a ligature only meets characters of its own script.
        ligs = ligature_contexts(office)
        runs = {}
        probes = list(ligs)
        for lig in ligs:
            run = char_script(ord(lig[0]))
            run = "Latn" if run in ("Zyyy", "Zinh", "Zzzz", None) else run
            if run not in runs:
                runs[run] = same_run(text_chars(ours), run)
            probes += [chr(c) + lig for c in runs[run]] + [lig + chr(c) for c in runs[run]]
        texts = words() + SAMPLES + (THAI_TEXT if script == "thai" else []) + probes
        texts = ["".join(ch for ch in t if ord(ch) in ours) for t in texts]
        texts = [t for t in texts if t]
    loose = [t for t in texts if any(char_script(ord(ch)) in approximate for ch in t)]
    texts = [t for t in texts if not any(char_script(ord(ch)) in approximate for ch in t)]
    lay = layout(office_path, path, script, approximate)
    bad = text_check(office_path, path, texts)
    blank = blank_glyphs(office, path)
    ok = lay["exact"] and not bad and not missing and not blank and sanitizes(path)
    result = {"ok": ok, "layout": lay, "texts": len(texts), "texts_different": bad[:5], "missing": len(missing),
              "blank": len(blank)}
    if loose:
        result["approximate"] = {"scripts": list(approximate), "texts": len(loose),
                                 "different": len(text_check(office_path, path, loose))}
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("office")
    parser.add_argument("font")
    parser.add_argument("--script", default="latin", choices=sorted(BLOCKS))
    args = parser.parse_args()
    result = check(args.office, args.font, args.script)
    print(result)
    sys.exit(0 if result["ok"] else 1)
