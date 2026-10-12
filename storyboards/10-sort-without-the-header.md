# 10 · Sort a column without moving the header

**Mode:** single-node · **App:** Sheets · **Video:** [videos/10-sort-without-the-header.mp4](videos/10-sort-without-the-header.mp4) · **Script:** [scenes/sheets.spec.ts](scenes/sheets.spec.ts)

## Who and why

Lena coordinates volunteers and keeps their hours in a small table. She wants the busiest volunteers at the top, but in other apps sorting the Hours column dragged the "Hours" header into the middle of the list, or scrambled names away from their hours.

## Inspired by

- [r/googlesheets: How can I sort a column without including the header?](https://www.reddit.com/r/googlesheets/comments/11tpxro/how_can_i_sort_a_column_without_including_the/), one of the most common Sheets questions.
- [Google Docs Editors Help: Sort & filter your data](https://support.google.com/docs/answer/3540681): select the range, then Data › Sort range › Advanced range sorting options › "Data has header row".
- [Sheets Bootcamp: How to sort and alphabetize](https://www.sheetsbootcamp.com/sort-google-sheets/): select every column so rows move as one unit; "Sort sheet" treats row 1 as data unless it is frozen.

## Scenes

1. **Open the sheet.** Lena opens "Volunteer hours" (Name, Team, Hours, eight volunteers).
2. **Select the whole table.** She drags across A1:C9, header included, so each row stays together.
3. **Sort range.** She chooses Data › Sort range.
4. **The header is recognised.** "Sort range from A1 to C9" opens with "Data has header row" already ticked, because row 1 is text above a column of numbers. The "Sort by" list shows the header names (Name, Team, Hours) instead of column letters.
5. **Pick the column and order.** She picks Hours and Z → A, then clicks Sort.
6. **Result.** Row 1 still reads Name, Team, Hours. Wen Zhou (Greeters, 31) is first and Grace Obi (Setup, 7) is last; every name kept its own team and hours.

## Success looks like

- The header row stays in row 1 and the eight data rows are ordered by Hours, largest first.
- Each row moved as a unit (verified in the downloaded file).

## Gaps and notes

- **Data › Sort range** now opens a Sheets-style dialog: "Data has header row", "Sort by" with A → Z / Z → A, and "Add another sort column". With a single cell selected it sorts the sheet's data region. Escape or Cancel closes it without changes, and Undo reverses a sort.
- Header detection is a simple guess: row 1 must be all text, with numbers or true/false somewhere below it. An all-text table (for example Name and Team only) starts unticked, so the person ticks the box. Sheets also looks at formatting such as a bold first row.
- Sheets' Data menu has "Sort sheet" and "Sort range" submenus with quick "Sort range by column A (A to Z)" items. SuiteLeaf's menus have no submenus yet, so "Sort range" goes straight to the dialog.
- The right-click path (Sort › Custom Sort) still uses Univer's own dialogs: an extra "Sort Reminder" step even when the whole table is selected, "First row does not participate in sorting" instead of "Data has header row", and labels such as "Expand Ascending". The longest items in that menu can also sit behind the bottom of the window when you right-click low in the grid.
- Not specific to sorting: just after the workbook opens, the "Sheet tools" strip appears and pushes the toolbar and grid down by about one row.
