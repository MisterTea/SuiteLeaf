# Fill the formula across

Who: Nia has a tax formula in C2, `=B2*1.1`. She wants the same formula in D2 and E2, each one pointing at the column to its left. She does not want to retype it, and she does not want Fill down, which would move to the next row.

Inspired by: Google Sheets' Edit › Fill › Right, and the fill handle dragged sideways. Excel's Fill Right shifts relative column letters and leaves absolute references alone.

## Scenes

1. Nia opens a sheet. B2 is 40, C2 is `=B2*1.1` and shows 44. D2 and E2 are empty. Row 3 is a different amount, 10 in B3, so a mistaken fill down would be obvious.
2. She selects C2:E2 and chooses Fill right, beside Fill down. D2 becomes `=C2*1.1` and shows 48.4. E2 becomes `=D2*1.1` and shows 53.24. C2 is still `=B2*1.1`. B3 and C3 stay empty of that formula.
3. She puts `=$B$2` in F2, selects F2:H2, and fills right. G2 and H2 stay `=$B$2`. They do not become `$C$2`.
4. She puts 7 in I2, selects I2:J2, and fills right. J2 is the number 7, not a formula.
5. She selects C2:C4 and uses Fill down. That still shifts rows, and it does not undo the fill across row 2.
6. She saves, returns home, and reopens. E2's formula bar still shows `=D2*1.1`.
7. She downloads Excel. D2 is `=C2*1.1`, not a copy of `=B2*1.1`. G2 is still `=$B$2`.

## Google Workspace benchmark

- Sheets can fill right, but it is Edit › Fill › Right, a sibling of Fill › Down, and the sideways handle is the same tiny square.
- Nothing next to Fill down says that the next command moves across columns instead of down rows.
- A locked reference and a relative column look the same until the formula bar is open on the filled cell.

## Better than Google Workspace when

1. Fill right sits beside Fill down. One click fills the selection from its left cell. There is no dialog and no drag handle required.
2. D2 and E2 become `=C2*1.1` and `=D2*1.1`, and they show 48.4 and 53.24.
3. C2 stays `=B2*1.1`. Row 3 does not receive the tax formula.
4. An absolute `=$B$2` stays `=$B$2` in every filled column.
5. Filling a plain number copies the number and does not invent a formula.
6. Fill down still shifts row references. Save and reopen keep both the filled-across formulas and a filled-down formula.
7. The downloaded workbook stores the shifted column letters, and the absolute reference is still absolute.

## Success

- Nia fills the tax formula across the row, and each column points at the cell to its left.

## Gaps

- `shiftFormulaDown` in `apps/web/src/editors/fill-down.ts` only changes row numbers. Fill down is the only command wired from `Sheets.tsx`.
- Nothing fills a formula from the left cell of a selection into the cells to its right.
