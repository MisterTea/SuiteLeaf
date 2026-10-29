"""Glyphs for the Office symbol fonts: the best match in the open fonts we have, else our own drawing.

Each Office code that stands for a Unicode character is looked up in every font of the font cache whose
license lets its glyphs into an OFL font (OFL_COMPATIBLE); the candidate whose glyph, scaled into the Office
glyph's box, overlaps it best wins (choose). Our drawings in symbols/NAME.svg (suiteleaf_svg) take the codes
they draw; the build fails on a code neither covers.
"""
import json
import os
from functools import lru_cache
from pathlib import Path

from fontTools.ttLib import TTFont, TTCollection

import suiteleaf_fill as fill
import suiteleaf_sources

# The license of each folder of the font cache.
LICENSES = {
    "dejavu": "Bitstream Vera and DejaVu license (permissive)",
    "liberation": "OFL-1.1",
    "libertinus": "OFL-1.1",
    "texgyre": "GUST Font License",
    "croscore": "Apache-2.0",
    "jigmo": "CC0-1.0",
    "dmca": "OFL-1.1",
    "gfa": "Apache-2.0",
    "freefont": "GPL-3.0-or-later with font exception",
    "libertine": "GPL-2.0-or-later with font exception, or OFL-1.1",
    "tlwg": "GPL-2.0-or-later with font exception",
    "urw": "AGPL-3.0 with font exception",
    "ume": "Umefont license (permissive)",
    "baskervaldx": "GPL-2.0-or-later",
    "venturisadf": "Utopia license (TeX Users Group)",
}
# Google Fonts folders are OFL-1.1, but for these.
GF_LICENSES = {"tinos": "Apache-2.0", "arimo": "Apache-2.0", "cousine": "Apache-2.0"}
# The symbol faces are under the OFL, which must cover the whole font: glyphs come only from fonts whose
# license allows that (not the GPL, AGPL, or GUST licenses, or a license we have not read).
OFL_COMPATIBLE = {"OFL-1.1", "Apache-2.0", "CC0-1.0", "Bitstream Vera and DejaVu license (permissive)",
                  "Umefont license (permissive)", "GPL-2.0-or-later with font exception, or OFL-1.1"}
# License texts in the font cache for donors from folders without an OFL.txt, and their copyright lines.
LICENSE_FILES = {
    "dejavu": ["dejavu/LICENSE"], "liberation": ["liberation/LICENSE"], "libertinus": ["libertinus/OFL.txt"],
    "texgyre": ["texgyre/GUST-FONT-LICENSE.txt"], "croscore": ["licenses/Apache-2.0.txt"], "jigmo": ["jigmo/LICENSE.txt"],
    "gfa": ["gfa/luckiestguy/LICENSE.txt"], "freefont": ["freefont/copyright", "licenses/GPL-3.0.txt"],
    "libertine": ["libertine/copyright", "licenses/GPL-2.0.txt"], "tlwg": ["tlwg/copyright", "licenses/GPL-2.0.txt"],
    "urw": ["urw/LICENSE", "urw/COPYING"], "ume": ["ume/copyright"], "baskervaldx": ["baskervaldx/COPYING"],
    "venturisadf": ["venturisadf/LICENSE-utopia.txt"], "tinos": ["licenses/Apache-2.0.txt"],
    "arimo": ["licenses/Apache-2.0.txt"], "cousine": ["licenses/Apache-2.0.txt"],
}
NOTICES = {
    "dejavu": "Copyright Bitstream, Inc. (Bitstream Vera) and the DejaVu authors",
    "liberation": "Copyright 2010 Google Corporation and 2012 Red Hat, Inc.",
    "libertinus": "Copyright The Libertinus Project Authors",
    "texgyre": "Copyright B. Jackowski, J. M. Nowacki, and P. Strzelczyk (GUST e-foundry)",
    "croscore": "Digitized data copyright (c) 2010-2012 Google Corporation",
    "jigmo": "Jigmo, by Kamichi Koichi, dedicated to the public domain (CC0)",
    "freefont": "Copyright Free Software Foundation and the GNU FreeFont contributors",
    "libertine": "Copyright Philipp H. Poll (Linux Libertine)",
    "tlwg": "Copyright the Thai Linux Working Group and contributors",
    "urw": "Copyright URW++ Design & Development (URW++ Core Font Set)",
    "ume": "Copyright Wataru Horai (Umefont)",
    "baskervaldx": "Copyright Arkandis Digital Foundry (Baskervald ADF)",
    "venturisadf": "Copyright Arkandis Digital Foundry, from Adobe's Utopia",
    "tinos": "Digitized data copyright (c) 2010-2012 Google Corporation",
    "arimo": "Digitized data copyright (c) 2010-2012 Google Corporation",
    "cousine": "Digitized data copyright (c) 2010-2012 Google Corporation",
}
FONT_SUFFIXES = (".ttf", ".otf", ".ttc")


class Office(fill.Office):
    """An Office symbol face by its symbol codes (U+F020 on), whatever other character maps it has."""

    def __init__(self, path):
        super().__init__(path)
        self.cmap = dict(next(t for t in self.font["cmap"].tables if (t.platformID, t.platEncID) == (3, 0)).cmap)

    def inked(self):
        return sorted(c for c, g in self.cmap.items() if fill.bounds(self.gs, g))


def database(cache=suiteleaf_sources.DEFAULT_CACHE):
    """[(path relative to the cache, collection index, family name, license)] of every usable font."""
    cache = Path(cache)
    out = []
    for path in sorted(cache.rglob("*")):
        if path.suffix.lower() not in FONT_SUFFIXES:
            continue
        rel = path.relative_to(cache).as_posix()
        top = rel.split("/")[0]
        if top == "licenses":
            continue
        license = GF_LICENSES.get(rel.split("/")[1], "OFL-1.1") if top == "gf" else LICENSES.get(top, "see the font's notice")
        count = len(TTCollection(str(path)).fonts) if path.suffix.lower() == ".ttc" else 1
        for index in range(count):
            out.append((rel, index, license))
    return out


def index(cache=suiteleaf_sources.DEFAULT_CACHE):
    """{character: [(path, index, license)]} over the database, kept in the cache between builds."""
    cache = Path(cache)
    store = cache / "symbol-index.json"
    fonts = database(cache)
    stamp = [[p, i, l, os.path.getmtime(cache / p)] for p, i, l in fonts]
    if store.exists():
        saved = json.loads(store.read_text())
        if saved.get("fonts") == stamp:
            return {int(k): [tuple(x) for x in v] for k, v in saved["chars"].items()}
    chars = {}
    for p, i, l in fonts:
        try:
            cmap = TTFont(cache / p, fontNumber=i, lazy=True).getBestCmap() or {}
        except Exception:
            continue
        for c in cmap:
            chars.setdefault(c, []).append((p, i, l))
    store.write_text(json.dumps({"fonts": stamp, "chars": {str(k): v for k, v in chars.items()}}))
    return chars


@lru_cache(maxsize=None)
def family_name(path, index, cache=str(suiteleaf_sources.DEFAULT_CACHE)):
    font = TTFont(Path(cache) / path, fontNumber=index, lazy=True)
    return font["name"].getBestFamilyName() or Path(path).stem


def blank(path, index, cache=str(suiteleaf_sources.DEFAULT_CACHE)):
    """Fonts drawn empty on purpose (Adobe Blank) match nothing."""
    return "blank" in family_name(path, index, cache).lower()


@lru_cache(maxsize=None)
def weight(path, index, cache=str(suiteleaf_sources.DEFAULT_CACHE)):
    font = TTFont(Path(cache) / path, fontNumber=index, lazy=True)
    return font["OS/2"].usWeightClass if "OS/2" in font else 400


def _donor(path, idx, license, cache):
    return {"weight": weight(path, idx, str(cache)), "font": (str(Path(cache) / path), idx, None), "name": family_name(path, idx, str(cache)), "license": license,
            "notice": path.split("/")[1] if path.startswith("gf/") else path.split("/")[0], "path": path}


class Drawing:
    """A text set in one font, as one glyph: draw() replays its outline in the font's units."""

    def __init__(self, recording):
        self.recording = recording

    def draw(self, pen):
        self.recording.replay(pen)


@lru_cache(maxsize=256)
def text_drawing(full, idx, text):
    """The text shaped with HarfBuzz in a font, or None where the font lacks one of its characters."""
    import uharfbuzz as hb
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    from fontTools.pens.transformPen import TransformPen
    font, gs, cmap, upem = fill.donor_font(full, idx, None)
    if any(ord(ch) not in cmap for ch in text):
        return None
    hbfont = _hb_font(full, idx)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hbfont, buf)
    order = font.getGlyphOrder()
    rec = DecomposingRecordingPen(gs)
    x = 0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        if info.codepoint == 0:
            return None
        gs[order[info.codepoint]].draw(TransformPen(rec, (1, 0, 0, 1, x + pos.x_offset, pos.y_offset)))
        x += pos.x_advance
    return Drawing(rec)


@lru_cache(maxsize=64)
def _hb_font(full, idx):
    import uharfbuzz as hb
    return hb.Font(hb.Face(hb.Blob.from_file_path(full), idx))


def _score(office, code, gs, gname):
    t = fill.placement(office, code, (None, gs, None, None), gname, "symbol")
    if t is None:
        return None
    s = fill.PX / office.upem
    a = office.raster(code)
    b = fill.raster_from(gs, gname, (t[0] * s, 0, 0, t[3] * s, t[4] * s + 8, t[5] * s))
    return t, fill.iou(a, b)


# Families of plain, general-purpose design: a glyph of theirs is taken over a better-overlapping one of
# a display face (whose ÷ may be a flourish) unless that one overlaps clearly better.
PLAIN = ("Noto Sans", "Noto Serif", "Noto Emoji", "Noto Music", "DejaVu", "Liberation", "Arimo", "Tinos", "Cousine",
         "Libertinus", "Linux Libertine", "Jigmo", "STIX")
DISPLAY_MARGIN = 0.1


def best_matches(office, codes, cache=suiteleaf_sources.DEFAULT_CACHE, prefer=PLAIN):
    """{code: (overlap, donor dict, drawable, placement)} of the best candidate for each code {code: text or
    [texts]}: a font's glyph for a character, or a text it sets. The best of the `prefer` families (names
    they start with), in about the Office face's weight, stands unless another overlaps the Office glyph
    better by DISPLAY_MARGIN."""
    prefer = tuple(prefer)
    office_weight = office.font["OS/2"].usWeightClass if "OS/2" in office.font else 400
    chars = index(cache)
    best, best_plain = {}, {}

    def offer(code, score, donor, drawable, transform):
        pick = (score, donor, drawable, transform)
        if code not in best or score > best[code][0]:
            best[code] = pick
        if (donor["name"].startswith(prefer) and abs(donor["weight"] - office_weight) <= 150
                and (code not in best_plain or score > best_plain[code][0])):
            best_plain[code] = pick

    singles, texts = {}, []
    for code, wanted in codes.items():
        for text in [wanted] if isinstance(wanted, str) else wanted:
            if len(text) == 1:
                for spec in chars.get(ord(text), []):
                    singles.setdefault(spec, []).append((code, ord(text)))
            else:
                texts.append((code, text))
    for (path, idx, license), todo in singles.items():
        if license not in OFL_COMPATIBLE or blank(path, idx, str(cache)):
            continue
        full = str(Path(cache) / path)
        try:
            font, gs, cmap, upem = fill.donor_font(full, idx, None)
        except Exception:
            continue
        for code, cp in todo:
            gname = cmap.get(cp)
            if not gname or not fill.bounds(gs, gname):
                continue
            scored = _score(office, code, gs, gname)
            if scored:
                offer(code, scored[1], _donor(path, idx, license, cache), gs[gname], scored[0])
    for code, text in texts:
        fonts = None
        for ch in set(text):
            have = set(chars.get(ord(ch), []))
            fonts = have if fonts is None else fonts & have
        for path, idx, license in sorted(fonts or ()):
            if license not in OFL_COMPATIBLE or blank(path, idx, str(cache)):
                continue
            drawing = text_drawing(str(Path(cache) / path), idx, text)
            if drawing is None:
                continue
            scored = _score(office, code, {"text": drawing}, "text")
            if scored:
                offer(code, scored[1], _donor(path, idx, license, cache), drawing, scored[0])
    return {code: best_plain[code] if code in best_plain and best_plain[code][0] >= pick[0] - DISPLAY_MARGIN else pick
            for code, pick in best.items()}


# How the build credits glyphs drawn in symbols/*.svg: (name, license, notice).
OUR_DRAWINGS = ("SuiteLeaf drawings", "OFL-1.1", "")


def text_credits(symbol):
    """How the build credits the fonts a drawing's text copies outlines from: [(name, license, notice)]."""
    import suiteleaf_svg
    out = []
    for family in sorted(suiteleaf_svg.text_families(symbol)):
        path = suiteleaf_svg.TEXT_FONTS[family][0]
        folder = path.split("/")[1]
        out.append((family_name(path, 0), GF_LICENSES.get(folder, "OFL-1.1"), folder))
    return out


def drawings_name(office_file):
    """symbols/NAME.svg of an Office symbol face: its file name, lower case, without spaces."""
    return Path(office_file).stem.lower().replace(" ", "")


# A drawing of ours gives way only to an open font's glyph this close to the Office one.
CLOSER_THAN_OURS = 0.8
# Below this, a candidate is not the symbol at all.
LEAST = 0.02
TABLES_DIR = Path(__file__).resolve().parent / "symbols"


def preferred_for(table):
    """The families a face's glyphs come from first: symbols/TABLE.json's "_fonts" (a sans face's letters
    from sans fonts), else the plain families."""
    path = TABLES_DIR / f"{table}.json"
    return tuple(json.loads(path.read_text()).get("_fonts", PLAIN)) if path.exists() else PLAIN


def codes_for(table, office):
    """{code: text or [texts]} the Office face's codes stand for, from the dingbat tables or symbols/TABLE.json."""
    path = TABLES_DIR / f"{table}.json"
    if path.exists():
        data = json.loads(path.read_text())
        return {int(k, 16): v for k, v in data.items() if not k.startswith("_")}
    if table == "ZAPF DINGBATS":
        from suiteleaf_families import zapf_dingbats
        dmap = zapf_dingbats()
    else:
        from suiteleaf_build import dingbat_tables
        dmap = {int(k): v for k, v in dingbat_tables()[table].items()}
    return {c: chr(dmap[c & 0xFF]) for c in office.cmap if (c & 0xFF) in dmap}


def choose(office, table, drawings_name, cache=suiteleaf_sources.DEFAULT_CACHE):
    """{code: ("font", donor, drawable, placement, overlap) or ("svg", symbol element)} for every inked
    code of the Office face: our drawing where we made one (unless an open font matches closely), else
    the best open-font candidate. Raises on a code that has neither."""
    import suiteleaf_svg
    inked = office.inked()
    codes = {c: t for c, t in codes_for(table, office).items() if c in inked}
    best = best_matches(office, codes, cache, preferred_for(table))
    drawn = suiteleaf_svg.symbols(drawings_name)
    picks, missing = {}, []
    for code in inked:
        match = best.get(code)
        if code in drawn and not (match and match[0] >= CLOSER_THAN_OURS):
            picks[code] = ("svg", drawn[code])
        elif match and match[0] >= LEAST:
            picks[code] = ("font", match[1], match[2], match[3], match[0])
        else:
            missing.append(f"{code:04X}")
    if missing:
        raise RuntimeError(f"{office.path}: nothing draws {' '.join(missing)}; add them to symbols/{drawings_name}.svg")
    return picks
