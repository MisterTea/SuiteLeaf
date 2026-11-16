---
id: WP-030
status: ready
priority: P2
wave: 3
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-030: Complete touch and mobile lifecycle workflows

## Outcome and baseline

PWA installation and mobile lifecycle helpers exist; complete mobile editing is not certified.

Evidence inspected: [apps/web/src/mobile-workflow.ts](../apps/web/src/mobile-workflow.ts); [tests/browser/responsive.spec.ts](../tests/browser/responsive.spec.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Define supported phone/tablet tasks.
- [ ] fix touch selection, soft-keyboard occlusion, safe areas, background saves and offline recovery.

## Acceptance criteria

- [ ] On iOS Safari and Android Chrome, edit each supported file type, rotate, background/reopen and reconnect without lost edits.
- [ ] selected cells and essential controls remain visible above the keyboard.

## Dependencies and execution

Dependencies: WP-005, WP-029. These gate final integration acceptance, not initial investigation. Wave 3; priority P2; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
