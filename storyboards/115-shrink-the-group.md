# Shrink the group when a row is deleted

Who: Nia grouped the days of a month, and a week inside that month. She deletes one day from the middle of the week. The outline should shrink, and the controls should say the new row numbers before she collapses anything.

Inspired by: Google Sheets shrinks a group when you delete a row inside it, and shifts a group up when you delete a row above it. The plus and minus buttons do not say which rows they cover afterward. Excel removes `outlineLevel` from the deleted row and shifts the levels below it.

## Scenes

1. Nia opens a sheet. Row 1 is the total. Rows 2–8 are the month. Rows 4–6 are the week. The controls read Rows 2–8 and Rows 4–6.
2. She deletes row 5, inside the week. The week control changes to Rows 4–5. The month control changes to Rows 2–7. Row 1 stays the total. The deleted day is gone, and the days that were below it move up.
3. She collapses the week. Only the two remaining week rows hide. Rows 2, 3, 6, and 7 stay visible.
4. She deletes row 2, the first row of the month, above the week. The month control changes to Rows 2–6. The week control changes to Rows 3–4. The new row 2 is still part of the month. Row 1 stays the total.
5. She saves, returns home, and reopens. The smaller groups are still there.
6. She downloads Excel. Outline level 2 is only on the two remaining week rows. Outline level 1 is on the rest of the month. The deleted rows are gone.

## Google Workspace benchmark

- Sheets does shrink a group when a row inside it is deleted, and it does shift a group up when a row above it is deleted.
- The only sign is that the tiny outline buttons moved. Nothing names the new span.
- An inner group can keep a hidden index that now points at the wrong row.

## Better than Google Workspace when

1. Deleting a row inside the week changes the controls, before any collapse, from Rows 4–6 to Rows 4–5 and from Rows 2–8 to Rows 2–7.
2. The deleted row is in neither group. Collapsing the week hides only the two rows that remain.
3. Deleting the first row of the month shrinks the month from the top and shifts the week up by one. The row that slides into that place stays in the month.
4. The total on row 1 is never pulled into a group. Deleting a row below both groups does not move them.
5. A collapsed week stays collapsed across the delete: the hidden indexes drop the deleted row and move down for every hidden row below it. A delete above the week moves the hidden indexes up and does not expand the week.
6. Save and reopen keep the smaller spans.
7. The downloaded workbook writes outline level 2 only on the remaining week rows, and outline level 1 on the rest of the month.

## Success

- Nia deletes a day from the week and the outline controls already name the shorter span.

## Gaps

- `shiftRowGroups` in `apps/web/src/editors/sheet-row-groups.ts` only handles inserts. Nothing shrinks `startRow`, `endRow`, or `collapsed` when a row is deleted.
- `Sheets.tsx` shifts groups on insert. The delete path does not.
