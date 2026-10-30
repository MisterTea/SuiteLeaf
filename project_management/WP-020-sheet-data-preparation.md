---
id: "WP-020"
title: "Spreadsheet queries, connectors, and refresh"
type: "work_package"
status: "ready"
priority: "P1"
phase: 3
area: "spreadsheets"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S18"]
---

# Spreadsheet queries, connectors, and refresh

## Outcome and rationale

Provide repeatable data ingestion and transformation workflows comparable to common Power Query use cases.

## Existing implementation and starting points

SuiteLeaf already imports CSV/TSV and Excel and uses Arquero for pivots. Inspect `apps/web/src/csv-import.tsx`, `apps/web/src/csv.ts`, `apps/web/src/editors/Sheets.tsx`, and the core workbook schema.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Create a versioned query-step model for select/rename/type conversion, filtering, sorting, split/merge, joins, append, grouping, and deduplication with preview and per-step errors.
- Provide initial local CSV/JSON and authenticated HTTP/database connector interfaces; choose a small supported connector set and document credential/network requirements.
- Separate source data, transformations, and output ranges. Store provenance and refresh timestamps without storing credentials in portable workbook JSON.
- Implement manual refresh first, then scheduled server refresh with cancellation, timeouts, retries, concurrency limits, and notifications. Use the common automation job model when WP-031 is available.
- Support parameterized sources, stable schema handling, and review of breaking schema changes; never overwrite unrelated user cells.
- Make expensive work asynchronous and expose progress/diagnostics to WP-022.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A saved query can be reopened and refreshed to reproduce the same transformations.
- Schema drift produces a clear error or explicit remapping, not silent column corruption.
- Credentials do not appear in exports/logs and unauthorized viewers cannot refresh protected sources.
- Refresh failure preserves the last successful output and labels it stale.

## Verification

- Vitest transform fixtures, schema drift, cancellation, output placement, and credential redaction.
- Server integration tests for scheduled refresh and authorization; connector contract tests using local mock services.
- Painted-grid tests only for output visibility and progress layout.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Full Power Query M-language compatibility and every commercial connector are not implied. Define interoperability limits and keep source access opt-in.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S18`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
