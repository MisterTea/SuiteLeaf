# Paint the cell

Who: Nia formatted the grocery total as bold, blue, and currency. The next amount is a plain 12. She wants that 12 to look like the total, and she wants the number to stay 12.

Inspired by: Google Sheets' paint format brush. One click arms a sticky brush, and the next click anywhere copies the format, including a click she did not mean. The brush also does not say which cell it copied.

## Scenes

1. Nia opens a budget. B2 is bold, blue, and currency, showing $40.00. C2 is the plain number 12. D2 is the plain number 7.
2. She selects B2 and chooses Copy format. The control then reads Apply format. B2, C2, and D2 are unchanged.
3. She selects C2 and chooses Apply format. C2 is bold, blue, and shows $12.00. The formula bar still says 12, not 40. B2 is still $40.00. D2 is still the plain 7.
4. With nothing copied, Apply format is not offered. She saves, returns home, and reopens. C2 is still $12.00 and the formula bar is 12.
5. She downloads Excel. C2 is currency and the value is 12. B2 is still 40. D2 is still a plain 7.

## Google Workspace benchmark

- Sheets copies a cell's format with a paint brush that stays armed until the next click.
- The brush does not say which cell it copied.
- A click in the wrong cell paints that cell, and there is no separate Apply step.

## Better than Google Workspace when

1. Copy format and Apply format are two named steps. After copying B2, the control reads Apply format. There is no sticky brush and no dialog.
2. Apply format on C2 copies bold, blue, and the currency format. The value stays 12, shown as currency.
3. B2 stays $40.00. D2 stays a plain 7.
4. Apply format is unavailable until a format has been copied.
5. The words and numbers in other cells do not change.
6. Save and reopen keep C2 as currency 12, still bold and blue.
7. The downloaded workbook stores 12 in C2 with the currency format, 40 in B2, and a plain 7 in D2.

## Success

- Nia makes 12 look like the total, and the number stays 12.

## Gaps

- The Sheets toolbar has a Paint format button whose click handler is empty.
- Docs can already copy bold, size, and color onto a selection. Sheets cannot copy a cell's format onto another cell.
