---
id: "WP-028"
title: "Resumable Office and Workspace migration"
type: "work_package"
status: "blocked"
priority: "P1"
phase: 2
area: "migration"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-007", "WP-010", "WP-012", "WP-013"]
related_sources: ["S15", "S16", "S09", "S12"]
---

# Resumable Office and Workspace migration

## Outcome and rationale

Move organizations into SuiteLeaf with predictable identity, file, permission, and compatibility outcomes instead of a one-shot folder import.

## Existing implementation and starting points

The desktop directory importer preserves folder structure but repeated runs create copies. Inspect `apps/desktop/src/directory-import.ts`, `import-cli.ts`, Office conversion helpers, SuiteDrive APIs, and existing round-trip reports.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Add Google Drive and SharePoint/OneDrive migration adapters using scoped authorization, source inventory, throttling/retry, and resumable checkpoints.
- Provide preflight/dry-run reports for identities, groups, ownership, permissions, duplicate names, links, unsupported formats, quotas, and conversion losses.
- Map source IDs to stable destination IDs so reruns are idempotent; preserve folder paths and supported comments/history/metadata where provider exports allow it.
- Map users/groups and effective permissions explicitly. Block or isolate unresolvable permissions rather than broadening access to make import succeed.
- Support staged imports, validation, delta passes, cutover, rollback/restore, and user acceptance samples; preserve source data untouched.
- Emit a per-file manifest with hashes, source/destination links, converter version, warnings, errors, and final disposition.

## Dependencies and delivery

Completion is blocked on `WP-007`, `WP-010`, `WP-012`, `WP-013`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- An interrupted migration resumes without duplicate files or silent skipped failures.
- A rerun imports changed items according to documented policy and leaves unchanged items intact.
- Permissions/ownership are validated against mapped identities; unsupported metadata is clearly reported.
- Operators can reconcile inventory totals and inspect every rejected or changed item before cutover.

## Verification

- Use mock provider API contract tests for pagination, rate limits, token expiration, and exports.
- Run an authorized disposable tenant/folder pilot with generated content; compare manifest counts/hashes and access matrices.
- Test rollback and restore using WP-010 without modifying source repositories.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not promise migration of every historical revision or comment when provider APIs cannot export it. Email/calendar migration is outside this file-migration package.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S15`, `S16`, `S09`, `S12`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
