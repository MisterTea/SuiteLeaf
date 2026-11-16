---
id: WP-015
status: ready
priority: P0
wave: 1
effort: XL
owner: unassigned
updated: 2026-11-15
---

# WP-015: Match Excel workbook and calculation semantics

## Outcome and baseline

XLSX conversion and formula helpers exist; native preservation is not certified Excel calculation correctness.

Evidence inspected: [packages/core/src/excel.ts](../packages/core/src/excel.ts); [packages/core/src/xlsx-export.ts](../packages/core/src/xlsx-export.ts); [packages/core/src/sheet-cross-calc.ts](../packages/core/src/sheet-cross-calc.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Build a function/behavior matrix.
- [ ] fix dynamic arrays, names, structured references, date systems, errors and external-link handling by corpus priority.
- [ ] preserve charts and rules.

## Acceptance criteria

- [ ] Excel recalculation and SuiteLeaf match all supported numeric/error results with documented tolerances.
- [ ] tests include spill, circular references and 1900/1904 dates.
- [ ] unsupported functions cannot masquerade as fresh cached values.

## Dependencies and execution

Dependencies: WP-012. These gate final integration acceptance, not initial investigation. Wave 1; priority P0; rough effort XL (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
