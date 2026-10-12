# 16 · Import and export a CSV without losing leading zeros

**Mode:** single-node · **App:** Sheets · **Video:** [videos/16-import-and-export-csv.mp4](videos/16-import-and-export-csv.mp4) · **Script:** [scenes/sheets.spec.ts](scenes/sheets.spec.ts)

## Who and why

Rosa volunteers for a community garden. The old signup site exports members as a CSV, and member IDs like 00412 matter: the last time someone opened it in a spreadsheet the zeros vanished and the IDs stopped matching. She needs to update one member and send the CSV back.

## Inspired by

- WF-B2-07 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md) and the README's portability section: delimited imports preview their delimiter and rows and preserve leading-zero identifiers as text; CSV exports contain calculated values.
- [r/excel: Leading zeros not preserved upon opening csv](https://www.reddit.com/r/excel/comments/73va3m/leading_zeros_not_preserved_upon_opening_csv/) and [How to keep leading zeros from dropping in CSV sheets](https://www.reddit.com/r/excel/comments/1cbzdxc/how_to_keep_leading_zeros_from_dropping_in_csv/): "Excel assumes 000123 is a number and removes the meaningless digits."
- [knowsheets: Zip code format in Google Sheets](https://knowsheets.com/zip-code-format-in-google-sheets/): Sheets keeps zeros only if you untick "Convert text to numbers, dates, and formulas", which then turns every column into text.

## Scenes

1. **Open / import.** From the home screen Rosa opens `garden-members.csv` (Member ID, Name, ZIP, Plot, Dues paid).
2. **Preview.** Before anything lands in a sheet, an in-app "Import garden-members.csv" dialog shows the detected separator (Comma, changeable to Semicolon, Tab or Pipe), "First row is a header" (on, guessed from the labels), "Convert text to numbers and TRUE/FALSE", and a preview table that labels each column Text, Number or Mixed. The summary reads "4 data rows · 5 columns · comma-separated, plus a header row".
3. **Code columns.** "Keep code columns as text" explains that Member ID and ZIP have codes with leading zeros, so every value in them stays text. Rosa unticks it to see the ZIP column turn Mixed (10001 would become a number), ticks it again, and imports.
4. **Zeros intact.** The sheet "garden-members" opens. A2 reads 00412, C4 (10001) is text like the other ZIPs, and Dues paid are real numbers.
5. **Update a member.** Mei Chen paid at the work day; Rosa changes her Dues paid from 0 to 45.
6. **Export CSV.** File › Export CSV downloads the active worksheet as CSV; the closing caption quotes Mei's exported line.

## Success looks like

- The preview counts data rows only (4, not 5) and the ZIP column is typed consistently.
- The exported CSV has the same header, keeps 00412, 00977, 01205 and 00038 and the ZIPs 02139, 07302 and 10001 exactly, and shows Mei's dues as 45.

## Gaps and notes

- Univer marks numeric-looking text cells with a small green corner and, when one is selected, a "stored as text" warning icon (like Excel). It is accurate here but a little noisy for columns Rosa deliberately kept as text.
- Formula-looking text is never run on import (the dialog says so when the file has any), and Export CSV prefixes such text with `'` so other spreadsheets will not run it either. That prefix is not removed on re-import.
- There is no per-column type picker like Excel's Text Import step 3; the choices are file-wide plus the automatic code-column rule.
- The export button is File › Export CSV. There is no Sheets-style "Download › Comma-separated values" naming, and the download gives no on-screen confirmation in the browser.
