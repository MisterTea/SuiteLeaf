# 48 · Dropdowns with several choices, or from a range

**Mode:** single-node · **App:** Sheets · **Video:** [videos/48-dropdowns-from-a-range.mp4](videos/48-dropdowns-from-a-range.mp4) · **Script:** [scenes/48-dropdowns-from-a-range.spec.ts](scenes/48-dropdowns-from-a-range.spec.ts)

## Who and why

Lena's Status column on "Volunteer roster" is already a dropdown (storyboard 37). Two gaps are left. The committee keeps the official status names on a "Statuses" sheet, and she wants the dropdown to follow that list when they add one. A person can also hold two roles, so the Roles column needs a dropdown that allows more than one choice, still in color, still refusing anything off the list.

## Inspired by

- WF-A2-13 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): data validation blocks bad input.
- Storyboard [37](37-dropdown-lists-in-a-sheet.md): a fixed list, chip colors, rename, trim, and reject. Its gaps call out multi-select and a list read from a range.
- [Create an in-cell dropdown list](https://support.google.com/docs/answer/186103): "Dropdown" or "Dropdown (from a range)", chip colors, and allowing multiple selections.
- [r/googlesheets: chip color and a dropdown from a range](https://www.reddit.com/r/googlesheets/comments/17ph81e/chip_color_and_data_validation_drop_down_list/): renaming a source cell turns the chip grey.
- [r/googlesheets: multi-select chips and hidden spaces](https://www.reddit.com/r/googlesheets/comments/1qqmjmg/dropdown_cells_allowing_multiple_selections_not/): a trailing space makes a selected chip lose its color.
- [Stack Overflow: colors stick to positions in a range](https://stackoverflow.com/questions/75397247/set-data-validation-display-style-in-apps-script): people pad the range with blank cells so the colors don't shift.

## Scenes

1. **The source list.** "Statuses" column A holds Confirmed, Maybe, Can't make it, and Waitlist, the same names as storyboard 37, with no blanks in between. "Volunteer roster" column C is the old fixed dropdown.
2. **Switch to the range.** Lena selects C2:C41, opens the dropdown editor, chooses **From a range**, and sets Statuses!A2:A5. Done. The chips still show the four colors. C5 still says Maybe.
3. **The list grows.** On Statuses she types "Training" in the cell under the range. The dropdown follows it. She gives Training a purple chip from the rule and sets Priya to Training. The Maybe chips stay amber.
4. **Rename at the source.** She renames Maybe to Perhaps on Statuses. Every Perhaps chip stays amber. She inserts a row inside the range. The blank cell is not an option, and Training stays on the list.
5. **More than one role.** Roles, column D, has Helper, Driver, and Cook on a small list. She selects D2:D41, Insert › Dropdown, and turns on **Allow more than one**. Reject other values stays on.
6. **Pick two.** In D5 she types "dr". Driver is the match. Enter adds the Driver chip and leaves the list open. She adds Cook. The cell shows both chips. Escape closes the list.
7. **A bad extra value.** She enters "Driver, Cook, Boss" in D6. Boss is refused, the message names Helper, Driver, and Cook, and D6 keeps Driver and Cook. "Driver " with a trailing space still matches Driver and keeps its color.
8. **Round trip.** File › Export XLSX. Column C's validation points at the Statuses range. Opening that workbook restores From a range. Excel has no multi-select, so column D's roles are text there. The downloaded SuiteLeaf file restores the colors, From a range, and Allow more than one. A fixed list from storyboard 37, left on another column, still renames and rejects as before.

## Google Workspace benchmark

A dropdown from a range is Insert › Dropdown, then the range field instead of typing options: about 4 clicks plus selecting the range. Multiple selections are a checkbox in the same panel ([Docs Help](https://support.google.com/docs/answer/186103)). Colors for a range are tied to the cell's position in the list, not to the text.

Known pain points:

- Renaming or reordering the source turns chips grey or swaps their colors ([r/googlesheets](https://www.reddit.com/r/googlesheets/comments/17ph81e/chip_color_and_data_validation_drop_down_list/), [Stack Overflow](https://stackoverflow.com/questions/75397247/set-data-validation-display-style-in-apps-script)).
- A trailing space in a multi-select cell drops the chip color ([r/googlesheets](https://www.reddit.com/r/googlesheets/comments/1qqmjmg/dropdown_cells_allowing_multiple_selections_not/)).
- Blank cells in the source become blank options unless the range is edited by hand.

## Better than Google Workspace when

1. The dropdown editor can switch a list to From a range and take a range such as Statuses!A2:A5. Cells then offer exactly the non-blank values in that range.
2. Adding a value to the range adds the option. Renaming a source cell renames the chips that showed the old text and keeps each option's color.
3. A blank cell in the range is not an option.
4. Allow more than one stores several options in one cell, shown as chips. Typing filters the list, Enter adds the highlighted option without closing it, and Escape closes it.
5. Reject refuses a value that is not an option, including one bad token among valid ones, with a message that names the options. Matching still ignores leading and trailing spaces.
6. A From a range rule survives save, reopen, and an XLSX round trip as a list validation whose source is that range.
7. Allow more than one and the chip colors survive save, reopen, and the native file.
8. A fixed list from storyboard 37 still pre-fills, renames cells when an option is renamed, and rejects other values.

## Success looks like

- Status offers Confirmed, Perhaps, Can't make it, Waitlist, and Training, from the Statuses sheet, and Perhaps is still amber.
- D5 shows Driver and Cook. D6 does not contain Boss. The re-imported file still reads the range and still allows more than one role.

## Gaps and notes

- Excel has no multi-select. Export keeps column C as a list whose source is the Statuses range. Column D's chosen roles are text in the workbook, and opening that file marks a cell that holds two roles because Excel stored an ordinary list. Allow more than one, and the chip colours, come back from the SuiteLeaf file.
- Chip colours for a range are kept with each name in the SuiteLeaf file. After an XLSX round trip the range comes back and the colours are the palette for the current order.
- A comma still cannot be part of one option on a fixed list (storyboard 37). A range source does not have that limit, because the option is the cell's text.
- Typing a new value in the cell directly under a single-column source extends the range, so the list grows without editing the reference by hand. Inserting a row inside the range does the same for a value that slides just past the end. A blank cell in the middle is skipped.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. The editor can switch a list to From a range, and cells offer the non-blank values | Met | Video ~18–24s: Insert › Dropdown, From a range, Statuses!A2:A5, four coloured options. Test `dropdowns can read a range and accept more than one choice`. |
| 2. Adding a value adds the option. Renaming a source cell renames the chips and keeps the colour | Met | Video ~30s: Training appears and is set to purple. Video ~40s: Maybe becomes Perhaps and stays amber. |
| 3. A blank cell in the range is not an option | Met | Video ~42–48s: a row inserted in the range is not listed; the five names remain. Test `renaming a source cell keeps its colour and a blank is not an option`. |
| 4. Allow more than one stores several chips. Enter adds one and leaves the list open. Escape closes it | Met | Video ~54–60s: "dr" then Enter leaves the list open, Cook is added, Escape closes it. D5 shows Driver and Cook. |
| 5. Reject refuses a bad token among valid ones, names the options, and ignores surrounding spaces | Met | Video ~64s: "D6 is marked. Boss isn't an option. Choose Helper, Driver, or Cook." D6 keeps Driver and Cook. "Driver " becomes a Driver chip. Test `a bad token is refused and a trailing space still matches`. |
| 6. From a range survives save, reopen, and an XLSX round trip as a list whose source is that range | Met | Video ~74–78s: the re-imported workbook opens Data › Data validation on From a range, Statuses!A2:A7. Test `a from-a-range rule round-trips through Excel as that range`. |
| 7. Allow more than one and the chip colours survive save, reopen, and the native file | Met | Video ~85–90s: Perhaps is amber, Training is purple, Driver and Cook are chips, and the native file still allows more than one role. |
| 8. A fixed list from storyboard 37 still renames cells and rejects other values | Met | Video ~66–70s: Evening becomes Night across the Shift column, and "nope" is refused with "Choose Morning, Afternoon, or Night." |
