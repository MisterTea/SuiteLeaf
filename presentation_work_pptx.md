# PPTX round-trip fidelity ledger

## Resume checkpoint

- Task: process every genuine PPTX recursively under `Z:\Datasets\zenodo10k\files`, one sequential subagent per file.
- Current: 0001–0005 completed; worker `pptx_roundtrip_0006` assigned to af21bf76f7eb1d313e44b8e82851ab7b-final-project-presentation.pptx.
- Outcomes: five matched for static visual/layout fidelity, zero given up; 10,437 genuine decks remain. The older `presentation_work.md` records PDF exports, not this task's PPTX round trips.
- Inventory: `artifacts/presentation-fidelity/inventory.csv` (10,445 entries; parse with Python CSV because paths can contain newlines). Revalidate source availability. Metadata files beginning `._` and Office locks beginning `~$` are excluded.
- Fresh 2026-11-08 enumeration: 10,442 genuine presentations and three excluded metadata/lock files. All source files stat successfully using Windows extended paths. `artifacts/presentation-pptx/inventory.json` records this task's queue, source sizes, and available reference PDFs (10,242). The 200 presentations lacking existing reference PDFs still need source rendering, rather than automatic skipping.
- Process in case-insensitive relative-path order. Record source, worker, status, iterations, fixes, tests, output/comparison paths, and remaining discrepancies before launching the next worker.
- Artifacts: `artifacts/presentation-pptx/`; source dataset remains untouched.

## Acceptance procedure

1. Use SuiteLeaf CLI to import and export a fresh PPTX. Add `convert --to pptx` if necessary.
2. Compare the exported PPTX against the original, including rendering both through the same renderer. Existing Office ground-truth PDFs may support reference comparison; do not substitute SuiteLeaf PDF export for the required exported PPTX.
3. Review all slides. Different glyph outlines are allowed; wrapping, text boxes, pictures, shapes, and placement must agree. Ignore deviations below 5 pixels, with scale recorded.
4. Fix shared SuiteLeaf causes and repeat CLI PPTX export and comparison. At least five substantive fix/re-export iterations are required before giving up on unresolved disparities. Do not count unchanged reruns as fixes.
5. Add Vitest behavior coverage for changes and keep relevant coverage above 90%. Avoid font-family-specific layout overrides. Preserve pre-existing user changes.
6. Only report matched with concrete all-slide evidence; distinguish blocked prerequisites from given-up fidelity results.

## Initial workspace

- Pre-existing modifications: `packages/core/src/pptx.ts`, `packages/core/src/slide-motion.ts`; untracked `packages/core/src/pptx-slide-motion.ts`, `tests/pptx-slide-motion.test.ts`, and `.codex-remote-attachments/01a1bbb8-0985-71e1-9e28-f28a45d64446/`. Preserve them.

## Assignments and outcomes

### 0001 — matched: static visual/layout fidelity; original media retained

- Source: `pptx/apache2.0/2021/dd7f08ed3679f01ee8f5369ab6428a5d-escience_2021_conferentie_2.pptx`.
- Worker: `pptx_roundtrip_0001`.
- Status: in progress; add CLI PPTX round trip, compare, fix and re-export until matched or at least five fix iterations have been completed.
- Baseline generated: `artifacts/presentation-pptx/0001/baseline/roundtrip.pptx` (about 367 MB, source about 437 MB). PowerPoint refuses to open it (COM 0x80004005); no visual acceptance is possible yet.
- Parent independent package inspection: ZIP entries/XML parse; relationship targets resolve; no duplicate relationship IDs or untyped parts. Stale content-type overrides reference absent slideMasters 2–12. Duplicate shape IDs occur on eight slides; slide 1 collides between Text 2 and Media 0. Findings sent to worker. Evidence: `artifacts/presentation-pptx/0001/baseline/package-check.json`.
- Worker isolated invalid timing references (including fallback shape IDs 1000–1004 and absent source ID 21). A diagnostic package opens after timing removal; this is diagnosis, not a valid fidelity result.
- Parent visually reviewed all 12 diagnostic pages in `diagnostic3-review/contact-01.png` and `contact-02.png`. Type is consistently oversized (suspected CSS-pixel to point export mismatch), causing extensive wrapping and overflow. Duplicate bullets appear on several slides. Images/background placements appear substantially closer, but require full-resolution final review. Findings sent to worker; deck remains unresolved.
- Iteration 1 completed: genuine CLI export opens in PowerPoint, 12 rendered pages. Fixes normalize duplicate shape IDs/paragraph properties/content types and map animation references to emitted shape IDs. Evidence: `iteration1/roundtrip.pptx`, `iteration1-pdf/roundtrip.pdf`, `iteration1-review/` under the work directory. CLI tests: 25 passed; coverage 91.71% lines / 90.68% statements. Motion/package tests: 16 passed.
- Iteration 2 completed: font-size conversion improved relative text size; 12 pages rendered. All-page parent contact-sheet review still found title offsets, paragraph spacing and duplicate bullets. Evidence: `iteration2-review/`.
- Iteration 3: inset/vertical alignment/text flow/wrapping preservation; output and 12-page review created. Worker continuing review.
- Important scale correction: imported canvas uses 960 model units but source has separate `pointWidth`/`pointHeight`. Original PDF is 960x540 points; initial exports are 720x405 points. Thumbnail comparisons hide physical size mismatch; the 5px tolerance cannot be assessed until page size and all model-to-point conversions use a shared original-size scale. Worker is correcting this. No match claimed.
- Iteration 4 completed: exact/percentage paragraph pitch, paragraph alignment, spacing gaps and corrected asymmetric inset order. 12 Office-rendered pages; nested list geometry/highlights remain.
- Iteration 5 completed: original physical page-size export. Parent verified all 12 reference/export pages are 1280x720 pixels at 96 dpi; full-resolution page 3 main text baselines/wrapping closely agree, nested list indentation remains wrong. Evidence: `iteration5-review/comparison.json` and page images.
- Iteration 6 in progress: reconstruct hanging bullet geometry/tab stops; export highlights, hyperlink targets, tracking and strike.
- Iteration 6 artifacts exist and PowerPoint rendered 12 pages: `iteration6/roundtrip.pptx`, `iteration6-pdf/roundtrip.pdf`, `iteration6-review/`. Parent all-page contact review found continued extra bullets on soft-wrapped lines (slides 6 and 7). Full-resolution page 6 continuation lines drift by 13.44px and 26.79px; remaining issues exceed tolerance, so no match yet.
- Worker hit a usage limit before final status; user explicitly requested continuation. Same worker resumed from artifacts, with soft-break preservation as next investigation. Do not restart baseline or count the interruption as a given-up fidelity result.
- Latest worker-reported broad validation: 420 tests / 72 files pass; changed export/CLI/motion/helpers coverage 93.62% statements, 96.51% lines, 98.05% functions. Final typechecks pending at interruption.
- Iteration 7 completed: preserve soft line breaks within DrawingML paragraphs. All normalized lines match; parent full-resolution pages 6/7 confirm extra bullets and drift resolved. Page 7 apparent 7.52px line-bound change is an extracted leading space: actual `kind-agnostic` word x coordinates agree exactly and y differs 0.16px. This is not acceptance by text alone.
- Final worker all-page full-resolution overlay review found a missing lower-right video/poster on slide 5 (source Video 8, shape 9). Export omits the media object entirely; suspected unsupported MIME handling and about 68 MB missing media. Worker investigating. Deck still unresolved; iteration 7 must not be recorded as matched.

#### Terminal outcome (supersedes intermediate notes)

- Worker returned matched after **8 substantive fix/re-export iterations**. All 12 slides rendered in PowerPoint at original 1280x720 pixels, 96 dpi. All text lines match; wrapping and visible object placements agree within 5 pixels. All-page full-resolution review by worker, plus independent parent contact/all-line checks and full-resolution review of corrected pages. Source files unchanged.
- Final CLI output: `artifacts/presentation-pptx/0001/iteration8/roundtrip.pptx` (432,409,130 bytes). Render: `iteration8-pdf/roundtrip.pdf`. Evidence: `iteration8-review/acceptance.json`, `media-comparison.json`, `line-comparison.json`, full-page images and overlays. These paths are under `artifacts/presentation-pptx/0001/`.
- Iteration 8 fixed poster-only media fallback and retains large source clips through existing native OOXML drawing/dependency grafts. All 12 source MP4 assets match SHA-256 byte-for-byte, including the 68,966,402-byte clip. Slide 5 poster restored; the other 11 pages are pixel-identical to iteration 7.
- Shared fixes: CLI `convert --to pptx`, package bookkeeping, emitted animation target mapping, physical page dimensions, point font semantics, text insets/anchor/flow, paragraph pitch/spacing, native bullet geometry/tab stops, soft line breaks, highlights/hyperlink targets/tracking/strike, and large-media retention. No named-font spacing overrides.
- Validation: 424 passing tests / 73 files; changed CLI/export/import/motion/helpers coverage 97.09% lines / 94.25% statements / 98.19% functions. Core and desktop typechecks passed. Logs and scope in `worker-notes.md` and `final-tests.log`.
- Acceptance scope: static appearance and layout; original video bytes retained. Dynamic slideshow playback was not manually exercised. The 64 MiB inline preview limit remains intact. Source input and unrelated user changes preserved.

### 0002 — assigned

- Source: `pptx/apache2.0/2024/41fde69739d885f2e079e2218c9ad5b4-20240620 Spyderisk Overview.pptx`.
- Worker: `pptx_roundtrip_0002`.
- Source size 2,087,478 bytes; 36 slides. Reference PDF exists at matching relative path under `Z:\Datasets\zenodo10k\windows-ground-truth-pdf`.
- Work directory: `artifacts/presentation-pptx/0002/`.
- Status: in progress; use existing PPTX CLI and shared fixes, compare all 36 slides, fix and re-export until matched or at least five substantive iterations before giving up.
- Baseline: genuine CLI PPTX opens and renders 36 pages in PowerPoint. Evidence: `artifacts/presentation-pptx/0002/baseline-review/contact-01.png` through `contact-06.png` and `comparison.json`. Parent reviewed all six contact sheets; ordinary text appears close.
- Unresolved baseline: slide 4 first image blank; slide 5 image fade ignored; no-fill outline shapes white-filled (7/8); gradients dropped (11/15); arrow/connector geometry wrong (6/14/23–30), including curved connectors inverted through boxes; table formatting/geometry lost on 20/32, with table 32 clipped beyond page. Worker pursuing shared fixes and re-exports.
- Scale semantics refinement from broad tests (supersedes provisional font-unit hypothesis): imported `fontSize` is authored points, independent of normalized geometry. Keep font sizes and other authored point metrics as points; restore original physical page dimensions and scale only normalized geometry. Worker is correcting this with 720pt/960pt fixtures. Initial broad regression run: 419/420 pass; failing placeholder font assertion exposed this issue, not an accepted regression.

#### Resume 2026-11-08 — worker reattached

- Parent found no surviving subagent and launched a fresh `pptx_roundtrip_0002` to resume the existing deck and artifacts, preserving all workspace edits.
- Existing worker notes contain baseline plus iteration1/2 (one substantive combined export) and iteration3 gradient work. Worker must audit artifacts and count substantive iterations accurately.
- Parent will keep images confined to per-file workers; acceptance evidence returned as text and artifact paths.
- Resumed worker implemented live-model editable table serialization preserving dimensions, merges, cell paints/borders/margins and rich text. Focused drawing/scale tests and core typecheck pass; iteration4 export/render is underway. Not yet accepted; only two earlier substantive export iterations are confirmed.
- Iteration4 (third substantive export) rendered all 36 pages; table32 now fits, table20 restored but point-padding scaling still inflated rows. Worker fixed padding scale and mixed-bold inheritance for iteration5. Original freshly rendered at `0002/original-pdf/source.pdf`; worker reports all36 pages pixel-identical to cached reference at96dpi. Remaining gradient colors too pale; under investigation.
- Iteration6 restored native editable gradient color transforms; iteration7 rendered36 pages and resolves contact1 and table20 drift. Worker verifying apparent leading/trailing-space extraction shifts via actual word positions. True remaining discrepancies: field text on slides4/33 incorrectly falls back to footer instead of source top-left(0,0); importer fix underway. Original/cached ground truth equality confirmed. Still unresolved, no terminal status yet.
- Iteration8 (seventh substantive) rendered all36 pages after field placement fix. Text evidence:13,687 non-whitespace characters matched, max bbox delta1.44px, none over5px (`iteration8-review/character-comparison.json`).401 tests/71files pass; relevant combined coverage96.8%lines/94.31%statements/97.84%functions/90.43%branches; core/desktop typechecks pass.
- NOT matched: worker full-resolution review caught ignored image cropBottom on slide22 (12.201% and19.467%), causing ~100px picture-content compression despite matching outer bounds and text. Worker adding editable srcRect crop serialization and continuing all-slide visual review.


#### Terminal outcome 0002 (supersedes intermediate notes)

- Matched static visual/layout fidelity after **8 substantive fix/re-export iterations** (numbered iteration9; iteration1/2 count once).
- All36 slides reviewed full-resolution by worker at1280x720px/96dpi. Final5 crop-changed pages re-reviewed; other31 pixel-identical to reviewed iteration8. No disparities above5px observed. Fresh original render pixel-identical to cached reference.
- Final output: `artifacts/presentation-pptx/0002/iteration9/roundtrip.pptx` (2,842,489 bytes). Evidence: `iteration9-review/acceptance.json`, `comparison.json`, `character-comparison.json`, images/overlays, and `iteration9-pdf/roundtrip.pdf` under0002.
- Text evidence independently checked by parent: all13,687 non-whitespace characters matched across36pages, maximum bbox delta1.44px, zero over5px. Worker reviewed images; parent consumed text evidence only, per user restriction.
- Fixes: transparency/image alpha, connector geometry/end markers/flips, editable gradient transforms, editable table dimensions/merges/cell styles/runs, authored point paddings, blank paragraph pitch/font sizes, explicit field placement, signed picture crops. No named-font layout overrides.
- Validation:428tests/73files pass; relevant coverage97.34%lines/94.45%statements/98.62%functions/88%branches; core/desktop typechecks pass. Source unchanged, SHA256 recorded. Static acceptance; dynamic slideshow not manually exercised.

### 0003 — assigned

- Source: `pptx/bsd-3-clause/2021/bb7d81f702ba3e8d43d15d1d3f525d00-2021-02-ro-crate-bco.pptx`.
- Worker: `pptx_roundtrip_0003`.
- Source size20,942,085bytes; reference PDF exists under matching relative path at `Z:\Datasets\zenodo10k\windows-ground-truth-pdf`.
- Work directory: `artifacts/presentation-pptx/0003/`.
- Status: in progress. Genuine CLI PPTX round trip, same-renderer all-slide comparison; fix/re-export until matched or at least5 substantive iterations before giving up. Images confined to worker.
- 0003 baseline genuine CLI roundtrip and PowerPoint render completed43slides; fresh original rendered. Worker reviewed all8 contact sheets. Text flags1/2/3/5/10/11/14/23/34/43; parent also noted42 line extraction change. Some shifts reach~49px, final list pitch visibly wrong. Full-resolution diagnosis/source OOXML underway; no accepted result yet.
- Important reference correction0003: fresh original matches cached PDF on only16/43pages. Cached-only title shifts are not valid SuiteLeaf disparities. Same-local-PowerPoint fresh original is authoritative; run-iteration now compares `0003/original-pdf/source.pdf`. Source dataset untouched.
- Genuine fixes underway: iteration1 arbitrary symbol-font native bullets (Wingdings markers exported as literal text); iteration2 preserve bodyPr spcFirstLastPara via general paragraphEdgeSpacing model setting (first-paragraph spacing loss caused~25px shifts).7focused paragraph tests pass. Soft-break font metrics/script/tabs remain under investigation. Not matched yet.
- 0003 iterations1-3 genuinely exported/rendered43pages. Symbol bullets and paragraphEdgeSpacing fix lists/paragraph starts; preserved a:br run fonts/sizes resolves14/34. Character audit after3 flags only1(two glyphs),5(superscript metrics),23(table paragraph metrics). Iteration4 restores run script baseline; table23 source uses107%pitch and10.5pt paragraph marks around8pt text, currently lost. Worker investigating preservation. All statuses provisional.
- 0003 iteration4 resolves superscript5. Page1 false-positive nearest-glyph pairing corrected by matching prioritizing perfect pairings within5px; actual full spans~4.64px drift, permitted. Iteration5 preserves table paragraph pitch but exposes general table-vs-text line-spacing normalization (raw1.07 vs1.2scaled run paraLine); iteration6 corrects normalization and cell gap physical units.18focused tests pass. Six genuine substantive iterations exported; worker continues to match, not given up.
- 0003 iteration7 table paragraph indents/tabs fix last wrapping discrepancy. Parent independently inspected character report:43pages,14,367 source/actual/matched non-whitespace characters, max4.752px, zeroover5. Worker fullres review1-26 finds no above-tolerance issues;27-43 and broad regression/coverage/typechecks underway. Do not mark matched before terminal review.


#### Terminal outcome0003 (supersedes intermediate notes)

- Matched static appearance/layout, all43slides after7substantive fix/export iterations. Final output `artifacts/presentation-pptx/0003/iteration7/roundtrip.pptx`; same-renderer PDF `iteration7-pdf/roundtrip.pdf`; per-slide acceptance/character/line evidence under `iteration7-review/`. Worker reviewed all43fullres overlays; no above5px disparities. Parent independently verified14367characters/max4.752px/zeroover5.
- Ground truth: fresh original `original-pdf/source.pdf`, same local PowerPoint. Cached PDF differs on27/43pages and was rejected as sole reference. Source unchanged; hashes in acceptance. Static scope; slideshow playback not manually exercised.
- Shared fixes: symbol-font bullets, bodyPr spcFirstLastPara, hard-break font metrics, script baseline, table paragraph pitch/gaps and geometric units, table paragraph indents/hanging/tabs. No named-font spacing overrides.
- Validation421tests pass; coverage95.25%lines94.02%statements92.13%branches97.38%functions; core/desktop typechecks pass. `final-tests.log`, worker-notes persisted.

### 0004 — assigned

- Source: `pptx/cc-by-2.0/2019/14efb9f657739c56404e3153ecfdb4ed-Firenze_By_the_book_Giglia.pptx`.
- Worker: `pptx_roundtrip_0004`; directory `artifacts/presentation-pptx/0004/`.
- Size82266838bytes; cached matching-path reference exists but must verify against freshly rendered original.
- In progress: genuine CLI PPTX roundtrip, all-slide same-renderer review, fixes and re-exports until matched or at least5substantive iterations before giving up. Images only in worker.
- 0004 baseline completed17slides, fresh original rendered. Parent checked2388source/actual/matched non-whitespace chars, max1.01px,zeroover5. Worker fullres reviewed all17 and found true nontext defect9:three logo pictures lose outer shadows extending20–30px beyond frames. Shadow serialization investigation underway; NOT matched despite text agreement.
- 0004 iteration1 genuine export/render restores explicit shadows9 and text remains2388/max1.01px. Fresh original matches cache17/17.504tests pass, core/desktop typechecks pass. Final changed-page review finds theme-inherited shadow on gradient cards2 missing(~6pxextent), above tolerance. Worker adding theme effectRef inheritance with explicit effectLst override and tests beforeiteration2. Still unresolved.


#### Terminal outcome0004 (supersedes intermediate notes)

- Matched static visual/layout fidelity, all17slides, after2substantive fix/export iterations. Output `artifacts/presentation-pptx/0004/iteration2/roundtrip.pptx`; acceptance/comparison/character/line evidence and fullres overlays under `iteration2-review/`; PowerPoint PDF under `iteration2-pdf/`.
- All17baseline fullres pages reviewed, eight iteration1 shadow-changed pages reviewed, two iteration2 theme-shadow-changed pages reviewed; unchanged renders pixel-identical. No above5px disparities observed. Parent independently verifies2388source/actual/matched chars, maximum1.01px,zeroover5. All17ordered text lines match ignoring whitespace. Fresh original matches cache17/17pages.
- Fixes: editable object shadows (pictures/shapes/text), authored-point shadow metrics without geometry scaling, theme effectRef inheritance/placeholder colors and explicit effectLst override. No named-font layout overrides. Source unchanged.
- Validation505tests/79files pass; relevant coverage99.44%lines94.47%statements97.43%functions88.01%branches; core/desktop typechecks pass. Static acceptance, dynamic slideshow not manually exercised.

### 0005 — assigned

- Source: `pptx/cc-by-2.0/2019/a5b471cc1cf989699f8c872ae9a7f8ed-Slavec_190923_v3.pptx`.
- Worker `pptx_roundtrip_0005`; directory `artifacts/presentation-pptx/0005/`.
- Size3990045bytes, matching-path cached PDF exists; freshly render source as same-renderer ground truth.
- In progress; genuine CLI roundtrip, all-slide visual and text review, shared fixes and re-exports. At least5substantive iterations before giving up unresolved disparities. Images confined to worker.
- 0005 baseline genuine CLI/Office render16slides; worker reviewed all3contacts.8383non-whitespace counts match, but tables8/10 positions fail. Real baseline issues: inherited RGBA title fill1 dropped, table8 lower rows grow/shift~28px, mixed-run table10 width~5.6px, possible missing gray text highlight3. Shared-cause diagnosis underway, no match.
- 0005 initial iteration1 used stale CLI after failed rebuild: explicitly excluded from substantive count. `iteration1-fixed` correct rebuild/export restores RGBA title fill (sampleRGB234,236,227). ApparentRQ3gray highlight is thumbnail artifact; fullres source/XML confirm no real highlight defect. Iteration2 separates editable authored table row minima from predicted UI row heights to avoid Office applying growth twice; releases minima after row resize.24focused tests pass, rebuild/export underway.
- 0005 iteration2 restores table8; iteration3 fixes table-style bold inheritance preserving explicit regular runs. Parent verifies16pages8383characters/max2.616px/zeroover5. Worker reviewed all16fullres overlays with no above5px disparities.421tests/73files pass; relevant96.08%lines94.93%statements90.69%branches98.93%functions; core/desktop typechecks pass. Added retained-row metadata edit-release guard+test, final export verification underway; acceptance pending.


#### Terminal outcome0005 (supersedes intermediate notes)

- Matched all16slides static appearance/layout after3substantive fixes; stale initial build excluded, final defensive verification export uncounted. Output `artifacts/presentation-pptx/0005/final-verification/roundtrip.pptx`; acceptance/character/line/render evidence under `final-verification-review/` and `final-verification-pdf/`.
- Worker fullres reviewed all16iteration3 overlays; final verification16pages pixel-identical. All8383non-whitespace characters match, max2.616px,zeroover5 (parent checked iteration3). All16ordered line sequences match ignoring whitespace. Fresh original matches cached16/16. No remaining above5px visual disparities.
- Fixes: RGBA solid fills; editable authored row minima separated from predicted UI heights, released on row resize (including in-place edits); table-style bold inheritance respecting explicitly regular mixed runs. Source unchanged, no font-specific overrides.
- Validation422tests/73files pass; relevant96.08%lines94.93%statements90.71%branches98.93%functions; core/desktop typechecks pass. Static scope, slideshow not exercised.

### 0006 — assigned

- Source: `pptx/cc-by-2.0/2019/af21bf76f7eb1d313e44b8e82851ab7b-final-project-presentation.pptx`.
- Worker `pptx_roundtrip_0006`; directory `artifacts/presentation-pptx/0006/`.
- Size2679128bytes; same-renderer freshly rendered source required.
- In progress; actual CLI PPTX roundtrip and all-slide fullres review, fixes/re-exports until match or minimum5substantive iterations before giving up. Images confined to worker.
- 0006 baseline genuine CLI/Office render15slides and fresh original rendered. Contact review finds major losses: inherited slide gradient background dropped throughout; cap=all formatting lost on1/11/14 (case/wrapping); list paragraph indents/margins differ. Worker implementing editable background gradient preservation, then caps and paragraph geometry. Not matched.
