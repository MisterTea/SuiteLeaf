# Line under the header

Who: Nia has a grocery list. The first row is Groceries and Amount. She wants a line under that header, and she does not want a box around every cell.

Inspired by: Google Sheets' border menu, a grid of tiny icons. Bottom, outside, and all look alike until you try one, and there is no None that says it will clear the lines.

## Scenes

1. Nia selects the header row. The border control lists Bottom, Outside, All, and None, in words. She chooses Bottom. A line appears under Groceries and Amount. The cells below have no border.
2. She selects the header and the two data rows and chooses Outside. A box surrounds the whole selection. There are no lines between the cells.
3. She chooses All. Lines appear between the cells as well as around the outside.
4. She chooses None. The lines disappear. The words and numbers stay.
5. She puts Bottom back on the header, saves, returns home, and reopens. The line under the header is still there. The data cells are still clear.
6. She downloads Excel. The header cells have a bottom border and do not have a top, left, or right border from this command. The data cells have no border.

## Google Workspace benchmark

- Sheets can set a bottom border, but the control is a palette of icons.
- All borders is the easy default, so a header becomes a full grid.
- Clearing borders is an icon that looks like the others, with no word None.

## Better than Google Workspace when

1. Bottom, Outside, All, and None are words on the border control. One click each. There is no dialog.
2. Bottom on the header draws only the bottom edge. The data cells stay clear.
3. Outside draws the outer box of the selection and does not draw lines between the cells.
4. All draws the outer box and the lines between the cells.
5. None removes the borders from the selection and leaves the values.
6. Save and reopen keep the bottom line on the header and the clear data cells.
7. The downloaded workbook has a bottom border on the header cells and no border on the data cells.

## Success

- Nia puts one line under the header, and the amounts stay unboxed.

## Gaps

- `applyBorders` in `Sheets.tsx` always calls `setBorder` with `BorderType.ALL` and a thin black line.
- The toolbar button does not offer Bottom, Outside, or None.
