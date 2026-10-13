# 37 · Dropdown lists in a sheet

**Mode:** single-node · **App:** Sheets · **Video:** [videos/37-dropdown-lists-in-a-sheet.mp4](videos/37-dropdown-lists-in-a-sheet.mp4) · **Script:** [scenes/37-dropdown-lists-in-a-sheet.spec.ts](scenes/37-dropdown-lists-in-a-sheet.spec.ts)

## Who and why

Lena keeps the food bank's volunteer roster. The Status column is a mess of "confirmed", "Confirmed ", "yes", and "tbc", so she can't filter it. She wants a dropdown with three choices, each in its own colour, that stops people typing anything else. When the committee adds a "Waitlist" status in a month, she wants to add it and rename "Tentative" to "Maybe" without repainting every cell.

## Inspired by

- WF-A2-13 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): data validation should block bad input ("data validation… out-of-v1").
- Storyboard [18](18-highlight-and-check-off.md): SuiteLeaf already turns cells into checkboxes through data validation.
- [Docs Editors Help: Create an in-cell dropdown list](https://support.google.com/docs/answer/186103): Insert › Dropdown, chips, colours, reject or warn, and "Remove any leading/trailing whitespace in dropdown options".
- [r/googlesheets: chip colour and dropdown from a range](https://www.reddit.com/r/googlesheets/comments/17ph81e/chip_color_and_data_validation_drop_down_list/): renaming a source item turns its chip grey.
- [r/googlesheets: multi-select dropdowns losing colours](https://www.reddit.com/r/googlesheets/comments/1qqmjmg/dropdown_cells_allowing_multiple_selections_not/): "the culprit: Hidden Spaces".
- [Stack Overflow: set the dropdown display style in Apps Script](https://stackoverflow.com/questions/75397247/set-data-validation-display-style-in-apps-script): colours from a range stick to positions, so people pad the range with blank cells.
- [r/googlesheets: change the chip text colour](https://www.reddit.com/r/googlesheets/comments/1vf2mur/how_can_i_change_the_color_of_the_text_in_the/): the option is hard to find.

## Scenes

1. **Open the roster.** Lena opens "Volunteer roster". Column C, Status, has 40 rows of inconsistent text.
2. **Make a dropdown.** She selects C2:C41 and chooses Insert › Dropdown (or right-clicks › Dropdown). A side panel opens with the options already filled in from the distinct values in the column, trimmed and grouped case-insensitively: "Confirmed", "Tentative", "yes", "tbc".
3. **Tidy the options.** She deletes "yes" and "tbc", adds "Can't make it", and picks green, amber, and grey. A preview chip next to each option shows the colour with readable text. She leaves "Reject input" on and clicks **Done**.
4. **Fix the leftovers.** Cells that don't match an option get a red corner, and a notice says "6 cells don't match the list · Review". **Review** steps through them, offering the closest option ("yes" → Confirmed?) with Accept and Skip.
5. **Pick from the cell.** Clicking C5 shows a chip with a small arrow. Typing "ma" filters the list, and Enter picks "Can't make it".
6. **Typing something else.** In C6 she types "maybe" and presses Enter. The cell is refused, with "Choose Confirmed, Tentative, or Can't make it."
7. **Rename an option.** She reopens Data › Data validation, renames "Tentative" to "Maybe", and adds "Waitlist" in blue. Every cell that said Tentative now says Maybe and keeps its amber chip.
8. **Filter by status.** Data › Create a filter, then the Status filter lists exactly the four options.
9. **Send to Excel.** File › Export XLSX. In Excel the column has a list validation with the same four options and the same reject setting. Re-importing the file into SuiteLeaf restores the dropdown.

## Google Workspace benchmark

In Google Sheets, a dropdown takes about 5 clicks: Insert › Dropdown (2), then add or edit options in the side panel (typing), pick a colour for each option (2 clicks each), Advanced options › "Reject the input" (2), and Done (1). Google fills the options from the selected cells' values. Renaming an option means Data › Data validation, the rule, then editing the option ([Docs Help](https://support.google.com/docs/answer/186103)).

Known pain points:

- Colours are tied to exact text: renaming an item in the source range turns its chips grey ([r/googlesheets](https://www.reddit.com/r/googlesheets/comments/17ph81e/chip_color_and_data_validation_drop_down_list/)).
- Trailing spaces silently break the match ([r/googlesheets](https://www.reddit.com/r/googlesheets/comments/1qqmjmg/dropdown_cells_allowing_multiple_selections_not/)).
- With a range as the source, colours stick to positions, and people pad ranges with blank cells to keep them ([Stack Overflow](https://stackoverflow.com/questions/75397247/set-data-validation-display-style-in-apps-script)).
- Deleting a coloured value from the source range leaves an uneditable leftover in the rule ([Docs Help](https://support.google.com/docs/answer/186103)).
- Renaming an option in the rule doesn't change the cells that already hold the old value.

## Better than Google Workspace when

1. With cells selected, Insert › Dropdown or right-click › Dropdown creates a dropdown in at most 2 clicks, pre-filled with the selection's distinct values, trimmed and de-duplicated ignoring case.
2. Each option can have a colour, and chips always have readable text (contrast of at least 4.5:1) without picking a text colour.
3. Renaming an option in the rule changes every cell holding the old value and keeps the option's colour.
4. Matching ignores leading and trailing spaces, so "Confirmed " is treated as "Confirmed" and shows its colour.
5. After a dropdown is created over existing data, non-matching cells are marked, counted, and can be reviewed one by one with a suggested option.
6. Typing a value that isn't an option is refused (or warned, if the rule says so) with a message naming the allowed options. Pasting invalid values over many cells marks every one.
7. In a dropdown cell, typing filters the options and arrow keys plus Enter choose one, so no mouse is needed.
8. Dropdowns and their reject or warn setting survive save and reopen and an XLSX round trip through Excel (list validation with the same options and error style).

## Success looks like

- Status holds only Confirmed, Maybe, Can't make it, and Waitlist, each with its own chip colour, and the filter lists exactly those four.
- The exported workbook has the same list validation in Excel.

## Gaps and notes

- **Dropdowns exist, but only through Univer's panel.** The data-validation preset is installed, and Data › Data validation (and Sheet tools › Data validation) runs Univer's `open-validation-panel` command, where a list rule can be created. Whether chips, colours, and reject-or-warn look and read well there needs checking in the recording.
- **There's no quick way in.** The Insert menu has Checkbox (built with `requireCheckbox`) but no Dropdown, and nothing pre-fills options from existing cell values.
- SuiteLeaf code doesn't propagate a renamed option to existing cells, trim when matching, or offer a review of non-matching cells. Whatever Univer does by default is the starting point.
- **XLSX round trip is in place for list rules.** `excel-features.ts` imports `type="list"` validations, and `xlsx-export.ts` writes `dataValidation` with `showErrorMessage` and `errorStyle`. Chip colours have no Excel equivalent, so they only survive in the native file.
