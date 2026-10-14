# 152 · Send the minutes with the fees still in them

**Mode:** single-node · **App:** Docs · **Video:** [videos/152-send-the-minutes-with-the-fees-still-in-them.mp4](videos/152-send-the-minutes-with-the-fees-still-in-them.mp4) · **Script:** [scenes/152-send-the-minutes-with-the-fees-still-in-them.spec.ts](scenes/152-send-the-minutes-with-the-fees-still-in-them.spec.ts)

## Who and why

Maya put the plot-fee chart in the October minutes. She exports a Word file for the club email. Today that file drops the chart, so the email has the prose and not the numbers. In Google Docs the chart becomes a picture. The numbers are not text, the source file is not named, and a screen reader skips the fees.

## Inspired by

- Storyboard [151](151-put-the-fee-chart-in-the-minutes.md): the minutes draw Dues and Compost from Plot fees. Word export does not draw the bars.
- [Insert a chart from Sheets](https://support.google.com/docs/answer/7009814): a chart in Docs downloads as an image.

## Scenes

1. **The chart is in the minutes.** October meeting shows Dues at 40, Compost at 15, and **From Plot fees**.
2. **Export.** She chooses File › Export DOCX. She does not copy the numbers by hand.
3. **The Word file has the fees.** The download contains the words Dues, 40, Compost, 15, and Plot fees, as text she can select, not only as a picture.
4. **The minutes stay.** The chart is still on the page in SuiteLeaf, with the same numbers.

## Success looks like

- Word, web page, and plain text export include every bar's label and value, and the source name.
- Those values are text in the file.
- Exporting does not remove the chart from the open document.
- A document with no chart exports as it does today.

## Better than a picture of a chart

- The fees can be copied and read aloud. They are not locked in an image.
- The source name is in the file, next to the numbers.

## Gaps and notes

- Recorded. File › Export DOCX writes Dues, 40, Compost, 15, and From Plot fees into `word/document.xml` as text: a paragraph for the source, then a two-column table with one row per bar. The script unzips the download. The chart stays on the page, still Dues 40 and Compost 15.
- HTML and plain text use the same words. A missing spreadsheet still exports the last bars plus "The spreadsheet is missing." A document with no chart does not gain a From line.
- Word gets a table of the numbers, not a picture of the bars and not a Word chart object. The bar lengths are not in the file. No AI version.
