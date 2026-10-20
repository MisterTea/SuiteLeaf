# 14 · Turn a table into a chart

**Mode:** single-node · **App:** Sheets · **Video:** [videos/14-chart-from-a-table.mp4](videos/14-chart-from-a-table.mp4) · **Script:** [scenes/sheets.spec.ts](scenes/sheets.spec.ts)

## Who and why

Priya presents the quarterly studio budget on Friday. A table of numbers won't land with the room; she wants a column chart comparing Budget and Actual for each team, placed next to the table, that stays right when last-minute numbers change.

## Inspired by

- W10 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md) and acceptance scenario 2 in [docs/workflows.md](../docs/workflows.md): select a range with headers, Insert chart, move and resize, charts update from calculated values.
- [How to refresh a chart in Google Sheets](https://www.thebricks.com/resources/guide-how-to-refresh-chart-in-google-sheets): changing a number inside the chart's range updates it instantly; new rows outside the range don't.
- [Google Sheets charts not updating?](https://analysisfix.com/google-sheets-charts-not-updating-heres-what-to-do/): the most common confusion is a fixed data range and numbers stored as text.

## Scenes

1. **Open the budget.** Priya opens the "Sample budget" (Quarterly studio budget: Category, Budget, Actual, Remaining).
2. **Select with headers.** She drags from A1 to C5: the four teams with their Budget and Actual columns, header row included.
3. **Insert chart.** She clicks Insert chart on the toolbar. The panel opens below the toolbar, fills Source range with A1:C5 and suggests "Budget and Actual" as the title. She types "Studio costs by team" and keeps Column / bar.
4. **The chart.** A column chart appears below the table with a Budget/Actual legend in source order, a value axis on round steps (0, 2000 … 12000) and a "Category" axis label.
5. **Move it.** She drags the chart up beside the table, its top level with the header row.
6. **Resize it.** She drags the bottom-right handle inward to make it smaller.
7. **Change the data.** She clicks C3 and updates Engineering's Actual from 10800 to 13500. Remaining shows −1500, and the Engineering Actual bar grows past its Budget bar straight away; the axis rescales to 15000.
8. **Edit later.** She double-clicks the chart. Edit chart opens with its title, Source range A1:C5 and type, ready for when the range needs to grow, and she closes it.

## Success looks like

- An embedded chart titled "Studio costs by team" with eight bars, saved in the workbook beside the table (to the right of column D, starting in the first rows) and smaller than it was created.
- The chart follows the source cells, so the edit to C3 is reflected without any refresh step.
- Double-clicking the chart opens its editor, like Sheets.

## AI version

**Videos:** [web](videos/14-chart-from-a-table-ai.mp4) · [desktop](videos/electron/14-chart-from-a-table-ai.mp4) · **Script:** [scenes/ai/14-chart-from-a-table-ai.spec.ts](scenes/ai/14-chart-from-a-table-ai.spec.ts)

Priya opens the Sample budget and asks the on-device assistant (Gemma 4 E4B) twice:

1. "Make a column chart comparing Budget and Actual for each team, titled "Studio costs by team". Put it beside the table instead of under it, and make it a bit smaller."
2. Later: "Engineering's actual is now 13500."

Gemma uses `insert_chart`, then `edit_chart` to move it (to F1 in most runs, E1 in some) and shrink it, and `set_cells` for C3. In the web recording, the pointer goes to Insert chart, the panel fills in and creates the chart below the table, then the chart jumps up beside the table at F1, 400×280. In this run Gemma first charted A1:C6 (Total row included). The result said the Total row dwarfs the others, so Gemma narrowed the range in the same `edit_chart` call. For the second request it types 13500 into C3; Remaining shows −1500 and the Engineering Actual bar grows past Budget without any refresh. Priya then double-clicks the chart and Edit chart opens on A1:C5. The test checks the saved workbook: one chart titled "Studio costs by team" from A1:C5 with eight bars, to the right of column D and in the first rows, smaller than the 520×340 it was created at, and C3 = 13500. The assistant panel is closed before each look at the chart: with it open the grid is narrower and the chart's right side is cut off.

Fixes made along the way: `edit_chart` placed charts about a column too far left and over the column letters (it subtracted the grid origin twice). It also moved and resized the chart before rejecting a bad range, so it reported an error for a change it had made. Chart results now name the cells a chart covers, the series and labels it plots, a Total row it includes, and whether a resize made it larger or smaller. `insert_chart` defaults to a column chart, and a range that starts just below its header row (A2:C5) is extended to include it.

**How Gemma did:** with the final tools, web passed 2 of 3 runs and desktop 1 of 3; while the tools were being fixed, 2 of 8 web runs passed. Mistakes seen: charting the whole used range (A1:D6) or the Total row (A1:C6) although the request named Budget and Actual for each team, twice on desktop despite the note about totals; starting at A2 without the header row; calling `edit_chart` in the same turn before the chart existed; leaving out the chart type; making the chart larger (600 px wide) when asked for smaller, then saying "as requested"; changing the range to A1:B5 unasked, which dropped Actual; once calling `copy_pivot` after errors and claiming success. The C3 update was right every time.

## Gaps and notes

- At a 1280-pixel-wide window the toolbar no longer overflows. Tools that don't fit fold into a More tools (⋮) button at the right end, which opens them as a floating row, as in Google Sheets. Insert comment, Insert chart, the filter button, and Pivot table fold last, so they stay visible at 1280 pixels and on phones. Charts and pivots are listed under Data → Charts & pivots. The toolbar also stops clipping its own menus: More formats (123) used to open invisibly.
- The chart's range is fixed (A1:C5), like a Sheets chart with a closed range. To include a new team, double-click the chart (or pick it under Data → Charts & pivots), select the new range in the grid, choose **Use selection** and **Update chart**. Here row 6 is the Total row, so extending the range is not part of the story.
- Univer's own drawing menu (the small button at a selected chart's corner) still shows a greyed-out Edit item; double-click and Data → Charts & pivots are the ways to edit.
- Chart styling is basic compared with Sheets' chart editor: there are no per-series colours, axis titles beyond the category label, or data labels, and changes in the panel apply on Update rather than live.
- The "Sheet tools" strip above the toolbar takes a full row for one menu button (not changed here).
