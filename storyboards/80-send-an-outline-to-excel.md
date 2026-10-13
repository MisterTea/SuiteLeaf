# 80 · Send an outline to Excel

**Mode:** single-node · **App:** Sheets · **Video:** [videos/80-send-an-outline-to-excel.mp4](videos/80-send-an-outline-to-excel.mp4) · **Script:** [scenes/80-send-an-outline-to-excel.spec.ts](scenes/80-send-an-outline-to-excel.spec.ts)

## Who and why

Rosa grouped January through December in her rent budget (storyboard 71) and collapsed the expense rows. In SuiteLeaf the plus and minus work. She downloads the sheet for the treasurer, who opens it in Excel. The groups are gone. Excel has no outline, so the treasurer cannot collapse the months.

## Inspired by

- Storyboard [71](71-group-columns.md): column groups stay in the SuiteLeaf file and are not written as an Excel outline.
- [Group or ungroup rows or columns](https://support.google.com/docs/answer/1099814): Google Sheets writes an outline Excel can open. People expect the plus and minus to survive the download.
- `sheet-column-groups.ts` stores groups under a SuiteLeaf custom key. The Excel exporter does not write `outlineLevel`.

## Scenes

1. **The grouped budget.** Rosa opens Rent budget. Columns B through M are grouped, and the expense rows are collapsed. January is the only month showing, and the year total sits beside it. A minus and a plus sit on January. A plus sits on the total.
2. **Download.** File › Export XLSX. The file carries an outline of those months and those expense rows.
3. **Open it here.** She goes back to files and uses Open / import. The column group and the row group are back. January is still the only month showing.
4. **A file that started in Excel.** Quarter already has a column outline and a row outline. The minus controls are there. Collapsing the columns hides Jan, Feb, and Mar and leaves the total. Collapsing the rows hides Rent, Food, and Transit. All stays.
5. **A plain sheet.** Grocery list has no groups. Downloading it adds no outline levels.

## Google Workspace benchmark

In Google Sheets, Data › Group rows or Group columns, then File › Download › Microsoft Excel. Excel shows the outline controls ([Docs Help](https://support.google.com/docs/answer/1099814)). The complaint is the opposite direction: an Excel outline sometimes opens in Sheets already expanded, and nested groups become one level.

## Better than Google Workspace when

1. A SuiteLeaf column group is an Excel column outline in the downloaded xlsx, covering the same columns.
2. A SuiteLeaf row group is an Excel row outline covering the same rows.
3. Opening that xlsx in SuiteLeaf restores both groups.
4. A collapsed group is still collapsed after the round trip.
5. An xlsx that already has an outline opens with those groups, and collapsing them hides the outlined columns or rows.
6. A sheet with no groups downloads with no outline levels added.

## Success looks like

The treasurer's Excel file has the same month columns and expense rows outlined. Opening it back in SuiteLeaf shows the plus and minus, with January still the only month visible.

## Gaps and notes

- A second Excel outline level opens as one group. Import adds a compatibility note when that happens. The plus and minus are not nested.
- The downloaded outline puts the summary on the label column and the total row, so those stay outside the group. Excel's own default puts the button on the other side. Opening either kind restores the same detail columns and rows.
- A group can stay partly collapsed, with January open and the other months hidden. Excel's outline button collapses a whole level at once; the hidden flags are what keep January visible.
- The plus and minus stay on the column and row headers. There is no separate outline band above the letters.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| A SuiteLeaf column group is an Excel column outline of the same columns | Met | Video 0:12–0:15, File › Export XLSX. The scene checks `outlineLevel="1"` on the download. `tests/excel-outline.test.ts` checks columns B–M and not the category or the year. |
| A SuiteLeaf row group is an Excel row outline of the same rows | Met | Video 0:09, the plus on the total. The same test checks rows 3–5 outlined and the total row marked collapsed. |
| Opening that xlsx restores both groups | Met | Video 0:17 Open / import, then 0:24 the plus and minus. `tests/browser/excel-outline.spec.ts` |
| A collapsed group is still collapsed after the round trip | Met | Video 0:24, January still the only month and the expense rows still collapsed. `tests/excel-outline.test.ts` |
| An xlsx that already has an outline opens with those groups, and collapsing them hides the outlined columns or rows | Met | Video 0:34 the minuses, 0:40 the months hide, 0:43 Rent, Food, and Transit hide. `tests/excel-outline.test.ts` reads an outline whose summary sits after the detail. |
| A sheet with no groups downloads with no outline levels | Met | Video 0:48–0:56, Grocery list. The scene and `tests/excel-outline.test.ts` assert the download has no `outlineLevel`. |
