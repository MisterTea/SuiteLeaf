# Paste the number, not the formula

Who: Nia has a total in D2, `=SUM(B2:B4)`, which shows 120. She wants that 120 written into F2 as a plain number, so later changes to the groceries do not move the snapshot she is sending.

Inspired by: Google Sheets' Edit › Paste special › Values only, which is a nested menu under Paste. Excel's Paste Special › Values does the same.

## Scenes

1. Nia opens a budget. B2 is 40, B3 is 50, B4 is 30, and D2 is `=SUM(B2:B4)`, showing 120. She copies D2.
2. She selects F2 and chooses Paste values, next to Paste. F2 shows 120. The formula bar for F2 shows 120, not `=SUM(B2:B4)`.
3. She changes B2 from 40 to 80. D2 becomes 160. F2 stays 120.
4. D2 still shows `=SUM(B2:B4)` in the formula bar. Paste values did not remove the original formula.
5. She selects F2 and uses ordinary Paste on D2's copy into G2. G2 receives the formula, and its formula bar shows `=SUM(B2:B4)`.
6. She saves, returns home, and reopens. F2 is still the number 120. D2 is still the formula.
7. She downloads Excel. F2 is a number, not a formula. D2 is still the SUM formula.

## Google Workspace benchmark

- Sheets can paste values, but only through Edit › Paste special › Values only, three steps from the toolbar.
- The Paste toolbar button always pastes the formula. Nothing next to it says it will paste the number.
- After a values paste, Sheets does not show the formula bar and the source total together, so it is easy to think the formula was copied.

## Better than Google Workspace when

1. Paste values sits beside Paste. One click writes the number. There is no Paste special submenu and no dialog.
2. F2 shows 120, and its formula bar shows 120, not the SUM formula.
3. Changing B2 updates D2 and leaves F2 at 120.
4. D2 still has `=SUM(B2:B4)`.
5. Ordinary Paste still pastes the formula into another cell.
6. Save and reopen keep F2 as the number and D2 as the formula.
7. The downloaded workbook stores F2 as a number and D2 as the formula.

## Success

- Nia pastes the total as a number, and the live formula stays where it was.

## Gaps

- `clipboard` in `apps/web/src/editors/Sheets.tsx` only runs Univer's cut, copy, and paste commands. Nothing pastes the calculated value without the formula.
- A search for paste values or transpose in the sheets editor finds no values-only paste.
