# Presentation fidelity ledger

## Procedure and acceptance

- Source: `Z:\Datasets\zenodo10k\files` (recursive, including hidden files).
- Reference: `Z:\Datasets\zenodo10k\windows-ground-truth-pdf`, with the same relative path and `.pdf` extension.
- Process PPTX paths in case-insensitive relative-path order. Skip missing reference PDFs; exclude `._` resource forks and `~$` Office lock files.
- Export using SuiteLeaf's existing `convert <pptx> --to pdf --output <pdf>` CLI. Never substitute Office output for SuiteLeaf output.
- Review every page. Font glyph outlines may differ; line wrapping, text positions, pictures, and shapes must agree. Differences below 5 pixels may be ignored. Record raster scale with comparisons (96 dpi means one pixel per CSS pixel).
- Raster scores are triage, not automatic acceptance. A presentation only becomes matched after all pages have been checked, discrepancies fixed, and its SuiteLeaf export rerun.
- Run one subagent per eligible presentation, sequentially. After the subagent returns, record matched, skipped, or given-up with concrete evidence and remaining issues, then advance (including after given-up, as requested).

## Session: 2026-11-03

- Initial enumeration: 10,445 `.pptx` paths (including resource forks/lock files), 10,242 reference PDFs. Files on this drive often have the Hidden attribute; enumeration must include them.
- Existing one-step CLI found in `apps/desktop/src/convert-cli.ts`; no CLI feature needed.
- Checkout initially lacked `node_modules` and desktop output. Installing locked dependencies before the first conversion.
- Pre-existing untracked `scripts/zenodo-windows-pdfs.ps1` belongs to other work; leave it intact.
- Local comparison output/inventory lives under ignored `artifacts/presentation-fidelity/`; keep this ledger as the durable handoff.

## Current presentation

`pptx/apache2.0/2024/41fde69739d885f2e079e2218c9ad5b4-20240620 Spyderisk Overview.pptx`

Status: assigned to subagent `presentation_0002`; not accepted yet.

## Resumed session: 2026-11-03

- User requested sequential per-presentation subagents, including advancing after a documented given-up result.
- Dependencies and a first baseline are now present. Previous working changes in `pptx-slide-shapes.ts`, `pptx-text-body.ts`, `tests/pptx-paragraph-fonts.test.ts`, and `scripts/review-presentation-pdfs.py` are preserved for the first subagent to inspect.
- Existing CSV inventory includes metadata/lock-file skips. Durable per-presentation outcomes belong in this file; ignored comparison artifacts are supporting evidence only.

## Resume

Start with the current presentation above. Do not infer a match from successful conversion or matching text alone. Record fixes, tests, comparison artifacts, and remaining disparities here before moving to the next eligible path. Each terminal outcome must be returned by its own subagent before launching the next.

## Inventory and skip handling

- Inventory verified with Python's CSV reader: 10,445 total paths, 10,242 eligible with reference, 200 missing reference (skipped), 3 metadata/Office lock files (excluded).
- Inventory: `artifacts/presentation-fidelity/inventory.csv`. Read with a CSV parser supporting quoted embedded newlines; PowerShell `Import-Csv` produced incorrect extra rows on this inventory.
- If ignored artifacts are unavailable in another checkout, recursively enumerate the source directory with hidden files included, sort relative paths case-insensitively, exclude filenames beginning `._` or `~$`, and skip those whose corresponding relative `.pdf` path does not exist.
- Outcomes below take precedence over inventory `pending` values.

## Outcomes

### 0001 — given-up: layout mismatch remains

- Source: `pptx/apache2.0/2021/dd7f08ed3679f01ee8f5369ab6428a5d-escience_2021_conferentie_2.pptx`.
- Subagent: `presentation_0001`. CLI development rebuild succeeded; rerun exported 12 pages, matching reference count. All 12 pages reviewed at 96 dpi with contact sheets and text positions.
- Preserved existing paragraph font inheritance/paragraph-specific spacing changes in `packages/core/src/pptx-slide-shapes.ts` and `pptx-text-body.ts`. Corrected Georgia alias expectation in `tests/pptx-paragraph-fonts.test.ts` to obtain it through `suiteLeafFont`.
- Validation: 337 passing tests / 51 files; changed-source coverage 94.4% lines, 92.06% statements.
- Remaining vertical drift: slide 2 up to 32.1px, slide 3 up to 29.3px, slide 8 up to 23.9px; Nunito multiline headings/quote also drift. Slide 6 `-Wconversion-extra` displaced horizontally about 24px.
- Embedded Assistant/Nunito fonts decode and load. Assistant parsed Windows line grid is 1.308; reference spacing suggests about 1.2. Metric-selection root cause remains unresolved; no speculative global override was added. This is a flagged font-layout issue, not an accepted glyph-only difference.
- Final export: `artifacts/presentation-fidelity/first-font-fix.pdf`; comparison/text bounds: `first-font-fix/comparison.json`; all-page review: `first-font-fix/contact-01.png`, `contact-02.png`; per-page PNGs in that folder. Diagnostic `inspect.ts` and decoded fonts retained under `artifacts/presentation-fidelity/`.
- Advance to 0002 as requested; revisit this deck when font metric selection is understood.

## Continuation: 2026-11-03

- Resumed interrupted subagent presentation_0002 on the current Spyderisk deck. Explicitly required at least five genuine fix-and-re-export iterations before any given-up outcome, with per-iteration evidence and all-page review.
- Audit: outcome 0001 does not document five iterations; retain its mismatch evidence, but treat its given-up procedure as incomplete and queue a revisit after the current deck.


### 0002 — progress (not terminal)

- Baseline exports 36/36 pages. Iteration 1 completed and all six 96-dpi contact sheets reviewed: corrected Lucida Sans alias from an italic-only demibold family to the complete SuiteLeaf Sassafras family, removing incorrect bold/italic styling.
- Remaining: paragraph/list vertical drift, missing WMF preview on slide 4, duplicated slide numbers, rotated table header on slide 20. Iteration 2 investigating WMF clipping from default 1x1 canvas bounds.


### 0002 — given-up after six fixing and re-export iterations

- Source: `pptx/apache2.0/2024/41fde69739d885f2e079e2218c9ad5b4-20240620 Spyderisk Overview.pptx`.
- Subagent presentation_0002 returned terminal status. Each iteration exported 36/36 pages; all six contact sheets reviewed at 96 dpi.
- Fixes: Lucida Sans alias and generator; bitmap-only WMF bounds (restored slide 4 diagram); measured Sassafras single spacing of 1.2em; duplicate synthesized slide numbers; vertical table text; merged-table measurement by actual grid column.
- Slide 10 drift improved -20.7px to -1.7px; slide 3 -11.6px to -2.6px. Slide 20 header and vertical label now within 5px.
- Remaining: slide 9 undersized fitted text / -15.8px final baseline; slide 20 fitted body -10.3px; slide 34 DOI soft breaks 36px left and +35.6px final baseline; reference slide 4 extra upper-left number absent.
- Validation: 520 tests / 76 files passed; changed behavior coverage 96.54% lines, 93.64% statements. Core/web typechecks and whitespace checks passed.
- Evidence: `artifacts/presentation-fidelity/0002-iterations.json`, final `0002-iteration6.pdf`, all-page review in `0002-iteration6/`, measurements `0002-line-positions-final.txt`, tests `0002-tests-final.log`.

## Continuation: 2026-11-04

- Revisiting 0001 to complete its missing five-iteration requirement, using the fixes from 0002. Next new eligible inventory entry follows 0002 after this procedural repair.
- Current presentation: 0001 revisit; assigned to presentation_0001_revisit. Earlier Current presentation section is superseded by this entry.

### 0001 revisit — progress 2026-11-04

- Iterations 1–4 re-exported 12/12 pages and reviewed all pages at 96 dpi. Assistant and Nunito measured single spacing corrected to 1.2em; continuation tab origin corrected; paragraph-specific font strut removes inherited Nunito height from Assistant-only paragraphs.
- Iteration 4 first-slide final baseline error reduced 6.6px to 1.6px; all page baselines within 2.67px by character-origin comparison. Leading-space extraction artifacts excluded after visual checks.
- Iteration 5 correcting remaining tabbed paragraph bullet gutter (5–9px offset). Final status pending. Durable log: `artifacts/presentation-fidelity/0001-revisit-iterations.json`.

### 0001 revisit — given-up after five genuine fixing/export iterations

- Subagent presentation_0001_revisit returned terminal status; supersedes earlier incomplete procedure. All five iterations exported/reviewed 12/12 pages at 96 dpi.
- Fixes: Assistant and Nunito measured 1.2em single spacing; continuation-line tab gutter; paragraph-font line strut; bullet gutter in tabbed paragraphs.
- Tab displacement resolved: 193.59px vs Office 193.63px. First-slide final baseline error 6.6px to 1.6px. All measured baselines within 2.67px; image counts agree and bounds within 0.46px.
- Remaining: slide 5 final word 'okay.' starts 5.27px too far left, just outside strict tolerance; no speculative font-width correction added.
- Validation: 39 tests / five files passed; changed behavior coverage 96.19% lines, 94.75% statements, 92.55% branches. Core/web typechecks and whitespace check passed.
- Evidence: `artifacts/presentation-fidelity/0001-revisit-iterations.json`, `0001-revisit5.pdf`, all-page review `0001-revisit5/`, `0001-final-positions.json`, `0001-tests-final.log`.

## Current assignment (supersedes earlier current sections)

- 0003: `pptx/bsd-3-clause/2021/bb7d81f702ba3e8d43d15d1d3f525d00-2021-02-ro-crate-bco.pptx`.
- Assigned to presentation_0003; terminal status pending. Continue sequential inventory after this file.

### 0003 — progress (not terminal)

- Baseline and iteration 1 export 43/43 pages; all eight contact sheets reviewed at 96 dpi.
- PT Sans was missing, causing Willow fallback. Subagent added four licensed PT Sans faces and OFL license, correcting width/wrap mismatches.
- Remaining vertical drift: slide 43 final baseline -52.25px; reference 20pt list pitch 33.02pt vs SuiteLeaf 29.25pt. Math plus/equal shapes rendered as rectangles; geometry fixes underway.
- Durable log: `artifacts/presentation-fidelity/0003-iterations.json`. Terminal status pending.
- 0003 iterations 2–4: added mathPlus and mathEqual preset geometry (only affected slide 24 changes); PT Sans measured 1.2em spacing restores slide 43 cumulative list spacing. Iteration 5 investigating PNG ICC color interpretation. Slide 8 wrapping remains under review.

### 0003 — given-up after five genuine fixing/export iterations

- Source: `pptx/bsd-3-clause/2021/bb7d81f702ba3e8d43d15d1d3f525d00-2021-02-ro-crate-bco.pptx`; subagent presentation_0003 returned terminal result. Every iteration 43/43 pages at 96 dpi, all-page review; shape iterations additionally verified other pages unchanged by hashes.
- Fixes: shipped four OFL-licensed PT Sans faces; adjustable DrawingML mathPlus/mathEqual geometry; measured PT Sans 1.2em spacing; removed PPTX PNG ICC metadata preserving compressed pixels (sample screenshot blue now reference RGB 80,126,183).
- Remaining: slide 35 final URL baseline +8.88px. Slide 8 wrapping agrees, final baseline +3.75px; slide 43 final list +1.75px.
- Validation: 43 tests / six files passed; focused coverage 100% lines/statements, 92.45% branches. Core/web typechecks and whitespace checks passed.
- Evidence: `artifacts/presentation-fidelity/0003-iterations.json`, `0003-iteration5.pdf`, all-page `0003-iteration5/`, `0003-final-positions.txt`, `0003-tests-final.log`, `0003-regression.log`.

## Current assignment (latest)

- 0004: `pptx/cc-by-2.0/2019/14efb9f657739c56404e3153ecfdb4ed-Firenze_By_the_book_Giglia.pptx`.
- Assigned to presentation_0004; terminal status pending. Continue sequential inventory after this file.

### 0004 — progress (not terminal)

- Baseline 17/17 pages, all three contact sheets reviewed at 96 dpi. Mixed-size title up to21px error; Times New Roman multiline drift; centered bullets up to69px displaced.
- Iteration 1 corrects soft-break lines inheriting first-line absolute height. Title error now ~1.4px; only slide 1 raster changed, all pages checked.
- Iteration 2 centered-bullet anchoring underway. Durable log `artifacts/presentation-fidelity/0004-iterations.json`.
- 0004 iterations 2–4: centered bullets corrected to within1px; measured Times New Roman metric correction initially had no effect because Maple alias held separate old metric; preserving explicit Arial bullet face exposed color-inheritance regression, queued correction before terminal result. Office/Maple metric equality regression test added. Fifth/sixth exports pending.

### 0004 — given-up after six fixing/export iterations

- Source: `pptx/cc-by-2.0/2019/14efb9f657739c56404e3153ecfdb4ed-Firenze_By_the_book_Giglia.pptx`; subagent presentation_0004 returned terminal status. All iterations 17/17 pages, all pages reviewed at96dpi with unchanged-page hashes and final three contact sheets.
- Fixes: mixed-size soft-break line heights; centered bullet gutters; Times New Roman then Maple alias measured1.2em spacing; explicit ordinary bullet fonts; split bullet color inheritance.
- Slide1 title baseline398.25pt vs399.31pt; slide11 bullet118.76pt vs118.54pt; slide4 last baseline525pt vs524.856pt.
- Remaining: slide10 caption final C starts6.42px too far left. Stored44pt*90%=39.6pt vs reference39.984pt (~40pt); no speculative rounding. Internal i/f glyph-origin differences excluded as glyph differences.
- Validation:393tests/60files passed; focused96.71%lines94.9%statements92.01%branches. Core/web typechecks and whitespace passed.
- Evidence: `artifacts/presentation-fidelity/0004-iterations.json`, `0004-iteration6.pdf`, all-page `0004-iteration6/`, `0004-final-positions.txt`, `0004-tests-final.log`, typecheck logs.

## Current assignment (latest)

- 0005: `pptx/cc-by-2.0/2019/a5b471cc1cf989699f8c872ae9a7f8ed-Slavec_190923_v3.pptx`.
- Assigned to presentation_0005; terminal status pending. Continue sequential inventory after this file.

### 0005 — progress (not terminal)

- Baseline16/16 pages, all three contact sheets reviewed96dpi. Incorrect black table-header text, extra master labels, logo sizing and paragraph issues identified.
- Iteration1 removes inherited run black overriding table white when no explicit run fill; white headers restored on slides5/8/10/11.
- Iteration2 interleaves inherited text with its master/layout layers so layout backgrounds can cover master labels. Iteration3 investigating dropped table subscript scale.
- Durable log: `artifacts/presentation-fidelity/0005-iterations.json`. Terminal status pending.

### 0005 — given-up after five fixing/export iterations

- Source: `pptx/cc-by-2.0/2019/a5b471cc1cf989699f8c872ae9a7f8ed-Slavec_190923_v3.pptx`; subagent presentation_0005 terminal result. Every iteration16/16 pages reviewed96dpi.
- Fixes: inherited run colors overriding table white; master/layout text layering; table subscript scale import and schema retention; real shipped Willow regular/bold advances replace approximate table width categories, removing~26px false header growth onslide5.
- Remaining: slide6 caption right edge17.11px left, slide14 sublist~17.86px left (SuiteLeaf fitted18.495pt vs reference18.96pt); slide2 cumulative baseline drift>5px.
- Validation335tests/54files passed; changed-source96.22%lines93.1%statements87.34%branches. Focused table98.97%lines97.03%statements93.71%branches. Core/web typechecks, whitespace passed. Broad measured branch coverage remains below90%; retain explicit limitation.
- Evidence: `artifacts/presentation-fidelity/0005-iterations.json`, `0005-iteration5.pdf`, all-page `0005-iteration5/`, `0005-final-positions.txt`, `0005-residual.py`, `0005-tests-final.log`, coverage/typecheck logs.

## Current assignment (latest)

- 0006: `pptx/cc-by-2.0/2019/af21bf76f7eb1d313e44b8e82851ab7b-final-project-presentation.pptx`.
- Assigned to presentation_0006; terminal status pending. Continue sequential inventory after this file.

### 0006 — progress (not terminal)

- Baseline15/15 pages all three sheets reviewed96dpi. No fractional normAutofit scaling here; measured Gill Sans/Plum line pitch mismatch.
- Iteration1 corrects Gill Sans and Plum to measured1.2em with alias regression tests. All2,329matched non-space character origins strictly<5px across15pages; no visible wrapping/shape difference>5px. Final image bounds/coverage/typechecks pending before acceptance.

### 0006 — matched after one fixing/export iteration

- Source: `pptx/cc-by-2.0/2019/af21bf76f7eb1d313e44b8e82851ab7b-final-project-presentation.pptx`; subagent presentation_0006 terminal matched result.
- Corrected measured Gill Sans MT / SuiteLeaf Plum single spacing1.1597em to1.2em. Export15/15pages; all three contact sheets reviewed96dpi.
- All2,329corresponding non-space character origins within tolerance: max3.35px horizontal1.67px vertical; image bounds max0.23px. Wrapping, textbox placement, shapes/images agree. Internally repeated background has no visible difference.
- Validation6font-mapping tests passed; metric data100%lines/statements; core/web typechecks, whitespace passed.
- Evidence: `artifacts/presentation-fidelity/0006-iterations.json`, `0006-iteration1.pdf`, all-page `0006-iteration1/`, `0006-final-positions.json`, tests/coverage/typecheck logs.

## Current assignment (latest)

- 0007: `pptx/cc-by-2.0/2020/0a0c7478080d6346c27a1c6c556feb29-ppt_penulisan artikel RJI.pptx`.
- Assigned to presentation_0007; terminal status pending. Continue sequential inventory after this file.

## User correction: 2026-11-04 — no font-specific layout rules

- User requested removal of font-specific spacing and AGENTS guidance against font-specific logic.
- Removed all spacing overrides introduced by this fidelity work: Assistant, Nunito, PT Sans, Gill Sans/Plum, Lucida Sans/Sassafras, Times New Roman/Maple. Restored pre-session metric data, removed override-specific assertions. Existing metric table is font data, not a newly tuned override.
- Also removed newly introduced Willow-only glyph-width shortcut/data; table measuring falls back to its prior implementation. General fixes to imports, shapes, layering, tables, paragraphs, and font availability remain.
- Added AGENTS.md guidance: avoid font-specific layout logic/spacing overrides; investigate shared import/layout/autofit/inheritance/font-metric causes and use general font-data measurement.
- Validation:22tests across font mapping, paragraph fonts, table rows passed.
- IMPORTANT: prior comparisons are historical evidence, not current-output guarantees after these removals. 0006 matched status is revoked and now NEEDS REVALIDATION; other processed decks remain unresolved and require fresh exports before future acceptance.
- Interrupted0007 while removing rules; resume with new guidance and freshly rebuilt CLI. No terminal0007 outcome yet.

### 0007 — given-up after five fixing/export iterations

- Source: `pptx/cc-by-2.0/2020/0a0c7478080d6346c27a1c6c556feb29-ppt_penulisan artikel RJI.pptx`; subagent presentation_0007 terminal result.18/18pages every iteration reviewed96dpi; no font-specific spacing exceptions.
- General fixes: whole-point quantization of reduced autofit sizes; removed heuristic second fitting of inherited labels; hanging trailing spaces preserving content; corrected hanging-span line-height; consistent SmartArt percentage font-grid interpretation with exact-spacing exemption. Diagram text extracted, main module943lines.
- Cross-deck0004 caption error6.42px to0.74px; not a full-deck reacceptance.0007slide18 authored36pt restored, baseline0.11px.
- Remaining baselines: slide2+5.91px, slide3max5.59px, slide5max5.33px, slide11max5.12px.
- Validation372tests/59files passed; changed-source95.78%lines93.23%statements89.27%branches (branch coverage remains below90%). Core/web typechecks and whitespace passed.
- Evidence: `artifacts/presentation-fidelity/0007-iterations.json`, `0007-iteration5.pdf`, all-page `0007-iteration5/`, `0007-residuals.json`, `0007-final-positions.txt`, tests/coverage/typecheck logs.

## Current assignment (latest)

- 0008: `pptx/cc-by-2.0/2020/84d594b2aea4d30d5e580ec0824aba5c-PRESENTASI NUR PEBIY RIANTI.pptx`.
- Assigned to presentation_0008; terminal status pending. Seven unique decks processed; zero currently accepted matches after font-override rollback.0006requires revalidation. Continue inventory sequentially.

## Commit checkpoint: 2026-11-04

- User requested commit and push to main. Paused presentation_0008 for a stable snapshot; its baseline6/6pages reviewed96dpi, character tracking and slide5 line geometry differences under investigation. No0008fix iterations or terminal status yet.
- Full Vitest:4283passed,29failed,18skipped /613files. Failures:28 Windows path-separator assertions or SQLite cleanup EBUSY in unchanged AI/update/store/directory tests; one slide-editor objects timeout (isolated rerun pending). Core/web typechecks and diff whitespace passed.
- Font-specific spacing overrides remain removed. Pre-existing `scripts/zenodo-windows-pdfs.ps1` excluded from commit as unrelated work. No desktop installer build requested or packaged.
- Isolated slide-editor objects rerun:22/22tests passed; full-run timeout did not reproduce.
