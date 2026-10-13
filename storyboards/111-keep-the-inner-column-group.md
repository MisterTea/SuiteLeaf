# Keep the inner column group

Who: Nia keeps a quarterly budget across columns. Columns B through H are the quarter, and columns D through F are one week inside it. Column A is the row labels. She wants to hide the week without hiding the rest of the quarter.

Inspired by: Google Sheets' View › Group › Group columns, which can nest a column group inside a column group. Excel stores that as `outlineLevel` 1 on the quarter and `outlineLevel` 2 on the week.

## Scenes

1. Nia opens a workbook. Column A is the labels. Columns B–H are the quarter, with outline level 1. Columns D–F are one week, with outline level 2. The sheet shows two column outline controls, and each one names the columns it will hide.
2. She collapses the week. Columns D–F disappear. Columns B, C, G, and H stay. Column A stays.
3. She collapses the quarter. The remaining quarter columns disappear, and the week stays collapsed inside them. Column A stays.
4. She expands the quarter. Columns B, C, G, and H come back. Columns D–F stay hidden until she expands the week.
5. She saves, returns home, and reopens. Both groups are still there, and the week is still collapsed.
6. She downloads Excel. The quarter columns are outline level 1 and the week columns are outline level 2.

## Google Workspace benchmark

- Sheets can nest column groups, but the only controls are tiny plus and minus buttons above the letters. Nothing says which columns will disappear.
- Collapsing the outer group forgets whether the inner group was already collapsed.
- Sheets does not show the column span on the control before the click.

## Better than Google Workspace when

1. Opening the workbook shows two column groups: the quarter (columns B–H) and the week inside it (columns D–F). They are not flattened into one group.
2. Each outline control names the columns it will hide before the click. There is no second dialog.
3. Collapsing the week hides only columns D–F. Columns A, B, C, G, and H stay visible.
4. Collapsing the quarter hides the rest of the quarter and keeps the week collapsed. Expanding the quarter brings back columns B, C, G, and H, and leaves columns D–F hidden.
5. Column A is never part of either group.
6. Save and reopen keep both groups and the week's collapsed state.
7. The downloaded workbook writes outline level 1 on columns B, C, G, and H, and outline level 2 on columns D–F.

## Success

- Nia hides one week of columns inside the quarter, and Excel still has both outline levels.

## Gaps

- `apps/web/src/editors/sheet-column-groups.ts` stores one flat span per group. A column group has no level and cannot contain another group.
- `readWorksheetOutline` in `packages/core/src/excel-outline.ts` keeps nested row groups, then still joins consecutive outlined columns into one span through `spansFrom`. The inner column level is not a separate group.
