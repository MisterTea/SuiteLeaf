# 71 · Group columns

**Mode:** single-node · **App:** Sheets · **Video:** [videos/71-group-columns.mp4](videos/71-group-columns.mp4) · **Script:** [scenes/71-group-columns.spec.ts](scenes/71-group-columns.spec.ts)

## Who and why

Rosa's budget has the category name in column A and twelve month columns after it. She can already collapse month rows (storyboard 58). She cannot collapse the month columns, so the yearly total in column N is off the right edge of the window. Google Sheets groups columns the same way it groups rows.

## Inspired by

- [Group rows or columns](https://support.google.com/docs/answer/9079949): select the detail columns, Data › Group columns, then use the minus button above them. The label column stays.
- Storyboard [58](58-group-rows.md): grouping must not hide the summary, and one Undo removes the group.
- There is no column-group control next to the row groups in `apps/web/src/editors`.

## Scenes

1. **The year across.** Rosa opens "Rent budget". Column A is the category. Columns B–M are the months. Column N is the year total, past the right edge.
2. **Group the months.** She selects columns B–M, not A and not N, and chooses Data › Group columns. A minus control appears above those columns. Category and the year total stay.
3. **Collapse.** She clicks the minus. Columns B–M hide. Column N slides into view beside column A. The year total is unchanged.
4. **One month.** She expands the group and hides every month except January. February is hidden. January and the year total stay.
5. **Undo.** One Undo removes the column group. All twelve months are visible again.
6. **The label.** She selects only column A and chooses Group columns. The dialog says there is nothing to group, and column A stays visible.
7. **Save.** Redo puts the group back, still open on January. She leaves and opens Rent budget again. January is still the only month, and the year total is still beside the category.
8. **Rows still group.** She groups the Rent and Food rows and collapses them. Those rows hide. January and the year total stay, and the other months stay hidden.

## Google Workspace benchmark

In Google Sheets the path is select the detail columns, Data › Group columns › Group columns, then the minus button ([Docs Help](https://support.google.com/docs/answer/9079949)). The label column is grouped too if it was selected, and the names disappear with the months. Ungroup is a separate menu item, not one Undo.

## Better than Google Workspace when

1. Data › Group columns groups the selected columns. The column to the left of the selection is not grouped.
2. A minus control collapses those columns. A plus expands them. The year-total column stays visible and moves next to the label when the months are hidden.
3. Collapsing does not change any cell value, including the year-total formula.
4. One Undo removes the group and shows every column again.
5. The group and whether it is collapsed survive save and reopen.
6. Selecting only the label column explains that there is nothing to group and hides nothing.
7. An existing row group from storyboard 58 still collapses its rows. Column groups do not clear it.

## Success looks like

Rosa sees the category and the year total side by side, with the months collapsed. She can open January without ungrouping the rest. Undo puts the twelve months back. After she leaves and comes back, January is still the only open month.

## Gaps and notes

- A group is kept in the SuiteLeaf file. It is not written out as an Excel outline.
- Inserting or deleting columns does not move an existing group.
- If the selection includes a text category on the left, or a year-total formula on the right, those columns stay out of the group. Selecting only the category explains that there is nothing to group.
- The plus and minus sit on the column headers. There is no extra outline band above the letters.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Group columns groups the selected months, and the column to the left is not grouped | Met | Video 0:16; `tests/browser/column-groups.spec.ts` |
| Minus collapses the months, plus expands them, and the year total moves beside the category | Met | Video 0:18 and 0:22 |
| Collapse does not change values or the year-total formula | Met | Video 0:21 (`=SUM(B2:M2)`, $14,400); browser test download |
| One Undo removes the group and shows every column | Met | Video 0:24; browser test |
| The group and its collapsed columns survive save and reopen | Met | Video 0:40, January open and February hidden; browser test reopen |
| Selecting only the category explains and hides nothing | Met | Video 0:27; browser test |
| An existing row group still collapses, and column groups do not clear it | Met | Video 0:46; browser test |
