---
id: WP-012
status: ready
priority: P0
wave: 1
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-012: Measure Office round trips against Office

## Outcome and baseline

The harness exists, but Office automation is macOS-only and page counts are not visual comparisons; some object probes are absent.

Evidence inspected: [docs/office-compat.md](../docs/office-compat.md); [scripts/office-compat.mts](../scripts/office-compat.mts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Add Windows reference automation and rendered comparisons.
- [ ] extend fixtures for comments, pictures, tables, media and formulas.
- [ ] pin input hashes and reference builds.

## Acceptance criteria

- [ ] Run import/edit/native-save/export/reopen for at least 30 DOCX, 30 XLSX and 30 PPTX fixtures.
- [ ] report content, visuals, calculation and editability separately with zero silent losses on the declared supported subset.

## Dependencies and execution

Dependencies: WP-001. These gate final integration acceptance, not initial investigation. Wave 1; priority P0; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
