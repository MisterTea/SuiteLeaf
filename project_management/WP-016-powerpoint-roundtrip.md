---
id: WP-016
status: ready
priority: P0
wave: 1
effort: XL
owner: unassigned
updated: 2026-11-15
---

# WP-016: Close PPTX visual and editable-object gaps

## Outcome and baseline

Extensive native PowerPoint import/export exists, including geometry and theme handling; the catalog still marks parity partial.

Evidence inspected: [packages/core/src/pptx.ts](../packages/core/src/pptx.ts); [packages/core/src/pptx-export.ts](../packages/core/src/pptx-export.ts); [packages/core/src/pptx-autofit.ts](../packages/core/src/pptx-autofit.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Fix master/layout inheritance, text autofit, cropping, groups, tables, charts, diagrams, notes and media by measured severity.

## Acceptance criteria

- [ ] A 30-slide reference deck reopens in PowerPoint with expected text and editable supported objects.
- [ ] no clipped text or displaced objects beyond approved tolerance.
- [ ] unsupported SmartArt/OLE behavior is explicit.

## Dependencies and execution

Dependencies: WP-012. These gate final integration acceptance, not initial investigation. Wave 1; priority P0; rough effort XL (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
