---
id: "WP-005"
title: "Explainable saving, synchronization, and conflict recovery"
type: "work_package"
status: "ready"
priority: "P0"
phase: 1
area: "storage"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S04", "S05", "S06"]
---

# Explainable saving, synchronization, and conflict recovery

## Outcome and rationale

Remove uncertainty about where work is saved. Users must distinguish a durable local edit from one safely synchronized to SuiteDrive and recover from conflicts without guesswork.

## Existing implementation and starting points

Start with `apps/web/src/storage.ts`, `apps/web/src/drive/status.ts`, `apps/web/src/drive-watch.ts`, `apps/web/src/node-client.ts`, `apps/desktop/src/store.ts`, and `crates/suiteleaf-node/src/drive_api.rs`. Existing local drafts, atomic desktop writes, upload/version conflicts, and history are foundations to extend.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Define a revision-aware save state machine: editing, saving locally, saved locally/pending sync, syncing, synced, offline, conflict, and failed. A success label must refer to a persisted revision.
- Persist a resumable per-file upload queue with idempotency, retry/backoff, last success, pending size, and an actionable failure reason. Account for expired credentials and quotas.
- Provide local-versus-remote comparison, save-both, and selective recovery where editor diffs permit it; preserve both source versions before resolution.
- Show storage location and sync target in the editor/library. Never silently redirect a local file into hosted storage.
- Expose non-content sync health for administration and diagnostics. Coordinate version/ack semantics with WP-002 when collaboration is active.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A locally saved but unsynchronized edit is never labeled fully synced.
- Crash/relaunch and offline/reconnect retain pending work; retry does not create duplicate versions or copies.
- External desktop modification and remote version conflicts retain both versions until the user resolves them.
- Each failed item offers a specific remedy and can be retried independently.

## Verification

- Vitest state-machine, persistence, idempotency, and conflict tests; Rust tests for preconditions and upload failures.
- Use temporary files for desktop atomic-write/recovery verification and simulated network/auth failures for queue tests.
- Test failure of a queued save does not poison later saves.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

This package does not make third-party Google Drive/Dropbox sync reliable; show the boundary when users choose their folders. Replication health and backup are separate states.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S04`, `S05`, `S06`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
