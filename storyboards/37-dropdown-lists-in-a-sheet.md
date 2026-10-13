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

1. **Open the roster.** Lena opens "Volunteer roster". Column C, Status, has 40 rows of inconsistent text: Confirmed, "Confirmed ", confirmed, Tentative, yes, tbc.
2. **Make a dropdown.** She selects C2:C41 and chooses Insert › Dropdown. A side panel opens with the options already filled in from the distinct values, trimmed and grouped case-insensitively: Confirmed, Tentative, yes, tbc. Reject other values is already on.
3. **Tidy the options.** She deletes yes and tbc, adds "Can't make it", and picks green, amber, and grey. A preview chip next to each option shows the colour with readable text. She clicks **Done**.
4. **Fix the leftovers.** Cells that don't match get a red corner, and a notice says "6 cells don't match the list" with **Review**. Review steps through them — yes and tbc — offering Confirmed, with Accept and Skip. Accepting writes Confirmed and its green chip.
5. **Pick from the cell.** In C5 she types "ma". The list filters to "Can't make it", and Enter picks it.
6. **Typing something else.** In C6 she types "maybe" and presses Enter. The cell is refused, with "Choose Confirmed, Tentative, or Can't make it." Helen stays Confirmed.
7. **Rename an option.** She reopens Data › Data validation, renames Tentative to Maybe, and adds Waitlist in blue. Every cell that said Tentative now says Maybe and keeps its amber chip. She sets Priya to Waitlist.
8. **Filter by status.** Data › Create a filter, then the Status filter lists exactly Confirmed, Maybe, Can't make it, and Waitlist.
9. **Send to Excel.** File › Export XLSX. The column has a list validation with those four options and error style stop. Opening the workbook again restores the dropdown and the reject setting. Chip colours stay in the SuiteLeaf file; Excel has no place for them.

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
- The exported workbook has the same list validation and reject setting. Re-importing restores the dropdown.

## Gaps and notes

- **The quick path is Insert › Dropdown and right-click › Dropdown.** Data › Data validation opens the same editor when the selection already has a list, and still opens Univer's panel for any other kind of rule.
- **A comma can't be part of an option.** Excel stores a list as comma-separated text, so the editor blocks a comma instead of silently splitting the option on the way back from Excel.
- **Chip colours have no Excel equivalent.** They travel in the SuiteLeaf file. After an XLSX round trip the list, the reject setting, and chip rendering come back; the colours are the palette defaults for those positions.
- Multi-select dropdowns, and lists that read from another range, are not part of this story.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Insert › Dropdown in 2 clicks, pre-filled, trimmed, de-duplicated ignoring case | Met | Video ~14–20s. Scene expects Confirmed, Tentative, yes, tbc from "Confirmed ", confirmed, yes, tbc. |
| 2. Option colours, chip text at least 4.5:1 without picking a text colour | Met | Video ~20s (panel chips) and ~52s (green, amber, grey, blue cells). Test `every chip color has readable text without a chosen text color`. |
| 3. Renaming an option updates every cell and keeps the colour | Met | Video ~45s: Tentative becomes Maybe and stays amber. Exported C16 and C17 are Maybe. |
| 4. Matching ignores leading and trailing spaces | Met | "Confirmed " and confirmed become Confirmed and take the green chip. Test `matching ignores surrounding spaces and letter case`. |
| 5. Non-matching cells are marked, counted, and reviewed with a suggestion | Met | Video ~23s: red corners, "6 cells don't match the list", yes → Confirmed, Accept. |
| 6. A value that isn't an option is refused, naming the options. Pasting invalid values marks every one | Met | Video ~36s: "Choose Confirmed, Tentative, or Can't make it." Helen stays Confirmed. Test `a pasted block tidies every matching cell and leaves the rest`; leftovers get the same red corner as yes and tbc. |
| 7. Typing filters the list; arrow keys and Enter choose | Met | Video ~30s: "ma" leaves only "Can't make it", Enter selects it. |
| 8. Reject or warn survives save, reopen, and an XLSX round trip | Met | Video ~62–66s: the re-imported file opens Data › Data validation with the four options and Reject checked. Test `list rules round-trip through Excel with the same options and reject setting`. Browser test `dropdown lists are prefilled, reject bad values, and survive the file` checks the native file. |
