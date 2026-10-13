# 12 · Freeze the header row

**Mode:** single-node · **App:** Sheets · **Video:** [videos/12-freeze-the-header-row.mp4](videos/12-freeze-the-header-row.mp4) · **Script:** [scenes/sheets.spec.ts](scenes/sheets.spec.ts)

## Who and why

Chris is checking a 60-guest wedding list for the caterer. Halfway down, the column headings scroll away and it's no longer obvious which column is the meal choice and which is the RSVP.

## Inspired by

- [Google Docs Editors Help: Freeze, group, hide, or merge rows & columns](https://support.google.com/docs/answer/9060449): View › Freeze › 1 row.
- [Spreadsheet Class: Freeze and unfreeze rows and columns](https://www.spreadsheetclass.com/freeze-unfreeze-rows-columns-in-google-sheets/): a thick grey bar under the frozen row; headers stay put while you scroll.
- *Google Workspace For Dummies* ch. 8 and W9 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): freezing locks panes.

## Scenes

1. **Open the list.** "Wedding guest list" has Guest, Party size, Meal and RSVP for 60 guests.
2. **The problem.** Chris scrolls down past row 35 and the header row is gone.
3. **View › Freeze.** Back at the top, Chris opens View › Freeze, laid out as in Google Sheets: No rows, 1 row, 2 rows, Up to row *n* (the selected row), then the same four choices for columns. A tick shows the current freeze ("No rows"). Chris picks **1 row**.
4. **Scroll with headers.** A grey line appears under row 1. Scrolling down to the last guest in row 61, Guest, Party size, Meal and RSVP stay at the top.
5. **Reopen.** Chris goes back to the file list and opens the workbook again. Row 1 is still frozen, and View › Freeze shows the tick next to 1 row. Choosing "No rows" would undo it.

## Success looks like

- Row 1 stays visible while the rest of the list scrolls.
- The freeze is saved with the workbook (`freeze.ySplit = 1`) and comes back when the file reopens.

## Also in the View menu

- **View › Show › Gridlines** hides or shows the sheet's gridlines. Like Google Sheets, this is saved per sheet in the workbook (`showGridlines`).
- **View › Show › Formula bar** hides or shows the formula bar. This is a personal preference kept on the device, not in the file.
- Freeze is also on the grid's right-click menu (Freeze first row, Freeze to active cell, and so on), as before.

## Gaps and notes

- Freezing more rows or columns than fit on screen would leave nothing to scroll, so "Up to row *n*" and "Up to column *X*" are greyed out when the selected cell is too far down or right. Google Sheets shows an error message instead.
- Freezing from the View menu while scrolled down jumps the grid back to the top. Google Sheets keeps the scroll position.
- The frozen-row divider is Univer's thin grey line, fainter than Google Sheets' thick bar.
- After a menu choice, keyboard focus goes back to the menu bar rather than the grid (true of every SuiteLeaf menu), so typing needs a click on a cell first.
- "Print layout" and "Toggle filter" remain at the bottom of View. Google Sheets keeps filters under Data, where SuiteLeaf also has "Create a filter".
