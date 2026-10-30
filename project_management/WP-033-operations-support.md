---
id: "WP-033"
title: "Operational visibility and actionable support"
type: "work_package"
status: "blocked"
priority: "P1"
phase: 2
area: "operations"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-005", "WP-010"]
related_sources: ["S04", "S06", "S26"]
---

# Operational visibility and actionable support

## Outcome and rationale

Make self-hosting supportable and let administrators diagnose failures without repeatedly exporting private documents or guessing which subsystem failed.

## Existing implementation and starting points

Nodes replicate database operations/blobs, host auth, and serve SuiteDrive. Existing admin activity views are not a complete health/support console. Inspect `deploy/`, node HTTP/replication modules, and `apps/web/src/admin/`.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Expose health/readiness, replication lag/backlog, failed saves, room health, queue failures, storage usage, quotas, backup freshness, and restore-test status.
- Add capacity thresholds, quota policies, alerts, and a clear distinction between transient offline state and data-integrity failures.
- Create stable error codes, user remedies, correlation IDs, and an opt-in diagnostics bundle excluding document contents, tokens, and secrets by default.
- Provide operator runbooks for auth failure, full disks, missing blobs, damaged indexes, node replacement, upgrades, and restore; include a support access path when ordinary sign-in is unavailable.
- If commercial support is offered, define severity, ownership, escalation, response expectations, and an incident/status process independent of the affected application.
- Track support outcomes and common failure categories without unnecessary personal-data collection.

## Dependencies and delivery

Completion is blocked on `WP-005`, `WP-010`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- An operator can identify an induced failed upload, lagging node, full disk, and stale backup from documented telemetry.
- A diagnostics bundle contains enough context to reproduce a known issue without including file contents or credentials.
- A locked-out administrator has a documented, authenticated recovery/escalation route.
- Quotas fail safely before writes are acknowledged and preserve unsynchronized local edits.

## Verification

- Unit-test redaction/error mapping and dashboard data; server integration tests for health and alert transitions.
- Inject representative failures and follow the runbooks in a disposable deployment.
- Verify monitoring permissions and avoid leaking user activity to unauthorized administrators.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not promise support response times without staffing/capacity approval. A green health endpoint alone is not evidence that backups or application workflows work.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S04`, `S06`, `S26`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
