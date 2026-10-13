# Fill the formula down

Who: Nia has a tax formula in C2, `=B2*1.1`. The same formula belongs on C3, C4, and C5, with each row pointing at its own amount. She does not want to retype it.

Inspired by: Google Sheets' fill handle, a few pixels at the corner of the selection, and Edit › Fill › Down, which is easy to miss. Excel's Fill Down does the same and shifts relative references.

## Scenes

1. Nia opens a sheet. B2 is 40, B3 is 50, B4 is 30, and B5 is 20. C2 is `=B2*1.1` and shows 44. C3:C5 are empty.
2. She selects C2:C5 and chooses Fill down, beside Paste values. C3 becomes `=B3*1.1` and shows 55. C4 becomes `=B4*1.1` and shows 33. C5 becomes `=B5*1.1` and shows 22. C2 is still `=B2*1.1`.
3. She puts `=$B$2` in D2, selects D2:D4, and fills down. D3 and D4 stay `=$B$2`. They do not become `$B$3`.
4. She puts 7 in E2, selects E2:E3, and fills down. E3 is the number 7, not a formula.
5. She saves, returns home, and reopens. C5's formula bar still shows `=B5*1.1`.
6. She downloads Excel. C3 is `=B3*1.1`, not a copy of `=B2*1.1`. D3 is still `=$B$2`.

## Google Workspace benchmark

- Sheets can fill down, but the handle is a tiny square on the selection, and the menu item is Edit › Fill › Down.
- Nothing next to Paste says what Fill down will write.
- A locked reference and a relative reference look the same until you open the formula bar on the filled cell.

## Better than Google Workspace when

1. Fill down sits beside Paste values. One click fills the selection from its top cell. There is no dialog and no drag handle required.
2. C3, C4, and C5 become `=B3*1.1`, `=B4*1.1`, and `=B5*1.1`, and they show 55, 33, and 22.
3. C2 stays `=B2*1.1`.
4. An absolute `=$B$2` stays `=$B$2` on every filled row.
5. Filling a plain number copies the number and does not invent a formula.
6. Save and reopen keep the adjusted formulas.
7. The downloaded workbook stores the shifted formulas, and the absolute reference is still absolute.

## Success

- Nia fills the tax formula down the column, and each row points at its own amount.

## Gaps

- `Sheets.tsx` has Paste and Paste values. Nothing fills a formula down a selection.
- A search for fill down or autofill in `apps/web/src` finds no sheet command.
