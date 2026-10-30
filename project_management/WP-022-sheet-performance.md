---
id: "WP-022"
title: "Spreadsheet performance diagnostics and capacity"
type: "work_package"
status: "ready"
priority: "P1"
phase: 3
area: "performance"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S22", "S23"]
---

# Spreadsheet performance diagnostics and capacity

## Outcome and rationale

Keep large workbooks responsive and explain which formulas, ranges, rules, or imports consume time and memory.

## Existing implementation and starting points

Inspect Univer integration in `apps/web/src/editors/Sheets.tsx`, import workers, core Excel parsing, and `apps/web/src/library-search.ts`, which already bounds collected searchable text. Existing import limits are capacity controls, not performance guarantees.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Build a benchmark corpus covering dense/sparse data, long dependency chains, volatile formulas, repeated imports, many conditional rules, charts, and large paste operations.
- Instrument load, parse, recalculate, render, serialize, save, and refresh separately; attach timings to workbook features without collecting cell contents by default.
- Provide a performance inspector identifying expensive formulas/ranges/rules, repeated work, and actionable changes. Show measurements rather than generic guesses.
- Move appropriate expensive work off the interaction thread, use incremental invalidation, and add cancellation/progress with safe rollback or preserved prior output.
- Define documented capacity tiers and measured latency/memory budgets per representative hardware/browser; make failures explicit before resource exhaustion.
- Offer a route to query-backed workflows when data no longer fits interactive spreadsheet usage.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- A slow fixture identifies its dominant measured cost and provides a useful action.
- Long-running import/recalculation/refresh can be cancelled without losing the last saved workbook.
- Benchmark results record dataset, hardware, runtime, and version and detect regressions.
- No fixed speedup is claimed without before/after evidence.

## Verification

- Unit-test instrumentation and cancellation state; run reproducible performance benchmarks separately from ordinary unit timing assertions.
- Use painted-grid interaction/layout tests for responsiveness and progress behavior.
- Test memory/capacity limits with sparse and dense fixtures.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Performance work must preserve calculation correctness. Do not silently lower precision, drop styles, or display stale values as a speed optimization.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S22`, `S23`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
