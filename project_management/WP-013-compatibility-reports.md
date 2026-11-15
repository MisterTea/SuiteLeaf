---
id: WP-013
status: ready
priority: P0
wave: 1
effort: M
owner: unassigned
updated: 2026-11-15
---

# WP-013: Make conversion losses visible and recoverable

## Outcome and baseline

Compatibility notes and package preservation exist; their user-facing completeness is not certified.

Evidence inspected: [packages/core/src/compat](../packages/core/src/compat); [docs/office-compat.md](../docs/office-compat.md). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Unify UI and batch reports with object locations, severity and recovery choices.
- [ ] preserve originals and safe opaque content where possible.

## Acceptance criteria

- [ ] Each intentionally unsupported fixture yields an accurate warning before destructive export.
- [ ] report links locate the object.
- [ ] cancellation preserves the original.
- [ ] preserved binaries are never executed.

## Dependencies and execution

Dependencies: WP-012. These gate final integration acceptance, not initial investigation. Wave 1; priority P0; rough effort M (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
