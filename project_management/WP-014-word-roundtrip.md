---
id: WP-014
status: ready
priority: P0
wave: 1
effort: XL
owner: unassigned
updated: 2026-11-15
---

# WP-014: Close DOCX fidelity gaps

## Outcome and baseline

DOCX conversion and extensive layout helpers exist; exact Word fidelity is unverified.

Evidence inspected: [packages/core/src/word.ts](../packages/core/src/word.ts); [packages/core/src/docx-export.ts](../packages/core/src/docx-export.ts); [packages/core/src/document-pagination.ts](../packages/core/src/document-pagination.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Fix corpus-ranked losses in sections, lists, styles, tables, floating images, fields, review markup and headers.
- [ ] investigate font metrics through shared layout paths.

## Acceptance criteria

- [ ] A 20-page mixed-section report retains content, numbering, references and editable objects after both round trips.
- [ ] pages and approved visual tolerances match Word.
- [ ] paired Office/SuiteLeaf fonts introduce no layout drift.

## Dependencies and execution

Dependencies: WP-012. These gate final integration acceptance, not initial investigation. Wave 1; priority P0; rough effort XL (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
