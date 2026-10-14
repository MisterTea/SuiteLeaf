# Find the table

Who: Nia typed "10" in a table on the Welcome slide, in the Amount column next to Pears. The number is not in a text box, a shape, or the speaker notes. She is looking at Prices and wants Find to select that table.

Inspired by: Google Slides' Find, which can hit a table cell without saying the match is in a table. The table can look unselected, so the match seems to have failed.

## Scenes

1. Nia is on Prices. She finds 10. The deck shows Welcome, the table is selected, and the cell that says 10 is visible. The find bar does not cover it. The bar says 1 of 1 in the table on Welcome.
2. The text box still says Market. The shape and the notes are unchanged. The other cells stay Item, Amount, Apples, 2, and Pears.
3. She replaces 10 with 12. That cell says 12. Pears stays in the cell beside it. Market stays Market.
4. She finds 10 again. The bar says no matches. The table still shows 12.
5. She saves, returns home, and reopens. The Amount cell is still 12, and the table is still on Welcome.

## Google Workspace benchmark

- Slides can find text in a table, but the result does not say it is in a table.
- The table may not look selected, so the match is easy to miss.
- The find bar can cover the cell.

## Better than Google Workspace when

1. A word that exists only in a table cell is found. The bar says it is in the table and names the slide. The table is selected, and the bar does not cover the cell.
2. The text box, the shape, and the speaker notes are unchanged.
3. On the same slide, the order is text box, then shape, then table cells in reading order, then notes. Next walks that order.
4. "10" finds "10". A search with no matches says there are none and does not change any cell.
5. Replace changes only that cell. The neighboring cell and the text box stay.
6. Zoom, slide numbers, and the table's position do not change.
7. Save and reopen keep the replaced cell. A skipped slide's table text is found while editing, and presenting still skips that slide.

## Success

- Nia finds 10 in the table, sees that it is in the table, and replaces it with 12 without touching Market.

## Gaps

- `slide-find.ts` reads text boxes, shapes, and speaker notes. A table's `rows` are skipped.
- The find bar cannot say a match is in a table, and it does not select that table.
