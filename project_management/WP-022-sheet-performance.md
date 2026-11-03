---
id: "WP-022"
title: "Spreadsheet performance diagnostics and capacity"
type: "work_package"
status: "in_progress"
priority: "P1"
phase: 3
area: "performance"
created: "2026-10-29"
updated: "2026-10-30"
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

# Progress

2026-10-30: In progress. `packages/core/src/sheet-cost.ts` walks sheets and reports counts of cells, formulas, volatile formulas (`NOW`, `RAND`, `RANDBETWEEN`, `TODAY`, `OFFSET`, `INDIRECT`), conditional rules, and charts, plus how long that walk took. The report does not include cell values. The largest weighted count is named with an action. A stop function ends the walk. The scan only reads, so the workbook object is unchanged. `tests/sheet-cost.test.ts` passed (2 tests). Limits are in `docs/sheet-performance.md`.

2026-10-30, later: the spreadsheet toolbar button Cost shows `SheetCostNote` for the open workbook. The note lists the same counts and says the pass does not time recalculation. A cell value is not shown. `npx vitest run tests/ui/sheet-cost-note.test.tsx` passed (1 test). The web app typecheck passed. The button was not clicked in the browser.

This does not time Univer recalculation, import, or painting, and it records no hardware benchmark. No speedup is claimed.

2026-10-31: `runCancellable` stops before the first step and returns the saved workbook whose only cell is `A1`. That object is not given an `A2` cell. A finished one-step pass returns a new workbook with `A2` and leaves the saved one unchanged. The record for dataset `beds` stores hardware `test-machine`, runtime `node`, and version `0.0.0-test`. An empty hardware string is `not recorded`. A later pass of 30 ms after 10 ms on the same dataset and version is a regression. A shorter pass is not called a speedup. A cancelled pass is not a regression. `npx vitest run tests/sheet-benchmark.test.ts tests/sheet-cost.test.ts` passed (3 tests). The elapsed time is this pass, not Univer recalculation. No speedup is claimed.

2026-10-31, later: `refreshQuery` stops before the filter step and returns the last saved North Tomato row, marked stale. The error is "The refresh was cancelled." The source still has the South Bean row. `npx vitest run tests/sheet-query.test.ts` passed (11 tests). This does not time Univer recalculation. No speedup is claimed. The Cost button was not clicked in the browser.

2026-10-31, later: `importKeepingSaved` discards an imported workbook whose only cell is `secret-value` when stop becomes true during the load. The result is the saved workbook whose cell is `Tomato`. Opening `secret-value.xlsx` with a stop that is already true returns the saved spreadsheet `Beds` and does not replace it. `npx vitest run tests/sheet-benchmark.test.ts` passed (2 tests). The Excel parser is not interrupted in the middle of a file. No speedup is claimed. The spreadsheet was not opened in the browser.

2026-10-31, later: `cellsToRecalculate` names `B1` and `C1` when `B1` is `=A1` and `C1` is `=B1`. `D1`, which is `=E1`, is left out. The result does not contain `secret tomato`, and that cell stays on the sheet. A cycle of `A1` and `B1` lists each cell once. `SUM(A1:A80)` is included for a change to `B1` as well, and marked unlisted, because that range is not enumerated. `npx vitest run tests/sheet-invalidation.test.ts` passed (1 test). This pass does not calculate the formulas. No speedup is claimed. The spreadsheet was not opened in the browser.

2026-11-01: stopping `cellsToRecalculate` returns `{ cells: [], unlisted: false, cancelled: true }`. That empty list is not a claim that no formula reads `A1`. The result does not contain `secret tomato` or `=A1`. The sheet still has `secret tomato`. Without the stop, `B1` and `C1` are still listed. `npx vitest run tests/sheet-invalidation.test.ts` passed (4 tests). This pass does not calculate the formulas. No speedup is claimed. The spreadsheet was not opened in the browser. The painted grid was not used.

2026-10-31, later: the formula audit panel lists `Recalculate: A1, B1.` when `A1` is `=B1` and `B1` is `=A1`. The line does not include `secret tomato`. `npx vitest run tests/ui/sheet-audit-note.test.tsx tests/sheet-invalidation.test.ts` passed (2 tests). This pass does not calculate the formulas. No speedup is claimed. The audit panel was not opened in the browser. The painted grid was not used.

2026-10-31, later: `timeWorkbookPhases` records load and parse, then stops. Recalculate, render, serialize, save, and refresh are skipped. A parse function that throws is failed, and the record does not contain `secret-value`. `npx vitest run tests/sheet-benchmark.test.ts` passed (3 tests). These times are the functions supplied to the test. They are not Univer recalculation or painting. No speedup is claimed. The spreadsheet was not opened in the browser. The painted grid was not used.

2026-10-31, later: `recalculateDirty` copies a direct reference. `A1` is `secret tomato`, `B1` is `=A1`, and `C1` is `=B1`, so both become that value. `SUM(A1:A80)` stays `4`. A cycle of `A1` and `B1` stays `North` and `South`. The address list does not contain `secret tomato`. The sheet passed in is not changed. `npx vitest run tests/sheet-invalidation.test.ts tests/ui/sheet-audit-note.test.tsx` passed (3 tests). The audit panel still says this pass does not calculate the formula. The panel was not opened. This is not Univer recalculation. No speedup is claimed. The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: `recalculateDirty` adds a `SUM` whose range is small enough to list. `A1` is `10` and `A2` is `5`, so `=SUM(A1:A2)` becomes `15`. `B1` is `=A1`, so `=SUM(A1:B1)` becomes `20`. `A3` is `secret-value`, so `=SUM(A1:A3)` stays `4`. `=SUM(A1:A80)` stays `4`. The address lists do not contain `secret-value`. The sheet passed in is not changed. `npx vitest run tests/sheet-invalidation.test.ts tests/ui/sheet-audit-note.test.tsx` passed (5 tests). The audit panel still says this pass does not calculate the formula, and it was not opened. This is not Univer recalculation. No speedup is claimed. The spreadsheet was not opened in the browser. The painted grid was not used.

2026-11-01: the formula audit panel names the cells `recalculateDirty` calculates and the cells it leaves. A cycle of `A1` and `B1` shows `Calculated: none. Left: A1, B1.` `B1` as `=A1` shows `Calculated: B1.` `=SUM(A1:A80)` shows `Left: C1.` The panel does not show `10` or `secret-value`, and it does not write the new value back onto the sheet. `npx vitest run tests/ui/sheet-audit-note.test.tsx tests/sheet-invalidation.test.ts` passed (6 tests). The panel was not opened in the browser. This is not Univer recalculation. No speedup is claimed. The spreadsheet was not opened. The painted grid was not used.

2026-11-01: the same pass calculates `=SUM(Sales[Revenue])` when the table is included. The returned cell is `35` and the formula text stays `=SUM(Sales[Revenue])`. The audit panel says `Calculated: D1.` and does not show `35` or `secret-value`. `npx vitest run tests/sheet-invalidation.test.ts tests/ui/sheet-audit-note.test.tsx` passed (8 tests). The panel was not opened in the browser. This is not Univer recalculation. No speedup is claimed. The spreadsheet was not opened. The painted grid was not used.

2026-11-01: `expensiveFormulas` lists `=SUM(A1:A80)` as `C1` with 80 cells. `=A1` is left out. A quoted `secret-value` and a cell value `secret-value` are not in the list. `npx vitest run tests/sheet-benchmark.test.ts` passed (4 tests). This does not calculate the formula. This is not Univer recalculation. No speedup is claimed. The spreadsheet was not opened. The painted grid was not used.

2026-11-01: the spreadsheet cost note lists that wide formula as `Wide formulas: C1 names 80 cells.` A sheet with only `=NOW()` says `No formula names 64 cells or more.` The formula text and `secret-value` are not shown. `npx vitest run tests/ui/sheet-cost-note.test.tsx tests/sheet-benchmark.test.ts` passed (6 tests). The note was not opened in the browser. This is not Univer recalculation. No speedup is claimed. The painted grid was not used.

2026-11-01: the same note lists `=NOW()` as `Volatile formulas: B1.` A quoted `NOW()` is not listed, so C1 is not in that sentence. The cell value `secret tomato count` is not shown. `npx vitest run tests/ui/sheet-cost-note.test.tsx tests/sheet-benchmark.test.ts` passed (6 tests). The note was not opened in the browser. This is not Univer recalculation. No speedup is claimed. The painted grid was not used.

2026-11-01: volatile addresses are listed by column, then by row. `TODAY()` in A2, `RAND()` in A10, and `NOW()` in B1 read `Volatile formulas: A2, A10, B1.` A10 does not come before A2. A quoted `NOW()` is still not listed. The cell value `secret tomato count` is not shown. `npx vitest run tests/ui/sheet-cost-note.test.tsx tests/sheet-benchmark.test.ts` passed (6 tests). The note was not opened in the browser. This is not Univer recalculation. No speedup is claimed. The painted grid was not used.

2026-11-01: a workbook of at most 50,000 stored cells is an interactive spreadsheet. From 50,001 through 200,000 cells it is in the large tier. Past 200,000 cells, recalculation, painting, and refresh do not start, and the function that would have returned `secret-value` is not called. A count that is not a whole number is refused and is not repeated. These counts are not a measured latency or memory budget. The cost note says `Interactive spreadsheet.` for the open workbook and does not show `secret tomato count`. `npx vitest run tests/sheet-capacity.test.ts tests/sheet-benchmark.test.ts tests/ui/sheet-cost-note.test.tsx` passed (10 tests). The note was not opened in the browser. This is not Univer recalculation. No speedup is claimed. The painted grid was not used.

2026-11-01: a later pass is a regression only when the dataset, hardware, runtime, and version match and the time is more than twice as long. Ten milliseconds then 30 milliseconds says `This pass took 30 ms after 10 ms.` A dataset named `secret-value` is not in that sentence. A different computer is not a regression, and that sentence does not repeat `secret-value`. `npx vitest run tests/sheet-benchmark.test.ts` passed (4 tests). This is not Univer recalculation. No speedup is claimed. The spreadsheet was not opened. The painted grid was not used.

2026-11-01: a workbook of 50,001 stored cells is in the large tier, and the cost note offers Open the query panel. Choosing it calls the opener. An interactive workbook does not show that button. A cell value is not in the note. The spreadsheet cost control in the editor passes that opener through to the query panel. `npx vitest run tests/ui/sheet-cost-note.test.tsx` passed (3 tests). The note was not opened in the browser. This is not Univer recalculation. No speedup is claimed. The painted grid was not used.

2026-11-01: a failed workbook phase skips the phases after it. When parse throws `secret-value`, recalculate is not called. That word is not stored. The parse phase is failed, and recalculate is skipped. `npx vitest run tests/sheet-benchmark.test.ts tests/sheet-capacity.test.ts` passed (8 tests). This is not Univer recalculation. No speedup is claimed. The painted grid was not used.

2026-11-01: a sheet with no name is called Sheet in the cost scan. The sheet id is not used. `npx vitest run tests/ui/sheet-cost-note.test.tsx` passed (3 tests). The spreadsheet was not opened in the browser. The painted grid was not used. This is not a measured latency or memory budget.

2026-11-01: the cost note names the longest measured phase when those times are supplied. Parse at 4 ms and recalculate at 30 ms says `The longest measured phase is recalculate at 30 ms.` A failed render is left out. A phase named `secret-value` is left out, and that word is not in the note. Without phase times, the note still says this pass does not time recalculation. `npx vitest run tests/ui/sheet-cost-note.test.tsx -t "longest measured"` passed. The spreadsheet was not opened. The painted grid was not used. This is not a speedup claim.

2026-11-01: Goal Seek can be stopped while it is running. Stop sets the flag the search reads. The status says `The search stopped. The input cell was put back.` and does not name the formula cell. The spreadsheet passes that flag into the seek and the solver. `npx vitest run tests/ui/sheet-goal-panel.test.tsx -t "stops a search"` passed. The spreadsheet was not opened. The painted grid was not used. This check did not run a formula. This is not a speedup claim.

2026-11-01: when a workbook has more than one sheet, a volatile formula is named with its sheet. `NOW()` on a sheet named `secret-value` is `another sheet B1`, and `TODAY()` on Fees is `Fees A1`. The cell value stays on the sheet. A workbook with one sheet still lists the cell alone. `npx vitest run tests/ui/sheet-cost-note.test.tsx` passed (5 tests). The note was not opened in the browser. This is not Univer recalculation. No speedup is claimed. The painted grid was not used.

2026-11-01: a formula that names a whole column is listed as a wide formula. `=SUM(A:A)` in A1 counts as 10000 cells. A quoted `A:A` is not counted. The formula text is not in the list, and `secret-value` is not in the list. `=SUM(A1:A80)` still counts as 80 cells. `npx vitest run tests/sheet-benchmark.test.ts -t "whole column"` passed (1 test). The spreadsheet was not opened. The painted grid was not used. This is not a speedup claim. This does not calculate the formula.

2026-11-01: a formula that names a whole row is listed as a wide formula. `=SUM(1:1)` in A1 counts as 10000 cells. A quoted `1:1` is not counted. `=SUM(A1:B2)` still counts as 4 cells. The formula text is not in the list, and `secret-value` is not in the list. `npx vitest run tests/sheet-benchmark.test.ts -t "whole row"` passed (1 test). The spreadsheet was not opened. The painted grid was not used. This is not a speedup claim. This does not calculate the formula.

2026-11-01: cancelling an import keeps the saved spreadsheet. A loaded file titled `secret-value` is discarded, and that word is not in the result. With no saved spreadsheet the notice is `Import cancelled. The original file is unchanged.` Cancel import sets that stop while an import is running. `npx vitest run tests/office-import-cancel.test.ts` passed (1 test). The import menu was not opened. This does not interrupt the Excel parser in the middle of a file. No speedup is claimed.

2026-11-02: a delimited file that cannot be read says `That delimited file could not be read.` An unclosed quote around `secret-value` does not put that word in the notice. `npx vitest run tests/core.test.ts -t "detects or overrides the separator"` passed (1 test) at 02:31:26. The import menu was not opened. No speedup is claimed.

2026-11-02: a sheet name that breaks across lines is listed as another sheet. `NOW()` on that sheet is `another sheet B1`, and `TODAY()` on Fees stays `Fees A1`. The stored name stays `Garden` and the rest of that name. `npx vitest run tests/ui/sheet-cost-note.test.tsx -t "breaks across lines"` passed (1 test) at 06:47:54. The cost note was not opened in the browser. This is not Univer recalculation. No speedup is claimed. The painted grid was not used.
