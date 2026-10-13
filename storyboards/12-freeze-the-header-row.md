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

## AI version

**Videos:** [web](videos/12-freeze-the-header-row-ai.mp4) · [desktop](videos/electron/12-freeze-the-header-row-ai.mp4) · **Script:** [scenes/ai/12-freeze-the-header-row-ai.spec.ts](scenes/ai/12-freeze-the-header-row-ai.spec.ts)

Chris opens the same 60-guest list and scrolls down to row 36, where the headings are gone. Still scrolled down, he asks the on-device assistant (Gemma 4 E4B) once:

*When I scroll down I can't see the column headings anymore. Can you keep the header row on screen while I scroll?*

**Tools Gemma used:** only `freeze`, with `rows: 1`, sometimes with `columns: 0` as well. It made no reads and no extra calls, then replied in one sentence ("I have frozen the first row so that your column headings will remain visible…").

**What the recording shows:** The grid scrolls back to the top, and Gemma's pointer lands on the header row (Guest, Party size, Meal, RSVP) before the grey freeze line appears under row 1. Chris closes the panel and scrolls to the last guest in row 61. The headings stay at the top. The test downloads the workbook (Save As to a file on desktop) and checks `freeze` is `{startRow: 1, ySplit: 1}` with no frozen columns. Then Chris goes back to the file list and reopens the workbook. Row 1 is still frozen, and View › Freeze shows the tick next to 1 row. Each request takes 13–20 seconds on the web after the model loads (about 23 seconds), and 8–23 seconds on desktop.

**How Gemma did:** With the final code, the web recording passed 3 of 3 runs, and desktop (llama.cpp) passed all 3 of its recordings, one of them on the final code. Across the 7 web recordings made along the way, 6 passed. The one model mistake seen:
- Once, Gemma called `freeze` with `columns: 1, rows: 1` and said it had frozen "the first row and the first column so your headings will remain visible as you scroll down and to the right". Chris only asked for the header row. The `freeze` description now says a header row is `rows=1` and to leave out what the user didn't ask to change. After that change, Gemma sent `columns: 0` or no `columns` at all in every run.

Fixed while making it:
- **Pointer off screen.** Gemma's pointer aimed at A1 while the sheet was scrolled down, so it ended up over the file title. Sheet tools now scroll cells that are out of view back on screen before pointing, as a person would.
- **Pointer target.** `freeze` now points at the rows (or columns) it freezes.
- **Vague result.** `freeze` used to say only "Frozen: 1 row(s), 0 column(s)". It now reads the sheet back and names what stays put, for example "Row 1 (Guest, Party size, Meal, RSVP) now stays at the top while scrolling. No columns are frozen."
- **Header jump.** With the panel open, the editor's save status wrapped onto two or three lines as it changed ("Opened … · Saved on this device" → "Unsaved changes"). This moved the toolbar and grid up and down by 12 px mid-run. The status now stays on one line and ends in "…" when space runs out.
- **Footer grammar.** The panel footer now says "1 tool call · 1 request" instead of "1 tool calls · 1 requests".

## Gaps and notes

- Freezing more rows or columns than fit on screen would leave nothing to scroll, so "Up to row *n*" and "Up to column *X*" are greyed out when the selected cell is too far down or right. Google Sheets shows an error message instead.
- Freezing from the View menu while scrolled down jumps the grid back to the top. Google Sheets keeps the scroll position.
- The frozen-row divider is Univer's thin grey line, fainter than Google Sheets' thick bar.
- After a menu choice, keyboard focus goes back to the menu bar rather than the grid (true of every SuiteLeaf menu), so typing needs a click on a cell first.
- "Print layout" and "Toggle filter" remain at the bottom of View. Google Sheets keeps filters under Data, where SuiteLeaf also has "Create a filter".
