# Shift the group when a row is inserted

Who: Nia grouped the days of a month, and a week inside that month. She inserts a new day in the middle of the week. The outline should grow to include that day, and the controls should say the new row numbers before she collapses anything.

Inspired by: Google Sheets moves a group when you insert a row inside it, but the plus and minus buttons do not say which rows they cover. Excel shifts `outlineLevel` with the inserted row.

## Scenes

1. Nia opens a sheet. Row 1 is the total. Rows 2–8 are the month. Rows 4–6 are the week. The controls read Rows 2–8 and Rows 4–6.
2. She inserts one row at row 5, inside the week. The week control changes to Rows 4–7. The month control changes to Rows 2–9. The new row is inside both groups. Row 1 stays the total and is not grouped.
3. She collapses the week. The new row hides with rows 4, 6, and 7. Rows 2, 3, 8, and 9 stay visible.
4. She inserts one row at row 2, above the month. Both groups move down by one: the month reads Rows 3–10 and the week reads Rows 5–8. Row 1 is still the total. The new row 2 is not inside either group.
5. She saves, returns home, and reopens. The shifted groups are still there.
6. She downloads Excel. The outline levels sit on the shifted rows, including the inserted day inside the week.

## Google Workspace benchmark

- Sheets does expand a group when a row is inserted inside it, and it does shift a group when a row is inserted above it.
- The only sign is that the tiny outline buttons moved. Nothing names the new span.
- An inner group and an outer group can drift apart, and Sheets does not show both new spans together.

## Better than Google Workspace when

1. Inserting a row inside the week changes the controls, before any collapse, from Rows 4–6 to Rows 4–7 and from Rows 2–8 to Rows 2–9.
2. The inserted row belongs to both groups. Collapsing the week hides it.
3. Inserting a row above the month shifts both groups down by one and leaves the new row ungrouped.
4. The total on row 1 is never pulled into a group by either insert.
5. A collapsed week stays collapsed across the insert: the hidden rows include the inserted row when the insert is inside the week, and the hidden indexes move down when the insert is above the week.
6. Save and reopen keep the shifted spans.
7. The downloaded workbook writes outline level 2 on the week, including the inserted row, and outline level 1 on the rest of the month.

## Success

- Nia inserts a day in the week and the outline controls already name the new rows.

## Gaps

- `apps/web/src/editors/sheet-row-groups.ts` stores `startRow` and `endRow` and has no function that shifts those bounds when a row is inserted.
- `Sheets.tsx` can insert rows. Nothing in that path updates the row groups.
