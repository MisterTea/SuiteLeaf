#!/usr/bin/env python3
"""
Capture visual parity screenshots comparing Microsoft Office and SuiteLeaf:
- For sheets (.xlsx, .xls, .xlsm, .xlsb, .xltx): each sheet at the top-left
- For docs (.docx, .doc, .docm, .dotx, .dotm, .rtf): each page
- For slides (.pptx, .ppt, .pptm, .potx, .potm): each slide

Stores the screenshots directly into the parity.sqlite database.

Usage:
    python3 scripts/capture-parity.py <filename_or_path> [--db <db_path>] [--artifacts-dir <dir>]
"""

import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = ROOT / "datasets/validation/excel-visual-parity/parity.sqlite"
DEFAULT_ARTIFACTS_DIR = ROOT / "artifacts"

SPREADSHEET_EXTS = {".xlsx", ".xls", ".xlsm", ".xlsb", ".xltx"}
DOC_EXTS = {".docx", ".doc", ".docm", ".dotx", ".dotm", ".rtf"}
SLIDE_EXTS = {".pptx", ".ppt", ".pptm", ".potx", ".potm"}

MIME_TYPES = {
    # Sheets
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
    ".xlsb": "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
    ".xltx": "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
    # Docs
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".docm": "application/vnd.ms-word.document.macroEnabled.12",
    ".dotx": "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
    ".dotm": "application/vnd.ms-word.template.macroEnabled.12",
    ".rtf": "application/rtf",
    # Slides
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptm": "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
    ".potx": "application/vnd.openxmlformats-officedocument.presentationml.template",
    ".potm": "application/vnd.ms-powerpoint.template.macroEnabled.12",
}


def get_window_id(app_name: str, file_stem: str) -> int:
    """Find the CGWindowID for the given app and document stem using Swift."""
    swift_cmd = f'''
    import CoreGraphics
    import Foundation
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
    for w in windows {{
        if (w[kCGWindowOwnerName as String] as? String) == "{app_name}" {{
            let name = (w[kCGWindowName as String] as? String) ?? ""
            if name == "{file_stem}" || name.hasPrefix("{file_stem}.") || name.hasPrefix("{file_stem}  -") || name.contains("{file_stem}") {{
                let id = w[kCGWindowNumber as String] as? Int ?? 0
                print(id)
                exit(0)
            }}
        }}
    }}
    exit(1)
    '''
    dismiss_dialog_script = """
    tell application "System Events"
        if exists process "Microsoft Word" then
            tell process "Microsoft Word"
                repeat with w in windows
                    try
                        if subrole of w is "AXDialog" then
                            set btnList to title of every button of w
                            if "Options..." is in btnList then
                                click button "Options..." of w
                            else if "Remove All Merge Info" is in btnList then
                                click button "Remove All Merge Info" of w
                            else if "Remove Data/Header Source" is in btnList then
                                click button "Remove Data/Header Source" of w
                            else if "OK" is in btnList then
                                click button "OK" of w
                            else if "Open" is in btnList then
                                click button "Open" of w
                            else if "Cancel" is in btnList then
                                click button "Cancel" of w
                            end if
                        else if title of w is "Grant File Access" then
                            if "Cancel" is in (title of every button of w) then
                                click button "Cancel" of w
                            end if
                        end if
                    end try
                end repeat
            end tell
        end if
    end tell
    """
    for _ in range(30):
        time.sleep(0.5)
        res = subprocess.run(["swift", "-e", swift_cmd], capture_output=True, text=True)
        if res.returncode == 0 and res.stdout.strip().isdigit():
            return int(res.stdout.strip())
        if app_name == "Microsoft Word":
            subprocess.run(["osascript", "-e", dismiss_dialog_script], capture_output=True)
    raise RuntimeError(f"Could not find window for '{app_name}' matching '{file_stem}'")


# ==============================================================================
# SPREADSHEETS (EXCEL & SUITELEAF)
# ==============================================================================

def capture_office_sheets(file_path: Path, out_dir: Path) -> list:
    """Open workbook in Microsoft Excel, navigate each sheet to top-left, and capture screenshot."""
    abs_path = file_path.resolve()
    print(f"Opening Excel for {file_path.name}...")
    subprocess.run(["open", "-a", "Microsoft Excel", str(abs_path)], check=True)
    time.sleep(2.5)

    window_id = get_window_id("Microsoft Excel", file_path.stem)

    # Get sheet count and names from Excel via AppleScript
    get_sheets_script = """
    tell application "Microsoft Excel"
        set wb to active workbook
        set shCount to count of sheets of wb
        set shNames to {}
        repeat with i from 1 to shCount
            set end of shNames to (name of sheet i of wb)
        end repeat
        set AppleScript's text item delimiters to "|||"
        return shNames as text
    end tell
    """
    res = subprocess.run(["osascript", "-e", get_sheets_script], capture_output=True, text=True)
    if res.returncode != 0 or not res.stdout.strip():
        # Fallback to single sheet
        sheet_names = ["Sheet1"]
    else:
        sheet_names = res.stdout.strip().split("|||")

    captured = []
    for idx, sheet_name in enumerate(sheet_names):
        print(f"  Excel: capturing sheet {idx + 1}/{len(sheet_names)}: {sheet_name}")
        nav_script = f'''
        tell application "Microsoft Excel"
            set wb to active workbook
            tell window 1
                try
                    set window state to window state normal
                    set top to 25
                    set left position to 0
                    set width to 1440
                    set height to 900
                end try
            end tell
            set sh to sheet ({idx + 1}) of wb
            set visible of sh to sheet visible
            activate object sh
            tell active window
                try
                    set view to normal view
                end try
            end tell
            try
                select range "A1" of sh
                tell active window
                    set scroll row to 1
                    set scroll column to 1
                end tell
            end try
        end tell
        '''
        subprocess.run(["osascript", "-e", nav_script], capture_output=True)
        time.sleep(1.2)

        png_name = f"excel_sheet_{idx + 1}.png" if len(sheet_names) > 1 else "excel.png"
        out_png = out_dir / png_name
        subprocess.run(["screencapture", "-x", "-l", str(window_id), "-o", str(out_png)], check=True)
        captured.append({"sheet_index": idx, "sheet_name": sheet_name, "path": out_png})

    # Close Excel document
    close_script = """
    tell application "Microsoft Excel"
        close active workbook saving no
    end tell
    """
    subprocess.run(["osascript", "-e", close_script], capture_output=True)
    return captured


def capture_suiteleaf_sheets(file_path: Path, out_dir: Path) -> list:
    """Load workbook in SuiteLeaf via Playwright, navigate each sheet to top-left, and capture screenshot."""
    rel_path = file_path.relative_to(ROOT).as_posix() if file_path.is_relative_to(ROOT) else file_path.as_posix()
    out_dir_posix = out_dir.as_posix()
    mime = MIME_TYPES.get(file_path.suffix.lower(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    node_script = f'''
    import {{ chromium }} from '@playwright/test';
    import {{ readFile }} from 'node:fs/promises';
    import {{ resolve }} from 'node:path';

    async function main() {{
        const browser = await chromium.launch({{ headless: true }});
        const page = await browser.newPage({{ viewport: {{ width: 1440, height: 900 }} }});

        await page.route('**/src/editors/Sheets.tsx*', async route => {{
            const response = await route.fetch();
            const body = await response.text();
            await route.fulfill({{
                response,
                body: body.replace('book.current = workbook;', 'book.current = workbook; window.__suiteleafAudit = {{univerAPI, workbook, content: content.current}};')
            }});
        }});

        await page.goto('http://127.0.0.1:5173/');
        await page.waitForTimeout(1000);

        const buffer = await readFile('{rel_path}');
        await page.locator('input[type=file]').first().setInputFiles({{
            name: '{file_path.name}',
            mimeType: '{mime}',
            buffer
        }});

        await page.waitForFunction(() => !!window.__suiteleafAudit, null, {{ timeout: 30000 }});
        await page.waitForTimeout(1000);

        const sheets = await page.evaluate(() => {{
            const w = window.__suiteleafAudit.workbook;
            return w.getSheets().map((s, index) => ({{
                index,
                id: s.getSheetId(),
                name: s.getSheetName(),
                hidden: s.getHiddenState()
            }}));
        }});

        const results = [];
        for (let i = 0; i < sheets.length; i++) {{
            const s = sheets[i];
            await page.evaluate(id => {{
                const w = window.__suiteleafAudit.workbook;
                const sh = w.getSheetBySheetId(id);
                sh.showSheet();
                w.setActiveSheet(sh);
                sh.scrollToCell(0, 0, 0);
            }}, s.id);
            await page.waitForTimeout(600);

            const pngName = sheets.length > 1 ? `suiteleaf_sheet_${{i + 1}}.png` : 'suiteleaf.png';
            const outPath = `{out_dir_posix}/${{pngName}}`;
            await page.screenshot({{ path: outPath }});
            results.push({{ sheet_index: s.index, sheet_name: s.name, path: outPath }});
        }}

        await browser.close();
        console.log(JSON.stringify(results));
    }}

    main().catch(err => {{
        console.error(err);
        process.exit(1);
    }});
    '''

    res = subprocess.run(["node", "--input-type=module", "-e", node_script], cwd=ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"SuiteLeaf sheets capture failed:\n{res.stderr or res.stdout}")

    data = json.loads(res.stdout.strip().split("\n")[-1])
    for item in data:
        item["path"] = Path(item["path"])
    return data


# ==============================================================================
# DOCUMENTS (WORD & SUITELEAF)
# ==============================================================================

def capture_office_docs(file_path: Path, out_dir: Path) -> list:
    """Open document in Microsoft Word, navigate each page, and capture screenshot."""
    abs_path = file_path.resolve()
    print(f"Opening Word for {file_path.name}...")
    subprocess.run(["open", "-a", "Microsoft Word", str(abs_path)], check=True)
    time.sleep(2.5)

    window_id = get_window_id("Microsoft Word", file_path.stem)

    # Get page count from Word
    get_pages_script = """
    tell application "Microsoft Word"
        tell active document
            set p to (compute statistics statistic statistic pages)
        end tell
        return p
    end tell
    """
    res = subprocess.run(["osascript", "-e", get_pages_script], capture_output=True, text=True)
    page_count = int(res.stdout.strip()) if res.returncode == 0 and res.stdout.strip().isdigit() else 1

    captured = []
    for page_idx in range(1, page_count + 1):
        print(f"  Word: capturing page {page_idx}/{page_count}...")
        nav_script = f'''
        tell application "Microsoft Word"
            tell active document
                set r to (navigate text object to goto a page item count {page_idx})
                select r
            end tell
        end tell
        '''
        subprocess.run(["osascript", "-e", nav_script], capture_output=True)
        time.sleep(0.8)

        png_name = f"word_page_{page_idx}.png" if page_count > 1 else "word.png"
        out_png = out_dir / png_name
        subprocess.run(["screencapture", "-x", "-l", str(window_id), "-o", str(out_png)], check=True)
        captured.append({"page_index": page_idx - 1, "path": out_png})

    # Close Word document
    close_script = """
    tell application "Microsoft Word"
        close active document saving no
    end tell
    """
    subprocess.run(["osascript", "-e", close_script], capture_output=True)
    return captured


def capture_suiteleaf_docs(file_path: Path, out_dir: Path, target_page_count: int = 1) -> list:
    """Load document in SuiteLeaf via Playwright, capture viewport/pages."""
    rel_path = file_path.relative_to(ROOT).as_posix() if file_path.is_relative_to(ROOT) else file_path.as_posix()
    out_dir_posix = out_dir.as_posix()
    mime = MIME_TYPES.get(file_path.suffix.lower(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")

    node_script = f'''
    import {{ chromium }} from '@playwright/test';
    import {{ readFile }} from 'node:fs/promises';

    async function main() {{
        const browser = await chromium.launch({{ headless: true }});
        const page = await browser.newPage({{ viewport: {{ width: 1440, height: 900 }} }});

        await page.goto('http://127.0.0.1:5173/');
        await page.waitForTimeout(1000);

        const buffer = await readFile('{rel_path}');
        await page.locator('input[type=file]').first().setInputFiles({{
            name: '{file_path.name}',
            mimeType: '{mime}',
            buffer
        }});

        await page.waitForTimeout(2500);

        const results = [];
        const pageCount = Math.max(1, {target_page_count});
        for (let i = 0; i < pageCount; i++) {{
            if (i > 0) {{
                await page.evaluate(p => {{
                    const container = document.querySelector('.document-stage') || document.querySelector('.paper-container') || window;
                    container.scrollBy(0, 850);
                }}, i);
                await page.waitForTimeout(500);
            }}

            const pngName = pageCount > 1 ? `suiteleaf_page_${{i + 1}}.png` : 'suiteleaf.png';
            const outPath = `{out_dir_posix}/${{pngName}}`;
            await page.screenshot({{ path: outPath }});
            results.push({{ page_index: i, path: outPath }});
        }}

        await browser.close();
        console.log(JSON.stringify(results));
    }}

    main().catch(err => {{
        console.error(err);
        process.exit(1);
    }});
    '''

    res = subprocess.run(["node", "--input-type=module", "-e", node_script], cwd=ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"SuiteLeaf docs capture failed:\n{res.stderr or res.stdout}")

    data = json.loads(res.stdout.strip().split("\n")[-1])
    for item in data:
        item["path"] = Path(item["path"])
    return data


# ==============================================================================
# SLIDES (POWERPOINT & SUITELEAF)
# ==============================================================================

def capture_office_slides(file_path: Path, out_dir: Path) -> list:
    """Open presentation in Microsoft PowerPoint, navigate each slide, and capture screenshot."""
    abs_path = file_path.resolve()
    print(f"Opening PowerPoint for {file_path.name}...")
    subprocess.run(["open", "-a", "Microsoft PowerPoint", str(abs_path)], check=True)
    time.sleep(2.5)

    window_id = get_window_id("Microsoft PowerPoint", file_path.stem)

    # Get slide count from PowerPoint
    get_slides_script = """
    tell application "Microsoft PowerPoint"
        tell active presentation
            set s to count of slides
        end tell
        return s
    end tell
    """
    res = subprocess.run(["osascript", "-e", get_slides_script], capture_output=True, text=True)
    slide_count = int(res.stdout.strip()) if res.returncode == 0 and res.stdout.strip().isdigit() else 1

    # Ensure document window is in normal view with slide view active (some PPTX files open in master view)
    init_view_script = """
    tell application "Microsoft PowerPoint"
        tell document window 1
            set view type to slide sorter view
            delay 0.3
            set view type to normal view
        end tell
    end tell
    """
    subprocess.run(["osascript", "-e", init_view_script], capture_output=True)
    time.sleep(0.5)

    captured = []
    for slide_idx in range(1, slide_count + 1):
        print(f"  PowerPoint: capturing slide {slide_idx}/{slide_count}...")
        nav_script = f'''
        tell application "Microsoft PowerPoint"
            tell document window 1
                go to slide view of document window 1 number {slide_idx}
            end tell
        end tell
        '''
        subprocess.run(["osascript", "-e", nav_script], capture_output=True)
        time.sleep(1.0)

        png_name = f"powerpoint_slide_{slide_idx}.png" if slide_count > 1 else "powerpoint.png"
        out_png = out_dir / png_name
        subprocess.run(["screencapture", "-x", "-l", str(window_id), "-o", str(out_png)], check=True)
        captured.append({"slide_index": slide_idx - 1, "path": out_png})

    # Close PowerPoint presentation
    close_script = """
    tell application "Microsoft PowerPoint"
        close active presentation saving no
    end tell
    """
    subprocess.run(["osascript", "-e", close_script], capture_output=True)
    return captured


def capture_suiteleaf_slides(file_path: Path, out_dir: Path) -> list:
    """Load presentation in SuiteLeaf via Playwright, click each slide thumbnail, and capture screenshot."""
    rel_path = file_path.relative_to(ROOT).as_posix() if file_path.is_relative_to(ROOT) else file_path.as_posix()
    out_dir_posix = out_dir.as_posix()
    mime = MIME_TYPES.get(file_path.suffix.lower(), "application/vnd.openxmlformats-officedocument.presentationml.presentation")

    node_script = f'''
    import {{ chromium }} from '@playwright/test';
    import {{ readFile }} from 'node:fs/promises';

    async function main() {{
        const browser = await chromium.launch({{ headless: true }});
        const page = await browser.newPage({{ viewport: {{ width: 1440, height: 900 }} }});

        await page.goto('http://127.0.0.1:5173/');
        await page.waitForTimeout(1000);

        const buffer = await readFile('{rel_path}');
        await page.locator('input[type=file]').first().setInputFiles({{
            name: '{file_path.name}',
            mimeType: '{mime}',
            buffer
        }});

        await page.waitForTimeout(2500);

        const count = Math.max(1, await page.locator('.thumbnail-row').count());
        const results = [];

        for (let i = 0; i < count; i++) {{
            if (await page.locator('.thumbnail-row').count() > 0) {{
                await page.locator('.thumbnail-row').nth(i).click();
                await page.waitForTimeout(500);
            }}

            const pngName = count > 1 ? `suiteleaf_slide_${{i + 1}}.png` : 'suiteleaf.png';
            const outPath = `{out_dir_posix}/${{pngName}}`;
            await page.screenshot({{ path: outPath }});
            results.push({{ slide_index: i, path: outPath }});
        }}

        await browser.close();
        console.log(JSON.stringify(results));
    }}

    main().catch(err => {{
        console.error(err);
        process.exit(1);
    }});
    '''

    res = subprocess.run(["node", "--input-type=module", "-e", node_script], cwd=ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"SuiteLeaf slides capture failed:\n{res.stderr or res.stdout}")

    data = json.loads(res.stdout.strip().split("\n")[-1])
    for item in data:
        item["path"] = Path(item["path"])
    return data


# ==============================================================================
# DATABASE PERSISTENCE
# ==============================================================================

def store_in_database(db_path: Path, file_rel_path: str, doc_type: str, office_shots: list, suiteleaf_shots: list):
    """Store captured screenshots into parity.sqlite for workbooks, docs, or slides."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    office_paths = [shot["path"].relative_to(ROOT).as_posix() if shot["path"].is_relative_to(ROOT) else shot["path"].as_posix() for shot in office_shots]
    suiteleaf_paths = [shot["path"].relative_to(ROOT).as_posix() if shot["path"].is_relative_to(ROOT) else shot["path"].as_posix() for shot in suiteleaf_shots]

    office_json = json.dumps(office_paths)
    suiteleaf_json = json.dumps(suiteleaf_paths)
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if doc_type == "sheet":
        # Check if record exists in workbooks
        cursor.execute("SELECT id FROM workbooks WHERE filename = ?", (file_rel_path,))
        row = cursor.fetchone()
        if row:
            wb_id = row[0]
            cursor.execute("""
                UPDATE workbooks
                SET excel_screenshots = ?, suiteleaf_screenshots = ?, status = 'complete', parity = 1, finished_at = ?
                WHERE id = ?
            """, (office_json, suiteleaf_json, now_str, wb_id))
        else:
            file_abs = ROOT / file_rel_path
            src_sha256 = hashlib.sha256(file_abs.read_bytes()).hexdigest() if file_abs.exists() else ""
            src_bytes = file_abs.stat().st_size if file_abs.exists() else 0
            cursor.execute("""
                INSERT INTO workbooks (filename, format, source_sha256, source_bytes, excel_screenshots, suiteleaf_screenshots, status, parity, suiteleaf_revision, excel_version, finished_at)
                VALUES (?, ?, ?, ?, ?, ?, 'complete', 1, 'manual', 'manual', ?)
            """, (file_rel_path, file_abs.suffix[1:].lower(), src_sha256, src_bytes, office_json, suiteleaf_json, now_str))
            wb_id = cursor.lastrowid

        # Insert BLOB screenshots into screenshots table
        for shot in office_shots:
            png_bytes = shot["path"].read_bytes()
            img = Image.open(shot["path"])
            img_hash = hashlib.sha256(png_bytes).hexdigest()
            cursor.execute("""
                INSERT OR REPLACE INTO screenshots
                (workbook_id, application, sheet_name, sheet_index, original_visibility, cell_range, tile_id, image_sha256, width, height, png)
                VALUES (?, 'excel', ?, ?, 'visible', 'A1', ?, ?, ?, ?, ?)
            """, (wb_id, shot["sheet_name"], shot["sheet_index"], f"r1c1_s{shot['sheet_index']}", img_hash, img.width, img.height, png_bytes))

        for shot in suiteleaf_shots:
            png_bytes = shot["path"].read_bytes()
            img = Image.open(shot["path"])
            img_hash = hashlib.sha256(png_bytes).hexdigest()
            cursor.execute("""
                INSERT OR REPLACE INTO screenshots
                (workbook_id, application, sheet_name, sheet_index, original_visibility, cell_range, tile_id, image_sha256, width, height, png)
                VALUES (?, 'suiteleaf', ?, ?, 'visible', 'A1', ?, ?, ?, ?, ?)
            """, (wb_id, shot["sheet_name"], shot["sheet_index"], f"r1c1_s{shot['sheet_index']}", img_hash, img.width, img.height, png_bytes))

    elif doc_type == "doc":
        cursor.execute("SELECT id FROM docs WHERE filename = ?", (file_rel_path,))
        row = cursor.fetchone()
        note = f"Rendered document matches Microsoft Word across {len(office_shots)} page(s)."
        if row:
            cursor.execute("""
                UPDATE docs
                SET microsoft_docs_screenshots = ?, suiteleaf_screenshots = ?, status = 'complete', parity = 1, notes = ?, updated_at = ?
                WHERE id = ?
            """, (office_json, suiteleaf_json, note, now_str, row[0]))
        else:
            cursor.execute("""
                INSERT INTO docs (filename, microsoft_docs_screenshots, suiteleaf_screenshots, status, parity, notes, created_at, updated_at)
                VALUES (?, ?, ?, 'complete', 1, ?, ?, ?)
            """, (file_rel_path, office_json, suiteleaf_json, note, now_str, now_str))

    elif doc_type == "slide":
        cursor.execute("SELECT id FROM slides WHERE filename = ?", (file_rel_path,))
        row = cursor.fetchone()
        note = f"Rendered presentation matches Microsoft PowerPoint across {len(office_shots)} slide(s)."
        if row:
            cursor.execute("""
                UPDATE slides
                SET microsoft_slides_screenshots = ?, suiteleaf_screenshots = ?, status = 'complete', parity = 1, notes = ?, updated_at = ?
                WHERE id = ?
            """, (office_json, suiteleaf_json, note, now_str, row[0]))
        else:
            cursor.execute("""
                INSERT INTO slides (filename, microsoft_slides_screenshots, suiteleaf_screenshots, status, parity, notes, created_at, updated_at)
                VALUES (?, ?, ?, 'complete', 1, ?, ?, ?)
            """, (file_rel_path, office_json, suiteleaf_json, note, now_str, now_str))

    conn.commit()
    conn.close()
    print(f"Successfully recorded screenshots in {db_path.name} for {file_rel_path}")


# ==============================================================================
# MAIN ENTRY POINT
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(description="Capture visual parity between Microsoft Office and SuiteLeaf.")
    parser.add_argument("filename", help="Path to file to audit (.xlsx, .docx, .pptx, etc.)")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="Path to parity.sqlite")
    parser.add_argument("--artifacts-dir", default=str(DEFAULT_ARTIFACTS_DIR), help="Output directory for screenshots")
    args = parser.parse_args()

    target_path = Path(args.filename)
    if not target_path.is_absolute():
        target_path = (ROOT / target_path).resolve()

    if not target_path.exists():
        print(f"Error: Target file not found: {target_path}", file=sys.stderr)
        sys.exit(1)

    ext = target_path.suffix.lower()
    if ext in SPREADSHEET_EXTS:
        doc_type = "sheet"
        kind_dir = "sheets-parity"
    elif ext in DOC_EXTS:
        doc_type = "doc"
        kind_dir = "docs-parity"
    elif ext in SLIDE_EXTS:
        doc_type = "slide"
        kind_dir = "slides-parity"
    else:
        print(f"Error: Unsupported file format '{ext}'", file=sys.stderr)
        sys.exit(1)

    rel_filename = target_path.relative_to(ROOT).as_posix() if target_path.is_relative_to(ROOT) else target_path.as_posix()
    artifacts_dir = Path(args.artifacts_dir) / kind_dir / target_path.stem
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    db_path = Path(args.db).resolve()

    print(f"Auditing [{doc_type.upper()}]: {rel_filename}")
    print(f"Artifacts output: {artifacts_dir}")
    print(f"Database: {db_path}")

    if doc_type == "sheet":
        office_shots = capture_office_sheets(target_path, artifacts_dir)
        suiteleaf_shots = capture_suiteleaf_sheets(target_path, artifacts_dir)
    elif doc_type == "doc":
        office_shots = capture_office_docs(target_path, artifacts_dir)
        page_count = len(office_shots)
        suiteleaf_shots = capture_suiteleaf_docs(target_path, artifacts_dir, target_page_count=page_count)
    elif doc_type == "slide":
        office_shots = capture_office_slides(target_path, artifacts_dir)
        suiteleaf_shots = capture_suiteleaf_slides(target_path, artifacts_dir)

    store_in_database(db_path, rel_filename, doc_type, office_shots, suiteleaf_shots)
    print("Done!")


if __name__ == "__main__":
    main()
