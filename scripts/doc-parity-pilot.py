#!/usr/bin/env python3
import json
import sqlite3
import subprocess
import time
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "datasets/validation/excel-visual-parity/parity.sqlite"
ARTIFACTS_DIR = ROOT / "artifacts/docs-parity"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

def get_word_window_info(doc_stem):
    cmd = f'''
    import CoreGraphics
    import Foundation
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
    for w in windows {{
        if (w[kCGWindowOwnerName as String] as? String) == "Microsoft Word" {{
            let name = (w[kCGWindowName as String] as? String) ?? ""
            if name == "{doc_stem}" || name.hasPrefix("{doc_stem}.") || name.hasPrefix("{doc_stem}  -") || name.contains("{doc_stem}") {{
                let id = w[kCGWindowNumber as String] as? Int ?? 0
                let bounds = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
                let data = try! JSONSerialization.data(withJSONObject: ["id": id, "bounds": bounds, "name": name], options: [])
                print(String(data: data, encoding: .utf8)!)
                exit(0)
            }}
        }}
    }}
    exit(1)
    '''
    res = subprocess.run(['swift', '-e', cmd], capture_output=True, text=True)
    if res.returncode == 0 and res.stdout.strip():
        return json.loads(res.stdout.strip())
    return None

def capture_word(doc_path: Path, output_png: Path):
    abs_path = doc_path.resolve()
    subprocess.run(['open', '-a', 'Microsoft Word', str(abs_path)], check=True)
    stem = doc_path.stem
    info = None
    for _ in range(30):
        time.sleep(0.5)
        info = get_word_window_info(stem)
        if info:
            break
    if not info:
        raise RuntimeError(f"Could not find Word window for {stem}")
    window_id = info['id']
    time.sleep(0.5)
    subprocess.run(['screencapture', '-l', str(window_id), '-o', str(output_png)], check=True)
    subprocess.run(['osascript', '-e', 'tell application "Microsoft Word" to close active document saving no'])

def capture_suiteleaf(doc_path: Path, output_png: Path):
    rel_path = doc_path.relative_to(ROOT).as_posix()
    script = f'''
    import('@playwright/test').then(async ({{ chromium }}) => {{
        const fs = await import('node:fs/promises');
        const buffer = await fs.readFile('{rel_path}');
        const browser = await chromium.launch({{ headless: true }});
        const page = await browser.newPage({{ viewport: {{ width: 1440, height: 900 }} }});
        await page.goto('http://127.0.0.1:5173/');
        await page.waitForTimeout(1000);
        await page.locator('input[type=file]').setInputFiles({{
            name: '{doc_path.name}',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            buffer,
        }});
        await page.waitForTimeout(2000);
        await page.screenshot({{ path: '{output_png.as_posix()}' }});
        await browser.close();
    }});
    '''
    subprocess.run(['node', '-e', script], cwd=ROOT, check=True)

def audit_doc(doc_rel_path: str):
    doc_path = ROOT / doc_rel_path
    stem = doc_path.stem
    doc_dir = ARTIFACTS_DIR / stem
    doc_dir.mkdir(parents=True, exist_ok=True)
    
    word_png = doc_dir / "word.png"
    suiteleaf_png = doc_dir / "suiteleaf.png"
    
    print(f"Capturing Word for {doc_rel_path}...")
    capture_word(doc_path, word_png)
    
    print(f"Capturing SuiteLeaf for {doc_rel_path}...")
    capture_suiteleaf(doc_path, suiteleaf_png)
    
    return word_png, suiteleaf_png

if __name__ == "__main__":
    import sys
    rel = sys.argv[1] if len(sys.argv) > 1 else "datasets/apache-poi/files/test-data/document/checkboxes.docx"
    w, s = audit_doc(rel)
    print("Done:", w, s)
