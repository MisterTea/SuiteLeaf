---
id: WP-011
status: ready
priority: P0
wave: 1
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-011: Ship trusted desktop updates

## Outcome and baseline

Signed-manifest verification and release policy exist; README still describes unsigned packaging and incomplete publishing.

Evidence inspected: [docs/updates.md](../docs/updates.md); [apps/desktop](../apps/desktop). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Reconcile packaging state.
- [ ] finish OS signing/notarization, update hosting, staged rollout and recoverable installation on Windows/macOS/Linux.

## Acceptance criteria

- [ ] Clean machines install and update each supported bundle.
- [ ] tampering is rejected.
- [ ] interrupted installation recovers.
- [ ] open edits survive restart.
- [ ] schema-incompatible downgrade is blocked.

## Dependencies and execution

Dependencies: WP-005. These gate final integration acceptance, not initial investigation. Wave 1; priority P0; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
