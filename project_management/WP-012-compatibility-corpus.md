---
id: "WP-012"
title: "Office compatibility corpus and differential verification"
type: "work_package"
status: "done"
priority: "P0"
phase: 1
area: "compatibility"
created: "2026-10-29"
updated: "2026-11-04"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S03", "S15", "S16"]
---

# Office compatibility corpus and differential verification

## Outcome and rationale

Establish measurable Office compatibility across import, editing, export, and reopening. A file that parses successfully may still lose layout, formulas, or review metadata.

## Existing implementation and starting points

Extend `packages/core/src/roundtrip.ts`, `packages/core/src/roundtrip-scan.ts`, `packages/core/src/roundtrip-digest.ts`, `scripts/office-roundtrip-batch.mjs`, `scripts/office-roundtrip-report.mjs`, and existing corpus/visual workflows in `docs/`.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Create a licensed, reproducible fixture manifest with source hashes, format/features, size, expected behavior, reference-app versions, and supported/rejected classifications.
- Add the full sequence: source -> import -> representative edit -> native save/reopen -> Office export -> reopen in reference application. Preserve original files and disable macro execution/external refresh.
- Compare semantic content, formulas and recalculated values, comments/revisions, object editability, fonts, layout, and media separately. Do not collapse all results into one misleading pass.
- Build generated fixtures for reliable CI plus optional external corpora; do not redistribute private or unlicensed documents.
- Invalidate results when converter/rendering fingerprints change. Capture unsupported, rejected, timed-out, unavailable-reference, and incomplete outcomes distinctly.
- Define release-blocking regressions for supported workflows; require an owner and documented limitation for each tolerated difference.

## Dependencies and delivery

Completion is blocked on `WP-001`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- DOCX, XLSX, and PPTX each have representative edit-and-round-trip cases with reproducible evidence.
- A lost formula, missing image, flattened revision, or changed slide object is reported in its proper dimension.
- Unreviewed screenshots and absent reference applications never count as passes.
- CI runs generated fixtures and emits a useful summary; larger corpus runs can resume safely.

## Verification

- Vitest for scanner/digest classification, fixture integrity, and import/export behavior.
- Use real Office/reference applications for calculation and rendering comparisons; use Playwright for actual SuiteLeaf grids/canvases/layout where needed.
- Follow existing corpus rules and record narrower viewport coverage explicitly.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not claim universal compatibility or pixel equality. This package supplies evidence and gates; format-specific repairs are WP-014 through WP-016.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S03`, `S15`, `S16`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: Not started. Front matter status is `blocked`. `blocked` is true. `blocked_on` is ["WP-001"]. No product behavior for this package changed on this date. Active work is the WP-001 catalog and a mark-preservation slice of WP-002.

2026-11-04: WP-001 was accepted as done, so this package is no longer blocked. Status is `ready`, meaning it is ready to start; no work has begun. It was blocked on WP-001 from 2026-10-29 until then; that dependency is still listed under Dependencies.

2026-11-04: the compatibility run exists. `packages/core/src/compat/` takes each file through these stages:
- source;
- import;
- a representative edit (one paragraph, cell, or text box holding `SuiteLeaf edit marker`);
- native save and reopen;
- Office export;
- reimport;
- LibreOffice reopening the export.

Content, formulas and their values, comments and revisions, objects, fonts, layout, and media are scored separately. The outcomes are pass, loss (naming the stage where the probe was lost), incomplete, unavailable-reference, and not-measured. A refusal and a timeout are their own outcomes. `docs/office-compat.md` describes the run.

The three fixtures are generated by independent libraries (docx 9.10.0, SheetJS 0.20.3, PptxGenJS 4.0.1), never by SuiteLeaf's exporters, and contain no third-party content:
- `docx-report`: heading, bold Calibri text, table, picture, comment, tracked insertion, page break;
- `xlsx-budget`: two sheets, `SUM` and a cross-sheet formula with expected values 60 and 120, cell comment;
- `pptx-plan`: two slides, Calibri title, table, picture, speaker notes.

The manifest records each fixture's generator, features, probes, classification, spec hash, and SHA-256.

2026-11-04: LibreOffice is the reference application. It runs in a throwaway profile with macros and link updates turned off, and it recalculates Excel formulas on load. A workbook whose cached `SUM` result was 999 came back as 60, so formula values come from LibreOffice and not from cached results. It reads DOCX text and page count, every XLSX sheet's values as CSV, and the PPTX slide count.

`npm run test:office-compat` ran with LibreOffice 26.2.5.2 and fingerprint `59236ac835547cd5`. All three fixtures completed and opened in LibreOffice. 14 dimensions passed, 1 was a tolerated loss, and 6 were not measured. Nothing blocked a release. A second run reused all three saved results. A result is reused only when the converter fingerprint, the fixture spec, and the reference version are unchanged.

2026-11-04: the run found a real loss. `docx-report` sets Calibri on every run. After import and export, Arial is the only font, because DOCX import keeps a run's font only for symbol fonts and export writes Arial as the default. It is tolerated with owner WP-014. `docs/office-imports.md` now states the limit, and WP-014 has a note. A sheet comment from the Excel fixture comes in as a cell note and survives.

2026-11-04: `tests/compat/compat-run.test.ts` is the CI gate in `npm test`. It runs the three fixtures without a reference application and checks every dimension's outcome. With the reference absent, DOCX layout is `unavailable-reference` and not a pass. It checks that nothing blocks a release, that every tolerated entry is still needed, and that removing the tolerated entry makes the font loss blocking.

Planted losses are each reported in their own dimension, at the export stage:
- a removed formula, under formulas;
- a removed picture, under media;
- a stripped tracked insertion, under review;
- a removed slide table, under objects.

A refusal, a timeout, and a reference application that fails on the export are reported as such and block a release. `tests/compat/compat-parts.test.ts` covers the readers, the LibreOffice runner with a fake process, and the report rules.

`npx vitest run tests/compat` passed (21 tests). Coverage was 96.29% statements and 98.05% lines across `packages/core/src/compat`, and every file was above 90% statements and lines. `npx vitest run --coverage` passed (617 files, 4,493 tests): statements 93.84% and lines 96.7%.

Acceptance evidence:
- DOCX, XLSX, and PPTX each have an edit-and-round-trip case. The CI test and the LibreOffice run are reproducible from the fixture specs.
- A lost formula, missing image, flattened revision, and removed slide object are each reported in their own dimension.
- An absent reference application gives `unavailable-reference`. The run never uses screenshots.
- CI runs the generated fixtures, and a failing assertion includes the summary table. The script writes `summary.md` and the GitHub job summary, and it resumes safely.

Known limits:
- Microsoft Word, Excel, and PowerPoint are installed on this machine but are not driven as reference applications.
- LibreOffice does not read fonts, comments, or PPTX text.
- Layout is a page or slide count, not a rendered comparison.
- The large external corpora still go through `scripts/office-roundtrip-report.mjs`, which reports features by owner but not these dimensions.
- The fixtures have no XLSX picture or PPTX comment, because these generators cannot write them.
- Three fixtures are a starting set, not broad coverage.

Status is `in_review`. WP-013, WP-014, WP-015, and WP-016 stay blocked on WP-012 until the evidence is accepted.

2026-11-04, later: the product owner accepted the evidence above. Status is `done`. WP-013, WP-014, WP-015, and WP-016 no longer wait on WP-012, and WP-028 no longer lists it. The known limits listed above still apply.
