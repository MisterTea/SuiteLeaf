---
id: WP-037
status: ready
priority: P2
wave: 4
effort: XL
owner: unassigned
updated: 2026-11-15
---

# WP-037: Close Outlook mail, calendar and contact workflows

## Outcome and baseline

SuiteLeaf Mail already has IMAP/SMTP, Gmail OAuth, contacts and optional Google calendar/tasks sidebar; it is not absent.

Evidence inspected: [docs/mail.md](../docs/mail.md); [apps/web/src/mail](../apps/web/src/mail); [packages/core/src/integrations/communications](../packages/core/src/integrations/communications). This is a source/documentation assessment, not a fresh runtime pass. Existing implementations must be reused and verified before replacing them.

## Work to deliver

- [ ] Prioritize Outlook/Exchange interoperability, full calendar invitation/edit/recurrence/time-zone behavior, contact sync, shared mailbox/delegation and offline mail.
- [ ] distinguish integrations from native replacements.

## Acceptance criteria

- [ ] Send/reply with attachments through test providers.
- [ ] recurring meeting exceptions and DST times round-trip.
- [ ] token revocation stops access.
- [ ] duplicate sync is harmless.
- [ ] document unsupported Exchange/delegation behaviors.

## Dependencies and execution

Dependencies: WP-008, WP-007. These gate final integration acceptance, not initial investigation. Wave 4; priority P2; rough effort XL (see [roadmap](ROADMAP.md#sizing-and-staffing)). Start with a failing representative workflow, implement the smallest complete slice, then expand the fixture set. Split XL work into independently accepted issues before implementation.

## Validation and completion

Use [the common evidence and test contract](README.md#definition-of-done). Add Vitest tests for behavior, serialization and permissions, and Rust tests for node behavior. Use Playwright only for layout, painted grid/canvas, real document typing or storyboards; use provider/desktop integration checks where those are required. Record reference application/build, mode, fixtures, command, actual result and remaining limits. No new acceptance run is recorded in this package.

Completion requires every criterion above and the common contract. An unavailable external dependency is recorded as blocked/inconclusive, never passed. Broader Office behavior outside the accepted fixture set remains an explicit limit. See [comparison](COMPARISON.md) and [Microsoft sources](SOURCES.md) for the benchmark and edition boundaries.
