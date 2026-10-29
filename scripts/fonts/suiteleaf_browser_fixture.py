"""Write the layout HarfBuzz gives each installed SuiteLeaf face, for the browser test to compare with.

The browser test (tests/browser/font-layout.spec.ts) draws the same texts on a canvas at one pixel per
font unit and checks each text's advance and ink box against these, with kerning on and off. Each face
gets texts that exercise what the fonts do beyond plain advances: kerned pairs, ligatures, and letters
with one and two accents.

    python scripts/fonts/suiteleaf_browser_fixture.py
"""
import io
import json
import random
import zlib
import re
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen, ControlBoundsPen
from fontTools.ttLib import TTFont

from suiteleaf_latin import OUT, latin_chars
from suiteleaf_shaping import ligature_contexts

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests/fixtures/font-layout.json"
SAMPLE = ["AVATAR Wolf office fjord", "Tŷ Ŵales Ǆ ĳ", "ǖ́ q̃ ḗ̤ ŏ̧̃ Ǻ̃"]
ACCENTED, KERNED, LIGATED = 12, 6, 4
FACE_RULE = re.compile(r'font-family: "(SuiteLeaf [^"]+)";\s*src: url\("\./([^"]+\.woff2)"\)[^}]*?'
                       r"font-weight: (\d+);\s*font-style: (\w+);")


def faces():
    """{woff2 file: (family, weight, style)} for the SuiteLeaf family names in the generated CSS."""
    css = (OUT / "office-fonts.css").read_text()
    out = {}
    for family, file, weight, style in FACE_RULE.findall(css):
        out.setdefault(file, (family, int(weight), style))
    return out


def shaped(font, text, kern):
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": kern})
    return buf


def advance(font, text):
    return sum(p.x_advance for p in shaped(font, text, True).glyph_positions)


def layout(font, glyphs, text, kern):
    """(advance, control box, ink box) of the shaped text, in font units; boxes are None for blank text."""
    buf = shaped(font, text, kern)
    x, boxes = 0, {ControlBoundsPen: None, BoundsPen: None}
    for info, p in zip(buf.glyph_infos, buf.glyph_positions):
        for kind, box in boxes.items():
            pen = kind(glyphs)
            glyphs[font.glyph_to_string(info.codepoint)].draw(pen)
            if pen.bounds:
                b = pen.bounds
                b = (x + p.x_offset + b[0], p.y_offset + b[1], x + p.x_offset + b[2], p.y_offset + b[3])
                boxes[kind] = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
        x += p.x_advance
    round_box = lambda b: None if b is None else [round(v) for v in b]
    return x, round_box(boxes[ControlBoundsPen]), round_box(boxes[BoundsPen])


def texts_for(ttf, font, chars, seed):
    rnd = random.Random(seed)
    singles = [chr(c) for c in sorted(chars)]
    # Symbol faces have no letters: their other characters stand in.
    letters = [ch for ch in singles if ch.isalpha()] or [ch for ch in singles if not ch.isspace()]
    if not letters:
        return []
    marks = [ch for ch in singles if 0x300 <= ord(ch) <= 0x36F]
    texts = [t for t in SAMPLE if all(ord(ch) in chars or ch == " " for ch in t)]
    if marks:
        texts += [rnd.choice(letters) + rnd.choice(marks) + rnd.choice(marks) for _ in range(ACCENTED)]
    # The pairs kerned most among a sample: kerning on and off must differ there.
    pairs = {rnd.choice(letters) + rnd.choice(letters) for _ in range(400)}
    kerned = sorted(pairs, key=lambda p: (-abs(advance(font, p) - advance(font, p[0]) - advance(font, p[1])), p))
    texts += kerned[:KERNED]
    ligatures = [lig for lig in ligature_contexts(ttf) if all(ord(ch) in chars for ch in lig)]
    for lig in rnd.sample(ligatures, min(LIGATED, len(ligatures))):
        texts.append(lig + (rnd.choice(marks) if marks else ""))
    return texts


def fixture():
    out = []
    for file, (family, weight, style) in sorted(faces().items()):
        ttf = TTFont(OUT / file)
        ttf.flavor = None
        data = io.BytesIO()
        ttf.save(data)
        ttf = TTFont(io.BytesIO(data.getvalue()))
        font = hb.Font(hb.Face(hb.Blob(data.getvalue())))
        chars = set(latin_chars(ttf.getBestCmap() or {}))
        glyphs = ttf.getGlyphSet()
        rows = []
        # Seeded by the file's name, so adding a face leaves the others' texts as they were.
        for text in texts_for(ttf, font, chars, zlib.crc32(file.encode())):
            rows.append([text] + [list(layout(font, glyphs, text, kern)) for kern in (True, False)])
        # A symbol face (Monotype Sorts) has no Latin text to draw.
        if rows:
            out.append({"file": file, "family": family, "weight": weight, "style": style,
                        "upem": font.face.upem, "texts": rows})
    return out


def write():
    data = fixture()
    FIXTURE.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{len(data)} faces, {sum(len(f['texts']) for f in data)} texts -> {FIXTURE.relative_to(ROOT)}")


if __name__ == "__main__":
    write()
