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

## AI version

**Videos:** [web](videos/09-household-budget-with-formulas-ai.mp4) · [desktop](videos/electron/09-household-budget-with-formulas-ai.mp4) · **Script:** [scenes/ai/09-household-budget-with-formulas-ai.spec.ts](scenes/ai/09-household-budget-with-formulas-ai.spec.ts)

Maya asks the on-device assistant (Gemma 4 E4B) twice, once to build the budget and once after the grocery run:

1. *Make me a spreadsheet called October budget with columns Category, Planned and Spent. Rent is 1400 planned and 1400 spent, Groceries 450 and 380, Utilities 160 and 142, Transport 120 and 95, Fun money 150 and 60. Add a Total row that adds up both columns, and under it a Left to spend row showing how much of the plan is left.*
2. *I just did a big grocery run, so Groceries spent is now 455.*

Then she closes the panel and keeps a copy herself: Download on the web, Save As on desktop. She clicks the Spent total and the Left to spend amount, and the formula bar shows `=SUM(C2:C6)` and `=B7-C7`. The test reads the saved file. It looks for the rows labelled Total and Left to spend wherever Gemma put them, and checks that they hold `=SUM(B2:B6)` (2280), `=SUM(C2:C6)` (2152) and a formula giving 128, and that Groceries' Spent is 455.

**Tools Gemma used:** `create_file`, `set_cells` (the header, the five categories, the Total row, then Left to spend), and `format_cells`, which nobody asked for. In every run it also applied number or currency formats, and sometimes borders, bold or left/centre alignment. For the update it made one `set_cells` call on C3.

**What the recording shows:** the grid fills row by row with the pointer on each range: 2280 and 2077 in the Total row, 203 left. Gemma usually puts Total in row 7 and Left to spend in row 8, with no blank row as in the original. Sometimes it skips row 7. After the second request only C3 changes by hand. The tool result lists what recalculated (*C7 =SUM(C2:C6): 2077 → 2152; B8 =B7-C7: 203 → 128*), and Gemma's reply says the totals updated by themselves. Each request takes about 40–60 seconds for the build and 5 seconds for the update on the web, and about 18 and 3 seconds on desktop.

**How Gemma did:** On the final code the web recording passed 4 of 4 runs (3 consistency runs, then 1 more after the last small fix), and desktop (llama.cpp) passed 2 of 2. Over the whole loop the web passed 8 of 10 runs and desktop 2 of 4. Model mistakes seen while making it:
- Once on the web, Gemma finished by calling `back_to_files`, so the budget closed in front of her.
- Once it typed the results 2280, 2077 and 203 over its own formulas. After the grocery update it then typed made-up totals (3187, 2187, 1000). `set_cells` now warns when a formula is replaced by a fixed value, and that hasn't happened since.
- Before the result listed recalculated formulas, Gemma re-typed the total formulas after changing C3, "to recalculate".
- On desktop it once stacked both totals down column B (B7 and B8) with no "Total" label, and wrote `=B10` next to Left to spend.
- It listed ranges with commas (`B2:B9,C2:C9`) and, in the first run, repeated that shape after the error. The error now suggests one covering range, and Gemma uses it on its next call.
- It once wrapped the categories in single quotes (`'Groceries'`), wrote one row closed a `]` short, repeated a call that had already worked, and called `copy_pivot` on a sheet with no pivot table.
- It added formatting nobody asked for (dark red text on A1:A2, bold labels), and its replies sometimes overstate what happened ("recalculated … Total Planned", or "currency" when it used plain number format).

Fixed while making it: `set_cells` now lists the formulas elsewhere that recalculated and warns when it replaced a formula with a fixed value. Its description says formulas update by themselves and shows how a row across columns is written. A flat list is read as one row; schema checks used to turn each item into its own row, so the desktop run wrote a row down a column. `range` is accepted for `start`. Single quotes wrapped around a cell's text are dropped. `format_cells` could not right-align, because Univer's API calls right alignment "normal". It now shows up to 12 rows, and a comma-separated range says which single range covers it. The Gemma call parser now reads Python-style `'text'` and repairs a list of rows that is one `]` short. The panel says an unreadable call is being rewritten instead of showing its raw text.

## Gaps and notes

- **Fixed: a suggestion could replace a typed formula.** Univer refreshes the suggestion list 300 ms after typing stops, but Enter and Tab accepted whatever list was on screen. Typing `=SUM(B1:B`, pausing, then `2)` and Enter within that window produced `=SUM(B1:B2BASE(` and then `#REF!`. Enter and Tab now commit what was typed whenever the list no longer matches it ([tests/browser/formula-entry.spec.ts](../tests/browser/formula-entry.spec.ts)).
- **Fixed: `=su` suggested SUBTOTAL first.** Univer lists functions in registration order, so Tab after `=su` inserted SUBTOTAL. Everyday functions (SUM, AVERAGE, COUNT, IF, MIN, MAX, …) now come first, as in Google Sheets.
- **Fixed: the grid jumped 31 px about three seconds after opening**, when the "Sheet tools" bar appeared. Its space is now reserved from the start.
- Suggestions still open after a range colon (`C2:C` suggests COUNT…). Google Sheets doesn't suggest functions there. It's harmless now that typing past them is safe.
- While SUM's argument hint is showing, a new suggestion list can open on top of it. Both are Univer popups.
- The grid ignores clicks, and toolbar buttons are disabled, for about three seconds after the grid appears, until Univer reports its "Steady" stage. Maya names the file first, so she doesn't notice here.
- Amounts stay plain numbers until formatted. Currency formatting is covered in [13](13-format-money-and-percentages.md).
