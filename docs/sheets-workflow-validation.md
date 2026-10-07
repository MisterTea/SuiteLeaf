# Sheets workflow validation

Google Sheets is the reference application for this comparison. Each round is performed by a fresh subagent; an agent does not run a second product iteration.

## Workflow and acceptance criteria

The scenario comes from `docs/workflows.md`, acceptance scenarios 2–3, and chapter 1 of the local Kenneshaw *Ultimate Guide to Google Sheets* (PDF pages 14–18). It uses original budget data:

| Category | Budget | Actual |
| --- | ---: | ---: |
| Housing | 1200 | 1150 |
| Food | 500 | 425 |
| Transport | 300 | 280 |
| Utilities | 200 | 175 |

The Remaining column subtracts Actual from Budget. Row 6 sums the four categories. Headers are bold and monetary cells use dollar formatting. A column chart uses A1:C5; a filter uses A1:D5. Updating Food actual to 450 changes the totals from 2200 / 2030 / 170 to 2200 / 2055 / 145. Save/reopen must retain formulas, formatting, chart and filter.

Parity here means equivalent results and usable controls for these operations. The applications retain their own fonts, colors, toolbar layouts, and chart tick spacing. Sorting, applied filter criteria, chart resizing, other chart types and broader Sheets functionality are not covered by this video comparison.

## Round 1 findings and fixes

The first round found an empty chart when its numeric source had currency formatting. The Univer facade's `getValues()` reads intercepted cell values; numeric formatting can turn them into strings. Analysis now reads `getRawValues()` and carries source number formats separately into chart axis and tooltip labels. CSV export likewise uses calculated raw values, preserving the documented numeric export contract.

Additional chart improvements infer a title from series headers, retain source series order in the legend, label the category axis, and place new charts below existing table rows using their actual pixel heights. A named Create a filter / Remove filter control exposes toggle state and follows the active worksheet.

Local evidence is in `artifacts/sheets-workflow/round-1/report.md`, with reference and SuiteLeaf MP4s, extracted frames, and the original native workbook. Recording limitations and excluded contaminated attempts are described in each round's report.

## Verification

`tests/browser/sheets-workflow.spec.ts` checks eight visible bars from the currency-formatted budget, monetary chart labels, header-derived title, series order, non-overlapping chart placement, recalculated totals, filter persistence and removal, save/reopen, and numeric pivot aggregation from formatted source cells. It passes in Chromium and WebKit.

The existing Chromium spreadsheet scenarios also pass: formulas/chart/pivot persistence, common formula categories, and CSV import/export. Type checking, linting, the web build, and the existing 32 unit tests pass.

Round 2's independently recorded comparison and its scope/recording limitations are in `artifacts/sheets-workflow/round-2/report.md`. The automated checks supplement the MP4 review; they do not establish feature-wide equivalence with Google Sheets.

The second round found no remaining functional discrepancies in this scoped workflow. It independently measured the Food Actual bar increasing after the edit while the other seven bars stayed unchanged, and verified the final formula totals and A1:D5 filter in the clean native export. Final MP4s are `artifacts/sheets-workflow/round-2/google-sheets.mp4` and `artifacts/sheets-workflow/round-2/suiteleaf.mp4`.
