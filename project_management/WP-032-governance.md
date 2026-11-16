---
id: WP-032
status: ready
priority: P2
wave: 4
effort: XL
owner: unassigned
updated: 2026-11-15
---

# WP-032: Enforce governance across actual data paths

## Outcome and baseline

Governance policy components exist; complete retention/discovery enforcement is not established.

Evidence inspected: [packages/core/src/governance](../packages/core/src/governance); [docs/data-governance-residency.md](../docs/data-governance-residency.md). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Integrate retention, legal hold, audit export, sensitivity policy and residency constraints into storage, replication, export and deletion.
- [ ] define supported scope.

## Acceptance criteria

- [ ] Held content survives user deletion and remains discoverable by authorized roles.
- [ ] expiry deletes eligible replicas/backups per documented policy.
- [ ] unauthorized exports are blocked.
- [ ] restore cannot silently bypass policy.

## Dependencies and execution

Dependencies: WP-007, WP-010. These gate final integration acceptance, not initial investigation. Wave 4; priority P2; rough effort XL (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
