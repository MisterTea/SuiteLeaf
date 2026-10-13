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

## AI version

**Videos:** [web](videos/16-import-and-export-csv-ai.mp4) · [desktop](videos/electron/16-import-and-export-csv-ai.mp4) · **Script:** [scenes/ai/16-import-and-export-csv-ai.spec.ts](scenes/ai/16-import-and-export-csv-ai.spec.ts)

Rosa asks the on-device assistant (Gemma 4 E4B) twice, once to open the file and once after Mei pays:

1. *Open the garden members CSV I downloaded from the signup site. Don't lose the leading zeros in the member IDs and ZIP codes.*
2. *Mei Chen paid her dues at the work day, so her dues paid is now 45. Then export the list back to CSV.*

When the panel shows "Choose the file to open", Rosa picks `garden-members.csv` (the same five columns and four members as the original). The person doesn't touch the import preview: Gemma's import choices answer it. The test checks that the opened sheet lists `00412 Rosa Delgado 02139`. It then reads the exported file (the browser download on the web, the file the save dialog wrote on desktop). That file must be named `garden-members.csv` and keep the original header. The member IDs must stay 00412, 00977, 01205 and 00038, the ZIPs 02139, 07302, 10001 and 02139, and Mei's row must read `01205,Mei Chen,10001,B4,45`.

**Tools Gemma used:** `open_from_computer` with `keep_codes_as_text: true` every time. On the web it also passed `separator: "comma"` in 3 of 4 runs, and on desktop once `first_row_is_header: true`. Then `set_cells` on E4 and `export_spreadsheet` with `csv`. In one desktop run it also called `read_sheet` after opening, to check the codes.

**What the recording shows:** the pointer goes to Open / import, and Rosa chooses the file in the panel. The "Import garden-members.csv" preview opens with the pointer on its summary (*4 data rows · 5 columns · comma-separated, plus a header row*). The pointer then moves to "Keep code columns as text" (already ticked) and clicks Import. The tool result gives Gemma the summary, each column's type (Member ID, Name, ZIP and Plot Text, Dues paid Number) and the dialog's own explanation that Member ID and ZIP keep their leading zeros. The sheet opens with 00412 in A2 and 10001 as text in C4. For the second request the pointer types 45 into E4 and goes to the File menu to export. The result says where the CSV went: the browser's downloads, or the path chosen in the desktop save dialog. Each request takes about 30–40 seconds for the import and 7–16 seconds for the update on the web, and about 20–30 and 5 seconds on desktop.

**How Gemma did:** this was one of the easier tasks. The web recording passed 4 of 4 runs (2 loop iterations, then 2 consistency runs) and desktop (llama.cpp) passed 2 of 2. Every run used the fewest calls possible and never got an argument wrong. Model behaviour seen:
- In the first web run its reply named the tool argument (*since `keep_codes_as_text` was true, the leading zeros … have been maintained*). The system prompt now asks for replies in the user's words, and it hasn't happened since.
- In the first desktop run, the reply after the import came back empty three times (the known llama.cpp Q4_0 empty replies), so the panel ended right after the tool step with no summary. The panel now says "Gemma finished without a summary. The steps above are what it did." in that case.
- Twice on the web it ended the import reply with a question (*What would you like to do with it?*). On desktop it typed `"45"` as text in the call, which `set_cells` enters as the number 45.

Fixed while making it: `open_from_computer` used to wait silently on the CSV preview until someone clicked Import, and a cancelled preview left it waiting for two minutes. It now takes optional import choices (`keep_codes_as_text`, default on; `first_row_is_header`; `separator`). It sets them in the dialog with the pointer, clicks Import and reports the preview. If the preview can't be imported, it cancels and says why. A cancelled import is reported straight away. `export_spreadsheet` now says which sheet it exported and where the file went, or that the save dialog was closed, the same way documents do since storyboard 07.

## Gaps and notes

- Univer marks numeric-looking text cells with a small green corner and, when one is selected, a "stored as text" warning icon (like Excel). It is accurate here but a little noisy for columns Rosa deliberately kept as text.
- Formula-looking text is never run on import (the dialog says so when the file has any), and Export CSV prefixes such text with `'` so other spreadsheets will not run it either. That prefix is not removed on re-import.
- There is no per-column type picker like Excel's Text Import step 3; the choices are file-wide plus the automatic code-column rule.
- The export button is File › Export CSV. There is no Sheets-style "Download › Comma-separated values" naming, and the download gives no on-screen confirmation in the browser.
