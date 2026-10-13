# Sort the table

Who: Nia has a shopping table. The header is Item and Amount. The rows are Pears 4, Apples 2, and Figs 10. She wants the names in alphabetical order, then the amounts from small to large, without the header sliding into the list.

Inspired by: Google Docs' Table › Sort table, a dialog that asks for a column number and A to Z. The header stays only if you notice the checkbox.

## Scenes

1. Nia opens a document with that table and a sentence after it, "Buy these Saturday." The caret is in the Item column. Sort says it will sort by Item, A to Z. One click. There is no dialog.
2. The header stays Item and Amount. The body is Apples 2, Figs 10, Pears 4. The sentence after the table is still "Buy these Saturday."
3. She puts the caret in the Amount column. Sort says it will sort by Amount, small to large. One click. The body is Apples 2, Pears 4, Figs 10. Ten stays with Figs. It does not sort as text, which would put 10 before 2.
4. She clicks Sort again. The button says large to small. The body is Figs 10, Pears 4, Apples 2.
5. She saves, returns home, and reopens. The order is still Figs, Pears, Apples, and the header is still on top.
6. She downloads Word. The header row is still the header. The body is in that same order.

## Google Workspace benchmark

- Docs can sort a table, but only from Table › Sort table, and the dialog asks for a column number rather than the header's words.
- The "Header row" checkbox is easy to miss, so the header can sort into the list as if it were data.
- Amounts sort as text unless you already know they are numbers. 10 comes before 2.

## Better than Google Workspace when

1. With the caret in a column, Sort names that column and the direction. One click. There is no dialog and no column number.
2. The header row stays first. Sorting Item A to Z makes the body Apples, Figs, Pears, and each amount stays on its item's row.
3. Sorting Amount small to large orders 2, then 4, then 10. Ten stays with Figs.
4. The next click reverses the direction, and the button says large to small before the rows flip.
5. The sentence after the table stays after the table.
6. Save and reopen keep the header and the sorted body.
7. The downloaded Word file keeps the header row and the same body order.

## Success

- Nia sorts the shopping list by name and then by amount, and the header stays on top.

## Gaps

- The table menu in `apps/web/src/editors/Docs.tsx` can insert and delete rows and toggle a header row. Nothing sorts the body rows.
- A search for sort table in `apps/web` finds no document-table sort.
