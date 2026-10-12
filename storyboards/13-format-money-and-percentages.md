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

## Gaps and notes

- Fixed: the Bold, Italic and Strikethrough toolbar buttons and Format menu items threw `getFontWeight` / `getFontStyle` / `getFontLine` "is not a function". They now use the same commands as the keyboard shortcuts (and format selected text while you're typing in a cell). The buttons show as pressed when the active cell has that style.
- Fixed: Edit › Cut, Copy and Paste toggled bold. They now use the clipboard. If the browser blocks clipboard access from a menu (Paste usually needs permission), a message suggests the keyboard shortcut instead, as Sheets does. Edit › Delete values cleared formatting instead of values; it now clears the values and keeps the formatting.
- Fixed: the $ button applied an accounting pattern (`"$"#,##0.00_);[Red]("$"#,##0.00)`) with red parentheses for negatives. It now applies Sheets' plain currency, `"$"#,##0.00`, so −5 reads -$5.00.
- Fixed: unformatted fractions that didn't fit the column switched to scientific notation (5.42553E-01). They now drop decimal places first, and only very small or very large numbers use scientific notation.
- % starts at zero decimals (54%), as in Excel; one click on "Increase decimal places" gives 54.3%. Sheets' % button starts at two decimals.
- Not fixed here (other storyboards): the toolbar overflows its row at 1280 px (14).
