---
id: WP-026
status: ready
priority: P1
wave: 2
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-026: Deliver permission-aware workspace discovery

## Outcome and baseline

Search modules and local library search exist; end-to-end indexing freshness and permission guarantees need proof.

Evidence inspected: [packages/core/src/search](../packages/core/src/search); [apps/web/src/library-search.ts](../apps/web/src/library-search.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Index document text, sheet values, slide notes and metadata.
- [ ] expose filters and snippets.
- [ ] support incremental reindex and deletion.

## Acceptance criteria

- [ ] Find a known fixture in each format.
- [ ] edits appear within a measured target of 30s.
- [ ] revocation immediately blocks results/snippets.
- [ ] deleted/private content cannot leak through cache or alternate queries.

## Dependencies and execution

Dependencies: WP-007. These gate final integration acceptance, not initial investigation. Wave 2; priority P1; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
