---
id: WP-033
status: ready
priority: P1
wave: 2
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-033: Make cluster operations supportable

## Outcome and baseline

Runbooks and operations modules exist; service-level recovery needs measured deployment evidence.

Evidence inspected: [packages/core/src/operations](../packages/core/src/operations); [docs/operations-runbooks.md](../docs/operations-runbooks.md). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Instrument sync lag, storage, queue age and errors.
- [ ] add redacted diagnostics, health checks, capacity planning and rehearsed incident playbooks.

## Acceptance criteria

- [ ] Inject full disk, node outage and stalled replication in a disposable cluster.
- [ ] alerts identify failures without file contents.
- [ ] an operator restores service using the runbook and publishes measured impact/recovery.

## Dependencies and execution

Dependencies: WP-010, WP-011. These gate final integration acceptance, not initial investigation. Wave 2; priority P1; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
