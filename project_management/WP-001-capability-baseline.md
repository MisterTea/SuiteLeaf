---
id: WP-001
status: ready
priority: P0
wave: 1
effort: S
owner: unassigned
updated: 2026-11-15
---

# WP-001: Reconcile the Office parity baseline

## Outcome and baseline

The catalog separates implemented and verified capabilities, but README and historical package completion claims disagree.

Evidence inspected: [docs/capabilities.md](../docs/capabilities.md); [packages/core/src/capabilities/catalog.ts](../packages/core/src/capabilities/catalog.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Inventory user workflows by platform and runtime.
- [ ] reconcile catalog, README and evidence.
- [ ] record Office build, license and reference availability.

## Acceptance criteria

- [ ] Every advertised capability has a reproducible workflow and evidence classification.
- [ ] partial implementations remain partial.
- [ ] unavailable Office runs never count as passes.

## Dependencies and execution

Dependencies: None. These gate final integration acceptance, not initial investigation. Wave 1; priority P0; rough effort S (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
