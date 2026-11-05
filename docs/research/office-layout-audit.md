# Office layout source audit

Audit date: 2026-11-04. This is a targeted source audit, not a benchmark of the suites' PDF accuracy. No third-party implementation code was copied into SuiteLeaf. Application behavior was not changed by this audit.

## Downloaded sources and scope

Sparse, shallow Git checkouts live outside this repository in `E:/github/office-layout-audit-source`. The exact remotes, revisions, and checked-out directories are recorded in [office-layout-sources.json](office-layout-sources.json). These are source checkouts, not installed or compiled office applications. Additional paths can be fetched with `git sparse-checkout add`.

| Project | What was inspected | Role |
| --- | --- | --- |
| LibreOffice | DrawingML/PPTX import, EditEngine, Outliner, VCL text shaping, drawing text objects | Main independent native reference |
| Apache OpenOffice | PPTX import and EditEngine | Historical corroboration; shares ancestry with LibreOffice |
| ONLYOFFICE SDKJS | Presentation shapes, paragraph layout, font engine, run styles | Independent JavaScript implementation; especially relevant to SuiteLeaf |
| KDE Calligra | Stage import, Qt text layout, paragraph sizing | Another independent implementation |
| openDesk | Deployment source and architecture documentation | Integrates Collabora; not a separate presentation layout engine |
| Collabora | Current online.mirror engine/import/layout source | Confirms the LibreOffice-family approach in Collabora |

openDesk's own [architecture documentation](https://gitlab.opencode.de/bmi/opendesk/deployment/opendesk/-/blob/b6ec2b9f0606239a2cde0f510bfde23f8c7b607d/docs/architecture.md) says Collabora edits its text documents, spreadsheets, and presentations. The repository named `CollaboraOnline/online` now contains infrastructure/release material rather than the application engine. The actual engine was obtained from the organization's `online.mirror` repository. An initial Gerrit clone did not complete and was stopped after the official GitHub mirror succeeded; the incomplete `collabora-engine` directory is not an audited checkout.

This is a relevance-based selection, not a claim about a measured popularity ranking. WPS and Microsoft Office were not treated as open-source engines.

## 1. Main finding: PPTX line spacing is a format policy, not a named-font correction

**Source-confirmed:** LibreOffice's PPT shape importer sets `FontIndependentLineSpacing` to true for a shape's text body:

- [pptshapecontext.cxx, line 196](https://github.com/LibreOffice/core/blob/e6a711b134f04a45ec7f01646cd0438431ab4e8b/oox/source/ppt/pptshapecontext.cxx#L196).
- Tables receive the same setting in [tablecellcontext.cxx, line 61](https://github.com/LibreOffice/core/blob/e6a711b134f04a45ec7f01646cd0438431ab4e8b/oox/source/drawingml/table/tablecellcontext.cxx#L61).
- The UNO property maps to `SDRATTR_TEXT_USEFIXEDCELLHEIGHT` in [unoshprp.hxx, line 348](https://github.com/LibreOffice/core/blob/e6a711b134f04a45ec7f01646cd0438431ab4e8b/include/svx/unoshprp.hxx#L348).
- Drawing text passes that flag to the Outliner in [svdotext.cxx, line 1185](https://github.com/LibreOffice/core/blob/e6a711b134f04a45ec7f01646cd0438431ab4e8b/svx/source/svdraw/svdotext.cxx#L1185).
- EditEngine's font-independent spacing helper computes rounded `fontHeight * 1.2` in [impedit3.cxx, line 500](https://github.com/LibreOffice/core/blob/e6a711b134f04a45ec7f01646cd0438431ab4e8b/editeng/source/editeng/impedit3.cxx#L500). The fixed-cell path uses it when measuring portions and lines, including lines 888, 1256, and 1485.

Apache OpenOffice has the same import setting at `main/oox/source/ppt/pptshapecontext.cxx:203` and computes `(fontHeight * 12) / 10` at `main/editeng/source/editeng/impedit3.cxx:588`. This is corroborating family history, not an independent third-party proof.

Collabora's downloaded engine also sets the PPTX flag at `engine/oox/source/ppt/pptshapecontext.cxx:196` and implements the 120% helper at `engine/editeng/source/editeng/impedit3.cxx:556`.

Calligra independently defines `PresenterFontStretch` as 1.2 at `libs/textlayout/KoTextLayoutArea.cpp:61`. Its `LineSpacingFromFont` branch uses font point sizes times that stretch, while separately measuring ascent/descent and handling line-break formatting. Its subsequent line-spacing rules are more complicated, including a default 1.16 multiplier in another branch; do not translate this into a claim that all Calligra line heights are simply 1.2em.

**SuiteLeaf comparison:** the committed shape path multiplies paragraph spacing by `officeSingleSpacing`, whose lookup is based on per-face Windows/typographic metric data. `pptx-fonts.ts:117` even describes those metrics as PowerPoint single spacing. That description conflates glyph/font extents with the format's baseline-advance policy. SmartArt and renderer leading adjustment also call the metric helper, so changing only ordinary shapes would create inconsistent paths.

**Inference, strongly supported:** the repeatedly observed 1.2 relationship across Assistant, Nunito, Lucida, PT Sans, Times, Gill Sans, and Calibri is plausibly one shared presentation-layout policy. It should not have been treated as seven font corrections. This does not prove every paragraph, compatibility mode, or exact-spacing case uses the same formula.

**Recommended change:** introduce a presentation-specific spacing policy that distinguishes nominal baseline pitch from glyph ascent/descent. Keep exact point spacing exact. Apply percentage spacing and autofit reduction in a documented order. Use actual font metrics for baseline placement, clipping, mixed-run extents, and fallback, rather than using the Windows clipping grid as the universal PPTX pitch. Keep document and spreadsheet behavior independent.

Important working-tree detail: interrupted agent 0009 already left an exploratory general `1.2` replacement in `pptx-slide-shapes.ts`. It is uncommitted, incomplete across rendering paths, and not accepted as a finished correction. This audit supplies external evidence for pursuing that direction, not a declaration that the experiment is validated.

## 2. Autofit rounding: nearest point has an independent implementation reference

ONLYOFFICE's shape style resolution transfers body fontScale into text properties (`common/Drawings/Format/Shape.js:2956`). Its [CTextPr.CheckFontScale](https://github.com/ONLYOFFICE/sdkjs/blob/9d2138866d929be32f1d107e8b5bfae36156e097/word/Editor/Styles.js#L13982) multiplies the original size by the scale, rounds to the nearest whole point, and clamps to at least 1pt. It retains original sizes separately. Complex-script size is handled too.

SuiteLeaf's pushed checkpoint used ceiling rounding. Agent 0009 has an uncommitted nearest-rounding correction after finding source sizes 32pt*70%=22.4pt and 32pt*85%=27.2pt appearing as 22pt and 27pt in Office. ONLYOFFICE supports that correction. It also highlights a missing lower bound: our current helper can round a very small scaled size to zero.

LibreOffice imports the fontScale and spacing-reduction percentages separately in `oox/source/drawingml/textbodypropertiescontext.cxx:245`, and its drawing text code passes separate font and spacing scaling parameters at `svx/source/svdraw/svdotext.cxx:1238`. It does not justify conflating font scale, line reduction, shape growth, and overflow fitting.

**Recommended tests:** 22.4, 27.2, 39.6, and 18.495pt; half-point boundaries; sub-1pt results; unscaled authored fractions; mixed run sizes; exact line spacing. The earlier 18.495pt discrepancy remains a counterexample to resolve, not a reason to add a special epsilon or family rule. Nearest rounding alone is not a promise of complete compatibility.

## 3. Mature engines explicitly position shaped text

LibreOffice VCL uses HarfBuzz through `hb_shape_full` in `vcl/source/gdi/CommonSalLayout.cxx:232`. ONLYOFFICE uses `HB_Shape`/`HB_ShapeText` in `common/libfont/file.js:1061` and `common/libfont/engine.js:617`.

These engines carry shaped advances and baseline metrics into their paragraph layout. ONLYOFFICE calculates separate per-letter and per-space justification additions in `word/Editor/Paragraph_Recalculate.js:2001` and applies them in `word/Editor/Paragraph/recalc/align-recalc-state.js`. Trailing spaces have separate counters.

SuiteLeaf's browser also uses a shaping engine internally; the gap is **layout ownership**, not simply the presence of HarfBuzz. Our distributed alignment currently delegates to CSS `text-justify:inter-character`, while custom line, tab, and table calculations use different measurement paths. Browser distribution need not reproduce Office's word/letter allocation. This directly relates to deck 0008: matching box edges but up to 15.95px internal differences.

**Recommended progression:** first expose actual browser-measured runs, font identity, cluster advances, break decisions, and baselines in diagnostics. Then implement deterministic distribution over shaped clusters where native CSS demonstrably differs. Do not distribute by Unicode code units or replace shaping with per-character average widths. A full WASM shaping/layout engine is a larger option, not a prerequisite for the first spacing fix.

## 4. Font metrics remain necessary, but need context

ONLYOFFICE distinguishes cell, word, and slide measurement modes in `common/libfont/manager.js:117` and `:162`. Its `common/libfont/file.js:1731` reads face metrics, considers OS/2 USE_TYPO_METRICS, and treats ascent, descent, line height, and line gap separately. The audited source also contains a named Cambria Math exception; we should not copy that pattern into SuiteLeaf under the user's no-font-specific-rule requirement.

SuiteLeaf already reads embedded font OS/2 metrics and handles USE_TYPO_METRICS. Keep that font parsing. The improvement is to stop treating one returned scalar as both nominal presentation pitch and all baseline geometry. Resolve fonts per run/script, preserve face weight/style, and record fallback identities. A missing font, wrong family alias, disabled kerning, malformed HTML style, or lost tracking is not a line-spacing correction.

## 5. Make the corpus process diagnostic rather than five unrelated guesses

For each imported paragraph, emit a structured trace containing:

- Slide/shape/paragraph/run identity and the source XML values with inheritance provenance.
- Resolved font file/face, fallback, script, weight/style, nominal and fitted size.
- Raw percentage/exact spacing, reduction, chosen policy, nominal pitch, ascent/descent, baseline origin.
- Content box, margins, tabs, tracking, kerning features, shaped widths, break positions, and distribution allocation.

Attach the trace to existing PDF comparisons. Classify failures as import/inheritance, font resolution, shaping/width, paragraph pitch, alignment/distribution, or geometry/metafile. Compare measured baselines and run starts separately from glyph outlines. This should stop a correct width change from being misdiagnosed as a font-spacing problem.

Use LibreOffice/Collabora and ONLYOFFICE exports as additional triangulation when available, while preserving Microsoft Office PDFs as the acceptance reference. Agreement among alternative engines is evidence, not the ground truth. This audit did not build or execute the downloaded suites.

## Prioritized implementation and verification

1. **Shared PPTX spacing policy:** finish and isolate the 0009 experiment; cover ordinary shapes, inherited labels, table cells, SmartArt, empty paragraphs, mixed-size runs, hard/soft breaks, exact and reduced spacing. Keep baseline alignment independent of nominal pitch. Add font-name-independent Vitest tests using synthetic metrics with different clipping extents.
2. **Autofit semantics:** verify nearest rounding and the minimum size against controlled Office fixtures. Preserve original size/scale metadata rather than repeatedly shrinking resolved sizes. Avoid re-fitting inherited labels.
3. **Cross-deck regression sweep:** rerender decks 0001–0009 with one frozen build. Revisit all formerly spacing-dependent outcomes, especially revoked match 0006. Do not call a deck matched from sampled words alone.
4. **Distribution layout:** use deck 0008 plus controlled mixed-script and trailing-space fixtures to compare per-cluster allocation. Preserve authored text and avoid CSS-dependent editing/export divergence.
5. **Diagnostic CLI output:** make the paragraph trace an optional conversion artifact, so a future subagent can identify a shared cause before changing code.

Expected benefit is a reduction in repeated spacing and fitting investigations across decks. No corpus-wide matching gain has yet been measured from the audit. EMF playback, 3D effects, and unsupported geometry remain separate classes of work.

## Provenance and limitations

The source revisions are pinned in the adjacent manifest. Sparse clones contain the audited areas, not every dependency, submodule, asset, or historical revision. Licenses remain in the checkouts (including ONLYOFFICE's AGPL source license); this report records architectural findings rather than importing their implementations. Any future code reuse needs its own license review.

The presentation worker stopped during deck 0009 after its usage-limit error. Its incomplete EMF, rounding, and spacing experiments were preserved. The audit added only this report, its source manifest, and a ledger handoff; it did not complete that deck or change its status to matched/given-up.

## Follow-up implementation: CryptPad and GenOffice

Both source checkouts are now included in the pinned manifest.

- CryptPad revision `a4209cca7db6dca4b9cefc5b34fa765e9ae3c6a8`: `www/presentation/index.html` boots `/common/onlyoffice/main.js`, while `inner.html` boots the shared office iframe. `install-office.sh:196` references Euro-Office/ONLYOFFICE licenses and line 326 downloads CryptPad's editor builds. This presentation integration adds encrypted collaboration, rather than a separate baseline/paragraph layout model. Its current installer also references Euro-Office, so older documentation describing only ONLYOFFICE is incomplete for this revision.
- GenOffice revision `4b55db9ed1994575a695160ffc6cfd0bfc866211`: [text-layout.ts](https://github.com/genspark-ai/genoffice/blob/4b55db9ed1994575a695160ffc6cfd0bfc866211/packages/pptx-render/src/text-layout.ts#L1040) explicitly separates a 1.2em presentation box from font ascent/descent. Comments describe ten-font probes and differentiate default versus explicit-spacing baseline placement. Its run-size path at line 99 rounds scaled font sizes to nearest points with a minimum of 1pt. It uses a deterministic text-layout layer with measured advances, rather than entrusting all geometry to browser paragraph CSS. These are independently useful findings; the baseline-placement model has not been transplanted into SuiteLeaf.

Implemented in SuiteLeaf: one font-independent presentation spacing policy, wired into ordinary shapes, inherited labels, SmartArt text, table measurement, table rendering, and the renderer's tight-line nominal reference. Exact point-derived factors bypass percentage scaling. Font parsing and document/spreadsheet font metrics remain separate. Autofit now rounds reduced sizes to the nearest point and clamps the result to at least 1pt. No named-font rules were introduced and no third-party implementation code was copied.

GenOffice multiplies its paragraph percentage by its reduction factor, whereas SuiteLeaf currently subtracts the reduction before nominal scaling. Existing Office measurements in deck 0007 support SuiteLeaf's current result for that fixture. This discrepancy needs controlled fixtures; it was deliberately not changed merely to imitate another implementation.

Verification and re-export measurements for this follow-up are recorded in `presentation_work.md` and under `artifacts/presentation-fidelity/shared-spacing-*`. The earlier audit's source-only limitation applies to that audit checkpoint; this follow-up implements and tests changes.

## Isolated equation investigation during deck 0010

The shipped math-font counterpart lacks OpenType MATH data. Its local Office reference has that table. A private candidate using the reference's math constants and valid empty glyph-info/variant containers reproduces the Office font's native-MathML vertical measurements. This is font layout metadata, not a proposed family-specific rendering exception. See the [OpenType MATH specification](https://learn.microsoft.com/en-us/typography/opentype/spec/math).

The current renderer also omits mathematical operator spacing. A Chromium probe using native MathML plus standard medium spacing for binary operators matches the 31 non-space character origins of deck 0009 slide 22's equation, **relative to the first glyph only**, within 4.387px horizontally and 0.267px vertically. Absolute frame placement, editing, other equation structures, and full-deck rendering remain unverified. The candidate has not been installed in the application.

ONLYOFFICE corroborates operator-class-based spacing: `word/Math/mathContent.js:590` defines contextual gap coefficients, `:787` applies them between math objects, and `word/Math/mathText.js:1489` classifies the asterisk as a binary sign. This supports a general operator policy; copying their implementation or tuning a named font is unnecessary. MathML fraction behavior and operator spacing are defined by [MathML Core](https://www.w3.org/TR/mathml-core/).

Artifacts and private reference font material are confined to ignored `artifacts/presentation-fidelity/mathml-probe/`. Treat this as evidence for a future equation-layout iteration, not an accepted application fix or deck match.
