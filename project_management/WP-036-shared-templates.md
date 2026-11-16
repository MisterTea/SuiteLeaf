---
id: WP-036
status: ready
priority: P1
wave: 2
effort: M
owner: unassigned
updated: 2026-11-15
---

# WP-036: Deliver reusable organization templates

## Outcome and baseline

Template components exist; governed distribution and full Office template fidelity need validation.

Evidence inspected: [packages/core/src/templates](../packages/core/src/templates); [apps/web/src/templates](../apps/web/src/templates). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Implement versioned document/workbook/deck templates, brand assets, permissions, preview and update policy.
- [ ] cover DOTX/XLTX/POTX conversion boundaries.

## Acceptance criteria

- [ ] Publish a branded template, create independent files, update the template and retain existing files.
- [ ] revoked templates disappear from new-file choices.
- [ ] styles/fonts/themes survive export.

## Dependencies and execution

Dependencies: WP-007, WP-014, WP-016. These gate final integration acceptance, not initial investigation. Wave 2; priority P1; rough effort M (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
