---
id: WP-019
status: ready
priority: P1
wave: 3
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-019: Complete research, language and mail merge

## Outcome and baseline

Citations, reference management, local proofing and document-producing mail merge already exist.

Evidence inspected: [docs/bibliography.md](../docs/bibliography.md); [docs/proofing.md](../docs/proofing.md); [docs/mail-merge.md](../docs/mail-merge.md). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Expand reference/style coverage and proofing quality with an evaluation set.
- [ ] finish field updates, multilingual/RTL input and letters/labels/envelopes merge workflows.

## Acceptance criteria

- [ ] A cited report updates bibliography and cross-references after reorder.
- [ ] RTL and IME text survive editing/export.
- [ ] 500 personalized letters have correct fields and unique names.
- [ ] missing data is caught before output.

## Dependencies and execution

Dependencies: WP-017. These gate final integration acceptance, not initial investigation. Wave 3; priority P1; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
