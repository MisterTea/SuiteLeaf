import { expect, it } from "vitest";
import JSZip from "jszip";
import { importOffice } from "../packages/core/src/office";
import { excelFixture } from "./office-fixtures";

it("retains Excel character widths, Normal font, implicit style, and point row defaults", async () => {
  const zip = await JSZip.loadAsync(await excelFixture());
  const path = "xl/worksheets/sheet1.xml";
  zip.file(
    path,
    (await zip.file(path)!.async("string")).replace(
      "<cols>",
      '<sheetFormatPr defaultRowHeight="12.75" baseColWidth="9" defaultColWidth="10.5"/><cols>',
    ),
  );
  const { file } = await importOffice(
    await zip.generateAsync({ type: "uint8array" }),
    "xlsx",
    "defaults.xlsx",
  );
  if (file.kind !== "sheet") throw new Error("Expected sheet");
  const sheet =
    file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  expect(sheet.defaultRowHeight).toBe(17);
  expect(sheet.defaultStyle).toBe("excel-0");
  expect(sheet.custom).toMatchObject({
    excelLayout: {
      normalFont: { family: "Arial", size: 12 },
      baseColumnWidthChars: 9,
      defaultColumnWidthChars: 10.5,
      columnWidths: { "0": 24, "1": 12 },
    },
  });
  // Stored character widths contain padding already; it must not be added twice.
  expect(sheet.columnData![0].w).toBe(168);
  expect(sheet.rowData![0].h).toBe(40);
});

it("resolves the Normal style's font independently of cell style zero", async () => {
  const zip = await JSZip.loadAsync(await excelFixture());
  const path = "xl/styles.xml";
  let styles = await zip.file(path)!.async("string");
  styles = styles
    .replace('<fonts count="1">', '<fonts count="2">')
    .replace(
      "</fonts>",
      '<font><name val="Calibri"/><sz val="11"/></font></fonts>',
    )
    .replace(
      "</styleSheet>",
      '<cellStyleXfs count="1"><xf fontId="1"/></cellStyleXfs><cellStyles count="1"><cellStyle name="Normal" builtinId="0" xfId="0"/></cellStyles></styleSheet>',
    );
  zip.file(path, styles);
  const { file } = await importOffice(
    await zip.generateAsync({ type: "uint8array" }),
    "xlsx",
    "normal.xlsx",
  );
  if (file.kind !== "sheet") throw new Error("Expected sheet");
  const sheet =
    file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  expect(sheet.custom!.excelLayout.normalFont).toEqual({
    family: "Calibri",
    size: 11,
  });
  expect(file.content.workbook.styles!["excel-0"].ff).toBe("Arial");
});
