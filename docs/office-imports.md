# DOCX and XLSX imports

Use **Open / import** on the web, or native **Open** in Electron, to load an Office file. It becomes an editable SuiteLeaf copy. Saving/downloading uses `.suiteleaf`; original Office files are unchanged. DOCX/XLSX export is not included in this change.

## Supported content

| Format | Imported into editable content | Compatibility notes |
| --- | --- | --- |
| DOCX | Text and Unicode, headings, lists, emphasis, safe links, tables, supported raster images, footnote/endnote text | Continuous layout; Word page furniture becomes labelled sections. Deep nesting or semantic-parser failures recover text as paragraphs. Exact pagination, font styling, floating objects, equations, review history and unsupported image formats can differ. |
| XLSX | Worksheet names/order, typed values, formulas and caches, shared/array formulas, date system, named ranges, basic styles, merges, row/column dimensions and hiding, frozen panes | Calculation uses Univer's supported functions. External links are not fetched. Excel conditional formatting, validation, protection, hyperlink targets and pivot definitions are not recreated. Pivot results remain cells. Embedded spreadsheet images are not displayed. Representable basic charts are recreated with simplified styling. |

Each imported file stores `importInfo` and shows an expandable compatibility summary. These notes survive native saves and reopen. Document imports verify body-text retention; additional recovered text is labelled explicitly, and may duplicate content when source layout rearranges text. A successful import establishes editable content and native round-trip validity, not pixel-perfect Word/Excel equivalence.

## Limits and failures

Office inputs: 120 MB; expanded package: 1 GB; native editable file: 200 MB; spreadsheet: 10 million stored cells and 100 MB of cell text. Worker timeouts are two minutes. Password-protected files require an unencrypted copy from Word/Excel. Damaged containers, missing required parts, unsafe XML declarations and invalid XML produce explicit errors. Limits never silently truncate the source. Originals remain intact on every error path.

## Corpus validation

`npm run test:office-corpus` processes every DOCX/XLSX entry in `datasets/inventory.jsonl`, using the same conversion functions as the UI. It checks original SHA-256, document text retention where available, native schema validity, and save/reopen serialization. Conversions use isolated workers and immutable source snapshots. Detailed reports stay under `datasets/validation/` with the local corpus; third-party files and generated document content are excluded from Git and releases.

The original inventory has 7,427 DOCX and 5,963 XLSX files, including encrypted, damaged-signature and deliberately malformed fixtures. Its “primary XML OK” flag validates only the primary part: secondary-part errors, orphan worksheet entries and decompression faults require additional checks during import. Capacity failures are separate from encrypted/invalid failures; neither is counted as a successful editable import.

Representative browser checks use owned Word/Excel fixtures plus actual Arabic, Chinese and English DOCX and real Excel regression files when the local corpus is available. Desktop checks cover native Open, worker conversion, native Save As, unchanged original bytes and reopening. Synthetic fixtures and ordinary application regressions run in CI without downloading or redistributing the corpus.

## Measured results — October 7, 2026

| Format | Tested | Editable imports and native round trips | Encrypted/invalid | Capacity limits |
| --- | ---: | ---: | ---: | ---: |
| DOCX | 7,427 | 7,200 | 227 | 0 |
| XLSX | 5,963 | 5,732 | 224 | 7 |
| Total | 13,390 | 12,932 | 451 | 7 |

There are no unclassified converter failures after targeted rechecks. **Not every file loads:** encrypted and invalid inputs are explicitly rejected, and seven spreadsheets remain beyond current capacity. The seven are the oversized shared-string regression fixture, NapierOne `2918`, `3243`, `3245` (native outputs over 200 MB), `3570` and `4359` (isolated heap budget), and `4067` (expanded package over 1 GB). The exact paths/reasons are in [the checked-in summary](office-validation-summary.json); every file has a local JSONL result in `datasets/validation/office-final-results/complete-results.jsonl`.

The complete run used immutable converter snapshots. A corrupt secondary ZIP part and heap-budget outcomes were rechecked; each result retains its snapshot revision. Corpus conversion is supplemented by actual browser/native Open, edits and save/reopen tests, including a real 5.6-million-cell workbook (164.5 MB native representation) loaded and saved in Chromium. This is coverage of the actual conversion pipeline, not a claim of exact rendering or calculation parity for every corpus feature.
