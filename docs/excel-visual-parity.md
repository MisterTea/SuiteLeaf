# Excel visual parity audit

The local corpus ledger is `datasets/validation/excel-visual-parity/parity.sqlite`.
Images are embedded PNG BLOBs. Workbook columns `excel_screenshots` and
`suiteleaf_screenshots` are ordered JSON manifests referencing `screenshots.id`.
Corpus and content-bearing evidence remain gitignored.

## Commands

```sh
python3 scripts/excel-parity-db.py init
python3 scripts/excel-parity-native.py SOURCE OUTPUT/excel
node scripts/capture-suiteleaf-parity.mjs SOURCE OUTPUT/suiteleaf OUTPUT/excel/excel.json
python3 scripts/excel-parity-db.py ingest OUTPUT/result.json
python3 scripts/excel-parity-db.py verify
python3 scripts/excel-parity-db.py report
python3 scripts/run-excel-parity.py
```

SuiteLeaf must be served by Vite at `http://127.0.0.1:5173` (or the runner's
`--base-url`). The browser helper temporarily exposes the existing Univer facade
through an intercepted development-module response. It uses the real importer
and existing editor; it does not alter repository code or substitute a render.
Excel uses native AppleScript and window screenshots. macOS application/file
access dialogs can require native UI interaction; record any unresolved blocker.

The runner invokes a fresh ephemeral Codex process for each file. It runs one
file at a time, giving that subagent exclusive Excel and source-fix access. This
fits the maximum of three concurrent file agents while preventing capture/fix
races. The parent sees structured results and log summaries only. Each file
subagent fixes observed disparities and recaptures before the next file starts.
An unresolved disparity stops dispatch. Changed SuiteLeaf fingerprints invalidate
earlier verdicts and requeue them for the updated application.

## Review rules

- Inventory all Excel-format files under each dataset's `files/` tree; duplicates
  remain distinct records. Verify originals by SHA-256 before ingesting results.
- Use disposable copies, no saving originals, macros disabled, no external-link
  updates. Preserve user-open workbooks and unrelated repository edits.
- Capture every worksheet, including hidden and very-hidden worksheets exposed
  only in disposable state. Preserve original visibility in metadata.
- Capture at 100% zoom with overlapping readable tiles over the entire used
  area, visible formatting and drawing extent. Blank sheets get one tile.
- Record actual visible ranges and frozen panes. A screenshot that clips a
  requested region does not prove coverage. Never silently cap tiles.
- Visually inspect every paired image in the file subagent's context. Values,
  formulas' displayed results, layout, styles, charts and images matter.
  Application controls and minor antialiasing differences do not matter.
- Enlarge the Excel window when values are clipped. If `#####` persists because
  a column is too narrow, use `--readable` for supplemental native evidence and
  its manifest for matching SuiteLeaf widths. Retain original-width baseline
  captures for layout comparison; record the adjusted widths in both views.
- Excel recovery is allowed only on disposable copies. Set
  `reference_altered_by_excel: true` if recovery changes the reference; that
  workbook remains inconclusive against the original, even if its recovered
  data compares successfully. Do not imitate diagrams deleted by recovery.
- Fix the first disparity, run meaningful regression checks, and recapture.
  Do not lower the review criteria or hide an unsupported feature to pass.
- Continue capturing remaining sheets even after a mismatch. Record inaccessible
  sheets, capture errors, oversized cells and resource barriers as incomplete.
- Passwords explicitly documented in dataset metadata may be used. NapierOne
  password variants use `napierone`; unknown passwords are barriers.
- Only a complete visual review can pass. Excel-readable/SuiteLeaf-rejected files
  fail; unavailable reference or incomplete evidence is inconclusive.

## Result contract

Write a JSON object containing the following fields. Every screenshot path must
refer to a genuine PNG from its stated application. Paths can be absolute or
relative to the result file. Sheet indices are zero-based, tile IDs are strings.

```json
{
  "filename": "datasets/apache-poi/files/test-data/spreadsheet/Formatting.xlsx",
  "source_sha256": "the frozen source hash",
  "suiteleaf_revision": "the final fingerprint from revision()",
  "audit_revision": "the final capture-helper fingerprint from audit_revision()",
  "excel_version": "the ledger's installed version and build",
  "agent_id": "file subagent identifier",
  "excel_readable": true,
  "sheet_inventory_complete": true,
  "coverage_complete": true,
  "capture_settings": {"zoom": 100, "appearance": "light"},
  "sheets": [
    {"index": 0, "name": "Sheet1", "visibility": "visible",
     "expected_tiles": ["r1c1"], "excel_complete": true,
     "suiteleaf_complete": true}
  ],
  "screenshots": [
    {"application": "excel", "sheet_index": 0, "sheet_name": "Sheet1",
     "visibility": "visible", "range": "A1:M25", "tile_id": "r1c1",
     "path": "excel/sheet-0-r1c1.png"},
    {"application": "suiteleaf", "sheet_index": 0, "sheet_name": "Sheet1",
     "visibility": "visible", "range": "A1:M25", "tile_id": "r1c1",
     "path": "suiteleaf/sheet-0-r1c1.png"}
  ],
  "reviews": [
    {"sheet_index": 0, "tile_id": "r1c1", "parity": true,
     "reason": "Compared all visible values, layout and formatting"}
  ],
  "errors": []
}
```

For rejection also set `suiteleaf_rejected: true` and provide a concrete
`suiteleaf_rejection`; retain rejection UI evidence with an appropriate range
label. Missing comparisons are never represented as passing reviews.

Read source fingerprints without changing the ledger:

```python
import importlib.util
spec = importlib.util.spec_from_file_location('ledger', 'scripts/excel-parity-db.py')
ledger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger)
print(ledger.revision())
print(ledger.excel_version())
print(ledger.audit_revision())
```

`summary.json` and `report.md` distinguish pending work from completed passing,
failing and inconclusive outcomes. `verify` checks SQLite integrity, foreign
keys, image hashes, decoding, dimensions and evidence-manifest references.
Earlier verdicts and embedded images survive replacement in `audit_history`
and `history_screenshots`; only current-revision results count as current passes.
