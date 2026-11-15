---
id: WP-007
status: ready
priority: P0
wave: 2
effort: M
owner: unassigned
updated: 2026-11-15
---

# WP-007: Enforce and explain sharing permissions

## Outcome and baseline

Sharing and access explanations exist; complete enforcement must cover every access path.

Evidence inspected: [docs/access.md](../docs/access.md); [packages/core/src/access-matrix.ts](../packages/core/src/access-matrix.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Unify inherited, direct, link and role permissions across editors, exports, search, AI and collaboration.
- [ ] show effective access and revocation.

## Acceptance criteria

- [ ] A role-by-action matrix passes API tests.
- [ ] revocation closes live access and new downloads.
- [ ] explanations agree with actual server decisions.
- [ ] denied resources reveal no content.

## Dependencies and execution

Dependencies: WP-002. These gate final integration acceptance, not initial investigation. Wave 2; priority P0; rough effort M (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
