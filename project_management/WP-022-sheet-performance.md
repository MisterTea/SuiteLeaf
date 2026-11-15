---
id: WP-022
status: ready
priority: P1
wave: 3
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-022: Make large workbooks responsive and printable

## Outcome and baseline

Cost scans, invalidation helpers and capacity limits exist; counting formulas is not a measured speedup; printing has a 10,000-cell limit.

Evidence inspected: [docs/sheet-performance.md](../docs/sheet-performance.md); [packages/core/src/sheet-invalidation.ts](../packages/core/src/sheet-invalidation.ts); [apps/web/src/pdf-export.tsx](../apps/web/src/pdf-export.tsx). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Benchmark import, edits, recalculation, scrolling and export.
- [ ] optimize critical paths.
- [ ] implement print areas, repeat titles, page breaks and scaling with explicit capacity handling.

## Acceptance criteria

- [ ] On recorded 4-core/16-GB hardware, target a 100k-cell/10k-formula workbook opening within 10s and p95 simple edits within 100ms.
- [ ] report actuals.
- [ ] print a multi-page selected range without clipping or silent truncation.

## Dependencies and execution

Dependencies: WP-015. These gate final integration acceptance, not initial investigation. Wave 3; priority P1; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
