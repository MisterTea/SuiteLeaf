---
id: WP-027
status: ready
priority: P2
wave: 2
effort: M
owner: unassigned
updated: 2026-11-15
---

# WP-027: Complete review assignments and approvals

## Outcome and baseline

Workflow and approval components exist; module tests do not prove a team can complete the workflow.

Evidence inspected: [packages/core/src/workflows](../packages/core/src/workflows); [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Integrate assignments, due dates, mentions, notifications, approval history and revision binding into document/file views.

## Acceptance criteria

- [ ] Author assigns a reviewer, reviewer comments and approves, author changes content and approval becomes stale.
- [ ] repeated notifications are deduplicated.
- [ ] unauthorized actors cannot approve or read the task.

## Dependencies and execution

Dependencies: WP-007, WP-018. These gate final integration acceptance, not initial investigation. Wave 2; priority P2; rough effort M (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
