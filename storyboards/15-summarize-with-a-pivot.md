# 15 · Summarize spending with a pivot table

**Mode:** single-node · **App:** Sheets · **Video:** [videos/15-summarize-with-a-pivot.mp4](videos/15-summarize-with-a-pivot.mp4) · **Script:** [scenes/sheets.spec.ts](scenes/sheets.spec.ts)

## Who and why

Ana and Ben log every shared household expense: date, category, who paid, amount. At the end of the month they want one small table showing how much went to each category and who paid, without writing SUMIFS formulas.

## Inspired by

- Acceptance scenario 4 in [docs/workflows.md](../docs/workflows.md) and W11 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): group, aggregate, refresh after a source change, make an editable copy.
- [Google Docs Editors Help: Create & use pivot tables](https://support.google.com/docs/answer/1272900): select data where each column has a header, Insert › Pivot table, add Rows and Values.
- [r/googlesheets: Pivot table help with expense tracking](https://www.reddit.com/r/googlesheets/comments/1g9q6t0/pivot_table_help_with_expense_tracking_just_need/) and [Summing up dropdowns](https://www.reddit.com/r/googlesheets/comments/1sly7vc/summing_up_dropdowns/): "You could use a pivot table of course. That would be the easiest solution."

## Scenes

1. **Open the log.** "Household expenses" has twelve rows: Date, Category, Paid by, Amount. Ana formats the Amount column as currency.
2. **Insert › Pivot table.** Ana selects A1:D13 and chooses Insert › Pivot table. The panel's Source range reads A1:D13.
3. **Set it up.** Title "October by category"; Rows: Category; Columns: Paid by. Value field is already Amount (the first numeric column) and Summarize by is SUM.
4. **Create.** A new tab "October by category" opens, with a lock on its tab and a bar above the grid: "Pivot table from Sheet1 A1:D13 · Updates when the source changes", with Edit, Refresh and Make editable copy. It shows Category down the side, Ana and Ben across the top, and a bold Grand Total row and column, all in the source's dollar format. Groceries is $245.05 for Ana, $117.80 for Ben, $362.85 in total; the overall total is $760.74.
5. **Fix a typo in the source.** Back on Sheet1, Ben corrects the Oct 1 grocery run from $84.20 to $148.20.
6. **The pivot follows.** Back on the pivot tab there is nothing to refresh: Ana's Groceries is already $309.05 and the overall total $824.74.
7. **Editable copy.** Make editable copy creates a plain worksheet, "October by category (copy)", with the same numbers, bold header and totals, and dollar format. Ana types a note beside Groceries.

## Success looks like

- A protected pivot worksheet grouping by Category and Paid by, with correct sums, grand totals, and the source's number format.
- After the source correction, the pivot shows the new totals without a manual refresh. Undoing the correction puts the pivot back too.
- A third, unprotected worksheet holds a detached, formatted copy of the results that can be annotated.

## Gaps and notes

- Pivots update when cells on their source worksheet change. A pivot whose source is another pivot's output still needs Refresh after the first pivot changes. Pivots saved by an older version that are out of date update on the next source edit or Refresh.
- Grand totals are always shown; there is no "Show totals" toggle like the one in Sheets.
- Opening Charts & pivots replaces the formatting toolbar with the list of charts and pivots. The toolbar comes back when the list is closed. The pivot bar avoids that list for this storyboard.
- Field pickers are multi-select list boxes ("Use Command / Ctrl to select several fields"), not the drag-and-drop field editor that Sheets and Excel users expect.
