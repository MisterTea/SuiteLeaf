# Shift the column group when a column is inserted

Who: Nia grouped a quarter across columns B–H, and a week inside it across D–F. Column A is the row labels. She inserts a new day in the middle of the week. The outline should grow, and the controls should say the new column letters before she collapses anything.

Inspired by: Google Sheets moves a column group when you insert a column inside it, but the plus and minus buttons above the letters do not say which columns they cover. Excel shifts `outlineLevel` with the inserted column.

## Scenes

1. Nia opens a sheet. Column A is the labels. Columns B–H are the quarter. Columns D–F are the week. The controls read Columns B–H and Columns D–F.
2. She inserts one column at E, inside the week and after the week's first column. The week control changes to Columns D–G. The quarter control changes to Columns B–I. The new column is inside both groups. Column A stays the labels and is not grouped.
3. She collapses the week. The new column hides with D, F, and G. Columns B, C, H, and I stay visible.
4. She inserts one column at B, the first column of the quarter. Both groups move right by one: the quarter reads Columns C–J and the week reads Columns E–H. The new column B is not inside either group. Column A stays the labels.
5. She saves, returns home, and reopens. The shifted groups are still there.
6. She downloads Excel. The outline levels sit on the shifted columns, including the inserted day inside the week.

## Google Workspace benchmark

- Sheets does expand a column group when a column is inserted inside it, and it does shift a group when a column is inserted at its first column or to its left.
- The only sign is that the tiny outline buttons moved. Nothing names the new span.
- An inner group and an outer group can drift apart, and Sheets does not show both new spans together.

## Better than Google Workspace when

1. Inserting a column inside the week changes the controls, before any collapse, from Columns D–F to Columns D–G and from Columns B–H to Columns B–I.
2. The inserted column belongs to both groups. Collapsing the week hides it.
3. Inserting a column at B shifts both groups right by one and leaves the new column ungrouped.
4. Column A is never pulled into a group by either insert.
5. A collapsed week stays collapsed across the insert: the hidden columns include the inserted column when the insert is inside the week, and the hidden indexes move right when the insert is at B or to the left of the week.
6. Save and reopen keep the shifted spans.
7. The downloaded workbook writes outline level 2 on the week, including the inserted column, and outline level 1 on the rest of the quarter.

## Success

- Nia inserts a day in the week and the outline controls already name the new columns.

## Gaps

- `shiftRowGroups` in `apps/web/src/editors/sheet-row-groups.ts` updates row groups on insert. `sheet-column-groups.ts` has no matching function for columns.
- `Sheets.tsx` shifts row groups when a row is inserted. Inserting a column does not update the column groups.
