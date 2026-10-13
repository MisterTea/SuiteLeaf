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
3. **The list grows.** On Statuses she types "Training" in A6 and gives it a purple chip from the rule. C2:C41 now offer Training. She sets Priya to Training. The Maybe chips stay amber.
4. **Rename at the source.** She renames Maybe to Perhaps on Statuses. Every Perhaps chip stays amber. A blank she inserts in the range does not become an option.
5. **More than one role.** Roles, column D, has Helper, Driver, and Cook on a small list. She selects D2:D41, Insert › Dropdown, and turns on **Allow more than one**. Reject other values stays on.
6. **Pick two.** In D5 she types "dr". Driver is the match. Enter adds the Driver chip and leaves the list open. She adds Cook. The cell shows both chips. Escape closes the list.
7. **A bad extra value.** She pastes "Driver, Cook, Boss" into D6. Boss is refused, D6 is marked, and the message names Helper, Driver, and Cook. "Driver " with a trailing space still matches Driver and keeps its color.
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

- Options are a static list. `optionsFromRule` reads `formula1` as JSON or comma-separated labels, and the draft is options, reject, and notation. Nothing stores a source range or reads live cells.
- The editor only treats a rule whose criteria type is `list`. There is no From a range choice and no Allow more than one flag.
- Excel has no multi-select dropdown. The XLSX file should keep the range validation for column C. Allow more than one has to come back from the SuiteLeaf file; the gap to accept in the recording is that Excel itself will show the chosen roles as text.
- A comma still cannot be part of one option (storyboard 37), because a fixed list is comma-separated on the way through Excel. A range source does not have that limit, because the option is the cell's text.
