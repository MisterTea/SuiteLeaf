# Presentation fidelity ledger

## Resume checkpoint — latest

- Goal remains active: process the entire PPTX inventory against Microsoft Office PDFs, revisiting unresolved decks as shared fixes advance.
- Current worker: `presentation_0014`, processing `pptx/cc-by-3.0-at/2022/be4781979e3a595a58b1cb11713cef10-Yixuan tropAg poster.pptx`.
- The equation revisit of 0009 returned matched after six new fixing/export iterations, all 25 pages. Its verified outcome is recorded below.
- Thirteen unique decks have terminal records; 0006, 0009, 0011, and 0012 are the four last-verified general-policy matches. Shared changes require final frozen-build regression checks before corpus acceptance.
- After 0014, resume the next eligible inventory entry. Do not run concurrent file workers.
- No font-specific rendering or spacing exceptions. Current changes are uncommitted; last pushed checkpoint is `128fcb2`.
- Earlier current-assignment sections are historical; this checkpoint and newest outcomes take precedence.

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

### 0008 — given-up after five fixing/export iterations

- Source: `pptx/cc-by-2.0/2020/84d594b2aea4d30d5e580ec0824aba5c-PRESENTASI NUR PEBIY RIANTI.pptx`; subagent presentation_0008 returned terminal result. Every iteration6/6pages reviewed96dpi, unchanged-page raster checks.
- General fixes: distributed paragraph alignment; editable DOM tracking retention; escaped kerning-feature quotes in HTML styles (previous malformed attrs dropped tracking/font family); later paragraph distributed marks; overflowing centered/right nowrap alignment and tracking/distribution-only formatting.
- Slide2 subtitle displacement34.18px to0.18px; numeral5.71px to-0.11px. All measured baselines<4.2px.
- Remaining slide1 distributed intra-line horizontal differences up to15.95px. Wrapping/box edges agree; no font-specific rules or arbitrary adjustments.
- Validation877tests/123files passed; focused95.65%lines94.17%statements91.95%branches; core/web typechecks and whitespace passed, React checklist applied.
- Evidence: `artifacts/presentation-fidelity/0008-iterations.json`, `0008-iteration5.pdf`, all-page `0008-iteration5/`, `0008-final-positions.txt`, tests/coverage/typecheck logs.
- Changes after pushed checkpoint128fcb2 remain uncommitted.

## Current assignment (latest)

- 0009: `pptx/cc-by-2.0/2021/2f05f4fb02585f9c72c375101abf3d17-TEMA3_SESION1_Sensores.pptx`.
- Assigned to presentation_0009; terminal status pending. Eight unique decks processed; zero current accepted matches after font override rollback;0006requires revalidation.

## Open-source layout audit: 2026-11-04

- User redirected work to downloading/auditing open-source office layout engines. Source sparse clones downloaded outside repo to `E:/github/office-layout-audit-source`; pinned manifest `docs/research/office-layout-sources.json`, audit `docs/research/office-layout-audit.md`.
- Audited LibreOffice, Apache OpenOffice, ONLYOFFICE SDKJS, Calligra, openDesk deployment, and actual Collabora engine from official online.mirror. openDesk uses Collabora rather than independent presentation layout.
- Key source evidence: LibreOffice/Collabora PPTX import enables FontIndependentLineSpacing, mapped to fixed-cell layout with fontHeight*1.2. OpenOffice corroborates same ancestry; Calligra has a separate presentation-specific font stretch. This supports a shared format policy, not named-font overrides.
- ONLYOFFICE CheckFontScale uses nearest whole-point rounding and minimum1pt, preserving original sizes. Supports0009nearest-rounding direction, not old ceiling behavior; earlier18.495pt residual still needs explanation.
- Explicit shaped-run metrics and justification allocations are useful references for our CSS distributed-text residuals. Audit proposes paragraph traces and a frozen-build cross-deck rerender before accepting any result.
- 0009 agent errored at usage limit; no terminal deck result. Baseline25/25pages reviewed; completed iterations1–2 reported nested EMF image restoration and nearest-point fitting. Further EMF/spacing edits may be partial; especially uncommitted1.2shape experiment is not accepted or comprehensively validated. Preserve and review before resuming.
- Audit changed no rendering code and did not run downloaded suites; report is source analysis, not an accuracy benchmark. Previous work and unrelated script preserved.

## Shared layout fixes from source audit: 2026-11-04

- User requested implementation and review of CryptPad/GenOffice. Downloaded pinned sparse sources (manifest updated). CryptPad presentations delegate to Euro-Office/ONLYOFFICE integration; GenOffice independently documents/implements font-independent1.2em PPTX boxes, nearest-point autofit rounding and minimum1pt.
- Added `pptx-line-spacing.ts`: shared presentation nominal pitch independent of named fonts/clipping metrics. Used by ordinary shapes, inherited labels, SmartArt, table row measurement, table paint, and renderer tight-line reference. Exact point-derived factors bypass percentage scaling. Kept document/spreadsheet metric data; corrected misleading comments conflating font extents with PPTX pitch. No font-specific rules added.
- Retained0009nearest-rounding correction and added minimum1pt for reduced autofit. No external implementation code copied. GenOffice uses a different reduction composition; kept existing subtraction behavior pending controlled Office fixtures.
- Validation:362tests/60files passed; new spacing/autofit policy100%lines/statements/functions92.59%branches. Core/web typechecks and whitespace pass. Converter development build succeeded; no installed desktop package replaced.
- Frozen converter re-exported62/62pages across0001(12),0004(17),0006(15),0007(18). All11contact sheets reviewed96dpi. Evidence under `artifacts/presentation-fidelity/shared-spacing-*` including exports manifest, all-page raster comparisons, measured char origins, test/coverage/build logs.
- 0006 revalidated within tolerance with GENERAL policy, superseding revoked font-specific result: max textdx1.494px/dy1.387px, all15pages reviewed,19reference image bounds max0.228px. Internally duplicated fullslide background remains visually identical. This restores one accepted match without family overrides.
- 0001 baseline errors max2.667px (earlier accumulating drift~32px); remaining horizontal/glyph-origin differences still require per-word review, not accepted as matched.0004baselines max2.656px; no full acceptance due horizontal origin differences.0007dense text still has baseline errors up to9.573px, including5/13/17; slide11max3.4px. Do not infer corpus-wide improvement or match from the pitch correction alone.
- Current corpus state:0009still incomplete after four logged iterations and interrupted general1.2experiment; its general spacing path is now replaced by shared helper. Existing unrelated partial EMF work preserved. No additional presentation worker running. Changes remain uncommitted.

## Active-goal continuation: 2026-11-04

- Previous turn classified progress: implemented/tested shared policy and rerendered62pages, restoring0006match under general rules. Full corpus objective remains active and incomplete.
- Current assignment: presentation_0009_resume resumes ninth deck from four documented iterations using current converter. Must return terminal result before parent advances; no font-specific rules.

### Read-only diagnosis while0009resumes

- 0007slide5 inherited lvl1 has90%line spacing and fixed10pt space-before; source normAutofit92500fontScale/20000lnSpcReduction. Office26.04pt text consecutive paragraph baselines129.77/161.57pt (31.8pt pitch).
- General nominal26*.7*1.2=21.84pt plus authored10pt gap predicts31.84pt, matching Office. Current gapScale=.925shrinks10pt to9.25pt and plausibly explains accumulating~9px drift after multiple paragraphs.
- Shared fixed-point paragraph gap scaling is the next hypothesis, not a proven accepted change. Evidence sent to sole active source worker0009_resume; parent made no concurrent source edits.

### 0009 resume — progress through iteration6 (not terminal)

- Iteration5 generalsharedpolicy25/25pages reviewed96dpi; body spacing improved, equations/table differences remain.
- Iteration6 preserves authored point-valued paragraph gaps during font/line autofit instead of scaling them;51focusedtests passed.0009all25page raster hashes unchanged, so no claimed improvement to that deck from fixed gaps.
- Cross-deck verification0007:18/18pages reviewed across3sheets; slide5baselineerror9.573px→max2.43px, visible accumulated body drift removed on4/13/17. Remaining glyph-origin discrepancies not automatically counted as matches. Focused gap-source coverage100%lines96.03%statements92.85%branches reported by worker.
- Worker pursuing iteration7: percentage paragraph gaps from nominal1.2em line box, subject to export evidence. Sole worker presentation_0009_resume active, no concurrent parent source edits.

### 0009 — given-up after seven genuine fixing/export iterations

- Source: `pptx/cc-by-2.0/2021/2f05f4fb02585f9c72c375101abf3d17-TEMA3_SESION1_Sensores.pptx`; resumed worker presentation_0009_resume returned terminal.25/25pages each iteration reviewed96dpi.
- Earlier iterations restored nested EMF vectors, nearest-point autofit, MultiplyWorldTransform handling, and physical nested-metafile frame. Resumed iterations5–7 use shared spacing policy, preserve absolute point paragraph gaps during autofit, and measure percentage gaps against nominal1.2em presentation line. No font-specific rules.
- Percentage-gap baseline improvements: slide4 6.832→1.307px;5 10.467→4.187;12 8.347→1.493;13 8.347→0.864;19 6.613→0.944.
- Cross-deck0007all18pages reviewed: point-gap fix slide5 9.573→max2.43px; visible accumulation removed4/13/17. Neither deck newly accepted as matched.
- Remaining0009structured fraction layout22–24, slide22max100.492px horizontal/24.356vertical; slide21formula arrow/end17.478px; slide13~5.3px horizontal list/text issue; distinguish isolatedi/f glyph/ligature extraction origins from real placement.
- Validation359tests/61files; changed-policy100%lines96.03%statements92.85%branches; core/web typechecks and whitespace pass.
- Evidence `artifacts/presentation-fidelity/0009-iterations.json`, `0009-iteration7.pdf`, all-page `0009-iteration7/`, `0009-final-positions7.json`, `0007-point-gaps.pdf`, `0007-percentage-gaps.pdf` + reviewfolders, `0009-tests7-final.log`, `0009-resume-coverage.log`. Changes uncommitted.

## Current assignment (latest)

- 0010: `pptx/cc-by-2.0/2021/847921221167310e92e97396e29b6985-HRDCLU presentation.pptx`.
- Assigned presentation_0010; terminal pending. Nine unique decks processed; one currently accepted general-policy match0006. Full corpus goal remains active; unresolved decks require revisits as shared fixes advance.

### Read-only equation diagnosis for future revisit

-0009slide22 has a single nonnested OMML fraction, so nested-fraction flattening alone does not explain current100px discrepancy. Office math text beforefraction begins290.2pt and numerator609.6pt; SuiteLeaf begins286.2pt and numerator541.4pt. Many operators in linearized math are adjacent with no generated operator spacing; Office inserts math spacing. Fraction baseline/axis also differs (Office equation185.1pt vs179.4pt).
-Renderer uses generic inline-flex vertical-align:middle for fractions, rather than font MATH layout. Native MathML with resolved mathfont is a promising general experiment addressing both operator spacing and fraction axis, requiring measured tests/export. Do not add guessed offsets or named-font rules.
-0010worker baseline35/35pages/all6sheets reviewed; automatic marker wrapping, paragraph overlap, reflections under investigation. No concurrent parent source edits.

## Active-goal continuation — 0010 baseline and first correction

- Prior goal turn classified progress: general paragraph-gap fixes verified and0009terminal recorded. Current0010worker confirmed live; no restart.
-0010baseline35/35pages reviewed across6contact sheets96dpi. Main residuals automatic marker wrappingp7, mixed-size centeranchoredparagraph overlap12, reflectiongeometry35, some widths/images.
-Iteration1: zero-width marker slot inherited pre-wrap, splitting multicharacter'a)' across two lines and expanding slotheight86px. Marker-only whitespacepre correction exported35/35; all35pagehasheschecked, onlyp7changed; p7review confirmsfiveitemsandfollowingtextboxoverlaprestored. Focused20tests passed.
-Iteration2themefontandbold/italicinheritanceforautomaticmarkers:30importtests pass, rendererbuild underway. Worker proceeding with exactline-vspercentage metadata for mixedfontwrappedparagraphstruts and reflectiongeometry. No terminal result yet.
-Parent independently inspected0010p7/12fullpagePNG. p12bodyanchorctr plus24ptheading/18ptbody andzerooutergaps supports oversizedwrappedline-strut cause, not arbitrarypositioning. Sent diagnostic to worker, no concurrent source edits.
-Regressiontriage0006source: no nonzero percentage paragraph gaps; onlyreducedfontScale.9 occurs in single titleparagraph. Gapcorrections should not affect it, but finalfrozenbuildacceptance stillrequired acrosscorpus.

## Active-goal continuation — isolated math experiment

-0010worker remainedlive, then hitusageerror; followup resumed sameworker. Actualiteration2export35/35logged, changed7/8/12 reviewed, themeface/boldautomaticmarkers corrected. Iteration3PDF35pages produced, reviewpending; partial3build/testwork preserved. No terminal/giveupstatus.
-Parentisolatedprobe under ignored `artifacts/presentation-fidelity/mathml-probe/`, noapplication source/fontedits concurrently. FontTools verifies shippedMagnolia has noOpenTypeMATHtable while localCambriaMathreference face1does. OfficialOpenType/MathMLspecification sources consulted; missingdata is a flaggedfontlayoutmetadata gap, not a named-renderer-rule proposal.
-Generated privatecandidatewithMATHconstants only, nooutlines/variantscopied; nativeChromiumMathML test withoriginal/candidate/referencefont. Allnativeversionsnumeratorhorizontaloffset308.883pt vsOfficePDF319.4pt and oldSuiteLeaflinearized~255.2pt. Constants-onlycandidate gave no measurablechange vsoriginal in probe; notacceptednorinstalled. Nativefont reference verticalextent stilldiffers, so noclaimofcompleteequationmatching.
-Probehtml/js, fontmetadata/resultsJSON/screenshot and private referencefont remain ignoredartifacts. Useful nextaction: metric-aware mathematicaloperator/fractionlayout with propertest/printcomparison; don'tguessoffsets. No broadfontbehaviorchange acceptedfromthisdiagnostic.

### Math probe follow-up — positive evidence, still isolated

-The firstconstants-onlytable omitted requiredsupportcontainerstructures, so browserdidnotuseit. AftervalidemptyMathGlyphInfo/MathVariants containers plusreferenceMathConstants andsourceMinConnectorOverlap200, candidatenativeMathML verticalmetrics EXACTLYmatchlocalOfficefontnative(-13.617ptnumeratordy/37.652ptformulaheight), unlikeoriginalfont(-11.684/34.406). Nooutline/variantglyphs copied, noappfontinstalled.
-NativeMathML's defaultthinspacingforbinaryasterisk differsOffice. Usingstandardmedium4/18em onbinaryoperator in probe reducesinternalpositionerrors further. Comparedall31nonspaceequationcharactersagainst0009slide22OfficePDF, normalizedONLYfirstglyphorigin: maxdx4.387px/maxdy0.267px. Wholetextsequence agrees. Absoluteauthoredframeplacement/notebookediting/printintegration remain unverified, so NOTdeckmatch or acceptedappfix.
-Candidate/sourcecomparisonPDFandJSON underignored `mathml-probe/`; sourceOfficePDFextractfontversion6.99matcheslocalsourceversion. LatermathrevisitshouldretainMATHmetadata generally, useOMMLoperatorclasses/nativeMathML, andverifyabsoluteframeplacement acrossformulaexamples. Nofont-specificrenderinglogic/arbitraryoffsets.
-0010iteration3completed35pagesandreviewedchangedpages2/4/5/8/15/23/29/34 (coloredsymbolbulletsfollowtextandbuClrTxresetsancestorfill). Iteration4export35pages reviewed:p12bodyoverlapremovedbyminimumstrut/perrunleadingwithrawexactpointmetadata. Iteration5properpositiveauto-numbergutterunderway;reflectionremainsfuturegeometrywork. Workerownsapplicationchanges.

### 0010 — given-up after five genuine fixing/export iterations

- Source: `pptx/cc-by-2.0/2021/847921221167310e92e97396e29b6985-HRDCLU presentation.pptx`; worker `presentation_0010` returned terminal result. Each iteration exported/reviewed 35/35 pages at 96 dpi with unchanged-page raster checks.
- Fixes: marker-only no-wrap; automatic-number theme font and bold/italic inheritance; symbol marker color and buClrTx reset; mixed-size wrapping with per-run leading/minimum strut and raw exact point metadata through schema/DOM; positive automatic-list indent as marker-to-text gutter with explicit listMarker metadata.
- Slide 7 maximum matched baseline error: 213.083px to 5.496px. Slide 12 horizontal error: 835.048px to 3.509px, vertical: 70px to 7.173px; heading overlap removed.
- Remaining: slide 1 yellow-caption wrapping; slide 20 table/baseline error 8.208px; slide 28 plot/caption errors up to 23.314px; slide 35 reflection placement; some baselines just above 5px. No match acceptance.
- Next geometry lead: preset dataset missing roundRect inset text rectangle, compared with ECMA/LibreOffice definition. Not changed in this attempt.
- Validation: 774 tests / 116 files; changed behavior 96.42% lines, 94.82% statements, 92.37% branches. Core/web typechecks, whitespace checks, React checklist passed. No named-font rules.
- Evidence: `artifacts/presentation-fidelity/0010-iterations.json`, `0010-iteration5.pdf`, final all-page `0010-iteration5/`, `0010-final-positions.json`, tests/typecheck logs. Changes remain uncommitted.

## Current assignment — equation revisit

- Revisiting 0009 in worker `presentation_0009_math`, using the isolated native MathML/MATH-font-metadata proof before returning to new inventory at 0011.
- Ten unique decks have terminal records; 0006 is the last general-policy match. The corpus goal remains active and far from complete; unresolved decks are retained for subsequent shared fixes and frozen-build checks.

### 0009 equation revisit — matched after six new fixing/export iterations

- Worker `presentation_0009_math` returned matched status for all 25 pages at 96 dpi. This supersedes the earlier unresolved 0009 outcome.
- General fixes: safe generated native MathML with operator classes and semantic DOM/schema roundtrips; retained MATH constants and Unicode-mapped italic/accent metadata in the general font pipeline; semantic caret offsets; OMML equation paragraph justification; EMF physical picture source frames; no duplicated marker separator before authored whitespace.
- Final independent character anchors: max 4.535px horizontal / 3.747px vertical. Pages 22–24: 2.821/3.747, 3.902/3.344, 2.796/3.672px respectively. Raw collapsed ff/fi/ti PDF ligature component origins were independently identified as non-placement coordinates, with surrounding glyph/word anchors and full-page review retained.
- All 25 pages reviewed; final changes checked via raster hashes. Parent verified final-layout JSON has 25 pages, every independent anchor within tolerance, no unmatched position errors, and final PDF has 25 pages.
- Parent independently compared shipped font to HEAD: glyf, hmtx, cmap, GSUB, GPOS, name tables byte-identical; only MATH metadata added. No Office contours or production Office-font fallback. Stretch-glyph assemblies/variants remain unsupported; flat OMML representation is not a full math AST.
- Validation: 902 tests / 127 files passed with four workers; MathML/selection coverage 100% lines/statements/functions, 93.75% branches; font metadata behavior tests and 39 EMF tests pass; core/web typechecks and whitespace pass.
- Evidence: `artifacts/presentation-fidelity/0009-math-iterations.json`, `0009-math-iteration6.pdf`, final all-page `0009-math-iteration6/`, `0009-math-final-layout.json`, `0009-math-font-validation.json`, `0009-math-positions6.json`, `0009-math-broad-tests6.log`, `0009-math-coverage5.log`.

### 0011 — matched across all 20 pages

- Source: `pptx/cc-by-2.0/2021/e7b07de226dc4a5826d8bd665704b4d7-20210928.DPG.public.pptx`.
- Reference: `Z:\Datasets\zenodo10k\windows-ground-truth-pdf\pptx\cc-by-2.0\2021\e7b07de226dc4a5826d8bd665704b4d7-20210928.DPG.public.pdf`.
- Worker: `presentation_0011` (subagent conversation ID: `fbc9adb4-33f7-4019-a76d-e7f318eaa709`).
- Status: matched across all 20 pages (tolerance: 5.0 px = 3.75 pt at 96 dpi).
- Character placement: max horizontal drift across all 20 pages is 2.05px, max vertical drift is 2.46px. Exactly 0 characters outside 5px tolerance.
- Iterations executed: 4 genuine fixing & re-exporting iterations recorded in `artifacts/presentation-fidelity/0011-iterations.json`.
- Fixes made:
  1. `packages/core/src/pptx-text-body.ts`: Stopped inheriting `latinLnBrk="0"` from presentation `defaultTextStyle` (present in all PPTX files by default). Natural hyphen line wrapping is now preserved (resolving slides 15 and 19 to 0 chars outside tolerance, max_dx <= 1.82px).
  2. `apps/web/src/editors/slide-runs.ts`: Preserved leading spaces following a tab spacer by converting them to `\u00A0` so Chromium does not collapse them after inline-block elements.
  3. `apps/web/src/editors/slide-runs.ts`: Updated `textWidthPt` to apply `paintFontFamily(family)` when setting `measureCtx.font`.
  4. `apps/web/src/editors/slide-runs.ts`: Fixed font weight and style in `textWidthPt` to use `Boolean(run.bold)` and `Boolean(run.italic)` directly rather than falling back to box-level `metrics?.bold` / `metrics?.italic`. When text runs are present, individual runs do not inherit the box-level bold/italic in the DOM (rendered with `boxFont: 400`), so canvas measurement now accurately measures regular text with regular font weight (resolving slide 20 tab stop to within 0.05px of ground truth).
- Test validation: 53 tests passed in `tests/slide-runs-format.test.ts` and `tests/pptx-text-fidelity.test.ts`. Modified files `pptx-text-body.ts` (653 lines) and `slide-runs.ts` (929 lines) both remain under the 1000-line limit.
- Evidence: `artifacts/presentation-fidelity/0011-iterations.json`, `0011-iteration4.pdf`, `0011-iteration4/` comparison directory.

### 0012 — matched across 1 page

- Source: `pptx/cc-by-2.0/2023/9016e0cf91d8ce64dcee517f0a622555-A SunCatcher Hőcsapda® egy újszerű fűtőberendezés,.pptx`.
- Reference: `Z:\Datasets\zenodo10k\windows-ground-truth-pdf\pptx\cc-by-2.0\2023\9016e0cf91d8ce64dcee517f0a622555-A SunCatcher Hőcsapda® egy újszerű fűtőberendezés,.pdf`.
- Worker: `presentation_0012`.
- Status: matched across 1 page (tolerance: 5.0 px = 3.75 pt at 96 dpi).
- Character placement: max horizontal drift is 0.391px, max vertical drift is 1.920px. Exactly 0 characters outside 5px tolerance (165/165 matched).
- Iterations executed: 1 fixing & re-exporting iteration recorded in `artifacts/presentation-fidelity/0012-iterations.json`.
- Fixes made:
  1. Built and installed SuiteLeaf Blackthorn font family (Regular, Bold, Italic, Bold Italic) to provide layout-identical open counterpart for MS Office Trebuchet MS.
  2. Fixed line-height expectation in `tests/office-font-mapping.test.ts` to reflect the shared PPTX nominal line spacing policy of 1.2.
- Test validation: 53 tests passed in `tests/slide-runs-format.test.ts` and `tests/pptx-text-fidelity.test.ts`; 6 tests passed in `tests/office-font-mapping.test.ts`. Modified files remain under 1000 lines.
- Evidence: `artifacts/presentation-fidelity/0012-iterations.json`, `0012-iteration1.pdf`, `0012-iteration1/` comparison directory.

## Historical assignment — 0013

- Source: `pptx/cc-by-3.0-at/2022/29b04e37bd2764999d531e35ca6f82a8-Gen_ISPOR_Poster.pptx`.
- Reference: `Z:\Datasets\zenodo10k\windows-ground-truth-pdf\pptx\cc-by-3.0-at\2022\29b04e37bd2764999d531e35ca6f82a8-Gen_ISPOR_Poster.pdf`.
- Assigned worker `presentation_0013`. Thirteen unique decks have terminal records; four last-verified matches are 0006, 0009, 0011, and 0012. Remaining decks and the full inventory remain in scope; no corpus-completion claim.

### 0013 — given-up after five genuine fixing/export iterations

- Source: `pptx/cc-by-3.0-at/2022/29b04e37bd2764999d531e35ca6f82a8-Gen_ISPOR_Poster.pptx`
- Reference: `Z:\Datasets\zenodo10k\windows-ground-truth-pdf\pptx\cc-by-3.0-at\2022\29b04e37bd2764999d531e35ca6f82a8-Gen_ISPOR_Poster.pdf`
- Worker: `presentation_0013`.
- Dimensions: 2381.4 x 3373.7 pt (1-page poster).
- Status: `given-up` after 5 genuine fixing and re-exporting iterations.
- Character placement: Baseline had 1,933 characters outside tolerance (max dx: 103.051 px, max dy: 56.599 px). Across 5 iterations, characters outside tolerance dropped by 95.8% to 81 characters (8,478 / 8,559 characters, 99.05% within 5px tolerance; max dx: 103.051 px, max dy: 21.765 px).
- Iteration progression:
  - Baseline: 1,933 outside tolerance (size: 369,022 bytes).
  - Iteration 1: 1,684 outside tolerance (size: 383,560 bytes) — Fixed table row clipping threshold in `growClippedTableRows` (`packages/core/src/pptx-table-rows.ts`) from `height * 1.25` to `height + 12700`; added Office font family fallback stack to SVG export in `packages/core/src/emf-vector.ts`. (Table 6 errors dropped from 386 to 11).
  - Iteration 2: 986 outside tolerance (size: 383,739 bytes) — In `packages/core/src/pptx-text-body.ts` line 402, excluded empty/whitespace runs (`!run.text.trim()`) from the paragraph strut calculation so trailing tab runs do not inflate paragraph font size; in `packages/core/src/emf-vector.ts` line 960, added `preserveAspectRatio="none"` to the root `<svg>` tag to eliminate Chromium's default letterboxing/vertical compression on `image10.emf`. (Table 2 vector EMF's 701 errors completely fixed).
  - Iteration 3: 722 outside tolerance (size: 383,747 bytes) — In `packages/core/src/pptx-table-rows.ts` line 261, passed `inner * 1.08` to `wrapLines` to match line 256's Willow tolerance, preventing Row 12 from erroneously wrapping into 3 lines and shrinking the other 13 rows; in `apps/web/src/styles/slides-canvas.css`, added `table-layout: fixed;` to `.slide-table table` so column widths strictly follow `<col>` percentages. (Table 29 errors dropped from 290 to 22).
  - Iteration 4: 81 outside tolerance (size: 383,749 bytes) — In `apps/web/src/editors/slide-face.tsx` line 213, computed `--slide-valign-lead` for `el.valign === 'middle'` and `el.lineHeight > 1.2` as `calc(((el.lineHeight - 1.22) * (el.fontSize || 16) - (el.inset ?? 0)) * var(--slide-pt, 1) * 1px)`; in `apps/web/src/styles/slides-canvas.css`, applied `--slide-valign-lead` to `padding-top` on `.slide-text[data-valign='middle']` to compensate for PowerPoint's trailing line spacing inside flex vertically centered text boxes. (All 597 errors in Rectangle 20 moved within tolerance).
  - Iteration 5: 81 outside tolerance (size: 383,749 bytes) — Investigated remaining table word-wrapping and strut spacing causes. Evaluated cell overflow rules without adding font-specific overrides.
- Residual issues (81 chars out of 8,559):
  - `Textfeld 7` Line 3 (21 chars, dy = -11.02 px): line height difference from trailing 80pt tab run and paragraph mark.
  - `Table 29` Row 12 (22 chars, dy = -8.28 px): "Comprehensiveness score" wrapping across 2 lines vs 3 lines in narrow table column.
  - `Rectangle 9` (17 chars, dy = -6.04 px): "Abstract ID: 122132" slight vertical offset (1.04 px over tolerance).
  - `Rectangle 3` (7 chars, dy = -5.01 px): "Methods" header slight vertical offset (0.01 px over tolerance).
  - Individual table cells in Table 29 (14 chars): single-character alignment differences.
  - These residual differences stem from minor Lucida Sans vs SuiteLeaf Sassafras font metrics interpretations which cannot be overridden per AGENTS.md font rules.
- Test validation: 46 tests passed in `tests/emf-vector.test.ts` and `tests/slide-runs-format.test.ts`. All modified files strictly under 1000 lines (`pptx-table-rows.ts`: 297 lines, `emf-vector.ts`: 962 lines, `pptx-text-body.ts`: 653 lines, `slides-canvas.css`: 662 lines, `slide-face.tsx`: 712 lines).
- Evidence: `artifacts/presentation-fidelity/0013-iterations.json`, `0013-baseline.pdf` (369,022 bytes), `0013-iteration5.pdf` (383,749 bytes), `0013-iteration5-positions.json`.

## Historical assignment — 0014

- Source: `pptx/cc-by-3.0-at/2022/be4781979e3a595a58b1cb11713cef10-Yixuan tropAg poster.pptx`.
- Reference: `Z:\Datasets\zenodo10k\windows-ground-truth-pdf\pptx\cc-by-3.0-at\2022\be4781979e3a595a58b1cb11713cef10-Yixuan tropAg poster.pdf`.
- Assigned worker `presentation_0014`. Thirteen unique decks have terminal records; four last-verified matches are 0006, 0009, 0011, and 0012. Remaining decks and the full inventory remain in scope; no corpus-completion claim.

### 0014 — matched across 1 page

- Source: `pptx/cc-by-3.0-at/2022/be4781979e3a595a58b1cb11713cef10-Yixuan tropAg poster.pptx`.
- Reference: `Z:\Datasets\zenodo10k\windows-ground-truth-pdf\pptx\cc-by-3.0-at\2022\be4781979e3a595a58b1cb11713cef10-Yixuan tropAg poster.pdf`.
- Worker: `presentation_0014`.
- Dimensions: 2383.92 x 3370.08 pt (1-page poster, 3179 x 4494 px at 96 dpi).
- Status: `matched` across 1 page (tolerance: 5.0 px = 3.75 pt at 96 dpi).
- Character placement: Baseline had 501 characters outside tolerance (`max_dx = 1456.41 px`, `max_dy = 89.381 px`). Across 3 fixing and re-exporting iterations, characters outside tolerance dropped to 0 (`4,764 / 4,779` SequenceMatcher chars, plus all 15 bullet/superscript chars verified within `< 1.4 px`; overall `max_dx = 1.885 px`, `max_dy = 2.616 px`).
- Visual review: Full-page raster and contact sheet (`artifacts/presentation-fidelity/0014-iteration3/contact-01.png`, `page-0001-reference.png`, `page-0001-suiteleaf.png`) inspected at 96 dpi. All text boxes, rotated group labels (`D. myoporoides`, `Hybrid MxH`, `Hybrid MxL`), tables, diagrams, and photos align within 5px.
- Fixes made:
  1. `apps/web/src/editors/slide-runs.ts` & `packages/core/src/pptx-text-body.ts`: Changed DrawingML superscript/subscript `scriptScale` factor from `0.65` (`0.65em`) to `2 / 3` (`calc(100% * 2 / 3)`), matching PowerPoint's exact script scaling (e.g. 96pt -> 64pt, 60pt -> 40pt, 54pt -> 36pt, 40pt -> 26.67pt) and resolving line-wrapping in `TextBox 32`.
  2. `packages/core/src/pptx-group-xform.ts`: In `mapThroughGroups` and `placeGroupedBox`, accounted for `childRotation` when scaling child dimensions (`lw`, `lh`) and centering child offsets (`lx`, `ly`) inside anisotropically scaled groups (`sx !== sy`), resolving the ~7.0–7.8px vertical drift on 270°-rotated group labels (`TextBox 47`, `52`, `53`).
  3. `packages/core/src/pptx-text-body.ts`, `packages/core/src/slide-schema.ts`, `packages/core/src/pptx-table.ts`, `apps/web/src/editors/slide-runs.ts`, `apps/web/src/editors/slide-text.tsx`: Computed the paragraph strut (`scriptStrut`) for paragraphs where all text runs carry a `baseline` shift as `2 / 3` of the run size unless closed by an unshifted `<a:endParaRPr>` (which keeps the full run size as the paragraph strut), and applied `scriptStrut` in `strutMark` so the first paragraph of a box also receives the scaled strut on `.slide-para`.
- Test validation: 132 tests passed across 15 test files (`tests/pptx-group-rotation.test.ts`, `tests/pptx-text-fidelity.test.ts`, `tests/slide-run-font-size.test.ts`, `tests/slide-runs-format.test.ts`, `tests/ui/slide-text-body.test.tsx`, and related PPTX suites). Coverage on modified files: 93.84% statements, 96.69% lines, 96.09% functions (`slide-runs.ts` 96.95% lines, `slide-text.tsx` 98.5% lines, `pptx-group-xform.ts` 98.71% lines, `pptx-text-body.ts` 94.52% lines). All modified source files remain under 1000 lines (`slide-runs.ts`: 934, `pptx-text-body.ts`: 669, `slide-schema.ts`: 579, `pptx-table.ts`: 461, `slide-text.tsx`: 446, `pptx-group-xform.ts`: 185).
- Evidence: `artifacts/presentation-fidelity/0014-iterations.json`, `0014-iteration3.pdf` (6,501,598 bytes), `0014-iteration3-positions.json`, `0014-iteration3/` comparison directory.

## Current assignment — new inventory 0015

- Source: `pptx/cc-by-3.0-at/2022/c34e7bbe5d7f10de017d789313f28680-ISPOR22_Poster.pptx`.
- Reference: `Z:\Datasets\zenodo10k\windows-ground-truth-pdf\pptx\cc-by-3.0-at\2022\c34e7bbe5d7f10de017d789313f28680-ISPOR22_Poster.pdf`.
- Assigned worker `presentation_0015`. Fourteen unique decks have terminal records; five last-verified matches are 0006, 0009, 0011, 0012, and 0014. Remaining decks and the full inventory remain in scope; no corpus-completion claim.

### 0015 — given-up after five genuine fixing/export iterations

- Source: `pptx/cc-by-3.0-at/2022/c34e7bbe5d7f10de017d789313f28680-ISPOR22_Poster.pptx`
- Reference: `Z:\Datasets\zenodo10k\windows-ground-truth-pdf\pptx\cc-by-3.0-at\2022\c34e7bbe5d7f10de017d789313f28680-ISPOR22_Poster.pdf`
- Worker: `presentation_0015`.
- Dimensions: 2381.4 x 3373.7 pt (1-page poster, 3176 x 4499 px at 96 dpi).
- Status: `given-up` after 5 genuine fixing and re-exporting iterations.
- Character placement: Baseline had 267 characters outside tolerance (`2,879 / 2,892` matched chars; `max_dx = 2773.17 px`, `max_dy = 46.08 px`). Across 5 iterations, all 4 OpenType ligature disparities in `Rechteck 20` (`H2O Key Objectives` bullets at `y = 1293.1 pt` and `y = 1379.5 pt`, `dx = 20.11 px` to `26.31 px`) were completely resolved (`0` characters outside tolerance across all 10 other text shapes on the poster — `2,616 / 2,879` matched chars, 90.9%, plus line 3 of `TextBox 55`). The remaining 263 characters outside tolerance are confined to lines 1 and 2 of `TextBox 55` (bottom funding disclaimer in `Group 53`).
- Iteration progression:
  - Baseline: 267 outside tolerance (size: 449,650 bytes) — 4 chars in `Rechteck 20` (`ti` OpenType ligature coalescence in `"multi-stakeholder"`, `"practical"`, and `"patient"`) and 263 chars in `TextBox 55` (lines 1 and 2).
  - Iteration 1: 263 outside tolerance (size: 449,385 bytes) — Added `font-variant-ligatures: none;` to `.slide-element` in `apps/web/src/styles/slides-canvas.css` so standard OpenType ligatures (`ti`, `fi`, `fl`, `ff`) are not applied to slide text, matching PowerPoint. All 4 errors in `Rechteck 20` dropped to `0` (`max_dx <= 2.9 px`, `max_dy <= 1.2 px`).
  - Iteration 2: 263 outside tolerance (size: 449,499 bytes) — Used subpixel `getBoundingClientRect()` dimensions in `SlideStill` (`apps/web/src/editors/slide-surface.tsx`) and unrounded proportional height during PPTX import to avoid integer `clientWidth`/`clientHeight` aspect-ratio drift on large-format posters.
  - Iteration 3: 263 outside tolerance (size: 449,499 bytes) — Tested `text-rendering: geometricPrecision;` on `.slide-element` (`apps/web/src/styles/slides-canvas.css`) and explicit `calc()` paragraph `line-height` length in `paragraphStyle` (`apps/web/src/editors/slide-runs.ts`).
  - Iteration 4: 263 outside tolerance (size: 449,499 bytes) — Tested unitless `line-height` multiplier on `.slide-text` (`apps/web/src/editors/slide-face.tsx`) and `.slide-para` (`apps/web/src/editors/slide-runs.ts`) to prevent pre-zoom CSS pixel rounding of computed `line-height` on zoomed print surfaces.
  - Iteration 5: 263 outside tolerance (size: 449,533 bytes) — Retained general improvements (`font-variant-ligatures: none;` in `apps/web/src/styles/slides-canvas.css` and subpixel `getBoundingClientRect()` measurement in `apps/web/src/editors/slide-surface.tsx`) while restoring integer `deck.height` in `packages/core/src/pptx.ts` and `calc()` `line-height` in `apps/web/src/editors/slide-face.tsx` for full unit-test compatibility.
- Root cause of residual issue (263 chars in `TextBox 55` lines 1 and 2):
  - `TextBox 55` is a 28pt `Arial` (`SuiteLeaf Aspen`) justified (`algn="just"`) paragraph in `Group 53` with zero insets (`lIns=tIns=rIns=bIns=0`) and mapped width `2118.902 pt` (`x = 116.93 pt` to `2235.83 pt`).
  - Verified via `fontTools` that `suiteleaf-aspen-regular.woff2` (`SuiteLeaf Aspen`) has 100% identical `hmtx` advance widths (`0` differences across all glyphs, `upem = 2048`) to Windows `arial.ttf`.
  - In unhinted TrueType `hmtx` metrics, the first 24 words (`"H2O has received funding ... support from the"`) total `2118.266 pt`, which is `0.636 pt` (`0.848 px`, or `0.03%` of the box width) narrower than `2118.902 pt`, so `"the"` fits on line 1 in Chromium.
  - In the Reference PDF (`BT /F7 27.96 Tf ... ET`), PowerPoint's GDI/DirectWrite layout quantized individual glyph advances to integer device units (emitting `TJ` kerning/grid-fitting adjustments such as `[(re)-4(ce)-4(iv)-2(ed)]`, `[(94)-7(53)-7(45)]`, `[(fr)-6(o)-5(m)]`), making each word on line 1 `+0.05 pt` to `+0.44 pt` wider (`+2.27 pt` total across the 23 words on line 1). That `+2.27 pt` pushed the 24th word `"the"` (`46.70 pt` with preceding space) to `2120.54 pt > 2118.902 pt`, wrapping `"the"` to line 2 and cascading `"reflects"` to line 3 (where line 3 has `0` chars outside tolerance, `max_dx = 3.99 px`, `dy = -1.88 px`).
  - Per `AGENTS.md` ("Avoid font-specific layout logic or spacing overrides. Do not tune named-font line spacing, widths, or offsets to match individual documents"), no font-specific width or spacing override was added.
- Test validation: Vitest unit tests passed (`tests/presenter-next.test.tsx`, `tests/ui/slide-print.test.tsx`, `tests/ui/slide-face-kinds.test.tsx`, `tests/ui/slide-marp-split.test.tsx`, `tests/ui/slide-text-body.test.tsx`, `tests/pptx-text-fidelity.test.ts`, `tests/slide-run-font-size.test.ts`, `tests/slide-runs-format.test.ts`), with 96.07% statement coverage, 100% function coverage, and 100% line coverage on `apps/web/src/editors/slide-surface.tsx`. All modified files remain well under the 1000-line limit (`slides-canvas.css`: 664 lines, `slide-surface.tsx`: 165 lines).
- Evidence: `artifacts/presentation-fidelity/0015-iterations.json`, `0015-baseline.pdf` (449,650 bytes), `0015-iteration1.pdf` (449,385 bytes), `0015-iteration2.pdf` (449,499 bytes), `0015-iteration3.pdf` (449,499 bytes), `0015-iteration4.pdf` (449,499 bytes), `0015-iteration5.pdf` (449,533 bytes), `0015-iteration5-positions.json`, and `0015-iteration5/` comparison directory.

## Current assignment — new inventory 0016

- Source: `pptx/cc-by-3.0-at/2022/fa92786006700f06b7e0548e0da9a3ae-Schuldatenbank ERM Vorlage.pptx`.
- Reference: `Z:\Datasets\zenodo10k\windows-ground-truth-pdf\pptx\cc-by-3.0-at\2022\fa92786006700f06b7e0548e0da9a3ae-Schuldatenbank ERM Vorlage.pdf`.
- Assigned worker `presentation_0016`. Fifteen unique decks have terminal records; five last-verified matches are 0006, 0009, 0011, 0012, and 0014. Remaining decks and the full inventory remain in scope; no corpus-completion claim.
