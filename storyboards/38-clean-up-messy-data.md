# 38 · Clean up messy data

**Mode:** single-node · **App:** Sheets · **Video:** [videos/38-clean-up-messy-data.mp4](videos/38-clean-up-messy-data.mp4) · **Script:** [scenes/38-clean-up-messy-data.spec.ts](scenes/38-clean-up-messy-data.spec.ts)

## Who and why

Omar is treasurer of a small charity. He has pasted three months of donations from the payment site's email receipts into one sheet. Names have stray spaces, the "Donor" column reads "Okafor, Ade" where he needs separate first and last names, and people who gave twice appear twice. He needs a clean list of unique donors for thank-you letters. He's nervous about deleting the wrong rows, so he wants to see what will go before it goes, and to be able to undo it.

## Inspired by

- WF-B2-10 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): sorting, filtering, and managing data.
- [Docs Editors Help: Split text, remove duplicates, or trim whitespace](https://support.google.com/docs/answer/6325535): Data › Split text to columns, Data › Data cleanup › Remove duplicates and Trim whitespace. "Non-breaking space… will not be trimmed."
- [WildandFree Tools: Remove duplicates in Google Sheets not working?](https://wildandfreetools.com/blog/remove-duplicates-google-sheets-alternative-free/): no preview, greyed out on filtered ranges, and a result that "disappears after three seconds".
- [SheetsHowTo: remove duplicates in Google Sheets](https://sheetshowto.com/remove-duplicates-google-sheets/): run Trim whitespace first, because "Anna Smith" and "Anna Smith " aren't treated as duplicates.
- [Sheets Bootcamp: remove duplicates](https://www.sheetsbootcamp.com/remove-duplicates/): people build COUNTIF helper columns just to see duplicates before deleting them.
- [r/googlesheets: delete a row if a duplicate is found in one column](https://www.reddit.com/r/googlesheets/comments/1lt9cni/delete_row_if_duplicate_found_in_one_column/): wanting to choose which duplicate to keep (the one with more details filled in).

## Scenes

1. **Open the donations.** Omar opens "Donations Q3": columns Date, Donor, Email, Amount, Gift Aid. There are 112 rows.
2. **Trim.** He selects columns B:C and chooses Data › Data cleanup › Trim whitespace. A notice reads "Trimmed 23 cells (including 4 non-breaking spaces)".
3. **Split names.** He selects B2:B113 and chooses Data › Split text to columns. A panel detects "Comma" as the separator and previews two columns, "Okafor" and "Ade". It warns "Column C isn't empty: insert 1 column?" He keeps **Insert columns**, renames the headers Last name and First name, and clicks Split.
4. **Find duplicates.** He selects the whole table and chooses Data › Data cleanup › Remove duplicates. The dialog detects the header row and lists the columns with checkboxes. He ticks only Email.
5. **Choose which to keep.** Under "Keep" he picks "The row with the most filled cells", because some later receipts include the Gift Aid flag.
6. **Preview.** The dialog says "9 duplicate rows will be removed, 103 will remain", and those 9 rows are highlighted in the sheet behind it. He scrolls to check two of them.
7. **Remove.** He clicks Remove. A notice that stays until he closes it reads "Removed 9 duplicate rows · 103 remain · Undo".
8. **Undo and redo.** One Cmd/Ctrl+Z brings all 9 rows back in their original positions, and Cmd/Ctrl+Shift+Z removes them again.
9. **Highlight instead.** On last year's sheet he uses the same dialog with **Highlight duplicates** instead. The duplicate rows get a light fill and nothing is deleted.

## Google Workspace benchmark

In Google Sheets, trimming takes 3 clicks: Data › Data cleanup › Trim whitespace. Removing duplicates takes about 6: Data › Data cleanup › Remove duplicates (3), tick "Data has header row" (1), choose the columns (1 or more), Remove duplicates (1). Splitting takes 2 (Data › Split text to columns), plus 2 more to change the separator ([Docs Help](https://support.google.com/docs/answer/6325535)).

Known pain points:

- There's no preview of which rows will be removed. The count appears in a brief notice after the fact ([WildandFree Tools](https://wildandfreetools.com/blog/remove-duplicates-google-sheets-alternative-free/)).
- Sheets always keeps the first occurrence, so the better-filled duplicate may be the one deleted ([r/googlesheets](https://www.reddit.com/r/googlesheets/comments/1lt9cni/delete_row_if_duplicate_found_in_one_column/)).
- Trim doesn't remove non-breaking spaces, so "duplicates" survive ([Docs Help](https://support.google.com/docs/answer/6325535), [SheetsHowTo](https://sheetshowto.com/remove-duplicates-google-sheets/)).
- Remove duplicates is greyed out on filtered ranges ([WildandFree Tools](https://wildandfreetools.com/blog/remove-duplicates-google-sheets-alternative-free/)).
- Split overwrites the columns to the right without asking.

## Better than Google Workspace when

1. Data › Data cleanup › Trim whitespace and Remove duplicates, and Data › Split text to columns, exist and take at most 3 clicks to start from the menu bar.
2. Trim removes leading, trailing, and repeated spaces, including non-breaking spaces and tabs, and reports how many cells changed.
3. Remove duplicates shows how many rows will be removed and highlights them in the sheet before anything is deleted.
4. Remove duplicates lets you choose which row to keep (first, last, or the row with the most filled cells) and whether matching ignores case.
5. After removing, a notice gives the counts and an Undo button, and stays until dismissed. One Undo restores every removed row in its original position.
6. "Highlight duplicates" marks duplicate rows without deleting anything.
7. Split text to columns detects the separator, previews the new columns, and asks before overwriting non-empty cells, with the option to insert columns. Values like "00123" stay as text.
8. Each cleanup is a single undo step, and on a filtered range each one acts only on visible rows and says so, instead of being disabled.

## Success looks like

- "Donations Q3" has separate Last name and First name columns, no stray spaces, and 103 unique donors by email, each keeping the most complete row.
- Every step could be undone in one go.

## Gaps and notes

- **None of these commands exist.** The Sheets Data menu has Create a filter, Pivot table, Sort range, Data validation, and Protect sheets and ranges. There's no Data cleanup submenu, Split text to columns, Remove duplicates, or Trim whitespace, and the Univer presets SuiteLeaf loads don't add them.
- **Formula workarounds are partly available.** Univer's formula engine has `TRIM`, `UNIQUE`, and Excel's `TEXTSPLIT`, but not Google's `SPLIT`, so people coming from Google Sheets will find their usual formula missing.
- CSV import (storyboard [16](16-import-and-export-csv.md)) splits columns when a file is opened, but nothing splits text that's already in the sheet.
- Find and replace (Univer's find-replace preset) can fix some inconsistencies by hand, but it doesn't help with duplicates or splitting.
