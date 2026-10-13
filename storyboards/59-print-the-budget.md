# 59 · Print the budget

**Mode:** single-node · **App:** Sheets · **Video:** [videos/59-print-the-budget.mp4](videos/59-print-the-budget.mp4) · **Script:** [scenes/59-print-the-budget.spec.ts](scenes/59-print-the-budget.spec.ts)

## Who and why

Rosa needs a paper copy of the rent budget for the meeting. The header row says Month, Rent, and Paid. The months fill two pages. Today, File › Print prints the grid, and page 2 starts in the middle of a month with no header, so nobody can tell which column is Paid.

## Inspired by

- [Print a spreadsheet](https://support.google.com/docs/answer/183965): File › Print, then headers, and "Repeat frozen rows" so the header prints on every page.
- People complain that Google hides page breaks until you open the print preview, and that a frozen row on screen is not the same as a row that repeats on paper.
- Sheets already has `print()` in `apps/web/src/editors/Sheets.tsx`. It does not set a page break or a repeating header.

## Scenes

1. **The budget.** Rosa opens "Rent budget". Row 1 is Month, Rent, Paid. Rows 2–30 are the months. She scrolls, and the column names leave the screen. Row 1 is not frozen.
2. **A page break.** She selects row 16, March 2025, and chooses Insert › Page break above. A blue line shows between February and March. March stays whole. A notice says page 2 will start on that row.
3. **The missing names.** File › Print settings opens a preview beside the grid. Page 2 starts at March, with a warning that the page has no column names.
4. **Repeat the header.** She ticks "Repeat row 1 on each page". Page 2 now starts with Month, Rent, and Paid, then March. Page 1 still ends at February. View › Freeze still says no rows are frozen.
5. **Undo.** One Undo removes the line, and the preview goes back to a single page. Redo puts the break and the page 2 header back.
6. **Save.** She closes the file and opens it again. The line is still between February and March, the checkbox is still on, and page 2 still starts with the column names.

## Google Workspace benchmark

In Google Sheets, File › Print opens a panel. Repeating the frozen rows is a checkbox that is easy to miss, and a row break is Insert › Break ([Docs Help](https://support.google.com/docs/answer/183965)). The print preview is a separate view, and people print a headerless second page because they froze the row on screen and assumed paper would match.

## Better than Google Workspace when

1. Insert › Page break above puts a visible break above the selected row. The row itself stays intact.
2. File › Print settings can repeat row 1 on every printed page, whether or not that row is frozen on screen.
3. The preview shows page 2 starting with Month, Rent, and Paid, then the first row after the break.
4. Printing does not change cell values.
5. The break and the repeating header survive save and reopen.
6. Removing the break is one Undo, and the preview goes back to one flow with no headerless page.

## Success looks like

Rosa's paper budget has the column names on both pages, and March is not cut in half.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Insert › Page break above puts a visible break above the selected row, and the row stays intact | Met | Video 0:22, blue line between February and March; March 2025 is still the cell. `tests/sheet-print.test.ts` |
| 2. File › Print settings repeats row 1 on paper whether or not that row is frozen | Met | Video 0:33 checkbox, and 0:40 View › Freeze › No rows is still checked. `tests/browser/sheet-print.spec.ts` |
| 3. The preview shows page 2 starting with Month, Rent, and Paid, then the first row after the break | Met | Video 0:33 and 1:01, page 2 is Month, Rent, Paid, then March 2025 |
| 4. Printing does not change cell values | Met | `tests/browser/sheet-print.spec.ts` compares the cells before and after Print |
| 5. The break and the repeating header survive save and reopen | Met | Video 0:58 the line is back; 1:01 the checkbox is on and page 2 still has the header |
| 6. One Undo removes the break, and the preview is one flow with no headerless page | Met | Video 0:44, the line is gone and the preview says one page |

## Gaps and notes

- Repeat row 1 is the only repeating print row. A different row, or a column, cannot be set to repeat.
- The preview splits on manual breaks. A long page can still be split by the browser when it prints; with the setting on, row 1 is the table header so the browser can repeat it.
- Inserting or deleting rows does not move a break with those rows.
- The break and the repeating header are kept in the SuiteLeaf file. They are not written into an XLSX export.
- Freezing a row on screen is storyboard 12 and is a different control. Grouping, named ranges, and spelling are other storyboards.
