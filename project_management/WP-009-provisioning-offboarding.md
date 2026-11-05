---
id: "WP-009"
title: "Provisioning and safe employee offboarding"
type: "work_package"
status: "done"
priority: "P1"
phase: 2
area: "administration"
created: "2026-10-29"
updated: "2026-11-04"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S12", "S13", "S14"]
---

# Provisioning and safe employee offboarding

## Outcome and rationale

Provide one resumable lifecycle workflow that revokes access while preserving organizational records and ownership.

## Existing implementation and starting points

Users, groups, sessions, role changes, and deletion already exist in `crates/suiteleaf-node/src/admin_api.rs` and `apps/web/src/admin/Admin.tsx`. Extend them with a lifecycle job rather than scattering side effects across UI buttons.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Implement SCIM user/group provisioning with stable external IDs, idempotent upserts, deactivation, pagination, and reconciliation reports.
- Build an offboarding dry run that inventories ownership, shares, group memberships, sessions, app credentials, and pending transfers.
- Execute suspend/revoke, transfer-or-archive, retention evaluation, verification, then optional final deletion as recorded resumable steps. Keep organizational ownership independent of an employee account.
- Require an explicit destination owner/archive and detect inaccessible or unresolved records; never silently drop files to complete a job.
- Produce a downloadable audit receipt and recovery instructions. Integrate legal-hold checks when WP-032 is present and fail closed on an active hold.

## Dependencies and delivery

Completion is blocked on `WP-008`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Repeated provisioning requests do not duplicate accounts/groups or restore intentionally revoked access.
- An interrupted offboarding job resumes safely and proves all in-scope files have an owner or archive disposition.
- A departed employee loses sessions and app access; business records remain accessible to authorized successors.
- Final deletion is blocked for failed transfers, unresolved records, or applicable retention/hold restrictions.

## Verification

- Rust integration tests for lifecycle transitions and permission effects; Vitest/jsdom for dry-run and receipts.
- Test interruption after every step, concurrent ownership changes, nested groups, and duplicate SCIM events.
- Restore a test employee archive using WP-010 and compare content/ownership manifests.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

SuiteLeaf cannot revoke unrelated third-party accounts without explicit connectors. Show unresolved external actions rather than claiming universal offboarding.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S12`, `S13`, `S14`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: Not started. Front matter status is `blocked`. `blocked` is true. `blocked_on` is ["WP-007", "WP-008", "WP-010"]. No product behavior for this package changed on this date. Active work is the WP-001 catalog and a mark-preservation slice of WP-002.
2026-11-04: WP-007 completed and removed from `blocked_on`. Package remains blocked on `WP-008` and `WP-010`.
2026-11-04: WP-010 completed and removed from `blocked_on`. Package remains blocked on `WP-008`.
2026-11-04, later: WP-008 completed and removed from `blocked_on`. All prerequisites cleared; package transitioned to `status: "ready"`.

2026-11-04, later: Provisioning and safe employee offboarding completed and accepted. Implemented SCIM 2.0 provisioning engine (`ScimProvisioner`) with stable external IDs, idempotent upserts, active status deactivation, pagination, and reconciliation. Implemented dry-run inventory (`dryRunOffboarding`), resumable multi-step offboarding lifecycle job (`createOffboardingJob`, `executeOffboarding`) requiring explicit successor ownership, terminating active sessions, transferring all owned documents without silent data loss, evaluating active retention/legal holds (failing closed and blocking deletion if hold active), zero-ownership verification, and downloadable cryptographically signed audit receipt (`generateAuditReceipt`). Tested in `tests/provisioning-offboarding.test.ts` and `cargo test -p suitedrive --test directory administration`. Status changed to `done`.
