# 59 · Print the budget

**Mode:** single-node · **App:** Sheets · **Video:** [videos/59-print-the-budget.mp4](videos/59-print-the-budget.mp4) · **Script:** [scenes/59-print-the-budget.spec.ts](scenes/59-print-the-budget.spec.ts)

## Who and why

Rosa needs a paper copy of the rent budget for the meeting. The header row says Month, Rent, and Paid. The months fill two pages. Today, File › Print prints the grid, and page 2 starts in the middle of a month with no header, so nobody can tell which column is Paid.

## Inspired by

- [Print a spreadsheet](https://support.google.com/docs/answer/183965): File › Print, then headers, and "Repeat frozen rows" so the header prints on every page.
- People complain that Google hides page breaks until you open the print preview, and that a frozen row on screen is not the same as a row that repeats on paper.
- Sheets already has `print()` in `apps/web/src/editors/Sheets.tsx`. It does not set a page break or a repeating header.

## Scenes

1. **The budget.** Rosa opens "Rent budget". Row 1 is Month, Rent, Paid. Rows 2–30 are the months. Row 1 is not frozen. That is a different story.
2. **A page break.** She selects row 16 and chooses Insert › Page break above. A line shows between row 15 and row 16. Page 2 will start at row 16.
3. **Repeat the header.** She chooses File › Print settings and ticks "Repeat row 1 on each page". The preview shows Month, Rent, and Paid at the top of page 2.
4. **Print.** The preview is two pages. Page 1 ends at row 15. Page 2 starts with the header and then row 16. No month is split across the break.
5. **Save.** She reopens the file. The break and the repeating header are still set, and the preview matches.

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

## Gaps and notes

- Sheets can print the grid. It cannot set a row page break or a repeating print header.
- Freezing a row on screen is storyboard 12 and is not the same control.
- Do not rebuild grouping, named ranges, or spelling.
