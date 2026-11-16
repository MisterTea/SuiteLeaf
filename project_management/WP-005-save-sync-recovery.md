---
id: WP-005
status: ready
priority: P0
wave: 1
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-005: Make save and recovery dependable

## Outcome and baseline

Atomic desktop saves, drafts, local autosave and SuiteDrive conflicts exist; related files have uncommitted changes in the reviewed worktree.

Evidence inspected: [apps/web/src/workspace/workspace-save.ts](../apps/web/src/workspace/workspace-save.ts); [apps/web/src/collab/recovery.ts](../apps/web/src/collab/recovery.ts); [README.md](../README.md). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Specify durable save states across all three modes.
- [ ] integrate upload retry, conflict copies, disk-full handling and crash recovery.

## Acceptance criteria

- [ ] Kill the process before and after acknowledgement and reopen.
- [ ] no acknowledged content is lost.
- [ ] unsynced edits remain recoverable.
- [ ] external file changes never get overwritten silently.

## Dependencies and execution

Dependencies: WP-001. These gate final integration acceptance, not initial investigation. Wave 1; priority P0; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
