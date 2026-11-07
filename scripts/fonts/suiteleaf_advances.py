"""Generate layout advances from the same font-face files used by the renderer.

Run after suiteleaf_install.py. Equal consecutive advances are range encoded;
the values are font units, without rounding or family-specific corrections.
"""
import json
import re
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
FONTS = ROOT / "apps/web/src/fonts"


def generate(fonts=FONTS):
    fonts = Path(fonts)
    faces, families, files = [], {}, {}
    for block in re.findall(r"@font-face\s*\{([^}]+)\}", (fonts / "office-fonts.css").read_text()):
        family = re.search(r'font-family:\s*"([^"]+)"', block)[1].lower()
        filename = re.search(r'url\("\./([^"]+)"\)', block)[1]
        weight = int(re.search(r"font-weight:\s*(\d+)", block)[1])
        italic = "font-style: italic" in block
        if filename not in files:
            font = TTFont(fonts / filename)
            widths = font["hmtx"].metrics
            ranges = []
            cmap = font.getBestCmap() or next((table.cmap for table in font["cmap"].tables if table.cmap), {})
            for code, glyph in sorted(cmap.items()):
                advance = widths[glyph][0]
                if ranges and ranges[-1][1] + 1 == code and ranges[-1][2] == advance:
                    ranges[-1][1] = code
                else:
                    ranges.append([code, code, advance])
            files[filename] = len(faces)
            faces.append([font["head"].unitsPerEm, widths[font.getGlyphOrder()[0]][0], ranges])
        families.setdefault(family, []).append([weight, int(italic), files[filename]])
    result = {"families": families, "faces": faces}
    target = ROOT / "packages/core/src/font-advances-data.json"
    target.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    print(f"{len(faces)} faces; {target.stat().st_size} bytes")


if __name__ == "__main__":
    generate()
