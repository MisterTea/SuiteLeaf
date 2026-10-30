---
id: "WP-001"
title: "Capability inventory and parity release gates"
type: "work_package"
status: "ready"
priority: "P0"
phase: 1
area: "quality"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S01", "S02", "S03"]
---

# Capability inventory and parity release gates

## Outcome and rationale

Create an accurate, maintained view of SuiteLeaf capabilities so planning and release claims reflect working workflows rather than menu entries. The README understates current functionality, while the existence of an implementation does not establish interoperability or reliability.

## Existing implementation and starting points

Start with `README.md`, `docs/architecture.md`, `docs/docs-parity.md`, `docs/excel-visual-parity.md`, `docs/workflows.md`, `apps/web/src/App.tsx`, and `tests/`. Current source includes citations, suggestions, forms, admin tools, presentation masters/recording/PPTX export, and collaboration beyond the README's description.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Create a machine-readable capability catalog with stable IDs, supported platforms/modes, UI entry points, file-format support, known limits, verification evidence, and statuses: absent, partial, implemented, verified.
- Separate everyday editor parity, professional desktop Office parity, and enterprise workspace parity. Record the competitor edition/platform and reference date; do not compare every enterprise feature to a basic plan.
- Define representative workflows: report with citations/review, financial workbook with pivots, media presentation, shared project folder, offline trip, employee departure, and disaster recovery.
- Update user documentation after checking behavior; explicitly distinguish native-file preservation, Office conversion, visual fidelity, and calculation correctness.
- Publish release gates and a capability-to-work-package mapping. Inventory coverage tooling and enforce the repository's above-90% unit-coverage requirement without silently excluding new code.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Every advertised feature has a supported mode/platform and linked evidence or an explicit unverified label.
- Existing advanced features are cataloged as extension/hardening work, not duplicated as missing features.
- Release reports identify failed, skipped, unavailable-reference, and inconclusive cases separately from passes.
- The catalog and documentation have a repeatable update/check procedure.

## Verification

- Validate catalog schema and references using a lightweight check.
- Run representative existing tests to establish a dated baseline; record failures without unrelated fixes or invented pass rates.
- Inspect one complete user workflow per editor and distinguish current evidence from historical corpus results.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not promise a percentage of total Office feature parity: there is no defined universal denominator. This package creates evidence and gates, not all downstream feature implementations.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S01`, `S02`, `S03`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
