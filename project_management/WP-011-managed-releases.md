---
id: "WP-011"
title: "Signed releases and managed updates"
type: "work_package"
status: "ready"
priority: "P0"
phase: 1
area: "distribution"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: []
---

# Signed releases and managed updates

## Outcome and rationale

Make SuiteLeaf deployable and maintainable on managed desktops, with trustworthy updates and a recovery path when a release fails.

## Existing implementation and starting points

Inspect `apps/desktop/electron-builder.yml`, `apps/desktop/package.json`, packaging scripts, and CI. The README describes unsigned/ad-hoc packages, no configured automatic updates, and a macOS packaging step that installs into `/Applications/SuiteLeaf.app`.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Configure platform signing/notarization using protected CI secrets and document prerequisites for credentials that are not available in the repository.
- Implement signed update manifests, integrity verification, staged rollout rings, pause/defer policy, proxy support, and rollback compatible with document/schema changes.
- Provide unattended installation/uninstallation, managed settings, update-channel selection, and clear restart/reopen behavior.
- Publish SBOM/dependency notices and reproducible release provenance; keep model downloads separate from basic editor updates.
- Define minimum supported OS/runtime versions and regression matrices. Coordinate schema compatibility with backup and native-format migrations.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Tampered installers/update manifests are rejected; signed packages install on the supported platform matrix.
- An administrator can hold a fleet on a supported version and move a pilot ring forward.
- A failed rollout can be paused and recovered without corrupting files or silently discarding edits.
- Release documentation records actual version, signing status, migration constraints, and restart needs.

## Verification

- Test update parsing and policy in unit tests, installers in isolated OS environments, and rollback with old/new file fixtures.
- For an explicitly requested local app build, run `npm run build` then `npm run package:desktop`; report installed version and whether the app was open and needs reopening.
- Do not publish releases or use production signing credentials merely to test package logic.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

This package defines deployment behavior; a scheduled marketing release or app-store submission remains an explicit release action. A rollback requiring a newer incompatible schema needs a documented recovery path, not an unsafe downgrade.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): Repository inspection; see the paths above. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
