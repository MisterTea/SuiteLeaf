---
id: WP-035
status: ready
priority: P2
wave: 2
effort: S
owner: unassigned
updated: 2026-11-15
---

# WP-035: Publish an honest feature and support matrix

## Outcome and baseline

One open-source edition and cost disclosures exist; no hosted commercial prices are published.

Evidence inspected: [docs/packaging.md](../docs/packaging.md); [packages/core/src/packaging.ts](../packages/core/src/packaging.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Publish verified platform/mode/format limits and support expectations.
- [ ] separate software, hosting, AI and storage costs.
- [ ] provide complete exit/export instructions.

## Acceptance criteria

- [ ] Every feature claim links to evidence.
- [ ] unknown costs remain unknown.
- [ ] local files remain usable without a host subscription.
- [ ] a documented exit exports file bytes plus required metadata rather than only an index.

## Dependencies and execution

Dependencies: WP-001. These gate final integration acceptance, not initial investigation. Wave 2; priority P2; rough effort S (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
