---
id: WP-031
status: ready
priority: P2
wave: 4
effort: XL
owner: unassigned
updated: 2026-11-15
---

# WP-031: Deliver safe automation and a macro migration path

## Outcome and baseline

API client, job runner, sandbox and webhooks exist; imported VBA is not executed.

Evidence inspected: [packages/core/src/automation](../packages/core/src/automation); [docs/office-compat.md](../docs/office-compat.md). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Publish versioned document APIs, script permissions and bounded execution.
- [ ] add recorder/templates and reliable webhooks.
- [ ] inventory VBA/COM dependencies and provide explicit migration guidance.

## Acceptance criteria

- [ ] Run a repeatable workbook transformation with cancellation and rollback.
- [ ] scripts cannot access unauthorized files or host credentials.
- [ ] webhook retries are idempotent.
- [ ] macro-enabled files clearly distinguish preservation from execution.

## Dependencies and execution

Dependencies: WP-007, WP-015. These gate final integration acceptance, not initial investigation. Wave 4; priority P2; rough effort XL (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
