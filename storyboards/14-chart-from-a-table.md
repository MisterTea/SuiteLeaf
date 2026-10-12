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

## Gaps and notes

- At a 1280-pixel-wide window the toolbar no longer overflows. Tools that don't fit fold into a More tools (⋮) button at the right end, which opens them as a floating row, as in Google Sheets. Insert comment, Insert chart, the filter button, Pivot table and Charts & pivots fold last, so they stay visible at 1280 pixels and on phones. The toolbar also stops clipping its own menus: the Charts & pivots list and More formats (123) used to open invisibly.
- The chart's range is fixed (A1:C5), like a Sheets chart with a closed range. To include a new team, double-click the chart (or pick it under Charts & pivots), select the new range in the grid, choose **Use selection** and **Update chart**. Here row 6 is the Total row, so extending the range is not part of the story.
- Univer's own drawing menu (the small button at a selected chart's corner) still shows a greyed-out Edit item; double-click and Charts & pivots are the ways to edit.
- Chart styling is basic compared with Sheets' chart editor: there are no per-series colours, axis titles beyond the category label, or data labels, and changes in the panel apply on Update rather than live.
- The "Sheet tools" strip above the toolbar takes a full row for one menu button (not changed here).
