---
id: "WP-012"
title: "Office compatibility corpus and differential verification"
type: "work_package"
status: "blocked"
priority: "P0"
phase: 1
area: "compatibility"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-001"]
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
