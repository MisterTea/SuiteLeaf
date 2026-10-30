---
id: "WP-015"
title: "Excel formula and workbook compatibility"
type: "work_package"
status: "blocked"
priority: "P0"
phase: 1
area: "spreadsheets"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: true
blocked_on: ["WP-012"]
related_sources: ["S03", "S18"]
---

# Excel formula and workbook compatibility

## Outcome and rationale

Make Excel interchange trustworthy for supported formulas, workbook resources, and recalculation rather than relying on cached imported results.

## Existing implementation and starting points

Inspect `packages/core/src/excel.ts`, `packages/core/src/excel-features.ts`, `packages/core/src/xlsx-export.ts`, `packages/core/src/sheet-links.ts`, `apps/web/src/editors/Sheets.tsx`, Univer integration, and existing Excel corpus workflows.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Publish a function/feature compatibility catalog with tested arguments, locale/date-system semantics, errors, arrays/spills, named formulas, structured references, and external-link behavior.
- Compare imported cached values to fresh recalculation after representative edits; make stale/unsupported calculations visible.
- Preserve styles, validation, conditional rules, names, tables, charts, drawings, hidden sheets, print settings, and supported pivot metadata through native/Office round trips.
- Define safe handling of VBA/XLSM, external links, add-ins, and data connections. Preserve nonexecuted macro payloads only if safe and explicitly supported; otherwise warn about their loss.
- Cover binary formats and large workbooks with explicit capacity/error handling; ensure worksheet identities survive changes and exports.
- Expose formula auditing hooks for precedents/dependents, evaluation errors, and compatibility reports.

## Dependencies and delivery

Completion is blocked on `WP-012`. Design and isolated prototypes may proceed, but do not bypass the prerequisite contracts or release gates.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Supported formula fixtures match documented reference results after changing inputs and reopening exports.
- An unsupported function never silently appears as a trustworthy current cached result.
- Cross-sheet references, date systems, dynamic arrays, validation, and hidden-sheet behavior have explicit verified cases.
- Macro/external-link behavior is documented and cannot execute automatically during import or test runs.

## Verification

- Vitest for formula semantics, serializations, rules, dates, reference relocation, and error cases.
- Reference Excel recalculation for differential values; painted-grid tests for displayed results and charts.
- Include large sparse workbooks and a capacity-limit case without claiming every theoretical Excel limit.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Power Query-like ingestion is WP-020; advanced analytical features are WP-021. Native VBA execution and COM/add-in compatibility require separately approved scope and are not implied here.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S03`, `S18`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
