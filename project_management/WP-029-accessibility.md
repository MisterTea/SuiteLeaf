---
id: WP-029
status: ready
priority: P0
wave: 3
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-029: Make all editors usable with assistive technology

## Outcome and baseline

Accessibility checkers and reading-order models exist; these do not establish accessible editor operation.

Evidence inspected: [docs/accessibility.md](../docs/accessibility.md); [packages/core/src/sheet-a11y.ts](../packages/core/src/sheet-a11y.ts); [docs/slide-access.md](../docs/slide-access.md). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Audit keyboard navigation, focus, screen-reader semantics, grid/canvas alternatives, contrast, zoom and exported reading order.
- [ ] fix blockers alongside editor work.

## Acceptance criteria

- [ ] Complete report, workbook and deck workflows using keyboard plus NVDA and VoiceOver on supported platforms.
- [ ] no traps or unlabeled controls.
- [ ] 200% zoom keeps primary controls reachable.
- [ ] exported alt text and order survive.

## Dependencies and execution

Dependencies: WP-001. These gate final integration acceptance, not initial investigation. Wave 3; priority P0; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
