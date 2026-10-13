# 09 · Build a household budget with formulas

**Mode:** single-node · **App:** Sheets · **Video:** [videos/09-household-budget-with-formulas.mp4](videos/09-household-budget-with-formulas.mp4) · **Script:** [scenes/sheets.spec.ts](scenes/sheets.spec.ts)

## Who and why

Maya wants to see her month at a glance: what she planned for each category, what she actually spent, and how much is left. She has never written a formula longer than a SUM and doesn't want a template full of tabs she doesn't understand.

## Inspired by

- *Ultimate Guide to Google Sheets*, ch. 1: create a sheet, fill it with data, add totals ([docs/workflows.md](../docs/workflows.md), acceptance scenario 2; WF-B1-01 and WF-B1-03 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md)).
- [How to make a budget in Google Sheets](https://themoneydecoded.com/blog/budget-in-google-sheets): "a budget is one subtraction that must not go negative"; a bounded `=SUM(C2:C13)` total row and a Remaining column.
- [r/googlesheets: Help with a budget spreadsheet](https://www.reddit.com/r/googlesheets/comments/1mbjd82/help_with_a_budget_spreadsheet/): people want a running "what's left" number without wrestling negative-number tricks.

## Scenes

1. **New spreadsheet.** From the home screen Maya clicks "New spreadsheet". An empty grid opens as "Untitled spreadsheet".
2. **Name it.** She types "October budget" in the title box.
3. **Enter the table.** She clicks A1 and types Category, Planned and Spent, then five categories (Rent, Groceries, Utilities, Transport, Fun money) with their amounts. Tab moves across; Enter after the last amount returns to column A of the next row, as in Sheets and Excel, so she never reaches for the mouse.
4. **Totals with a suggestion.** In row 7 she types "Total", Tab, then `=su`. Suggestions open with SUM first; Tab picks it and shows `SUM(Number 1, [Number 2, …])` as a hint. She finishes `B2:B6)` and presses Tab. The cell shows 2280.
5. **Typing straight past a suggestion.** In C7 she types `=SUM(C2:C`, and suggestions for "C" (COUNT, COUNTA, …) open. She keeps typing `6)` and presses Enter at once. The cell keeps exactly `=SUM(C2:C6)` and shows 2077.
6. **What's left.** In row 9 she types "Left to spend" and `=B7-C7` (203). Clicking B9 shows the formula in the formula bar.
7. **Update a value.** After a big grocery run she clicks C3 and changes Groceries' Spent from 380 to 455. The Spent total becomes 2152 (clicking C7 shows `=SUM(C2:C6)`) and Left to spend drops to 128 immediately.
8. **Autosave and keep a copy.** The status reads "Saved on this device". Download saves a portable copy.

## Success looks like

- Totals and the remaining-budget cell are live formulas (`=SUM(B2:B6)`, `=SUM(C2:C6)`, `=B7-C7`) that recalculate when any amount changes.
- Function suggestions help (SUM is first for `=su`) but never change a formula she typed in full, even when she presses Enter or Tab while a suggestion list is still on screen.
- The grid doesn't move while the spreadsheet finishes loading.
- The downloaded file holds the formulas and their current results (2280, 2152, 128) under the title "October budget".

## Gaps and notes

- **Fixed: a suggestion could replace a typed formula.** Univer refreshes the suggestion list 300 ms after typing stops, but Enter and Tab accepted whatever list was on screen. Typing `=SUM(B1:B`, pausing, then `2)` and Enter within that window produced `=SUM(B1:B2BASE(` and then `#REF!`. Enter and Tab now commit what was typed whenever the list no longer matches it ([tests/browser/formula-entry.spec.ts](../tests/browser/formula-entry.spec.ts)).
- **Fixed: `=su` suggested SUBTOTAL first.** Univer lists functions in registration order, so Tab after `=su` inserted SUBTOTAL. Everyday functions (SUM, AVERAGE, COUNT, IF, MIN, MAX, …) now come first, as in Google Sheets.
- **Fixed: the grid jumped 31 px about three seconds after opening**, when the "Sheet tools" bar appeared. Its space is now reserved from the start.
- Suggestions still open after a range colon (`C2:C` suggests COUNT…). Google Sheets doesn't suggest functions there. It's harmless now that typing past them is safe.
- While SUM's argument hint is showing, a new suggestion list can open on top of it. Both are Univer popups.
- The grid ignores clicks, and toolbar buttons are disabled, for about three seconds after the grid appears, until Univer reports its "Steady" stage. Maya names the file first, so she doesn't notice here.
- Amounts stay plain numbers until formatted. Currency formatting is covered in [13](13-format-money-and-percentages.md).
