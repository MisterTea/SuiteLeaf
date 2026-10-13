# Merge the title row

Who: Nia has a shopping table. The first row is the title "October market" in the left cell and an empty cell beside it. Under that, the header is Item and Amount, then Apples 2 and Pears 4. She wants the title to span both columns.

Inspired by: Google Docs' Table › Merge cells, which is easy to miss, and Unmerge cells, which is a separate command that does not rename itself when the caret is already in a merged cell.

## Scenes

1. Nia selects the two cells in the title row. The table menu says Merge cells. One click. "October market" spans both columns. Item, Amount, Apples, and Pears stay in two columns.
2. With the caret in the title, the same control says Unmerge. One click puts "October market" back in the left cell and leaves the right cell empty. The rows below stay two columns.
3. She merges the title again. She sorts the Item column. The title stays one cell across the top. The header stays Item and Amount. The body sorts, and each amount stays with its item.
4. She saves, returns home, and reopens. The title still spans both columns. The body is still sorted.
5. She downloads Word. The title cell spans two columns. The header and the body are still two columns.

## Google Workspace benchmark

- Docs can merge cells, but Merge cells and Unmerge cells are two commands in the Table menu.
- The command does not change its name when the selection is already one merged cell.
- Merging a title can pull the header into the same span if the selection was one row too tall, and Docs does not say which row will span.

## Better than Google Workspace when

1. With two title cells selected, the table menu says Merge cells. One click. There is no second command and no dialog.
2. "October market" spans both columns. Item, Amount, and the body stay in two columns. The words do not change.
3. With the caret in that spanned cell, the same control says Unmerge. Unmerge puts the title in the left cell and leaves the right cell empty.
4. Sorting Item after the title is merged keeps the title spanned, keeps the header, and sorts only the body.
5. A cell outside the title row does not become part of the span.
6. Save and reopen keep the span and the sorted body.
7. The downloaded Word file writes a two-column span on the title and two columns on the header and body.

## Success

- Nia spans the title across the table, and the shopping rows stay in their own columns.

## Gaps

- Tiptap's table extension already has `mergeCells` and `splitCell`. The table menu in `apps/web/src/editors/Docs.tsx` never calls them.
- The menu does not rename itself when the caret is in a cell that already spans columns.
