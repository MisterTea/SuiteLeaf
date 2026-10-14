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

## AI version

**Videos:** [web](videos/15-summarize-with-a-pivot-ai.mp4) · [desktop](videos/electron/15-summarize-with-a-pivot-ai.mp4) · **Script:** [scenes/ai/15-summarize-with-a-pivot-ai.spec.ts](scenes/ai/15-summarize-with-a-pivot-ai.spec.ts)

Ana opens the same twelve-row "Household expenses" log, with Amount still plain numbers. She asks the on-device assistant (Gemma 4 E4B):

*Can you summarize our October spending by category, split by who paid? Call it October by category, and show the amounts in dollars.*

Ben then fixes the Oct 1 typo by hand ($84.20 to $148.20) and Ana checks the pivot herself. Then she asks again:

*I'd like to add my own notes next to this summary. Can you give me a copy I can edit?*

**Tools Gemma used:** `create_pivot` with rows Category, columns Paid by, value Amount, SUM, title "October by category", and usually `number_format: "currency"`. That formats the source amounts D2:D13, and the pivot uses the source's format. On desktop it left out `number_format` and followed up with `format_cells` on the pivot sheet. A pivot sheet is read-only, so the tool formats the source numbers the pivot follows. For the second request it called `copy_pivot` with the pivot's title. There were no reads and no extra calls.

**What the recording shows:** Gemma's pointer goes to the Pivot table button, then over the Amount column as it turns to dollars, then back to the button. The Insert pivot table panel opens filled in and creates the summary on its own locked tab, with the pivot bar above the grid. Categories run down the side, Ana and Ben across the top, and the bold Grand Total row and column are in dollars. Groceries shows $245.05, $117.80 and $362.85, and the overall total is $760.74. Ben types 148.2 into D2 on Sheet1. Back on the pivot, Ana's groceries already read $309.05 and the total $824.74, with no Refresh. For the copy, the pointer points at the new "October by category (copy)" tab, which has no lock and no pivot bar. Ana types "Includes the big Oct 1 shop" in E3 beside Groceries. The test saves the workbook three times (Download, or Save As on desktop) and checks the following:
- The pivot's layout, sums and grand totals.
- That the pivot sheet is protected.
- The dollar pattern and the bold header.
- The corrected totals.
- That the copy is unprotected, has the same numbers and format, and keeps the note.

After the model loads (6–10 s), the first request takes 20–27 s on the web and 22 s on desktop. The copy takes 4–7 s.

**How Gemma did:** With the final code, the web recording passed 3 of 3 runs and desktop (llama.cpp) passed 1 of 1. Across the 8 web recordings made along the way, 5 passed. Model mistakes seen:
- In the first run, before the tool descriptions explained columns, it put both Category and Paid by in rows. It also added a filter "Date = October", although the dates read "Oct 1"… The result was "No matching data", which it reported as a finished summary. The tool now refuses a filter that matches no rows and lists the column's values.
- In most runs it sends `filter_column` (Date or Category) with no `filter_value`. This is now ignored instead of being treated as an empty filter.
- Twice it left out the dollars and told Ana she "may want to apply currency formatting". The second time, the tool result had just said how to do it. Both runs were before `format_cells` worked on pivot sheets.

## Gaps and notes

- Pivots update when cells on their source worksheet change. A pivot whose source is another pivot's output still needs Refresh after the first pivot changes. Pivots saved by an older version that are out of date update on the next source edit or Refresh.
- Grand totals are always shown; there is no "Show totals" toggle like the one in Sheets.
- Opening Charts & pivots replaces the formatting toolbar with the list of charts and pivots. The toolbar comes back when the list is closed. The pivot bar avoids that list for this storyboard.
- Field pickers are multi-select list boxes ("Use Command / Ctrl to select several fields"), not the drag-and-drop field editor that Sheets and Excel users expect.
