"""Which Office face each SuiteLeaf face follows, what it is built from, and its donors.

Source paths are relative to the download cache (see suiteleaf_sources.py). Donor
lists were chosen by scoring candidates from all of Google Fonts against the Office
glyphs; only the fonts that won glyphs are listed, so the build is reproducible.
"""
import json
import os
from pathlib import Path

# (Office file, face index, open source, variable instance, family, style, keep the source's own shaping)
FACES = [
    ("ariblk.ttf", 0, "gf/archivo/Archivo[wdth,wght].ttf", {"wght": 900, "wdth": 100}, "SuiteLeaf Ironwood", "Black", False),
    ("ArialRoundedMTBold.ttf", 0, "texgyre/texgyreheros-bold.otf", None, "SuiteLeaf Acorn", "Bold", False),
    ("Book Antiqua.ttf", 0, "urw/P052-Roman.ttf", None, "SuiteLeaf Cedar", "Regular", False),
    ("Book Antiqua Bold.ttf", 0, "urw/P052-Bold.ttf", None, "SuiteLeaf Cedar", "Bold", False),
    ("Book Antiqua Italic.ttf", 0, "urw/P052-Italic.ttf", None, "SuiteLeaf Cedar", "Italic", False),
    ("Book Antiqua Bold Italic.ttf", 0, "urw/P052-BoldItalic.ttf", None, "SuiteLeaf Cedar", "Bold Italic", False),
    ("pala.ttf", 0, "urw/P052-Roman.ttf", None, "SuiteLeaf Linden", "Regular", False),
    ("palab.ttf", 0, "urw/P052-Bold.ttf", None, "SuiteLeaf Linden", "Bold", False),
    ("palai.ttf", 0, "urw/P052-Italic.ttf", None, "SuiteLeaf Linden", "Italic", False),
    ("palabi.ttf", 0, "urw/P052-BoldItalic.ttf", None, "SuiteLeaf Linden", "Bold Italic", False),
    ("thsarabun.ttf", 0, "tlwg/Laksaman.ttf", None, "SuiteLeaf Teak", "Regular", True),
    ("thsarabun-bold.ttf", 0, "tlwg/Laksaman-Bold.ttf", None, "SuiteLeaf Teak", "Bold", True),
    ("thsarabun-italic.ttf", 0, "tlwg/Laksaman-Italic.ttf", None, "SuiteLeaf Teak", "Italic", True),
    ("thsarabun-bold-italic.ttf", 0, "tlwg/Laksaman-BoldItalic.ttf", None, "SuiteLeaf Teak", "Bold Italic", True),
    ("Calibri.ttf", 0, "gf/carlito/Carlito-Regular.ttf", None, "SuiteLeaf Willow", "Regular", False),
    ("Calibrib.ttf", 0, "gf/carlito/Carlito-Bold.ttf", None, "SuiteLeaf Willow", "Bold", False),
    ("Calibrii.ttf", 0, "gf/carlito/Carlito-Italic.ttf", None, "SuiteLeaf Willow", "Italic", False),
    ("Calibriz.ttf", 0, "gf/carlito/Carlito-BoldItalic.ttf", None, "SuiteLeaf Willow", "Bold Italic", False),
    ("calibril.ttf", 0, "gf/carlito/Carlito-Regular.ttf", None, "SuiteLeaf Willow", "Light", False),
    ("calibrili.ttf", 0, "gf/carlito/Carlito-Italic.ttf", None, "SuiteLeaf Willow", "Light Italic", False),
    ("arial.ttf", 0, "gf/arimo/Arimo[wght].ttf", {"wght": 400}, "SuiteLeaf Aspen", "Regular", False),
    ("arialbd.ttf", 0, "gf/arimo/Arimo[wght].ttf", {"wght": 700}, "SuiteLeaf Aspen", "Bold", False),
    ("ariali.ttf", 0, "gf/arimo/Arimo-Italic[wght].ttf", {"wght": 400}, "SuiteLeaf Aspen", "Italic", False),
    ("arialbi.ttf", 0, "gf/arimo/Arimo-Italic[wght].ttf", {"wght": 700}, "SuiteLeaf Aspen", "Bold Italic", False),
    ("times.ttf", 0, "liberation/LiberationSerif-Regular.ttf", None, "SuiteLeaf Maple", "Regular", False),
    ("timesbd.ttf", 0, "liberation/LiberationSerif-Bold.ttf", None, "SuiteLeaf Maple", "Bold", False),
    ("timesi.ttf", 0, "liberation/LiberationSerif-Italic.ttf", None, "SuiteLeaf Maple", "Italic", False),
    ("timesbi.ttf", 0, "liberation/LiberationSerif-BoldItalic.ttf", None, "SuiteLeaf Maple", "Bold Italic", False),
    ("Consola.ttf", 0, "dmca/DMCAsansserif-v0900-400.ttf", None, "SuiteLeaf Juniper", "Regular", False),
    ("Consolab.ttf", 0, "dmca/DMCAsansserif-v0900-700.ttf", None, "SuiteLeaf Juniper", "Bold", False),
    ("Consolai.ttf", 0, "dmca/DMCAsansserif-v0900-400-i.ttf", None, "SuiteLeaf Juniper", "Italic", False),
    ("Consolaz.ttf", 0, "dmca/DMCAsansserif-v0900-700-i.ttf", None, "SuiteLeaf Juniper", "Bold Italic", False),
]
# (Office file, its codes' characters: a dingbat-to-unicode table or symbols/NAME.json, family, style)
SYMBOL_FACES = [("Wingdings.ttf", "WINGDINGS", "SuiteLeaf Sprig", "Regular"),
                ("webdings.ttf", "WEBDINGS", "SuiteLeaf Fern", "Regular"),
                ("Wingdings 2.ttf", "WINGDINGS 2", "SuiteLeaf Bramble", "Regular"),
                ("Wingdings 3.ttf", "WINGDINGS 3", "SuiteLeaf Briar", "Regular"),
                ("MonotypeSorts.ttf", "ZAPF DINGBATS", "SuiteLeaf Clover", "Regular"),
                ("symbol.ttf", "SYMBOL", "SuiteLeaf Thistle", "Regular"),
                ("Marlett.ttf", "marlett", "SuiteLeaf Nettle", "Regular"),
                ("Bookshelf Symbol 7.ttf", "bookshelfsymbol7", "SuiteLeaf Sorrel", "Regular"),
                ("MS Reference Specialty.ttf", "msreferencespecialty", "SuiteLeaf Tansy", "Regular"),
                ("MTEXTRA.ttf", "mtextra", "SuiteLeaf Yarrow", "Regular")]


def zapf_dingbats():
    """Zapf Dingbats codes (Monotype Sorts uses the same layout) to Unicode: the Dingbats block was laid
    out from this font, and the few codes whose symbols Unicode already had point at those."""
    table = {code: 0x2700 + code - 0x20 for code in range(0x21, 0x7F)}
    table.update({0x25: 0x260E, 0x2A: 0x261B, 0x2B: 0x261E, 0x48: 0x2605, 0x6C: 0x25CF, 0x6E: 0x25A0,
                  0x73: 0x25B2, 0x74: 0x25BC, 0x75: 0x25C6, 0x77: 0x25D7})
    table.update({code: 0x2768 + code - 0x80 for code in range(0x80, 0x8E)})
    table.update({code: 0x2761 + code - 0xA1 for code in range(0xA1, 0xFF) if code != 0xF0})
    table.update({0xA8: 0x2663, 0xA9: 0x2666, 0xAA: 0x2665, 0xAB: 0x2660, 0xD5: 0x2192, 0xD6: 0x2194, 0xD7: 0x2195})
    table.update({code: 0x2460 + code - 0xAC for code in range(0xAC, 0xB6)})
    return table

DONOR_LICENSES = {
    "FreeSerif": "GPL-3.0-or-later with font exception",
    "FreeSans": "GPL-3.0-or-later with font exception",
    "FreeMono": "GPL-3.0-or-later with font exception",
    "DejaVu": "Bitstream Vera and DejaVu license (permissive)",
    "Tinos": "Apache-2.0",
    "Linux Libertine": "GPL-2.0-or-later with font exception, or OFL-1.1",
    "TeX Gyre DejaVu Math": "GUST Font License",
}
SERIF_DONORS = {
    # style: (FreeSerif, DejaVu Serif, Tinos, Linux Libertine)
    "Regular": ("FreeSerif.ttf", "DejaVuSerif.ttf", "Tinos-Regular.ttf", "LinLibertine_R.otf"),
    "Bold": ("FreeSerifBold.ttf", "DejaVuSerif-Bold.ttf", "Tinos-Bold.ttf", "LinLibertine_RB.otf"),
    "Italic": ("FreeSerifItalic.ttf", "DejaVuSerif-Italic.ttf", "Tinos-Italic.ttf", "LinLibertine_RI.otf"),
    "Bold Italic": ("FreeSerifBoldItalic.ttf", "DejaVuSerif-BoldItalic.ttf", "Tinos-BoldItalic.ttf", "LinLibertine_RBI.otf"),
}
# (path, variable instance, name): scored against Arial Black over every heavy upright OFL face.
IRONWOOD_DONORS = [
    ("gf/akt/Akt[wght].ttf", (("wght", 900.0),), "Akt"),
    ("gf/alegreyasans/AlegreyaSans-ExtraBold.ttf", None, "Alegreya Sans"),
    ("gf/chironheihk/ChironHeiHK[wght].ttf", (("wght", 800.0),), "Chiron Hei HK"),
    ("gf/chironheihk/ChironHeiHK[wght].ttf", (("wght", 900.0),), "Chiron Hei HK"),
    ("gf/golostext/GolosText[wght].ttf", (("wght", 800.0),), "Golos Text"),
    ("gf/gothica1/GothicA1-ExtraBold.ttf", None, "Gothic A1"),
    ("gf/jetbrainsmono/JetBrainsMono[wght].ttf", (("wght", 800.0),), "JetBrains Mono"),
    ("gf/lato/Lato-Black.ttf", None, "Lato"),
    ("gf/notosansmono/NotoSansMono[wdth,wght].ttf", (("wdth", 100.0), ("wght", 800.0)), "Noto Sans Mono"),
    ("gf/notosansmono/NotoSansMono[wdth,wght].ttf", (("wdth", 100.0), ("wght", 900.0)), "Noto Sans Mono"),
    ("gf/notoserifhk/NotoSerifHK[wght].ttf", (("wght", 900.0),), "Noto Serif HK"),
    ("gf/overpass/Overpass[wght].ttf", (("wght", 800.0),), "Overpass"),
    ("gf/sourcecodepro/SourceCodePro[wght].ttf", (("wght", 800.0),), "Source Code Pro"),
    ("gf/notosanssymbols2/NotoSansSymbols2-Regular.ttf", None, "Noto Sans Symbols 2"),
]
NOTO_SYMBOLS = [
    ("gf/notosanssymbols2/NotoSansSymbols2-Regular.ttf", None, "Noto Sans Symbols 2"),
    ("gf/notosanssymbols/NotoSansSymbols[wght].ttf", (("wght", 400.0),), "Noto Sans Symbols"),
    ("gf/notoemoji/NotoEmoji[wght].ttf", (("wght", 400.0),), "Noto Emoji"),
    ("gf/notosansmath/NotoSansMath-Regular.ttf", None, "Noto Sans Math"),
    ("gf/notosans/NotoSans[wdth,wght].ttf", (("wdth", 100.0), ("wght", 400.0)), "Noto Sans"),
]
# Pinned per family after scoring; filled in from the discovery run.
# Glyph donors per face, in the order they are tried; chosen from Google Fonts by suiteleaf_fill.choose.
GLYPH_DONORS = {
    ('SuiteLeaf Willow', 'Regular'): [
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Sans Display'),
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans Display'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Sans'),
        ('gf/arimo/Arimo[wght].ttf', (('wght', 500.0),), 'Arimo'),
        ('gf/arimo/Arimo[wght].ttf', (('wght', 400.0),), 'Arimo'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Sans Mono'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans Mono'),
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Sans Display'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Sans'),
        ('gf/notoserif/NotoSerif[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Serif'),
        ('gf/notoserif/NotoSerif[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Serif'),
        ('gf/charissil/CharisSIL-Regular.ttf', None, 'Charis SIL'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Sans Mono'),
        ('gf/iosevkacharon/IosevkaCharon-Medium.ttf', None, 'Iosevka Charon'),
        ('gf/iosevkacharon/IosevkaCharon-Regular.ttf', None, 'Iosevka Charon'),
        ('gf/notoserif/NotoSerif[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Serif'),
        ('gf/notosanslisu/NotoSansLisu[wght].ttf', (('wght', 400.0),), 'notosanslisu'),
        ('gf/notosansmath/NotoSansMath-Regular.ttf', None, 'notosansmath'),
    ],
    ('SuiteLeaf Willow', 'Bold'): [
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Sans Display'),
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Sans Display'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Sans'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Sans'),
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Sans Display'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Sans'),
        ('gf/arimo/Arimo[wght].ttf', (('wght', 600.0),), 'Arimo'),
        ('gf/arimo/Arimo[wght].ttf', (('wght', 700.0),), 'Arimo'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Sans Mono'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Sans Mono'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Sans Mono'),
        ('gf/iosevkacharon/IosevkaCharon-Bold.ttf', None, 'Iosevka Charon'),
        ('gf/notosanslisu/NotoSansLisu[wght].ttf', (('wght', 700.0),), 'notosanslisu'),
        ('gf/notosansmath/NotoSansMath-Regular.ttf', None, 'notosansmath'),
    ],
    ('SuiteLeaf Willow', 'Italic'): [
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Sans'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Sans Display'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans Display'),
        ('gf/arimo/Arimo-Italic[wght].ttf', (('wght', 400.0),), 'Arimo'),
        ('gf/arimo/Arimo-Italic[wght].ttf', (('wght', 500.0),), 'Arimo'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Sans'),
        ('gf/charissil/CharisSIL-Italic.ttf', None, 'Charis SIL'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Sans Display'),
        ('gf/notoserif/NotoSerif-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Serif'),
        ('gf/notoserif/NotoSerif-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Serif'),
        ('gf/iosevkacharon/IosevkaCharon-MediumItalic.ttf', None, 'Iosevka Charon'),
        ('gf/notoserif/NotoSerif-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Serif'),
        ('gf/iosevkacharon/IosevkaCharon-Italic.ttf', None, 'Iosevka Charon'),
        ('gf/iosevkacharon/IosevkaCharon-LightItalic.ttf', None, 'Iosevka Charon'),
        ('gf/notosanslisu/NotoSansLisu[wght].ttf', (('wght', 400.0),), 'notosanslisu'),
    ],
    ('SuiteLeaf Willow', 'Bold Italic'): [
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Sans'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Sans'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Sans'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Sans Display'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Sans Display'),
        ('gf/arimo/Arimo-Italic[wght].ttf', (('wght', 700.0),), 'Arimo'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Sans Display'),
        ('gf/arimo/Arimo-Italic[wght].ttf', (('wght', 600.0),), 'Arimo'),
        ('gf/gentiumbookplus/GentiumBookPlus-BoldItalic.ttf', None, 'Gentium Book Plus'),
        ('gf/charissil/CharisSIL-BoldItalic.ttf', None, 'Charis SIL'),
        ('gf/notoserif/NotoSerif-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Serif'),
        ('gf/notoserif/NotoSerif-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Serif'),
        ('gf/notoserif/NotoSerif-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Serif'),
        ('gf/iosevkacharon/IosevkaCharon-BoldItalic.ttf', None, 'Iosevka Charon'),
        ('gf/notosanslisu/NotoSansLisu[wght].ttf', (('wght', 700.0),), 'notosanslisu'),
    ],
    ('SuiteLeaf Willow', 'Light'): [
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans Display'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Sans'),
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Sans Display'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Sans Mono'),
        ('gf/arimo/Arimo[wght].ttf', (('wght', 400.0),), 'Arimo'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans Mono'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 200.0)), 'Noto Sans'),
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 200.0)), 'Noto Sans Display'),
        ('gf/notoserif/NotoSerif[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Serif'),
        ('gf/iosevkacharon/IosevkaCharon-Regular.ttf', None, 'Iosevka Charon'),
        ('gf/notoserif/NotoSerif[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Serif'),
        ('gf/iosevkacharon/IosevkaCharon-Light.ttf', None, 'Iosevka Charon'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 200.0)), 'Noto Sans Mono'),
        ('gf/notosanslisu/NotoSansLisu[wght].ttf', (('wght', 400.0),), 'notosanslisu'),
        ('gf/notosansmath/NotoSansMath-Regular.ttf', None, 'notosansmath'),
    ],
    ('SuiteLeaf Willow', 'Light Italic'): [
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Sans'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans Display'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Sans Display'),
        ('gf/arimo/Arimo-Italic[wght].ttf', (('wght', 400.0),), 'Arimo'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 200.0)), 'Noto Sans'),
        ('gf/notoserif/NotoSerif-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Serif'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 200.0)), 'Noto Sans Display'),
        ('gf/notoserif/NotoSerif-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Serif'),
        ('gf/iosevkacharon/IosevkaCharon-Italic.ttf', None, 'Iosevka Charon'),
        ('gf/iosevkacharonmono/IosevkaCharonMono-Italic.ttf', None, 'Iosevka Charon Mono'),
        ('gf/iosevkacharon/IosevkaCharon-LightItalic.ttf', None, 'Iosevka Charon'),
        ('gf/notoserif/NotoSerif-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 200.0)), 'Noto Serif'),
        ('gf/iosevkacharonmono/IosevkaCharonMono-LightItalic.ttf', None, 'Iosevka Charon Mono'),
        ('gf/notosanslisu/NotoSansLisu[wght].ttf', (('wght', 400.0),), 'notosanslisu'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'notosansmono'),
    ],
    ('SuiteLeaf Aspen', 'Regular'): [
        ('gf/ibmplexsansarabic/IBMPlexSansArabic-Regular.ttf', None, 'IBM Plex Sans Arabic'),
        ('gf/cairoplay/CairoPlay[slnt,wght].ttf', (('slnt', 0.0), ('wght', 500.0)), 'Cairo Play'),
        ('gf/ibmplexsansarabic/IBMPlexSansArabic-Medium.ttf', None, 'IBM Plex Sans Arabic'),
        ('gf/notosansarabic/NotoSansArabic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Sans Arabic'),
    ],
    ('SuiteLeaf Aspen', 'Bold'): [
        ('gf/ibmplexsansarabic/IBMPlexSansArabic-Bold.ttf', None, 'IBM Plex Sans Arabic'),
        ('gf/ibmplexsansarabic/IBMPlexSansArabic-SemiBold.ttf', None, 'IBM Plex Sans Arabic'),
        ('gf/cairo/Cairo[slnt,wght].ttf', (('slnt', 0.0), ('wght', 700.0)), 'Cairo'),
        ('gf/cairo/Cairo[slnt,wght].ttf', (('slnt', 0.0), ('wght', 800.0)), 'Cairo'),
    ],
    ('SuiteLeaf Aspen', 'Italic'): [
    ],
    ('SuiteLeaf Aspen', 'Bold Italic'): [
    ],
    ('SuiteLeaf Juniper', 'Regular'): [
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Sans Mono'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans Mono'),
        ('gf/cousine/Cousine-Regular.ttf', None, 'Cousine'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Sans'),
        ('gf/firasans/FiraSans-Regular.ttf', None, 'Fira Sans'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans'),
        ('gf/chocolateclassicalsans/ChocolateClassicalSans-Regular.ttf', None, 'Chocolate Classical Sans'),
        ('gf/mplus1p/MPLUS1p-Medium.ttf', None, 'M PLUS 1p'),
        ('gf/andika/Andika-Regular.ttf', None, 'Andika'),
        ('gf/chironheihk/ChironHeiHK[wght].ttf', (('wght', 400.0),), 'Chiron Hei HK'),
        ('gf/gothica1/GothicA1-Medium.ttf', None, 'Gothic A1'),
        ('gf/chironheihk/ChironHeiHK[wght].ttf', (('wght', 500.0),), 'Chiron Hei HK'),
        ('gf/firasans/FiraSans-Medium.ttf', None, 'Fira Sans'),
        ('gf/carlito/Carlito-Regular.ttf', None, 'Carlito'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Sans Mono'),
    ],
    ('SuiteLeaf Juniper', 'Bold'): [
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Sans Mono'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Sans Mono'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Sans Mono'),
        ('gf/firasans/FiraSans-SemiBold.ttf', None, 'Fira Sans'),
        ('gf/chironheihk/ChironHeiHK[wght].ttf', (('wght', 600.0),), 'Chiron Hei HK'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Sans'),
        ('gf/chironheihk/ChironHeiHK[wght].ttf', (('wght', 700.0),), 'Chiron Hei HK'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Sans'),
        ('gf/firasans/FiraSans-Bold.ttf', None, 'Fira Sans'),
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Sans Display'),
        ('gf/roundedmplus1c/RoundedMplus1c-ExtraBold.ttf', None, 'Rounded Mplus 1c'),
        ('gf/roundedmplus1c/RoundedMplus1c-Bold.ttf', None, 'Rounded Mplus 1c Bold'),
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Sans Display'),
        ('gf/mplus1p/MPLUS1p-Bold.ttf', None, 'M PLUS 1p'),
        ('gf/chironheihk/ChironHeiHK[wght].ttf', (('wght', 800.0),), 'Chiron Hei HK'),
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Sans Display'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Sans'),
        ('gf/mplus1p/MPLUS1p-ExtraBold.ttf', None, 'M PLUS 1p'),
        ('gf/firasanscondensed/FiraSansCondensed-ExtraBold.ttf', None, 'Fira Sans Condensed'),
        ('gf/firasanscondensed/FiraSansCondensed-Bold.ttf', None, 'Fira Sans Condensed'),
    ],
    ('SuiteLeaf Juniper', 'Italic'): [
        ('gf/cousine/Cousine-Italic.ttf', None, 'Cousine'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Sans'),
        ('gf/chironheihk/ChironHeiHK-Italic[wght].ttf', (('wght', 500.0),), 'Chiron Hei HK'),
        ('gf/firasans/FiraSans-MediumItalic.ttf', None, 'Fira Sans'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans'),
        ('gf/firasans/FiraSans-Italic.ttf', None, 'Fira Sans'),
        ('gf/arimo/Arimo-Italic[wght].ttf', (('wght', 500.0),), 'Arimo'),
        ('gf/chironheihk/ChironHeiHK-Italic[wght].ttf', (('wght', 400.0),), 'Chiron Hei HK'),
        ('gf/arimo/Arimo-Italic[wght].ttf', (('wght', 400.0),), 'Arimo'),
        ('gf/carlito/Carlito-Italic.ttf', None, 'Carlito'),
        ('gf/savate/Savate-Italic[wght].ttf', (('wght', 500.0),), 'Savate'),
        ('gf/savate/Savate-Italic[wght].ttf', (('wght', 400.0),), 'Savate'),
        ('gf/lato/Lato-MediumItalic.ttf', None, 'Lato'),
        ('gf/firasansextracondensed/FiraSansExtraCondensed-MediumItalic.ttf', None, 'Fira Sans Extra Condensed'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'notosansmono'),
    ],
    ('SuiteLeaf Juniper', 'Bold Italic'): [
        ('gf/cousine/Cousine-BoldItalic.ttf', None, 'Cousine'),
        ('gf/chironheihk/ChironHeiHK-Italic[wght].ttf', (('wght', 800.0),), 'Chiron Hei HK'),
        ('gf/chironheihk/ChironHeiHK-Italic[wght].ttf', (('wght', 700.0),), 'Chiron Hei HK'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Sans'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Sans'),
        ('gf/firasans/FiraSans-BoldItalic.ttf', None, 'Fira Sans'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Sans Display'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Sans'),
        ('gf/firasans/FiraSans-ExtraBoldItalic.ttf', None, 'Fira Sans'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Sans Display'),
        ('gf/chironheihk/ChironHeiHK-Italic[wght].ttf', (('wght', 600.0),), 'Chiron Hei HK'),
        ('gf/firasans/FiraSans-SemiBoldItalic.ttf', None, 'Fira Sans'),
        ('gf/arimo/Arimo-Italic[wght].ttf', (('wght', 700.0),), 'Arimo'),
        ('gf/arimo/Arimo-Italic[wght].ttf', (('wght', 600.0),), 'Arimo'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Sans Display'),
        ('gf/notosansmono/NotoSansMono[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'notosansmono'),
    ],

    ('SuiteLeaf Maple', 'Regular'): [
        ('gf/libertinusmath/LibertinusMath-Regular.ttf', None, 'Libertinus Math'),
        ('gf/cardo/Cardo-Regular.ttf', None, 'Cardo'),
        ('gf/ebgaramond/EBGaramond[wght].ttf', (('wght', 500.0),), 'EB Garamond'),
        ('gf/charissil/CharisSIL-Regular.ttf', None, 'Charis SIL'),
        ('gf/ebgaramond/EBGaramond[wght].ttf', (('wght', 400.0),), 'EB Garamond'),
        ('gf/gentiumbookplus/GentiumBookPlus-Regular.ttf', None, 'Gentium Book Plus'),
        ('gf/caudex/Caudex-Regular.ttf', None, 'Caudex'),
        ('gf/notoserif/NotoSerif[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Serif'),
        ('gf/notoserif/NotoSerif[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Serif'),
        ('gf/notoserifdisplay/NotoSerifDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Serif Display'),
        ('gf/notoserifdisplay/NotoSerifDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Serif Display'),
        ('gf/notoserif/NotoSerif[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Serif'),
        ('gf/andika/Andika-Regular.ttf', None, 'Andika'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Sans'),
        ('gf/arimo/Arimo[wght].ttf', (('wght', 500.0),), 'Arimo'),
        ('gf/googlesans/GoogleSans[GRAD,opsz,wght].ttf', (('GRAD', 0.0), ('opsz', 18.0), ('wght', 500.0)), 'Google Sans'),
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Sans Display'),
        ('gf/notoserifdisplay/NotoSerifDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Serif Display'),
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans Display'),
        ('gf/inter/Inter[opsz,wght].ttf', (('opsz', 14.0), ('wght', 500.0)), 'Inter'),
        ('gf/arimo/Arimo[wght].ttf', (('wght', 400.0),), 'Arimo'),
        ('gf/notoserifarmenian/NotoSerifArmenian[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Serif Armenian'),
        ('gf/notosanssymbols/NotoSansSymbols[wght].ttf', (('wght', 400.0),), 'Noto Sans Symbols'),
    ],
    ('SuiteLeaf Maple', 'Bold'): [
        ('gf/ebgaramond/EBGaramond[wght].ttf', (('wght', 700.0),), 'EB Garamond'),
        ('gf/ebgaramond/EBGaramond[wght].ttf', (('wght', 800.0),), 'EB Garamond'),
        ('gf/ebgaramond/EBGaramond[wght].ttf', (('wght', 600.0),), 'EB Garamond'),
        ('gf/notoserif/NotoSerif[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Serif'),
        ('gf/charissil/CharisSIL-Bold.ttf', None, 'Charis SIL'),
        ('gf/notoserif/NotoSerif[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Serif'),
        ('gf/notoserifdisplay/NotoSerifDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Serif Display'),
        ('gf/notoserifdisplay/NotoSerifDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Serif Display'),
        ('gf/gentiumbookplus/GentiumBookPlus-Bold.ttf', None, 'Gentium Book Plus'),
        ('gf/notoserif/NotoSerif[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Serif'),
        ('gf/andika/Andika-Bold.ttf', None, 'Andika'),
        ('gf/notoserifdisplay/NotoSerifDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Serif Display'),
        ('gf/inter/Inter[opsz,wght].ttf', (('opsz', 14.0), ('wght', 800.0)), 'Inter'),
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Sans Display'),
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Sans Display'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Sans'),
        ('gf/notosans/NotoSans[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Sans'),
        ('gf/arimo/Arimo[wght].ttf', (('wght', 700.0),), 'Arimo'),
        ('gf/notosansdisplay/NotoSansDisplay[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Sans Display'),
        ('gf/googlesans/GoogleSans[GRAD,opsz,wght].ttf', (('GRAD', 0.0), ('opsz', 18.0), ('wght', 700.0)), 'Google Sans'),
        ('gf/notoserifarmenian/NotoSerifArmenian[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Serif Armenian'),
        ('gf/notosanssymbols/NotoSansSymbols[wght].ttf', (('wght', 700.0),), 'Noto Sans Symbols'),
    ],
    ('SuiteLeaf Maple', 'Italic'): [
        ('gf/notoserif/NotoSerif-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Serif'),
        ('gf/charissil/CharisSIL-Italic.ttf', None, 'Charis SIL'),
        ('gf/notoserif/NotoSerif-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Serif'),
        ('gf/ebgaramond/EBGaramond-Italic[wght].ttf', (('wght', 400.0),), 'EB Garamond'),
        ('gf/notoserifdisplay/NotoSerifDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Serif Display'),
        ('gf/ebgaramond/EBGaramond-Italic[wght].ttf', (('wght', 500.0),), 'EB Garamond'),
        ('gf/notoserifdisplay/NotoSerifDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Serif Display'),
        ('gf/cardo/Cardo-Italic.ttf', None, 'Cardo'),
        ('gf/notoserif/NotoSerif-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Serif'),
        ('gf/gentiumbookplus/GentiumBookPlus-Italic.ttf', None, 'Gentium Book Plus'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Sans'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 500.0)), 'Noto Sans Display'),
        ('gf/arimo/Arimo-Italic[wght].ttf', (('wght', 500.0),), 'Arimo'),
        ('gf/googlesans/GoogleSans-Italic[GRAD,opsz,wght].ttf', (('GRAD', 0.0), ('opsz', 18.0), ('wght', 500.0)), 'Google Sans'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans Display'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Sans'),
        ('gf/gentiumplus/GentiumPlus-Italic.ttf', None, 'Gentium Plus'),
        ('gf/arimo/Arimo-Italic[wght].ttf', (('wght', 400.0),), 'Arimo'),
        ('gf/intertight/InterTight-Italic[wght].ttf', (('wght', 500.0),), 'Inter Tight'),
        ('gf/notoserifdisplay/NotoSerifDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 300.0)), 'Noto Serif Display'),
        ('gf/inter/Inter-Italic[opsz,wght].ttf', (('opsz', 14.0), ('wght', 500.0)), 'Inter'),
        ('gf/notoserifarmenian/NotoSerifArmenian[wdth,wght].ttf', (('wdth', 100.0), ('wght', 400.0)), 'Noto Serif Armenian'),
        ('gf/notosanssymbols/NotoSansSymbols[wght].ttf', (('wght', 400.0),), 'Noto Sans Symbols'),
    ],
    ('SuiteLeaf Maple', 'Bold Italic'): [
        ('gf/ebgaramond/EBGaramond-Italic[wght].ttf', (('wght', 600.0),), 'EB Garamond'),
        ('gf/ebgaramond/EBGaramond-Italic[wght].ttf', (('wght', 700.0),), 'EB Garamond'),
        ('gf/notoserif/NotoSerif-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Serif'),
        ('gf/ebgaramond/EBGaramond-Italic[wght].ttf', (('wght', 800.0),), 'EB Garamond'),
        ('gf/notoserif/NotoSerif-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Serif'),
        ('gf/notoserifdisplay/NotoSerifDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Serif Display'),
        ('gf/charissil/CharisSIL-BoldItalic.ttf', None, 'Charis SIL'),
        ('gf/notoserif/NotoSerif-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Serif'),
        ('gf/notoserifdisplay/NotoSerifDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Serif Display'),
        ('gf/gentiumbookplus/GentiumBookPlus-BoldItalic.ttf', None, 'Gentium Book Plus'),
        ('gf/notoserifdisplay/NotoSerifDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Serif Display'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Sans'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 800.0)), 'Noto Sans Display'),
        ('gf/gentiumplus/GentiumPlus-BoldItalic.ttf', None, 'Gentium Plus'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Sans'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Sans Display'),
        ('gf/arimo/Arimo-Italic[wght].ttf', (('wght', 700.0),), 'Arimo'),
        ('gf/notosans/NotoSans-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Sans'),
        ('gf/notosansdisplay/NotoSansDisplay-Italic[wdth,wght].ttf', (('wdth', 100.0), ('wght', 600.0)), 'Noto Sans Display'),
        ('gf/intertight/InterTight-Italic[wght].ttf', (('wght', 800.0),), 'Inter Tight'),
        ('gf/notoserifarmenian/NotoSerifArmenian[wdth,wght].ttf', (('wdth', 100.0), ('wght', 700.0)), 'Noto Serif Armenian'),
        ('gf/notosanssymbols/NotoSansSymbols[wght].ttf', (('wght', 700.0),), 'Noto Sans Symbols'),
    ],
}


def weight_of(style):
    return 300 if "Light" in style else 700 if "Bold" in style else 900 if "Black" in style else 400


def gf_donor(src, path, coords, name):
    if not path.startswith("gf/"):
        return {"font": (src(path), 0, coords), "name": name, "license": DONOR_LICENSES[name]}
    return {"font": (src(path), 0, coords), "name": name, "license": "OFL-1.1", "notice": path.split("/")[1]}


def donors_for(src, family, style):
    """License-compatible glyph donors for each family, matched to the style."""
    pool_file = os.environ.get("SUITELEAF_DONOR_POOL")
    if pool_file:
        pools = json.load(open(pool_file))
        if family in pools and style in pools[family]:
            return [{"font": (p, 0, tuple(map(tuple, c)) if c else None), "name": n, "license": "OFL-1.1", "notice": d, "path": p}
                    for p, c, n, d in pools[family][style]]
    dejavu_bold = {"font": (src("dejavu/DejaVuSans-Bold.ttf"), 0, None), "name": "DejaVu", "license": DONOR_LICENSES["DejaVu"]}
    if family == "SuiteLeaf Ironwood":
        return [gf_donor(src, *d) for d in IRONWOOD_DONORS] + [dejavu_bold]
    if family == "SuiteLeaf Acorn":
        return [dejavu_bold, {"font": (src("texgyre/texgyredejavu-math.otf"), 0, None), "name": "TeX Gyre DejaVu Math",
                              "license": DONOR_LICENSES["TeX Gyre DejaVu Math"]}]
    if family in ("SuiteLeaf Cedar", "SuiteLeaf Linden"):
        free, djv, tinos, lib = SERIF_DONORS[style]
        return [{"font": (src("freefont/" + free), 0, None), "name": "FreeSerif", "license": DONOR_LICENSES["FreeSerif"]},
                {"font": (src("dejavu/" + djv), 0, None), "name": "DejaVu", "license": DONOR_LICENSES["DejaVu"]},
                {"font": (src("croscore/" + tinos), 0, None), "name": "Tinos", "license": DONOR_LICENSES["Tinos"]},
                {"font": (src("libertine/" + lib), 0, None), "name": "Linux Libertine", "license": DONOR_LICENSES["Linux Libertine"]}]
    return [gf_donor(src, *d) for d in GLYPH_DONORS.get((family, style), [])]


# Scripts whose layout is close to, but not exactly, the Office face's: the open
# fonts choose contextual forms and ligatures differently. Verification reports them
# separately, and the license file says so.
APPROXIMATE_SCRIPTS = {"SuiteLeaf Willow": ("Arab", "Hebr"), "SuiteLeaf Aspen": ("Arab", "Hebr"),
                       "SuiteLeaf Maple": ("Arab", "Hebr")}


def merges_for(family, style):
    """Whole scripts merged from a donor: {script: (path, variable instance, name)}."""
    if family in CATALOG["families"]:
        merges = CATALOG["families"][family].get("merges", {}).get(style, {})
        return {k: (p, tuple(map(tuple, c)) if c else None, n) for k, (p, c, n) in merges.items()}
    w = weight_of(style)
    italic = "Italic" in style
    arimo = "gf/arimo/Arimo-Italic[wght].ttf" if italic else "gf/arimo/Arimo[wght].ttf"
    if family == "SuiteLeaf Willow":
        return {"ARABIC": ("gf/notosansarabicui/NotoSansArabicUI[wdth,wght].ttf", (("wdth", 100.0), ("wght", float(w))), "Noto Sans Arabic UI"),
                "HEBREW": (arimo, (("wght", float(min(max(w, 400), 700))),), "Arimo")}
    if family == "SuiteLeaf Aspen":
        return {"ARABIC": ("gf/notonaskharabicui/NotoNaskhArabicUI[wght].ttf", (("wght", float(min(w, 700))),), "Noto Naskh Arabic UI")}
    if family == "SuiteLeaf Maple":
        return {"ARABIC": ("gf/notonaskharabic/NotoNaskhArabic[wght].ttf", (("wght", float(min(w, 700))),), "Noto Naskh Arabic")}
    return {}


# The families the catalog adds: every other Office family, each built from one open family where possible.
CATALOG = json.loads(Path(__file__).with_name("suiteleaf_catalog.json").read_text())
for _family, _spec in CATALOG["families"].items():
    # Arabic and Hebrew may come close rather than exact, as in the hand-written families.
    APPROXIMATE_SCRIPTS[_family] = tuple(sorted(set(_spec.get("approximate", ())) | {"Arab", "Hebr"}))
    for _face in _spec["faces"]:
        FACES.append((_face["office"], _face["index"], _face["source"], _face["coords"], _family, _face["style"],
                      _face.get("options", False)))
        GLYPH_DONORS[(_family, _face["style"])] = [(p, tuple(map(tuple, c)) if c else None, n) for p, c, n in _face["donors"]]
