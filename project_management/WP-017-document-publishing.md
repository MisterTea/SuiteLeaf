---
id: WP-017
status: ready
priority: P1
wave: 3
effort: XL
owner: unassigned
updated: 2026-11-15
---

# WP-017: Finish professional document layout and print

## Outcome and baseline

Page settings, styles, section and table layout components exist; complete long-report publishing is not demonstrated.

Evidence inspected: [packages/core/src/document-pagination.ts](../packages/core/src/document-pagination.ts); [packages/core/src/table-pages.ts](../packages/core/src/table-pages.ts); [docs/document-styles.md](../docs/document-styles.md). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Finish style inheritance, multilevel lists, section breaks, columns, running headers, footnotes/endnotes, TOC, captions, index, cross-references and print/PDF consistency.

## Acceptance criteria

- [ ] A 100-page report updates fields after edits and repaginates correctly.
- [ ] tables split/repeat headers correctly.
- [ ] widows/orphans and keep-with-next behave consistently.
- [ ] exported Word and PDF retain the approved layout.

## Dependencies and execution

Dependencies: WP-014. These gate final integration acceptance, not initial investigation. Wave 3; priority P1; rough effort XL (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
