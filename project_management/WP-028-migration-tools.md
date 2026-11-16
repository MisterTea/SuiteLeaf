---
id: WP-028
status: ready
priority: P1
wave: 2
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-028: Make Office migration resumable and reversible

## Outcome and baseline

Directory import and migration components exist; repeated directory imports create additional copies.

Evidence inspected: [packages/core/src/migration](../packages/core/src/migration); [README.md](../README.md). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Add dry-run inventory, source hashes, resumable manifests, identity/share mapping and loss reports.
- [ ] preserve source hierarchy and originals.

## Acceptance criteria

- [ ] Migrate a 1,000-file mixed folder, interrupt and resume without duplicates.
- [ ] report every skipped/lossy file.
- [ ] verify hashes and ownership.
- [ ] rollback removes only newly created destination records.

## Dependencies and execution

Dependencies: WP-013, WP-007. These gate final integration acceptance, not initial investigation. Wave 2; priority P1; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
