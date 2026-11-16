---
id: WP-034
status: ready
priority: P1
wave: 2
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-034: Make the assistant reliable and permission-correct

## Outcome and baseline

Local/server assistant and tools exist; permission and file-authorization code is changing in the worktree.

Evidence inspected: [docs/ai-policy.md](../docs/ai-policy.md); [apps/web/src/ai/host.ts](../apps/web/src/ai/host.ts); [apps/web/src/ai/tool-permission.ts](../apps/web/src/ai/tool-permission.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Evaluate grounded reads and editable output.
- [ ] enforce permission checks at execution time, preview material edits, cancellation and undo.
- [ ] test hostile document instructions and provider policy.

## Acceptance criteria

- [ ] A fixed set of 50 document/sheet/slide tasks reports correctness and latency.
- [ ] unauthorized reads and writes always fail.
- [ ] revoked access is rechecked.
- [ ] canceled jobs stop.
- [ ] accepted edits are recoverable and traceable.

## Dependencies and execution

Dependencies: WP-007, WP-005. These gate final integration acceptance, not initial investigation. Wave 2; priority P1; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
