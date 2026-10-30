---
id: "WP-021"
title: "Advanced spreadsheet analysis and visualization"
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
related_sources: ["S03", "S18"]
---

# Advanced spreadsheet analysis and visualization

## Outcome and rationale

Close common business-analysis gaps beyond the existing basic charts and pivot aggregation.

## Existing implementation and starting points

Existing pivots, chart menus, formula help, named ranges, filter views, grouping, and cleanup live in `apps/web/src/editors/Sheets.tsx` and supporting modules. Current source includes pivot auto-refresh behavior beyond the README's manual-refresh description.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Extend pivot definitions with multiple measures, date grouping, subtotals/grand totals, sorting, calculated fields, slicers, and drill-through to source rows.
- Add structured tables and structured references with automatic expansion and predictable insertion/deletion behavior.
- Implement formula auditing: precedents/dependents, circular-reference explanation, evaluation tracing, and error navigation.
- Add Goal Seek and a bounded Solver interface with supported constraint/objective types, progress, cancellation, numerical tolerances, and explanation when no solution is found.
- Expand charts to prioritized business cases such as stacked/combo, area, histogram, waterfall, and secondary axes; specify labels, legends, accessibility summaries, and print/export support.
- Support linked charts across documents/decks with source permissions, update prompts, last-refresh state, and a snapshot fallback when the source is unavailable.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A sales workbook can group dates, use slicers, drill into totals, and retain its definitions after reopen.
- Table growth updates supported references and chart/pivot sources correctly.
- Goal Seek/Solver fixtures converge within documented tolerances or report infeasibility without changing source inputs unexpectedly.
- Linked charts never expose a source the viewer cannot access; exported snapshots have clear provenance.

## Verification

- Vitest aggregation, structured-reference, solver, auditing, and serialization tests against fixed numeric fixtures.
- Use grid/canvas tests for chart visibility, labels, slicers, and print layout.
- Verify Excel interchange for the supported subset through WP-015 when available.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

A full Power Pivot/DAX multidimensional engine is a separate, larger scope decision. Do not equate a new pivot UI with data-model compatibility.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S03`, `S18`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
