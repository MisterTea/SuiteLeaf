---
id: WP-009
status: ready
priority: P1
wave: 2
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-009: Complete employee onboarding and departure

## Outcome and baseline

Provisioning helpers and departure checks exist; the departure workflow remains inconclusive.

Evidence inspected: [packages/core/src/provisioning](../packages/core/src/provisioning); [packages/core/src/capabilities/departure.ts](../packages/core/src/capabilities/departure.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Integrate directory provisioning, group sync, disable/delete semantics, ownership transfer and audit.
- [ ] make bulk actions resumable.

## Acceptance criteria

- [ ] Provision and update a test group twice without duplicates.
- [ ] disable a live employee across nodes.
- [ ] transfer files and revoke sessions, shares and credentials with an inspectable result.

## Dependencies and execution

Dependencies: WP-008. These gate final integration acceptance, not initial investigation. Wave 2; priority P1; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
