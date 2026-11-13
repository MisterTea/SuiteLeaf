#!/usr/bin/env python3
"""Zenodo10K PPTX pipeline: convert a pptx via SuiteLeaf CLI, compare to ground-truth PDF.

Usage:
  python3 scripts/zenodo-pipeline.py <pptx-path> <output-dir>

Looks up the ground-truth PDF from the ground-truth-pdf/*.json sidecar files
(matched by pptx basename), runs the SuiteLeaf CLI convert, then compares the
exported PDF against the ground-truth PDF using the raster comparison tool.

Writes <output-dir>/result.json and prints a one-line summary.
"""
import argparse, glob, json, os, subprocess, sys
from pathlib import Path

GT_DIR = "/Volumes/GauciNAS/Datasets/zenodo10k/ground-truth-pdf"
SL_CLI = "/Applications/SuiteLeaf.app/Contents/MacOS/SuiteLeaf"


def load_gt_map():
    m = {}
    for j in glob.glob(os.path.join(GT_DIR, "*.json")):
        try:
            d = json.load(open(j))
        except Exception:
            continue
        m[os.path.basename(d.get("source", ""))] = os.path.basename(d.get("pdf", ""))
    return m


def find_gt(pptx_path, gt_map):
    base = os.path.basename(pptx_path)
    if base in gt_map:
        return os.path.join(GT_DIR, gt_map[base])
    return None


def run_cli(pptx_path, out_pdf):
    r = subprocess.run(
        [SL_CLI, "convert", pptx_path, "--to", "pdf", "--output", out_pdf],
        capture_output=True, text=True,
    )
    return r.returncode, r.stdout, r.stderr


def compare(gt_pdf, exported_pdf, dest):
    r = subprocess.run(
        [sys.executable, os.path.join(os.path.dirname(__file__), "compare-pptx-pdfs.py"),
         gt_pdf, exported_pdf, dest],
        capture_output=True, text=True,
    )
    report_path = os.path.join(dest, "comparison.json")
    report = None
    if os.path.exists(report_path):
        try:
            report = json.load(open(report_path))
        except Exception:
            pass
    return r.returncode, report


def main():
    p = argparse.ArgumentParser()
    p.add_argument("pptx")
    p.add_argument("output_dir")
    a = p.parse_args()
    out_dir = Path(a.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    gt_map = load_gt_map()
    gt_pdf = find_gt(a.pptx, gt_map)
    if gt_pdf is None:
        print(f"NO-GROUND-TRUTH {os.path.basename(a.pptx)}")
        (out_dir / "result.json").write_text(json.dumps({"pptx": a.pptx, "status": "no-ground-truth"}))
        return 3

    out_pdf = out_dir / "export.pdf"
    rc, out, err = run_cli(a.pptx, str(out_pdf))
    if rc != 0:
        print(f"CONVERT-FAILED {os.path.basename(a.pptx)} rc={rc}")
        (out_dir / "result.json").write_text(json.dumps({"pptx": a.pptx, "gt": gt_pdf, "status": "convert-failed", "error": err.strip().splitlines()[-1] if err else err}))
        return 1

    dest = out_dir / "compare"
    rc, report = compare(gt_pdf, str(out_pdf), str(dest))
    if report is None:
        print(f"COMPARE-FAILED {os.path.basename(a.pptx)}")
        (out_dir / "result.json").write_text(json.dumps({"pptx": a.pptx, "gt": gt_pdf, "status": "compare-failed", "error": err.strip()}))
        return 1

    status = report.get("status")
    flagged = report.get("flagged_pages", 0)
    pages = report.get("pages", [])
    text_ok = all(p.get("ordered_text_equal", False) for p in pages)
    print(f"{status.upper()} {os.path.basename(a.pptx)} flagged={flagged}/{len(pages)} text_ok={text_ok}")
    result = {
        "pptx": a.pptx,
        "gt": gt_pdf,
        "status": status,
        "flagged_pages": flagged,
        "total_pages": len(pages),
        "text_equal_all": text_ok,
        "report": str(dest / "comparison.json"),
    }
    (out_dir / "result.json").write_text(json.dumps(result, indent=2))
    return 0 if status == "raster-equal" else 0  # non-zero only for convert/compare failures


if __name__ == "__main__":
    sys.exit(main())
