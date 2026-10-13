# 19 · Open an Excel workbook and send it back

**Mode:** single-node · **App:** Sheets · **Video:** [videos/19-open-an-excel-workbook.mp4](videos/19-open-an-excel-workbook.mp4) · **Script:** [scenes/sheets.spec.ts](scenes/sheets.spec.ts)

## Who and why

Kemi runs a bakery. Her accountant emails the quarterly sales workbook as an .xlsx file. Kemi doesn't have Excel; she needs to open it, fix one number, and send back an Excel file that still has its formulas and formatting.

## Inspired by

- W16 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md) and the README's Office import notes: formulas and cached results, styles, number formats, frozen panes and worksheet order are preserved; File › Export XLSX writes every worksheet.
- [r/sheets: Are there drawbacks to creating a file in Excel and then importing?](https://www.reddit.com/r/sheets/comments/11t4fpn/are_there_drawbacks_to_creating_a_file_in_excel/): "95% of the features will work the same, but if something in that 5% is essential… you'll be in for a bad time"; Sheets warns which features it can't display.
- [r/excel: Does Google Sheets do nearly everything that Excel does?](https://www.reddit.com/r/excel/comments/17t621i/does_google_sheets_do_nearly_everything_that/): formulas usually survive; everything else is hit or miss.

## Scenes

1. **Open / import.** Kemi opens `Q3 bakery sales.xlsx`. It has two sheets, "Q3 sales" and "Summary".
2. **Import note.** A bar above the toolbar reads "Imported XLSX: Q3 bakery sales.xlsx · 1 compatibility note". Expanding it explains that the workbook's 8 Excel formulas were kept with their last calculated results and that SuiteLeaf recalculates them with its own formula engine, so Excel-only functions may differ.
3. **Formatting came across.** The peach header row, the bold Total row, dollar-formatted prices and revenue, the column widths and the frozen header are all there.
4. **Formulas came across.** Selecting D3 shows `=B3*C3`.
5. **Fix a number.** The accountant missed a late croissant order; Kemi changes Units sold in B3 from 958 to 1020. Croissant revenue becomes $3,315.00 and the total becomes $10,331.75.
6. **Cross-sheet formulas.** The Summary tab (`='Q3 sales'!D6` and an AVERAGE over the revenue column) already shows the new $10,331.75.
7. **Export XLSX.** File › Export XLSX downloads "Q3 bakery sales.xlsx".
8. **Check before sending.** Kemi opens the exported file again. The columns line up exactly as in the accountant's original, the header is still frozen, and the total is the corrected $10,331.75.

## Success looks like

- The exported workbook keeps both sheets, the frozen header, the formulas (`B3*C3`, `SUM(D2:D5)`, `'Q3 sales'!D6`) with up-to-date cached values (1020, 3315, 10331.75), and the styles.
- The exported column widths are the accountant's own: 22 and 14 characters on "Q3 sales", 24 and 14 on "Summary". Opening the export again looks the same as opening the original.
- The original file on disk is untouched; SuiteLeaf works on an editable copy.

## Gaps and notes

- The bundled `excelFixture()` test workbook is a deliberately odd edge case (its default style fills the whole sheet green and column B is hidden). This storyboard generates a realistic two-sheet workbook in the same way instead.
- The formula note says how many formulas were kept but is still generic about functions ("Excel-only functions may differ"). Unlike Sheets' ".XLSX ⚠️" panel, it doesn't name the functions or features of this file that SuiteLeaf can't reproduce.
- **Fixed: column widths grew on the round trip.** Import turned 22 characters into 176 px (8 px per character with macOS Excel metrics) but export divided pixels by SheetJS's default 6, so widths came back as 29.3 and 18.7, a third wider each pass. Imported sheets now remember the character widths and the pixels-per-character used on import: untouched columns export their original widths, resized columns convert with the same unit, and the sheet's default/base column widths are written back too. Covered by `tests/excel-column-widths.test.ts`.
- The toolbar's font box shows "Arial / 10" for every cell, including this workbook's Calibri 11 cells: the SuiteLeaf toolbar's font family and size don't follow the selection (the same root cause as the Bold/Italic state tracked by storyboard 13). The cells themselves render in the imported font.
- SuiteLeaf-created sheets (not imported from Excel) still export pixel widths through SheetJS's default conversion, so their widths in Excel may not match what SuiteLeaf shows.
