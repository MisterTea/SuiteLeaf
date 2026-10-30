---
id: "WP-035"
title: "Transparent packaging, ownership, and exit"
type: "work_package"
status: "ready"
priority: "P1"
phase: 2
area: "product-policy"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S30", "S27", "S28"]
---

# Transparent packaging, ownership, and exit

## Outcome and rationale

Keep pricing and ownership understandable as hosting/support services develop, avoiding unexpected entitlements, AI bundling, and loss of access to business files.

## Existing implementation and starting points

SuiteLeaf is Apache-2.0, supports account-free local files and self-hosted clusters, and has no required paid editor service in the README. Preserve those existing properties; hosting and support still incur costs.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Publish a stable packaging matrix separating software license, hosting, storage, backups, support, and optional AI/provider costs.
- Document billing/entitlement changes before rollout, cancellation behavior, cost estimation, usage warnings, and export availability. Commercial prices require an explicit product decision, not invented numbers.
- Keep local file reading/editing independent of hosted billing; define a practical read/export grace policy for any future hosted account suspension subject to security obligations.
- Provide complete organization export with file manifests, native/standard formats, ownership/group mappings, and documented portability limits; coordinate actual migration mechanisms with WP-028.
- Expose predictable storage/compute budgets and avoid automatic paid upgrades without an explicit choice.
- Create a public supported-feature matrix with edition/platform distinctions and no hidden AI requirement.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A customer can identify all cost categories and feature entitlements without resolving a chain of unrelated licenses.
- Account-free local editing and previously saved files remain usable after hosted-service cancellation.
- Organization export is documented, testable, and independent of purchasing another premium feature.
- Usage warnings precede any optional paid expansion and explain the effect of declining it.

## Verification

- Review policy scenarios for cancellation, quota exhaustion, AI disabled, ownership transfer, and export.
- Unit-test any entitlement/cost-warning code and verify local mode has no billing dependency.
- Test a complete sample export and reconciliation when export tooling is implemented.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

This is not authorization to introduce billing or change the open-source license. Hosted pricing, support commitments, and commercial policies need explicit product-owner decisions before launch.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S30`, `S27`, `S28`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
