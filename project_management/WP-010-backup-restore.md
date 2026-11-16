---
id: WP-010
status: ready
priority: P0
wave: 1
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-010: Demonstrate independent disaster recovery

## Outcome and baseline

Sealed backup and restore components exist; restoring a local archive is not a full disaster-recovery demonstration.

Evidence inspected: [docs/backup.md](../docs/backup.md); [packages/core/src/capabilities/catalog-data.ts](../packages/core/src/capabilities/catalog-data.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Schedule independent encrypted copies.
- [ ] validate retention, key recovery, integrity and restoration onto clean nodes.
- [ ] document measured RPO/RTO.

## Acceptance criteria

- [ ] Destroy a disposable cluster and restore accounts, permissions, versions and file bytes from the independent copy.
- [ ] corrupted/missing blobs fail safely.
- [ ] publish measured recovery times and key prerequisites.

## Dependencies and execution

Dependencies: WP-005. These gate final integration acceptance, not initial investigation. Wave 1; priority P0; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
