---
id: "WP-002"
title: "Durable document collaboration and session protocol"
type: "work_package"
status: "ready"
priority: "P0"
phase: 1
area: "collaboration"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S01", "S02"]
---

# Durable document collaboration and session protocol

## Outcome and rationale

Make simultaneous document editing survive disconnects, restarts, and node changes without dropping content or granting unintended access. This provides the durable collaboration contract for spreadsheets and slides.

## Existing implementation and starting points

Inspect `apps/web/src/collab/session.ts`, `apps/web/src/editors/Docs.tsx`, `packages/core/src/collab.ts`, `crates/suiteleaf-node/src/collab.rs`, and `crates/suiteleaf-node/src/replication.rs`. Docs receives a Y.Doc. The inspected client has no obvious reconnect handler; server compaction extracts paragraph text from a baseline. These are audit leads requiring reproduction, not confirmed runtime failures.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Specify join, seed, update, acknowledgement, reconnect, presence, leave, and snapshot messages; distinguish per-device sessions from user identity. Define idempotency, ordering, document generations, and protocol versions.
- Persist complete rich-document state, including formatting, tables, objects, comments, and structural edits. Replace or correct any text-only compaction path that cannot faithfully reconstruct that state.
- Durably journal acknowledged updates and recover rooms after process death. Define cross-node room ownership/routing or replication so clients on different nodes converge; avoid treating replicated presence as live-document replication.
- Add reconnect with bounded backoff, token renewal, queued local changes, state-vector reconciliation, and clear recovery UI. Prevent duplicate initial seeding and mode-switch data loss.
- Enforce authorization on connection and updates, including revoked access, commenter restrictions, and token expiration. Validate update content server-side rather than trusting client-supplied operation labels.
- Implement live selections, participant presence, collaborative undo scoped to the local user's operations, and honest idle/disconnected state. Define how read-only viewers receive live updates.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Two users on different nodes edit text, formatting, tables, and inserted images; both converge and reopening preserves the complete document.
- Network loss, token expiration, duplicate messages, simultaneous joins, and node restart lose no acknowledged edit.
- Revoking access prevents further server reads/writes according to a documented bounded enforcement policy; commenters cannot forge editing operations.
- Undo of one user's operation preserves unrelated remote work; idle transitions do not silently discard unsaved changes.

## Verification

- Use Rust integration tests for durable log recovery, protocol authorization, and multi-node convergence; Vitest for client state transitions and replay.
- Use real-browser typing tests for caret, selections, collaborative typing, and keyboard undo only; test rich-state persistence independently in unit/integration tests.
- Record deterministic fault-injection cases and repeat them against the same protocol fixture set.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not claim spreadsheet or presentation collaboration until WP-003 and WP-004 complete. Do not retain bearer tokens in diagnostics or URL logs; replace or redact the existing query-token transport where necessary.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S01`, `S02`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
