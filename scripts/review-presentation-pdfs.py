"""Render every PDF page at 96 dpi for manual presentation fidelity review.

Requires PyMuPDF and Pillow. Scores flag differences; they never certify a match.
Usage: python scripts/review-presentation-pdfs.py reference.pdf suiteleaf.pdf output
"""

import argparse
import json
from pathlib import Path

import pymupdf
from PIL import Image, ImageChops, ImageDraw, ImageStat


def render(page):
    pix = page.get_pixmap(dpi=96, colorspace=pymupdf.csRGB, alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def lines(page):
    result = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            result.append({
                "text": "".join(span["text"] for span in line["spans"]),
                "bbox_px": [round(value * 96 / 72, 2) for value in line["bbox"]],
                "fonts": sorted({span["font"] for span in line["spans"]}),
            })
    return result


def compare(reference, exported, output):
    output.mkdir(parents=True, exist_ok=True)
    report = {
        "reference": str(reference.resolve()),
        "suiteleaf": str(exported.resolve()),
        "dpi": 96,
        "tolerance_px": 5,
        "status": "review-required",
        "note": "Raster metrics include permitted glyph differences. Review every page; do not automatically accept.",
        "pages": [],
    }
    thumbnails = []
    with pymupdf.open(reference) as original, pymupdf.open(exported) as actual:
        report["reference_pages"] = len(original)
        report["suiteleaf_pages"] = len(actual)
        for index in range(max(len(original), len(actual))):
            row = {"page": index + 1}
            report["pages"].append(row)
            if index >= min(len(original), len(actual)):
                row["status"] = "missing-page"
                continue
            a, b = render(original[index]), render(actual[index])
            stem = f"page-{index + 1:04d}"
            a.save(output / f"{stem}-reference.png")
            b.save(output / f"{stem}-suiteleaf.png")
            row.update(reference_size=a.size, suiteleaf_size=b.size,
                       reference_lines=lines(original[index]),
                       suiteleaf_lines=lines(actual[index]))
            if a.size == b.size:
                diff = ImageChops.difference(a, b)
                row["normalized_rgb_rmse"] = (sum(x*x for x in ImageStat.Stat(diff).rms) / 3)**0.5 / 255
                diff.save(output / f"{stem}-difference.png")
                Image.blend(a, b, 0.5).save(output / f"{stem}-overlay.png")
            pair = Image.new("RGB", (800, 250), "#dddddd")
            draw = ImageDraw.Draw(pair)
            draw.text((8, 3), f"Page {index + 1} - Office / SuiteLeaf", fill="black")
            for x, picture in [(0, a), (400, b)]:
                picture.thumbnail((400, 225))
                pair.paste(picture, (x, 23))
            thumbnails.append(pair)
    for offset in range(0, len(thumbnails), 6):
        batch = thumbnails[offset:offset + 6]
        contact = Image.new("RGB", (800, 250 * len(batch)), "white")
        for index, pair in enumerate(batch):
            contact.paste(pair, (0, index * 250))
        contact.save(output / f"contact-{offset // 6 + 1:02d}.png")
    (output / "comparison.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "pages"}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("exported", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    compare(args.reference, args.exported, args.output)
