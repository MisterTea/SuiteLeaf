---
id: WP-018
status: ready
priority: P1
wave: 3
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-018: Finish Word-compatible review workflows

## Outcome and baseline

Comments, compare/combine and approval helpers exist; complex revision round trips remain a certification gap.

Evidence inspected: [docs/document-review.md](../docs/document-review.md); [packages/core/src/review-docx.ts](../packages/core/src/review-docx.ts); [packages/core/src/review-combine.ts](../packages/core/src/review-combine.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Complete tracked inserts/deletes/formatting, anchored threads, accept/reject, compare/combine and approval invalidation across collaborators and DOCX.

## Acceptance criteria

- [ ] Two reviewers change overlapping passages and table content.
- [ ] unresolved choices remain visible.
- [ ] accept/reject preserves intended content.
- [ ] Word retains authors and changes.
- [ ] new edits invalidate the approved revision.

## Dependencies and execution

Dependencies: WP-014, WP-002. These gate final integration acceptance, not initial investigation. Wave 3; priority P1; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
