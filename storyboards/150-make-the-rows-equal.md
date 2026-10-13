# Make the rows equal

Who: Nia has a shopping table. The Apples row is one line. The Pears row wraps onto two lines, so it is taller. She wants every row as tall as the tallest one, so the list lines up, and she does not want the wrapped pears cut off.

Inspired by: Google Docs' Table › Distribute rows. It is buried in the Table menu, and it can shrink a row until its text no longer fits.

## Scenes

1. Nia opens a document. The table has a spanned title, a header, Apples on one line, and Pears with a note that wraps. Pears is visibly taller. The columns are already equal. Equal rows appears on the table menu.
2. One click makes the header and Apples as tall as Pears. Pears does not get shorter. Every word of the pears note stays visible. The columns stay equal. The title still spans both columns.
3. She sorts by Item. The rows stay the same height. The header stays. The title stays spanned. The body order changes and each amount stays with its item.
4. She saves, returns home, and reopens. The rows are still equal, and the pears note is still fully visible.
5. She downloads Word. The rows have the same height. The title still spans two columns. The pears note is still in its cell.

## Google Workspace benchmark

- Docs can distribute rows, but only from Table › Distribute rows.
- The command can make a tall row shorter than the text inside it.
- It does not say that the short rows will grow to the tallest one.

## Better than Google Workspace when

1. Equal rows is on the table menu when the caret is in the table. One click. There is no dialog.
2. Every row becomes as tall as the tallest row. The tallest row does not shrink. Wrapped text stays fully visible.
3. The columns stay the width they were. The title stays one cell across both columns. The words do not change.
4. Sorting the body after that keeps the equal row heights, the header, and the spanned title.
5. A paragraph after the table does not change.
6. Save and reopen keep the equal heights and the span.
7. The downloaded Word file gives the rows the same height and keeps the title span and the pears note.

## Success

- Nia makes the short rows as tall as the pears row, and nothing is cut off.

## Gaps

- `doc-table-columns.ts` can give every column the same width. Nothing sets row heights.
- A search for equal rows or distribute rows in `apps/web` finds no match.
