---
id: WP-020
status: ready
priority: P1
wave: 3
effort: XL
owner: unassigned
updated: 2026-11-15
---

# WP-020: Turn sheet queries into dependable data preparation

## Outcome and baseline

Local query steps include conversion, grouping, joins and appends; this is not established Power Query/M compatibility.

Evidence inspected: [docs/sheet-query.md](../docs/sheet-query.md); [packages/core/src/sheet-query.ts](../packages/core/src/sheet-query.ts); [apps/web/src/editors/sheet-query-panel.tsx](../apps/web/src/editors/sheet-query-panel.tsx). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Add a multi-step editor, typed schemas, query dependencies and refresh controls.
- [ ] integrate a prioritized authenticated connector set and credential storage.

## Acceptance criteria

- [ ] Join CSV and database data, change source schema, cancel and refresh again without overwriting unrelated cells.
- [ ] errors preserve last good output.
- [ ] secrets are absent from exported workbooks and logs.
- [ ] declare M compatibility limits.

## Dependencies and execution

Dependencies: WP-015. These gate final integration acceptance, not initial investigation. Wave 3; priority P1; rough effort XL (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
