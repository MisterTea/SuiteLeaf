#!/usr/bin/env python3
import json
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS_DIR = ROOT / "artifacts/slides-parity"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

def get_ppt_window_info(doc_stem):
    cmd = f'''
    import CoreGraphics
    import Foundation
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
    for w in windows {{
        if (w[kCGWindowOwnerName as String] as? String) == "Microsoft PowerPoint" {{
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

def capture_powerpoint(slide_path: Path, output_png: Path):
    abs_path = slide_path.resolve()
    subprocess.run(['open', '-a', 'Microsoft PowerPoint', str(abs_path)], check=True)
    stem = slide_path.stem
    info = None
    for _ in range(30):
        time.sleep(0.5)
        info = get_ppt_window_info(stem)
        if info:
            break
    if not info:
        raise RuntimeError(f"Could not find PowerPoint window for {stem}")
    window_id = info['id']
    time.sleep(0.5)
    subprocess.run(['screencapture', '-l', str(window_id), '-o', str(output_png)], check=True)
    subprocess.run(['osascript', '-e', 'tell application "Microsoft PowerPoint" to close active presentation saving no'])

def capture_suiteleaf(slide_path: Path, output_png: Path):
    rel_path = slide_path.relative_to(ROOT).as_posix()
    script = f'''
    import('@playwright/test').then(async ({{ chromium }}) => {{
        const fs = await import('node:fs/promises');
        const buffer = await fs.readFile('{rel_path}');
        const browser = await chromium.launch({{ headless: true }});
        const page = await browser.newPage({{ viewport: {{ width: 1440, height: 900 }} }});
        await page.goto('http://127.0.0.1:5173/');
        await page.waitForTimeout(1000);
        await page.locator('input[type=file]').setInputFiles({{
            name: '{slide_path.name}',
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            buffer,
        }});
        await page.waitForTimeout(2000);
        await page.screenshot({{ path: '{output_png.as_posix()}' }});
        await browser.close();
    }});
    '''
    subprocess.run(['node', '-e', script], cwd=ROOT, check=True)

def audit_slide(slide_rel_path: str):
    slide_path = ROOT / slide_rel_path
    stem = slide_path.stem
    slide_dir = ARTIFACTS_DIR / stem
    slide_dir.mkdir(parents=True, exist_ok=True)
    
    ppt_png = slide_dir / "powerpoint.png"
    suiteleaf_png = slide_dir / "suiteleaf.png"
    
    print(f"Capturing PowerPoint for {slide_rel_path}...")
    capture_powerpoint(slide_path, ppt_png)
    
    print(f"Capturing SuiteLeaf for {slide_rel_path}...")
    capture_suiteleaf(slide_path, suiteleaf_png)
    
    return ppt_png, suiteleaf_png

if __name__ == "__main__":
    import sys
    rel = sys.argv[1] if len(sys.argv) > 1 else "datasets/apache-poi/files/test-data/slideshow/present1.pptx"
    p, s = audit_slide(rel)
    print("Done:", p, s)
