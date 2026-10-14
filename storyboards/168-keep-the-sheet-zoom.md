# Keep the sheet zoom

Who: Nia edits the grocery budget at 150% so the amounts are easy to read. She leaves and comes back. The grid should still be at 150%. A new spreadsheet should not open at 150% just because the budget did. Her minutes, which she left at 100%, should stay at 100%.

Inspired by: Google Sheets remembers a zoom, but it is one zoom for the browser. Opening a different spreadsheet, or a document, keeps the last zoom.

## Scenes

1. Nia opens the grocery budget. The zoom control says 100%. She chooses 150%. The grid is larger. The header line and the amounts stay readable.
2. She saves, returns home, and reopens the budget. The zoom control says 150%, and the grid is still large.
3. She creates a new spreadsheet. Its zoom is 100%.
4. She opens the minutes, a document she left at 100%. The document zoom is 100%, not 150%.
5. She returns to the budget. It is still at 150%. She downloads Excel. The file contains the groceries and does not contain "150%".

## Google Workspace benchmark

- Sheets has a zoom menu, and the last zoom sticks to the browser rather than to the file.
- Opening a small list after a wide budget can leave the list at 200%.
- A document and a spreadsheet share that same leftover zoom.

## Better than Google Workspace when

1. Choosing 150% enlarges that spreadsheet. The values stay the same.
2. Save and reopen of that spreadsheet restores 150%.
3. A new spreadsheet opens at 100%.
4. A document's zoom is unchanged. The minutes stay at 100% when the budget is at 150%.
5. Returning to the budget shows 150% again.
6. The zoom is not written into the cells.
7. The downloaded workbook does not contain "150%".

## Success

- Nia comes back to the budget and it is still at 150%, and the minutes are not.

## Gaps

- Sheet zoom in `Sheets.tsx` is React state that always starts at 100%. Leaving the file forgets it.
- Document zoom is stored per document. Nothing stores a zoom per spreadsheet, separate from documents.
