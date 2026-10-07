# Sheets workflow comparison — round 1

Google Sheets is the ground truth, as clarified by the user. No product iteration or source changes were made by this subagent.

## Manual-derived scope

`docs/workflows.md` acceptance scenarios 2–3: budget entry, formulas, formatting, chart creation and data updates, save/reopen. The Kenneshaw *Ultimate Guide to Google Sheets* chapter 1 (PDF pages 14–18) covers entering tabular data, bold headings, currency formatting, and SUM. Original synthetic budget content was used.

Data: Housing 1200/1150; Food 500/425; Transport 300/280; Utilities 200/175. Columns Category, Budget, Actual, Remaining. D2:D5 subtract actual from budget; row 6 sums rows 2–5. Initial totals 2200/2030/170. Updating C3 to 450 produces 2200/2055/145. A1:D1 bold; B2:D6 currency. Column chart source A1:C5; filter source A1:D5. Both workbooks were reopened from their URLs.

## Authentic recordings

- `google-sheets.mp4`: real signed-in Google Sheets in Brave, 82.2 seconds. Starts from a prefilled workbook; shows bold/currency formatting, chart creation, C3 update, filter creation and reopen. The initial real entry is in `failed-contaminated-attempt.mp4`; Chrome was concurrently manipulated by unrelated activity, so that recording is explicitly excluded as clean comparison evidence.
- `suiteleaf.mp4`: real SuiteLeaf at the current-source dev server localhost:5173 in Brave, 135.5 seconds. Shows workbook creation, table/formulas entry, formatting, chart, update, filter, reopen, and native export.
- A data-entry replay in the clean Google recording pasted repeated column A data because native clipboard use was contaminated. The wrong paste and filter were undone; the restored reference data/chart and final filter were verified. This was a recording recovery attempt, not a product discrepancy. Thus these videos are authentic but do not have identical starting states or step timing.
- Native screen capture included the full desktop and occasional unrelated Chrome tab strip behind Brave. It does not substitute simulated Google UI.

Google workbook: https://docs.google.com/spreadsheets/d/1iX7R8yeE6JSjUMqCNqR2X9BHe8j28STGdJm264Dei5g/edit
SuiteLeaf local workbook: http://127.0.0.1:5173/#/file/e83bb13a-edc8-4b33-8c6e-7cf38615d7f6

## Findings

| Observation | Google Sheets | SuiteLeaf baseline | Assessment |
| --- | --- | --- | --- |
| Formula totals and update | 2200/2030/170 → 2200/2055/145 | Same | Match |
| Bold heading and currency cells | Applied | Applied | Match |
| Column chart from currency source | Four categories, two numeric series, visible bars | Categories and legend visible, no bars or numeric Y axis | Functional defect |
| Currency chart axis | Dollar values with two decimals | Missing numeric axis; formatting unavailable in baseline chart | Functional display discrepancy |
| Default chart title | Budget and Actual inferred from series | Chart; manually renamed for comparison | Feature gap |
| Chart insertion placement | Below the source table | Over source cells and totals | Workflow usability discrepancy |
| Legend series order | Budget, Actual (source order) | Actual, Budget | Presentation discrepancy |
| Filter creation and persistence | Works | Works | Match |
| Accessible filter toolbar control | Named Create a filter / Remove filter | Unnamed image container; coordinate click needed | Accessibility discrepancy |
| Reopen | Data/formulas/format/chart/filter retained | Data/formulas/format/chart/filter retained; chart still empty | Persistence matches; chart defect persists |

Visual styles (font, colors, ribbon, chart size) differ; those differences alone are not defects. Sort, actual filter criteria, chart resizing, pivots, imports, and broader formula categories were not exercised in this scoped round, so no zero-discrepancy claim applies to them.

## Evidence and next round

`google-chart.png` is extracted at 31 seconds; `suiteleaf-chart.png` at 65 seconds. `google-reopened.png` and `suiteleaf-reopened.png` capture later persisted states. `baseline.suiteleaf` is the genuine native export: cell values are numeric (1200, 1150, etc.), formula caches numeric, currency formats stored in styles, filter resource retained, and chart source A1:C5 retained.

The chart renderer accepts only JavaScript numeric values; formatted facade values plausibly become strings. Parent confirmed from Univer implementation that `getValues` reads intercepted/formatted cells whereas `getRawValues` reads raw matrix values. Use raw numeric data for analysis while carrying number formatting separately into axes/tooltips. Preserve source order in legend, derive a title from series, and place new charts below their data. A new subagent must verify fixes in a new round, as requested by the user.
