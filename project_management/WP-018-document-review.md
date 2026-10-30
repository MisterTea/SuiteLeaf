---
id: "WP-018"
title: "Document review, comparison, and approvals"
type: "work_package"
status: "blocked"
priority: "P1"
phase: 3
area: "documents"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-002"]
related_sources: ["S21", "S16"]
---

# Document review, comparison, and approvals

## Outcome and rationale

Allow reviewers to propose, compare, and combine changes without losing attribution or silently accepting revisions.

## Existing implementation and starting points

Suggestions, comments, comparisons, and version restoration already exist in `apps/web/src/editors/doc-suggestions.ts`, `doc-suggestions-ui.tsx`, `doc-comments.tsx`, `version-history.tsx`, and `packages/core/src/doc-diff.ts`.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Extend tracked changes to supported formatting and structural operations, including tables, paragraph movement, and object edits; define unsupported cases explicitly.
- Implement compare and combine for separately edited documents with a shared baseline, reviewer attribution, conflict review, and selective acceptance/rejection.
- Add assigned review tasks, resolved/reopened comments, notifications, and a review-completion view; use WP-027's shared workflow model when available.
- Support original/final/markup views and safe export choices. Preserve Word revision/comment metadata in coordination with WP-014.
- Bind approval to a specific immutable version; subsequent edits invalidate or supersede approval rather than leaving a misleading approved badge.

## Dependencies and delivery

Completion is blocked on `WP-002`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Combining two reviewers' copies retains nonconflicting edits and requires decisions for overlapping changes.
- Accept/reject works on supported text, format, and structural changes with correct authorship and undo.
- A document's approved version can be retrieved exactly; editing it creates a new unapproved revision.
- Review data survives collaboration, native saves, and supported DOCX round trips.

## Verification

- Vitest for merge conflicts, revision transformations, export views, permissions, and version-bound approval.
- Use real typing/caret tests for suggestion-mode editing and selection behavior.
- Test review under reconnect and concurrent accept/reject operations.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Cryptographic signatures and legally binding e-signature services require separate provider/legal requirements. A review approval badge is not an e-signature.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S21`, `S16`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
