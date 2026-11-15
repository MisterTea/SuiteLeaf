---
id: WP-003
status: ready
priority: P0
wave: 1
effort: XL
owner: unassigned
updated: 2026-11-15
---

# WP-003: Complete spreadsheet collaboration semantics

## Outcome and baseline

Cell, worksheet and structural collaboration code exists; coverage is narrower than a full financial-workbook workflow.

Evidence inspected: [docs/collaboration.md](../docs/collaboration.md); [packages/core/src/sheet-schema.ts](../packages/core/src/sheet-schema.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Close concurrent row/column, range, formula-reference, formatting, chart and pivot edit gaps.
- [ ] define deterministic conflict behavior.

## Acceptance criteria

- [ ] Concurrent insert/delete/paste and sheet rename preserve intended references.
- [ ] clients recalculate to identical values.
- [ ] reconnect and undo do not silently discard accepted edits.

## Dependencies and execution

Dependencies: WP-002. These gate final integration acceptance, not initial investigation. Wave 1; priority P0; rough effort XL (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
