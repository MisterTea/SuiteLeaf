---
id: "WP-007"
title: "Explainable sharing and safe permission changes"
type: "work_package"
status: "ready"
priority: "P0"
phase: 2
area: "administration"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S09", "S10", "S11"]
---

# Explainable sharing and safe permission changes

## Outcome and rationale

Help people understand who has access and why, and prevent folder moves or group changes from unexpectedly broadening access.

## Existing implementation and starting points

SuiteDrive already has inherited ACLs, user/organization sharing, expiry UI, and nested groups. Inspect `crates/suitedrive/src/lib.rs`, `crates/suiteleaf-node/src/admin_api.rs`, `apps/web/src/drive/ShareDialog.tsx`, and `apps/web/src/drive/roles.ts`.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Implement one authoritative effective-access evaluator and an explanation endpoint showing direct grants, folder inheritance, nested membership, expiry, and administrative access.
- Add person-centric and file-centric access inspection, with restricted visibility of group membership information.
- Provide preview/dry-run for folder moves, share changes, and group membership updates showing users gaining/losing access. Revalidate the preview at commit time.
- Define restricted-subfolder behavior and conflict precedence explicitly; do not introduce ambiguous deny semantics. Preserve existing policies through versioned migrations.
- Add expiring guest workflows, external-sharing review, and before/after audit records. Honor revocation in live sessions, search, and APIs.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- For direct, inherited, nested-group, expired, and restricted access, the displayed explanation matches the server authorization decision.
- A move preview accurately predicts access changes and refuses stale approval when the policy changes underneath it.
- Cycles in nested groups terminate safely and produce actionable diagnostics.
- Sharing-policy migrations produce a reviewable impact report and a rollback/recovery plan.

## Verification

- Rust permission-matrix and property tests; Vitest/jsdom explanation and preview tests.
- Test unauthorized users cannot enumerate hidden files or membership via explanations.
- Test revocation behavior across nodes and live sessions against documented consistency bounds.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

This extends existing sharing rather than replacing it. Legal holds, retention, and sensitive-data policies belong to WP-032.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S09`, `S10`, `S11`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
