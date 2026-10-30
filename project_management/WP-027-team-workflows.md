---
id: "WP-027"
title: "Notifications, assigned work, and approvals"
type: "work_package"
status: "blocked"
priority: "P1"
phase: 2
area: "workflow"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-007"]
related_sources: ["S01", "S02"]
---

# Notifications, assigned work, and approvals

## Outcome and rationale

Give teams a coherent way to act on comments, reviews, form submissions, and shared documents without relying on manual follow-up.

## Existing implementation and starting points

Existing comments, mentions, history, sharing, and document suggestions provide UI/content anchors. Start with `apps/web/src/drive/file-comments.tsx`, editor comment modules, `apps/web/src/editors/doc-mentions.ts`, and node drive APIs.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Define stable events and tasks for mentions, assignments, review requests, sharing changes, form submissions, and approval actions. Link each event to an authorized file/version/anchor.
- Provide an inbox, unread state, assignment owner/due date, resolve/reopen, notification preferences, batching/digests, and deduplication.
- Bind approval to immutable versions and define what changes invalidate it; support multiple reviewers and explicit decision histories.
- Add transactional event/outbox delivery so failed notifications retry without duplicate task creation. Integrate email/chat only through configured providers.
- Remove or redact inaccessible notification content on revocation; distinguish notification visibility from permission to the referenced file.

## Dependencies and delivery

Completion is blocked on `WP-007`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A mention/assignment creates one actionable item, survives refresh, and tracks resolution.
- Repeated retries do not duplicate notifications or approvals.
- An approved version remains identifiable and later edits clearly require a new review.
- A user who loses access cannot retrieve document snippets through old notification endpoints.

## Verification

- Vitest event/task models, preference filtering, jsdom inbox behavior, and approval state; server tests for outbox durability/access.
- Simulate delivery failures, deleted anchors, revoked access, and concurrent decisions.
- Do not add browser tests that only verify notification strings.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

A basic review approval is not a legally binding signature. Sending external notifications requires an explicitly configured and authorized channel.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S01`, `S02`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
