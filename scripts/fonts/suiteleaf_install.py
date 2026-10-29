"""Write verified SuiteLeaf fonts into the app: WOFF2 files, license files, and name mappings."""
import json
import os
import tempfile
from collections import defaultdict
from pathlib import Path

from fontTools.ttLib import TTFont

import suiteleaf_families
from suiteleaf_shaping import worker_count
import suiteleaf_verify

BASES = {
    "SuiteLeaf Ironwood": ("Archivo (Black instance), Copyright 2020 The Archivo Project Authors", "Arial Black",
                           ["gf/archivo/OFL.txt"], "SIL Open Font License 1.1"),
    "SuiteLeaf Acorn": ("TeX Gyre Heros Bold, Copyright 2007-2009 B. Jackowski and J. M. Nowacki (GUST e-foundry)",
                        "Arial Rounded MT Bold", ["texgyre/GUST-FONT-LICENSE.txt"], "GUST Font License"),
    "SuiteLeaf Cedar": ("P052 from the URW++ Core Font Set 20200910, Copyright URW++ Design & Development",
                        "Book Antiqua", ["urw/LICENSE", "urw/COPYING"], "GNU AGPL 3.0 with font exception"),
    "SuiteLeaf Linden": ("P052 from the URW++ Core Font Set 20200910, Copyright URW++ Design & Development",
                         "Palatino Linotype", ["urw/LICENSE", "urw/COPYING"], "GNU AGPL 3.0 with font exception"),
    "SuiteLeaf Teak": ("Laksaman from fonts-tlwg 0.7.4, Copyright 2010-2011 Software Industry Promotion Agency (SIPA) "
                       "and 2014-2026 Theppitak Karoonboonyanan", "TH SarabunPSK", ["tlwg/copyright", "licenses/GPL-2.0.txt"],
                       "GNU GPL 2.0 or later with font exception"),
    "SuiteLeaf Sprig": ("symbol glyphs", "Wingdings", [], "SIL Open Font License 1.1"),
    "SuiteLeaf Fern": ("symbol glyphs", "Webdings", [], "SIL Open Font License 1.1"),
    "SuiteLeaf Bramble": ("symbol glyphs", "Wingdings 2", [], "SIL Open Font License 1.1"),
    "SuiteLeaf Briar": ("symbol glyphs", "Wingdings 3", [], "SIL Open Font License 1.1"),
    "SuiteLeaf Clover": ("symbol glyphs", "Monotype Sorts", [], "SIL Open Font License 1.1"),
    "SuiteLeaf Thistle": ("symbol glyphs", "Symbol", [], "SIL Open Font License 1.1"),
    "SuiteLeaf Nettle": ("symbol glyphs", "Marlett", [], "SIL Open Font License 1.1"),
    "SuiteLeaf Sorrel": ("symbol glyphs", "Bookshelf Symbol 7", [], "SIL Open Font License 1.1"),
    "SuiteLeaf Tansy": ("symbol glyphs", "MS Reference Specialty", [], "SIL Open Font License 1.1"),
    "SuiteLeaf Yarrow": ("symbol glyphs", "MT Extra", [], "SIL Open Font License 1.1"),
    "SuiteLeaf Willow": ("Carlito, Copyright 2013 The Carlito Project Authors", "Calibri", ["gf/carlito/OFL.txt"],
                         "SIL Open Font License 1.1"),
    "SuiteLeaf Aspen": ("Arimo, Copyright 2020 The Arimo Project Authors", "Arial", ["gf/arimo/OFL.txt"], "SIL Open Font License 1.1"),
    "SuiteLeaf Maple": ("Liberation Serif 2.1.5, Copyright 2010 Google Corporation and 2012 Red Hat, Inc.", "Times New Roman",
                        ["liberation/LICENSE"], "SIL Open Font License 1.1"),
    "SuiteLeaf Juniper": ("DMCA Sans Serif 9.0, Copyright (c) 2019 PB, released into the public domain by its author",
                          "Consolas", ["gf/notosans/OFL.txt"], "SIL Open Font License 1.1 (the source is public domain)"),
}
DONOR_TEXTS = {
    "DejaVu": ["dejavu/LICENSE"],
    "TeX Gyre DejaVu Math": ["texgyre/GUST-FONT-LICENSE.txt", "dejavu/LICENSE"],
    "Tinos": ["licenses/Apache-2.0.txt"],
    "Linux Libertine": ["libertine/copyright", "licenses/GPL-2.0.txt"],
    "FreeSerif": ["freefont/copyright", "licenses/GPL-3.0.txt"],
    "FreeSans": ["freefont/copyright", "licenses/GPL-3.0.txt"],
    "FreeMono": ["freefont/copyright", "licenses/GPL-3.0.txt"],
}
DONOR_NOTICES = {
    "DejaVu": "Copyright Bitstream, Inc. (Bitstream Vera) and the DejaVu authors",
    "TeX Gyre DejaVu Math": "Copyright B. Jackowski, P. Strzelczyk, and P. Pianowski (GUST e-foundry), from DejaVu",
    "Tinos": "Digitized data copyright (c) 2010-2012 Google Corporation (ChromeOS core fonts 1.23)",
    "Linux Libertine": "Copyright Philipp H. Poll (Linux Libertine 5.3.0)",
    "FreeSerif": "Copyright Free Software Foundation and the GNU FreeFont contributors",
}


for _family, _spec in suiteleaf_families.CATALOG["families"].items():
    _base = _spec["base"]
    BASES[_family] = (_base["credit"], _spec["office"], _base["files"], _base["license"])


SYMBOL_FAMILIES = {f[2] for f in suiteleaf_families.SYMBOL_FACES}


def slug(family, style):
    return f"{family.lower().replace(' ', '-')}-{style.lower().replace(' ', '-')}"


def font_copyright(folder):
    """The copyright line of the first font in a folder, for Google Fonts folders that ship no OFL.txt."""
    for path in sorted(folder.glob("*.[ot]tf")):
        return (TTFont(path, lazy=True)["name"].getDebugName(0) or "").strip()
    return ""


def ofl_notice(root, directory):
    path = root / "gf" / directory / "OFL.txt"
    if not path.exists():
        return font_copyright(path.parent)
    return path.read_text().split("This Font Software")[0].strip()


def read_license(root, name):
    """A license file from the cache; a Google Fonts folder without OFL.txt gets its font's copyright and the OFL text."""
    path = root / name
    if path.exists() or not name.startswith("gf/") or not name.endswith("OFL.txt"):
        return path.read_text().strip()
    body = (root / "gf/notosans/OFL.txt").read_text()
    return font_copyright(path.parent) + "\n\nThis Font Software" + body.split("This Font Software", 1)[1].rstrip()


def license_text(family, results, root):
    base, office_family, base_files, base_license = BASES[family]
    donors = defaultdict(int)
    for r in results:
        for name, lic, notice, count in r["donors"]:
            donors[(name, lic, notice)] += count
    styles = "its styles" if len(results) > 1 else "it"
    if family in SYMBOL_FAMILIES:
        lines = [f"{family} draws each symbol of {office_family} with the glyph of an open font that matches it best,",
                 "or, where no open font has the symbol, with a drawing made for SuiteLeaf (scripts/fonts/symbols/).",
                 "Each glyph was scaled to the height of the matching symbol and centered in its advance; advance widths,",
                 f"character codes, and line metrics were set from {office_family}'s layout. No outline shape was otherwise",
                 "changed. Each glyph keeps the license of the font it comes from, reproduced below; SuiteLeaf's drawings",
                 "are under the SIL Open Font License 1.1.", "", "Glyphs used:", ""]
    else:
        lines = [f"{family} is built from {base.rstrip('.')}.", "",
                 f"SuiteLeaf changed it so text lays out exactly as in {office_family}: outlines were scaled to that font's",
                 "units per em and moved sideways to center them in their advance; advance widths, kerning, glyph classes,",
                 "and line metrics were set from that font's layout. Where that font joins letters into a ligature, a",
                 "ligature glyph was made from this font's own letters, moved closer together. No outline shape was",
                 "otherwise changed."]
        approximate = {"Arab": "Arabic", "Hebr": "Hebrew"}
        loose = [approximate.get(t, t) for t in results[0].get("approximate", [])]
        if loose:
            lines += ["", f"{' and '.join(loose)} text lays out close to, but not exactly as, {office_family}: this font",
                      "chooses contextual forms and ligatures differently there, so lines can be slightly wider or narrower."]
        if donors:
            lines += ["", "Characters the source font lacks were filled with glyphs from these fonts, scaled and centered",
                      f"the same way (counts are across {styles}). Each keeps its own license, reproduced below; all are",
                      "compatible with the license of the whole font.", ""]
    symbol_files = {}
    if family in SYMBOL_FAMILIES:
        import suiteleaf_symbols
        symbol_files = {notice: suiteleaf_symbols.LICENSE_FILES.get(notice, []) for _, _, notice in donors}
    for (name, lic, notice), count in sorted(donors.items()):
        if symbol_files.get(notice):
            source = suiteleaf_symbols.NOTICES.get(notice, "")
        else:
            source = ofl_notice(root, notice) if notice else DONOR_NOTICES.get(name, "")
        lines.append(f"- {count} glyph{'' if count == 1 else 's'} from {name} ({lic}). {source}")
    lines += ["", "The build scripts are in scripts/fonts/ of the SuiteLeaf repository.", "",
              f"The font is distributed under the {base_license}, below."]
    lines += ["", "-" * 76, ""]
    for f in base_files:
        lines += [read_license(root, f), ""]
    included = set(base_files)
    if family in SYMBOL_FAMILIES:
        ofl = (root / "gf/notosanssymbols2/OFL.txt").read_text()
        lines += ["This Font Software" + ofl.split("This Font Software", 1)[1].rstrip(), ""]
    for (name, lic, notice) in sorted(donors):
        for f in symbol_files.get(notice) or DONOR_TEXTS.get(name, []):
            if f not in included:
                lines += ["-" * 76, "", f"{name}:", "", read_license(root, f), ""]
                included.add(f)
    return "\n".join(lines).rstrip() + "\n"


# Characters left out of the installed fonts: SuiteLeaf has no Chinese, Japanese, or Korean users, and
# these blocks are most of the size of the CJK faces. Their Latin and other text keeps its layout.
OMIT = [(0x1100, 0x11FF), (0x2E80, 0x2FFF), (0x3000, 0x303F), (0x3040, 0x30FF), (0x3100, 0x31FF), (0x3200, 0x33FF),
        (0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xA960, 0xA97F), (0xAC00, 0xD7FF), (0xF900, 0xFAFF), (0xFE30, 0xFE4F),
        (0xFF00, 0xFFEF), (0x1F200, 0x1F2FF), (0x20000, 0x3FFFF)]
# A face with fewer characters than this left after omitting is not installed.
MIN_CHARS = 50


def omitted(cp):
    return any(a <= cp <= b for a, b in OMIT)


def subset(font):
    """Drop the omitted characters (and the glyphs only they reach) from a font, in place."""
    from fontTools import subset as fts
    options = fts.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.glyph_names = True
    options.legacy_kern = True
    options.hinting = False
    options.drop_tables = []
    keep = [c for c in (font.getBestCmap() or {}) if not omitted(c)]
    subsetter = fts.Subsetter(options)
    subsetter.populate(unicodes=keep)
    subsetter.subset(font)
    return len(keep)


def _stage(args):
    """Subset and compress one face to WOFF2 and check the decoded font still matches its Office face.
    Returns None when nothing worth installing is left."""
    r, staged = args
    font = TTFont(r["path"])
    # A symbol face has no CJK to omit, and may map only symbol codes, which subsetting would drop.
    if r["script"] != "symbol" and subset(font) < MIN_CHARS:
        return None
    font.flavor = "woff2"
    font.save(staged)
    decoded = TTFont(staged)
    decoded.flavor = None
    plain = staged + ".ttf"
    decoded.save(plain)
    return suiteleaf_verify.check(r["office_path"], plain, r["script"], r.get("approximate", ()), OMIT)


def install(results, office_dir, root, out):
    """Write the faces into `out`. Several builds may install at once, so the writing holds a lock."""
    import fcntl
    out = Path(out)
    with open(Path(tempfile.gettempdir()) / "suiteleaf-install.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        _install(results, office_dir, root, out)


def _install(results, office_dir, root, out):
    from concurrent.futures import ProcessPoolExecutor
    out = Path(out)
    root = Path(root)
    mapping_path = out / "office-font-equivalents.json"
    mapping = json.loads(mapping_path.read_text()) if mapping_path.exists() else {}
    by_family = defaultdict(list)
    with tempfile.TemporaryDirectory() as tmp:
        staged = [str(Path(tmp) / f"{slug(r['family'], r['style'])}.woff2") for r in results]
        with ProcessPoolExecutor(worker_count(), max_tasks_per_child=8) as executor:
            checks = list(executor.map(_stage, zip(results, staged)))
        for r, path, check in zip(results, staged, checks):
            if check is not None and not check["ok"]:
                raise RuntimeError(f"{Path(path).name} no longer matches after subsetting and WOFF2 compression: {check}")
        kept = [(r, path) for r, path, check in zip(results, staged, checks) if check is not None]
        for r, _ in [(r, p) for r, p, c in zip(results, staged, checks) if c is None]:
            print(f"skipped {r['family']} {r['style']}: nothing left once CJK characters are omitted")
        results = [r for r, _ in kept]
        for r, path in kept:
            woff2 = out / Path(path).name
            woff2.write_bytes(Path(path).read_bytes())
            office_name = TTFont(r["office_path"])["name"].getDebugName(4)
            mapping[office_name] = TTFont(r["path"])["name"].getDebugName(4)
            by_family[r["family"]].append(r)
            print(f"wrote {woff2}")
    for family, rs in by_family.items():
        name = "LICENSE-" + family.replace(" ", "-") + ".txt"
        (out / name).write_text(license_text(family, rs, root))
    mapping_path.write_text(json.dumps(mapping, indent=2, ensure_ascii=False) + "\n")
    write_css(office_dir, out)
    import suiteleaf_browser_fixture as browser_fixture
    if Path(out).resolve() == browser_fixture.OUT.resolve():
        browser_fixture.write()
    # Cedar and Linden used to share one file; each family now has its own.
    (out / "LICENSE-SuiteLeaf-Cedar-Linden.txt").unlink(missing_ok=True)


def font_names(font, *ids):
    """Every name with these IDs, in any language, in order of first appearance."""
    out = []
    for record in font["name"].names:
        if record.nameID in ids:
            try:
                value = record.toUnicode()
            except UnicodeDecodeError:
                continue
            if value and value not in out:
                out.append(value)
    return out


def unicode_range(omit):
    """CSS unicode-range for every code point outside the omitted ranges."""
    parts, start = [], 0
    for a, b in sorted(omit):
        if a > start:
            parts.append(f"U+{start:X}-{a - 1:X}")
        start = b + 1
    parts.append(f"U+{start:X}-10FFFF")
    return ", ".join(parts)


# Families earlier builds put in documents, drawn and written back as the face that replaced them.
RETIRED = {"Symbol Neu": "SuiteLeaf Thistle"}


def write_css(office_dir, out):
    """office-fonts.css: an @font-face for each mapped Office face, under its Office family names, so text
    set in an Office font is drawn with the installed equivalent."""
    from fontTools.ttLib import TTCollection
    out = Path(out)
    mapping = json.loads((out / "office-font-equivalents.json").read_text())
    files = {}
    for path in sorted(out.glob("*.woff2")):
        files.setdefault(TTFont(path, lazy=True)["name"].getDebugName(4), path.name)
    rules, seen = [], set()
    to_suiteleaf, to_office = {}, {}
    # Faces whose reference comes with the operating system name it by absolute path in the catalog.
    elsewhere = sorted({face["office"] for spec in suiteleaf_families.CATALOG["families"].values()
                        for face in spec["faces"] if os.path.isabs(face["office"]) and os.path.exists(face["office"])})
    for path in [os.path.join(office_dir, f) for f in sorted(os.listdir(office_dir))] + elsewhere:
        if not path.lower().endswith((".ttf", ".otf", ".ttc")):
            continue
        for office in TTCollection(path).fonts if path.lower().endswith(".ttc") else [TTFont(path, lazy=True)]:
            target = mapping.get(office["name"].getDebugName(4))
            if target not in files:
                continue
            weight = office["OS/2"].usWeightClass
            style = "italic" if office["OS/2"].fsSelection & 1 or office["head"].macStyle & 2 else "normal"
            cjk = any(omitted(c) for c in (office.getBestCmap() or {}))
            ours = TTFont(out / files[target], lazy=True)
            our_legacy = ours["name"].getDebugName(1)
            our_typographic = ours["name"].getDebugName(16) or our_legacy
            office_legacy = office["name"].getDebugName(1)
            for name in font_names(office, 1):
                to_suiteleaf.setdefault(name, our_legacy)
            for name in font_names(office, 16):
                to_suiteleaf.setdefault(name, our_typographic)
            to_office.setdefault(our_legacy, office_legacy)
            to_office.setdefault(our_typographic, office["name"].getDebugName(16) or office_legacy)
            retired = [old for old, new in RETIRED.items() if new == our_legacy]
            for old in retired:
                to_office.setdefault(old, office_legacy)
            for family in font_names(office, 1, 16) + [our_legacy, our_typographic] + retired:
                key = (family, weight, style)
                if key in seen:
                    continue
                seen.add(key)
                rule = ['@font-face {', f'  font-family: "{family}";', f'  src: url("./{files[target]}") format("woff2");',
                        f"  font-weight: {weight};", f"  font-style: {style};", "  font-display: block;"]
                if cjk:
                    rule.append(f"  unicode-range: {unicode_range(OMIT)};")
                rules.append("\n".join(rule + ["}"]))
    header = ("/* Generated by scripts/fonts/suiteleaf_install.py from office-font-equivalents.json; do not edit.\n"
              "   Each Office face is drawn with the open font that lays out text the same way. Faces of CJK fonts\n"
              "   leave CJK characters to other faces (SuiteLeaf omits them from its fonts). */")
    (out / "office-fonts.css").write_text(header + "\n" + "\n".join(rules) + "\n")
    print(f"wrote {out / 'office-fonts.css'}: {len(rules)} faces")
    write_names(to_suiteleaf, to_office)


NAMES_TS = Path(__file__).resolve().parents[2] / "packages/core/src/office-font-names.ts"


def write_names(to_suiteleaf, to_office):
    """office-font-names.ts: Office family names to the families that lay out the same way, and back."""
    def entries(table):
        return "\n".join(f"  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},"
                         for k, v in sorted(table.items()) if k != v)
    NAMES_TS.write_text(
        "// Generated by scripts/fonts/suiteleaf_install.py; do not edit.\n"
        "/** Office font families (as documents name them, localized names too) and the installed family that lays out text the same way. */\n"
        f"export const OFFICE_TO_SUITELEAF: Record<string, string> = {{\n{entries(to_suiteleaf)}\n}};\n\n"
        "/** The installed families back to the Office family they stand in for, for files written for Office. */\n"
        f"export const SUITELEAF_TO_OFFICE: Record<string, string> = {{\n{entries(to_office)}\n}};\n")
    print(f"wrote {NAMES_TS}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Regenerate office-fonts.css from the installed fonts")
    parser.add_argument("--office", default="/Applications/Microsoft Word.app/Contents/Resources/DFonts")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[2] / "apps/web/src/fonts"))
    args = parser.parse_args()
    write_css(args.office, args.out)
