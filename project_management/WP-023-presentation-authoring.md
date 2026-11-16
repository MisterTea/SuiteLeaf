---
id: WP-023
status: ready
priority: P1
wave: 3
effort: XL
owner: unassigned
updated: 2026-11-15
---

# WP-023: Finish professional slide authoring

## Outcome and baseline

Masters, alignment, rich text and animation components exist beyond README's basic authoring description.

Evidence inspected: [apps/web/src/editors/slide-master-ui.tsx](../apps/web/src/editors/slide-master-ui.tsx); [packages/core/src/slide-align.ts](../packages/core/src/slide-align.ts); [packages/core/src/slide-motion.ts](../packages/core/src/slide-motion.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Complete master/theme editing, reusable layouts, selection pane, group/align/distribute, crop, chart/table editing and animation ordering.
- [ ] validate keyboard workflows.

## Acceptance criteria

- [ ] Create a branded 30-slide deck without import.
- [ ] master edits propagate with overrides preserved.
- [ ] layered objects remain selectable.
- [ ] animation order survives native save and PPTX export.
- [ ] undo restores every operation.

## Dependencies and execution

Dependencies: WP-016. These gate final integration acceptance, not initial investigation. Wave 3; priority P1; rough effort XL (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
