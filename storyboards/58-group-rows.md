# 58 · Group rows

**Mode:** single-node · **App:** Sheets · **Video:** [videos/58-group-rows.mp4](videos/58-group-rows.mp4) · **Script:** [scenes/58-group-rows.spec.ts](scenes/58-group-rows.spec.ts)

## Who and why

Omar's donations sheet has a total row and twelve month rows under it. He wants to collapse the months so the meeting sees the total, then open January when someone asks. Google Sheets does this with Data › Group rows. SuiteLeaf has no group control, so the months always take the whole screen.

## Inspired by

- [Group rows or columns](https://support.google.com/docs/answer/9079949): select the detail rows, Data › Group rows, then use the minus button. The summary row stays visible.
- People complain that Sheets groups the summary row by mistake when it was included in the selection, and that there is no undo that only ungroups.
- There is no row-group control in `apps/web/src/editors/Sheets.tsx`.

## Scenes

1. **The year.** Omar opens "Donations". Row 1 is the total, $1,400. Rows 2–13 are the months.
2. **Only the total.** He selects row 1 and chooses Data › Group rows. A dialog explains there is nothing to group. The total stays on screen and nothing is hidden.
3. **Group the months.** He selects rows 2–13, not the total, and chooses Data › Group rows. A minus appears beside those rows. The total is not in the group.
4. **Collapse.** He clicks the minus. Rows 2–13 hide. Row 1 stays visible at $1,400, and the formula bar still shows `=SUM(B2:B13)`.
5. **One month.** He clicks the plus, selects January, and clicks Show only January. January’s $120 stays. February is hidden. The group is still there.
6. **Undo.** One Undo removes the group. All twelve months are visible and there is no plus or minus.
7. **Save.** Redo puts the group back, still open on January. He leaves and opens Donations again. January is still the only month on screen, and the total formula is unchanged.

## Google Workspace benchmark

In Google Sheets the path is select the detail rows, Data › Group rows › Group rows, then the minus button ([Docs Help](https://support.google.com/docs/answer/9079949)). That is two menu clicks plus the selection. The summary row is grouped too if it was selected, and people only notice when the total disappears. Ungroup is a separate menu item, not one Undo. Showing one month means a second, nested group.

## Better than Google Workspace when

1. Data › Group rows groups the selected rows. The row above the selection, the total, is not grouped.
2. A minus control collapses those rows. A plus expands them. The total row stays visible either way.
3. Collapsing does not change any cell value, including the total formula.
4. One Undo removes the group and shows every row again.
5. The group and whether it is collapsed survive save and reopen.
6. If the selection includes only the total, Group rows explains that there is nothing to group and does not hide the total.

## Success looks like

The meeting sees the total with the months collapsed. Omar opens January without ungrouping the rest. Undo puts the year back on screen. After he leaves and comes back, January is still the only open month.

## Gaps and notes

- Columns cannot be grouped.
- A group is kept in the SuiteLeaf file. It is not written out as an Excel outline.
- Inserting or deleting rows does not move an existing group.
- Do not rebuild named ranges, cell links, spelling, or dropdowns.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Group rows groups the selected months and not the total above them | Met | Video 0:18; `tests/browser/row-groups.spec.ts` |
| Minus collapses the months, plus expands them, and the total stays visible | Met | Video 0:18 and 0:21 |
| Collapse does not change values or the total formula | Met | Video 0:21 (`=SUM(B2:B13)`, $1,400); browser test download |
| One Undo removes the group and shows every row | Met | Video 0:27; browser test |
| The group and its collapsed rows survive save and reopen | Met | Video 0:39, January open and February hidden; browser test reopen |
| Selecting only the total explains and hides nothing | Met | Video 0:11; browser test |
