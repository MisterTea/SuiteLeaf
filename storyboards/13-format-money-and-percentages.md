# 13 · Format money and percentages

**Mode:** single-node · **App:** Sheets · **Video:** [videos/13-format-money-and-percentages.mp4](videos/13-format-money-and-percentages.mp4) · **Script:** [scenes/sheets.spec.ts](scenes/sheets.spec.ts)

## Who and why

Jess is a freelance designer turning last month's hours into an invoice summary. The math is done, but 1020 and 0.54255… don't look like something to send a client. She wants dollar amounts, readable percentages, and a clear header and total.

## Inspired by

- *Ultimate Guide to Google Sheets*, ch. 1 (WF-B1-02 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md)): bold headers, currency formats and alignment; formatting changes display, not values.
- [Google Docs Editors Help: Format numbers in a spreadsheet](https://support.google.com/docs/answer/56470) and [How to format an entire column](https://www.thebricks.com/resources/guide-how-to-format-an-entire-column-in-google-sheets): the toolbar's $, % and decimal buttons.
- [r/googlesheets: Can't convert cell format from text to currency](https://www.reddit.com/r/googlesheets/comments/100mpjg/cant_convert_cell_format_from_text_to_currency/): formatting only works on real numbers, so the amounts must stay numeric.

## Scenes

1. **New spreadsheet.** Jess names it "September invoice".
2. **Enter the work.** Service, Hours, Rate, Amount and Share for three services, with Amount `=B2*C2` and Share `=D2/D$5`, plus a Total row with SUMs. Rates show as 85, amounts as 1020, and shares as long decimals (0.5425531915), rounded to fit the column like Sheets' Automatic format.
3. **Currency.** She selects C2:D5 and clicks $ ("Format as currency"). The cells read $85.00, $1,020.00 … $1,880.00.
4. **Percent.** She selects E2:E5, clicks % ("Format as percent"), then "Increase decimal places". Shares read 54.3%, 29.8%, 16.0% and 100.0%.
5. **Bold.** She drags across the header row and clicks the toolbar's B button, which then shows as pressed, then does the same for the Total row.
6. **Center the headings.** With the header row selected she chooses Format › Align center.
7. **The value is unchanged.** Selecting D2 shows `=B2*C2` in the formula bar, and the B button is no longer pressed because D2 isn't bold. Formatting only changed how it looks.

## Success looks like

- Rate and Amount use plain currency (`"$"#,##0.00`), Share uses `0.0%`, the header is bold and centered, and the Total row is bold.
- The underlying values and formulas are unchanged (D2 is still `=B2*C2` = 1020).
- No errors appear in the page.

## AI version

**Script:** [scenes/ai/13-format-money-and-percentages-ai.spec.ts](scenes/ai/13-format-money-and-percentages-ai.spec.ts) · **Video:** none yet. No run has passed, so there is no `videos/13-format-money-and-percentages-ai.mp4` or `videos/electron/13-format-money-and-percentages-ai.mp4`. Failed runs are saved to `test-results/ai-videos/` (and `test-results/ai-videos/electron/`) each time the spec runs.

Jess starts the same way as in the original. She makes a new spreadsheet called "September invoice" and types Service, Hours, Rate, Amount and Share for the three services, with the same `=B2*C2` and `=D2/D$5` formulas and a Total row of SUMs. Then she opens the assistant and types one request:

> Can you make this look like a proper invoice? Show the rates and amounts as dollars, the shares as percentages with one decimal, and make the header and total rows bold with the headings centered.

The script then downloads the workbook (Save As on the desktop) and checks the original's end state. C2:C4 and D2:D5 must use `"$"#,##0.00`, and E2:E5 must use `0.0%`. A1:E1 must be bold and centered, and A5, D5 and E5 must be bold. The formulas and values must be unchanged (D2 is still `=B2*C2` = 1020), D2 must not be bold, and the page must show no errors. The closing captions run only after these checks, so a failed run never claims "$1,880.00 total".

**Tools Gemma used:** almost only `format_cells`, one range and one or two options per call: the header, the total row, then Rate, Amount and Share in turn. A run takes 4–11 calls and about 30–80 seconds, including loading the model. In the recordings, the purple pointer lands on each range before it changes, and each card in the panel says what was applied, for example "percent with 1 decimal place(s) (0.0%)".

**How Gemma did:** 0 of 10 web runs and 0 of 2 desktop (llama.cpp) runs passed, so the story is not reliable yet. Leaving out the one run whose arguments were wrapped (below): the header was always bold and centered, and the total row was bold in all but one run. Once `decimals` meant a count, the shares E2:E4 always came out as `0.0%`. The Amounts D2:D4 were currency in all but one run. What it kept getting wrong:

- **The Amount total (D5) was left as 1880.** This happened in 8 of 12 runs, including every run from the fifth on: seven in a row on web and desktop. Gemma formats D2:D4, then moves on to Share. `format_cells` now says "Right next to D2:D4, D5 =SUM(D2:D4) → 1880 shows a different number format…". Gemma followed that note for the Share total (E5), which it was about to format anyway, but never went back for D5.
- **The Rate column was skipped or not made dollars** in 4 of 12 runs: left out, set to `plain`, or set to `number` with 0 decimals. Gemma's reply still said "the rates and amounts are now in dollars".
- **Formatting nobody asked for:** grey, green or yellow fills on the header or total row, borders on the whole table, wrap, centered or left-aligned totals, and bold on the empty cells F1:F3. Most of this is harmless, but once (desktop) it bolded the amounts and shares. It then redid the whole job without `bold`, expecting that to undo it, and D2 stayed bold.
- **The Share total as a whole percent** (100% rather than 100.0%) in 4 runs, and left as 1 in another.
- **A wrong argument shape once:** all options wrapped in `style_properties: {…}` with `text_align`. All eleven calls "changed nothing", and Gemma reported success anyway. The tool now accepts this shape (see below).

Changes made while recording it (all in `apps/web/src/ai/tools/sheets.ts`, with tool tests in `tests/browser/ai-tools.spec.ts`):

- `format_cells` `decimals` used to mean "add N decimal places". Gemma, like a person, reads it as "show N places", so "two decimals" gave `$85.0000` and percent with one decimal gave `54.26%`. It now sets the number of places, either on the named format or on each cell's current format. The result reports the format code it actually applied.
- The description says that options left out stay as they are (`bold=false` removes bold), and it uses neutral example numbers. Each result lists which cells in the range are bold.
- Options wrapped in an object, and `text_align`/`alignment`, are unwrapped. A call that would change nothing is now an error that lists the real options, and unknown options are reported as ignored.
- After a number format, the result names numbers just above or below the range that kept a different format, such as a column's total.
- `set_cells` treats `null` cells as blank. The schema check used to turn them into the text "null", which Gemma once typed into the Total row.

## Gaps and notes

- Fixed: the Bold, Italic and Strikethrough toolbar buttons and Format menu items threw `getFontWeight` / `getFontStyle` / `getFontLine` "is not a function". They now use the same commands as the keyboard shortcuts (and format selected text while you're typing in a cell). The buttons show as pressed when the active cell has that style.
- Fixed: Edit › Cut, Copy and Paste toggled bold. They now use the clipboard. If the browser blocks clipboard access from a menu (Paste usually needs permission), a message suggests the keyboard shortcut instead, as Sheets does. Edit › Delete values cleared formatting instead of values; it now clears the values and keeps the formatting.
- Fixed: the $ button applied an accounting pattern (`"$"#,##0.00_);[Red]("$"#,##0.00)`) with red parentheses for negatives. It now applies Sheets' plain currency, `"$"#,##0.00`, so −5 reads -$5.00.
- Fixed: unformatted fractions that didn't fit the column switched to scientific notation (5.42553E-01). They now drop decimal places first, and only very small or very large numbers use scientific notation.
- % starts at zero decimals (54%), as in Excel; one click on "Increase decimal places" gives 54.3%. Sheets' % button starts at two decimals.
- Not fixed here (other storyboards): the toolbar overflows its row at 1280 px (14).
