# 58 · Group rows

**Mode:** single-node · **App:** Sheets · **Video:** [videos/58-group-rows.mp4](videos/58-group-rows.mp4) · **Script:** [scenes/58-group-rows.spec.ts](scenes/58-group-rows.spec.ts)

## Who and why

Omar's donations sheet has a total row and twelve month rows under it. He wants to collapse the months so the meeting sees the total, then open January when someone asks. Google Sheets does this with Data › Group rows. SuiteLeaf has no group control, so the months always take the whole screen.

## Inspired by

- [Group rows or columns](https://support.google.com/docs/answer/9079949): select the detail rows, Data › Group rows, then use the minus button. The summary row stays visible.
- People complain that Sheets groups the summary row by mistake when it was included in the selection, and that there is no undo that only ungroups.
- There is no row-group control in `apps/web/src/editors/Sheets.tsx`.

## Scenes

1. **The year.** Omar opens "Donations". Row 1 is the total. Rows 2–13 are the months.
2. **Group the months.** He selects rows 2–13, not the total, and chooses Data › Group rows. A minus control appears beside those rows. The total stays on screen.
3. **Collapse.** He clicks the minus. Rows 2–13 hide. Row 1 is still visible and still shows the total.
4. **One month.** He clicks the plus and then collapses every month except January. January's figures are visible. February is not.
5. **Undo.** One Undo removes the group. All twelve months are visible and there is no plus or minus.
6. **Save.** He reopens the file. The group is back, collapsed the way he left it.

## Google Workspace benchmark

In Google Sheets the path is select the detail rows, Data › Group rows › Group rows, then the minus button ([Docs Help](https://support.google.com/docs/answer/9079949)). That is two menu clicks plus the selection. The summary row is grouped too if it was selected, and people only notice when the total disappears. Ungroup is a separate menu item, not one Undo.

## Better than Google Workspace when

1. Data › Group rows groups the selected rows. The row above the selection, the total, is not grouped.
2. A minus control collapses those rows. A plus expands them. The total row stays visible either way.
3. Collapsing does not change any cell value, including the total formula.
4. One Undo removes the group and shows every row again.
5. The group and whether it is collapsed survive save and reopen.
6. If the selection includes only the total, Group rows explains that there is nothing to group and does not hide the total.

## Success looks like

The meeting sees the total with the months collapsed. Omar opens January without ungrouping the rest. Undo puts the year back on screen.

## Gaps and notes

- Sheets cannot group or collapse rows.
- Do not rebuild named ranges, cell links, spelling, or dropdowns.
- Keep the Data menu hook small. Put the group logic in a new module.
