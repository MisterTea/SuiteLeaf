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
7. **Save.** She reopens the file. The months are collapsed the way she left them, and the year total is still beside the category.

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

Rosa sees the category and the year total side by side, with the months collapsed. She can open January without ungrouping the rest. Undo puts the twelve months back.

## Gaps and notes

- Row groups exist. Column groups do not.
- Do not rebuild row groups, named ranges, or spelling.
- Keep the Data menu hook small. Extend the row-group module or add a sibling module. Do not copy the row-group UI into a second unrelated system if one outline can hold both.
