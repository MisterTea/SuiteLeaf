---
id: WP-004
status: ready
priority: P0
wave: 1
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-004: Complete presentation collaboration semantics

## Outcome and baseline

Slide collaboration is cataloged as partial despite existing code and historical two-client tests.

Evidence inspected: [apps/web/src/collab](../apps/web/src/collab); [packages/core/src/slide-schema.ts](../packages/core/src/slide-schema.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Resolve simultaneous text/object editing, slide ordering/deletion, notes, masters and media uploads.
- [ ] provide recoverable conflicts.

## Acceptance criteria

- [ ] Three clients editing one deck converge after reconnect.
- [ ] deleted objects do not reappear.
- [ ] concurrent text is retained or explicitly recoverable.
- [ ] missing media is reported.

## Dependencies and execution

Dependencies: WP-002. These gate final integration acceptance, not initial investigation. Wave 1; priority P0; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
