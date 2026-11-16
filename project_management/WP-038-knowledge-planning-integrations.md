---
id: WP-038
status: ready
priority: P2
wave: 4
effort: XL
owner: unassigned
updated: 2026-11-15
---

# WP-038: Define the broader Office replacement boundary

## Outcome and baseline

Knowledge/planning integration modules exist; this review does not establish OneNote, Access, Teams, Planner or Visio replacement.

Evidence inspected: [packages/core/src/integrations/knowledge-planning](../packages/core/src/integrations/knowledge-planning); [packages/core/src/capabilities/catalog-completed.ts](../packages/core/src/capabilities/catalog-completed.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Inventory customer dependence on notebooks, relational apps, diagrams, chat/meetings and planning.
- [ ] select native implementation, integration or explicit deferral per workflow.
- [ ] deliver the highest-priority connector slice.

## Acceptance criteria

- [ ] Publish a decision and migration route for every named product.
- [ ] demonstrate notebook/page and task import/export with attachments, links and permissions for the selected slice.
- [ ] deferred products remain explicit parity exclusions.

## Dependencies and execution

Dependencies: WP-007, WP-026, WP-031. These gate final integration acceptance, not initial investigation. Wave 4; priority P2; rough effort XL (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
