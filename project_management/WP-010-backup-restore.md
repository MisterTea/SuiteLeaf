---
id: "WP-010"
title: "Independent backups and disaster recovery"
type: "work_package"
status: "ready"
priority: "P0"
phase: 1
area: "operations"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S14"]
---

# Independent backups and disaster recovery

## Outcome and rationale

Protect against deletions, corruption, operator mistakes, and loss of an entire cluster. Full replication copies failures too and is not an independent backup.

## Existing implementation and starting points

Start with `docs/suitedb.md`, `docs/architecture.md`, `crates/suitedb`, `crates/suitedrive/src/blobs.rs`, and `deploy/`. Each node holds accounts/files; desktop local drafts live separately from document files.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Define consistent backup manifests spanning database state, blobs, versions, configuration, and recoverable key material. Avoid snapshots whose database references missing blobs.
- Support scheduled encrypted backups to independent storage with retention, integrity verification, resumable transfer, and separate credentials; document immutable/offline storage options.
- Implement file/version, folder, and full-cluster restore with dry-run and restore-as-copy options. Validate tenant/identity/ACL mapping when restoring into a different environment.
- Add routine automated restore drills and last-success/last-tested indicators. Define measurable recovery point and recovery time objectives from pilot requirements.
- Document local-desktop backup boundaries, encryption-key recovery, and how to recover without a functioning original cluster.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Restore a complete cluster into a clean environment and verify content hashes, versions, permissions, and authentication configuration.
- Recover a deleted folder without rolling unrelated files backward.
- Corrupt or incomplete backups are rejected before they overwrite live data.
- Operators can see backup freshness and actual successful restore-test evidence.

## Verification

- Rust/integration tests with consistent snapshot and restore fixtures; fault injection during backup and restore.
- Test lost nodes, missing blobs, encrypted backup with incorrect key, and incremental-chain gaps.
- Measure recovery time/data loss on a documented representative dataset; do not invent service guarantees.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Replication, legal retention, and device sync are separate functions. Do not advertise end-to-end encryption simply because backup archives are encrypted.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S14`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
