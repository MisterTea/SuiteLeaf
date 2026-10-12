#!/usr/bin/env python3
import json
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS_DIR = ROOT / "artifacts/sheets-parity"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

def get_excel_window_info(doc_stem):
    res = subprocess.run(['swift', str(ROOT / 'scripts/excel-parity-window.swift'), doc_stem], capture_output=True, text=True)
    if res.returncode == 0 and res.stdout.strip():
        return json.loads(res.stdout.strip())
    return None

def capture_excel(sheet_path: Path, output_png: Path):
    abs_path = sheet_path.resolve()
    subprocess.run(['open', '-a', 'Microsoft Excel', str(abs_path)], check=True)
    stem = sheet_path.stem
    info = None
    for _ in range(30):
        time.sleep(0.5)
        info = get_excel_window_info(stem)
        if info:
            break
    if not info:
        raise RuntimeError(f"Could not find Excel window for {stem}")
    window_id = info['id']
    time.sleep(0.5)
    subprocess.run(['screencapture', '-l', str(window_id), '-o', str(output_png)], check=True)
    subprocess.run(['osascript', '-e', 'tell application "Microsoft Excel" to close active workbook saving no'])

def capture_suiteleaf(sheet_path: Path, output_png: Path):
    rel_path = sheet_path.relative_to(ROOT).as_posix()
    script = f'''
    import('@playwright/test').then(async ({{ chromium }}) => {{
        const fs = await import('node:fs/promises');
        const buffer = await fs.readFile('{rel_path}');
        const browser = await chromium.launch({{ headless: true }});
        const page = await browser.newPage({{ viewport: {{ width: 1440, height: 900 }} }});
        await page.goto('http://127.0.0.1:5173/');
        await page.waitForTimeout(1000);
        await page.locator('input[type=file]').setInputFiles({{
            name: '{sheet_path.name}',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            buffer,
        }});
        await page.waitForTimeout(2500);
        await page.screenshot({{ path: '{output_png.as_posix()}' }});
        await browser.close();
    }});
    '''
    subprocess.run(['node', '-e', script], cwd=ROOT, check=True)

def audit_sheet(sheet_rel_path: str):
    sheet_path = ROOT / sheet_rel_path
    stem = sheet_path.stem
    sheet_dir = ARTIFACTS_DIR / stem
    sheet_dir.mkdir(parents=True, exist_ok=True)
    
    excel_png = sheet_dir / "excel.png"
    suiteleaf_png = sheet_dir / "suiteleaf.png"
    
    print(f"Capturing Excel for {sheet_rel_path}...")
    capture_excel(sheet_path, excel_png)
    
    print(f"Capturing SuiteLeaf for {sheet_rel_path}...")
    capture_suiteleaf(sheet_path, suiteleaf_png)
    
    return excel_png, suiteleaf_png

if __name__ == "__main__":
    import sys
    rel = sys.argv[1] if len(sys.argv) > 1 else "datasets/apache-poi/files/test-data/spreadsheet/TwoSheetsOneHidden.xlsx"
    e, s = audit_sheet(rel)
    print("Done:", e, s)
