---
id: "WP-037"
title: "Email, calendar, contacts, chat, and meeting integrations"
type: "work_package"
status: "blocked"
priority: "P2"
phase: 4
area: "workspace-expansion"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-008", "WP-031"]
related_sources: ["S01", "S02"]
---

# Email, calendar, contacts, chat, and meeting integrations

## Outcome and rationale

Address the communications portion of full Microsoft 365/Google Workspace replacement through interoperable integrations before committing to operating an entire communications platform.

## Existing implementation and starting points

The current repository centers on editors, files, forms, and administration. Email hosting, calendar servers, chat, and conferencing were not established as implemented by the source assessment. Existing Nextcloud sign-in is authentication, not an email/calendar integration.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Choose an initial supported integration set from user/pilot needs and record a build-versus-integrate decision. Define provider capabilities, credentials, scopes, hosting obligations, and failure behavior.
- Support document sharing/review notifications through configured email/chat, calendar events with file links, contacts for sharing, and meeting creation/join links with clear user confirmation before sends/invitations.
- Implement scoped OAuth/service credentials, revocation, account mapping, webhooks, retries, and idempotency through WP-031; respect directory visibility and file permissions.
- Provide export/import or standards bridges for contacts/calendar where supported, and explain unsupported recurrence, delegation, shared mailbox, or resource-booking cases.
- If native communications is selected later, require separately sized packages for mail delivery/spam protection, calendar recurrence/time zones/resource booking, contacts, chat moderation/retention, and conferencing/media infrastructure before claiming parity.
- Document cross-provider/offline behavior and allow users to keep existing communications tools while adopting SuiteLeaf editors.

## Dependencies and delivery

Completion is blocked on `WP-008`, `WP-031`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- The selected integrations complete a document review invitation, calendar-linked file workflow, and meeting-link workflow with explicit authorization.
- Retries do not send duplicate messages/invitations and revoked credentials stop future actions.
- Recipients gain only the intended document access; sending a link does not silently broaden permissions.
- The parity matrix clearly labels integrated, native, and unsupported communications capabilities.

## Verification

- Provider contract tests with local fixtures and an explicitly authorized disposable account pilot.
- Test rate limits, recurrence/time-zone edge cases, revocation, duplicate webhooks, and failed delivery.
- Verify outbound actions are previewable and audited without logging message contents unnecessarily.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

This package delivers integrations, not an Exchange/Gmail/Teams/Meet clone. Native hosting is a major product decision and must not be presented as already covered by editor parity.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S01`, `S02`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
