---
id: WP-025
status: ready
priority: P2
wave: 3
effort: L
owner: unassigned
updated: 2026-11-15
---

# WP-025: Finish reliable forms and responses

## Outcome and baseline

Forms, validation and response exports exist; single-node deduplication does not prove concurrent multi-node response integrity.

Evidence inspected: [docs/forms.md](../docs/forms.md); [apps/web/src/form-submit.ts](../apps/web/src/form-submit.ts). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Complete branching, quizzes, uploads, response policy, abuse controls and accessible responder UX.
- [ ] reconcile concurrent submissions.

## Acceptance criteria

- [ ] Submit the same response through two nodes and store it once.
- [ ] enforce required/branch rules server-side.
- [ ] respondent cannot read others' answers.
- [ ] authorized export is complete and formula-safe.
- [ ] interrupted uploads resume or clean up.

## Dependencies and execution

Dependencies: WP-007, WP-005. These gate final integration acceptance, not initial investigation. Wave 3; priority P2; rough effort L (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
