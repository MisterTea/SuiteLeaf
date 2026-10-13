# Keep the inner group

Who: Nia keeps a household budget in Excel. The month is one group of rows, and one week inside that month is a second group. She wants to hide the week without hiding the rest of the month.

Inspired by: Google Sheets' View › Group, which can nest a group inside a group. Excel stores that as `outlineLevel` 1 on the month and `outlineLevel` 2 on the week.

## Scenes

1. Nia opens a workbook. Row 1 is the month total. Rows 2–8 are the month, with outline level 1. Rows 4–6 are one week, with outline level 2. The sheet shows two outline controls, and the control for the week says which rows it will hide.
2. She collapses the week. Rows 4–6 disappear. Rows 2, 3, 7, and 8 stay. The month total stays.
3. She collapses the month. The remaining month rows disappear, and the week stays collapsed inside them. The total stays.
4. She expands the month. Rows 2, 3, 7, and 8 come back. Rows 4–6 stay hidden until she expands the week.
5. She saves, returns home, and reopens. Both groups are still there, and the week is still collapsed.
6. She downloads Excel. The month rows are outline level 1 and the week rows are outline level 2.

## Google Workspace benchmark

- Sheets can nest groups, but the only controls are tiny plus and minus buttons in a margin. Nothing says which rows will disappear.
- Collapsing the outer group forgets whether the inner group was already collapsed.
- Sheets does not show the row span on the control before the click.

## Better than Google Workspace when

1. Opening the workbook shows two groups: the month (rows 2–8) and the week inside it (rows 4–6). They are not flattened into one group.
2. Each outline control names the rows it will hide before the click. There is no second dialog.
3. Collapsing the week hides only rows 4–6. Rows 2, 3, 7, 8, and the total stay visible.
4. Collapsing the month hides the rest of the month and keeps the week collapsed. Expanding the month brings back rows 2, 3, 7, and 8, and leaves rows 4–6 hidden.
5. The total row is never part of either group.
6. Save and reopen keep both groups and the week's collapsed state.
7. The downloaded workbook writes outline level 1 on the month rows and outline level 2 on the week rows.

## Success

- Nia hides one week inside the month, and Excel still has both outline levels.

## Gaps

- `apps/web/src/editors/sheet-row-groups.ts` stores one flat span per group. A group has no level and cannot contain another group.
- `readWorksheetOutline` in `packages/core/src/excel-outline.ts` joins consecutive outlined rows into one span and only records `nested: true` when `outlineLevel` is above 1. The inner level is not a separate group.
