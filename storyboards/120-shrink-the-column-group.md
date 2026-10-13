# Shrink the column group when a column is deleted

Who: Nia grouped a quarter across columns B–H, and a week inside it across D–F. Column A is the row labels. She deletes one day from the middle of the week. The outline should shrink, and the controls should say the new column letters before she collapses anything.

Inspired by: Google Sheets shrinks a column group when you delete a column inside it, and shifts a group left when you delete a column at its start or to its left. The plus and minus buttons do not say which columns they cover afterward. Excel removes `outlineLevel` from the deleted column and shifts the levels to its right.

## Scenes

1. Nia opens a sheet. Column A is the labels. Columns B–H are the quarter. Columns D–F are the week. The controls read Columns B–H and Columns D–F.
2. She deletes column E, inside the week. The week control changes to Columns D–E. The quarter control changes to Columns B–G. Column A stays the labels. The deleted day is gone, and the days that were to its right move left.
3. She collapses the week. Only the two remaining week columns hide. Columns B, C, F, and G stay visible.
4. She deletes column B, the first column of the quarter, to the left of the week. The quarter control changes to Columns B–F. The week control changes to Columns C–D. The column that slides into B stays in the quarter. Column A stays the labels.
5. She saves, returns home, and reopens. The smaller groups are still there.
6. She downloads Excel. Outline level 2 is only on the two remaining week columns. Outline level 1 is on the rest of the quarter. The deleted columns are gone.

## Google Workspace benchmark

- Sheets does shrink a column group when a column inside it is deleted, and it does shift a group left when a column to its left is deleted.
- The only sign is that the tiny outline buttons moved. Nothing names the new span.
- An inner group can keep a hidden index that now points at the wrong column.

## Better than Google Workspace when

1. Deleting a column inside the week changes the controls, before any collapse, from Columns D–F to Columns D–E and from Columns B–H to Columns B–G.
2. The deleted column is in neither group. Collapsing the week hides only the two columns that remain.
3. Deleting the first column of the quarter shrinks the quarter from the left and shifts the week left by one. The column that slides into B stays in the quarter.
4. Column A is never pulled into a group. Deleting a column to the right of both groups does not move them.
5. A collapsed week stays collapsed across the delete: the hidden indexes drop the deleted column and move left for every hidden column to its right. A delete to the left of the week moves the hidden indexes left and does not expand the week.
6. Save and reopen keep the smaller spans.
7. The downloaded workbook writes outline level 2 only on the remaining week columns, and outline level 1 on the rest of the quarter.

## Success

- Nia deletes a day from the week and the outline controls already name the shorter span.

## Gaps

- `shiftColumnGroups` in `apps/web/src/editors/sheet-column-groups.ts` only handles inserts. Nothing shrinks `startColumn`, `endColumn`, or `collapsed` when a column is deleted.
- `Sheets.tsx` shifts column groups on insert. The delete path does not. Row delete already calls `shrinkRowGroups`.
