# Make the columns equal

Who: Nia has a shopping table. The Item column is much wider than Amount. The title "October market" already spans both columns. She wants the two columns the same width, without retyping the list.

Inspired by: Google Docs' Table › Distribute columns. It is buried in the Table menu, and it does not say the width the columns will share.

## Scenes

1. Nia opens a document. The table has a spanned title, then Item and Amount, then Apples 2 and Pears 4. Item is about twice as wide as Amount. The caret is in the table. Equal columns appears on the table menu.
2. One click makes Item and Amount the same width. The title still spans both. The words stay Apples, Pears, 2, and 4. The table's overall width stays the same.
3. She sorts by Item. The columns stay equal. The header stays. The title stays spanned. The body sorts.
4. She saves, returns home, and reopens. The two columns are still equal, and the title still spans them.
5. She downloads Word. The two columns have the same width. The title still spans two columns.

## Google Workspace benchmark

- Docs can distribute columns, but only from Table › Distribute columns.
- The command does not say what width the columns will become.
- Distributing columns can drop a merged title back into two cells.

## Better than Google Workspace when

1. Equal columns is on the table menu when the caret is in the table. One click. There is no dialog.
2. Item and Amount become the same width. The table's overall width does not change. The words do not change.
3. The title stays one cell across both columns.
4. Sorting the body after that still keeps the header, the spanned title, and the equal widths.
5. A paragraph after the table does not change.
6. Save and reopen keep the equal widths and the span.
7. The downloaded Word file gives the two columns the same width and keeps the title span.

## Success

- Nia makes Item and Amount the same width, and the title still spans both.

## Gaps

- Tables in `Docs.tsx` can be resized by dragging, merged, and sorted. Nothing sets the columns to the same width.
- A search for distribute columns or equal columns in `apps/web` finds no match.
