# 151 · Put the fee chart in the minutes

**Mode:** single-node · **App:** Docs · **Video:** [videos/151-put-the-fee-chart-in-the-minutes.mp4](videos/151-put-the-fee-chart-in-the-minutes.mp4) · **Script:** [scenes/151-put-the-fee-chart-in-the-minutes.spec.ts](scenes/151-put-the-fee-chart-in-the-minutes.spec.ts)

## Who and why

Maya wants the plot-fee numbers in the October minutes. In Google Docs she must first build a chart in the spreadsheet, then insert that chart, and the link is easy to miss. An Update button floats over the chart and is easy to skip, so the minutes keep last month's numbers. If someone deletes the spreadsheet, the chart becomes a broken picture with no explanation.

## Inspired by

- Storyboard [14](14-chart-from-a-table.md): a spreadsheet can chart its own table. A document cannot use that table.
- [Insert a chart from Sheets](https://support.google.com/docs/answer/7009814): the chart has to exist in the spreadsheet first. Docs then asks which chart to paste.

## Scenes

1. **The fees.** Maya has a spreadsheet "Plot fees". The first row is Fee and Amount. Dues is 40. Compost is 15.
2. **Insert.** In "October meeting" she chooses **Insert chart** and picks Plot fees. She does not build a chart in the spreadsheet first.
3. **The bars.** The minutes show a bar for Dues at 40 and a bar for Compost at 15. Under the chart, a line says **From Plot fees**.
4. **The number changes.** She sets Compost to 25 in the spreadsheet and returns to the minutes. The chart still says 15 until she clicks **Update**. It then says 25. Dues stays 40.
5. **The sheet goes away.** She removes Plot fees from the library and clicks Update again. The bars stay at the last numbers, and the line says the spreadsheet is missing. The minutes are not blank.

## Success looks like

- Insert chart lists spreadsheets and draws a bar for each data row.
- The source file's name is on the chart.
- Update reads the current numbers. Until then, the chart keeps what it last showed.
- A missing spreadsheet leaves the last chart and says so.

## Better than Google Docs

- She does not make a chart in the spreadsheet before she can put one in the minutes.
- The source name is always visible. It is not a hidden link.
- Update is a control she can see, and a deleted spreadsheet does not turn into an empty box.

## Gaps and notes

- Recorded. Insert › Insert chart lists spreadsheets on this computer. Plot fees is only a table (Fee, Amount, Dues 40, Compost 15). The minutes draw one bar per row and say From Plot fees. Update is a button on the chart, not a control that appears on hover.
- Compost stays 15 in the minutes after the spreadsheet changes to 25, until Update. Then Compost is 25 and Dues stays 40. Closing the minutes and opening them again shows those bars and From Plot fees.
- Moving Plot fees to Trash and clicking Update leaves the bars at 40 and 25, and the chart says "The spreadsheet is missing." The page is not blank.
- The bars come from the first sheet only. The first text cell in a row is the label, or the first column when the row has no text, and the first numeric cell is the value. The header row is skipped. Maya cannot pick another sheet, a range, or a line or pie chart. SuiteDrive spreadsheets are not listed. Word, HTML, and plain text include each bar's label, value, and the source name (storyboard 152). No AI version.
