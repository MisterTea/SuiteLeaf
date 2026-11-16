---
id: WP-021
status: ready
priority: P1
wave: 3
effort: XL
owner: unassigned
updated: 2026-11-15
---

# WP-021: Complete analytical spreadsheet workflows

## Outcome and baseline

Pivots, slicers, charts, goal seek and solver components exist; the catalog explicitly says pivots are not Power Pivot.

Evidence inspected: [packages/core/src/pivot-slicer.ts](../packages/core/src/pivot-slicer.ts); [packages/core/src/goal-seek.ts](../packages/core/src/goal-seek.ts); [packages/core/src/solver.ts](../packages/core/src/solver.ts); [README.md](../README.md). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Finish pivot grouping, calculated fields, slicers and chart types.
- [ ] validate what-if analysis.
- [ ] separately design related tables and measures with explicit DAX support boundaries.

## Acceptance criteria

- [ ] Refresh a sales model and verify pivots, filters and charts against Excel.
- [ ] goal seek and solver hit declared tolerances or explain failure.
- [ ] related-table measures match a defined reference set.
- [ ] no full DAX claim from a subset.

## Dependencies and execution

Dependencies: WP-015, WP-020. These gate final integration acceptance, not initial investigation. Wave 3; priority P1; rough effort XL (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
