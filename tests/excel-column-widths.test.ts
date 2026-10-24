import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { importOffice } from "../packages/core/src/office";
import { exportXlsx } from "../packages/core/src/xlsx-export";
import { applyExcelColumnWidths } from "../apps/web/src/excel-layout";
import { excelFixture } from "./office-fixtures";

async function importWorkbook() {
  const zip = await JSZip.loadAsync(await excelFixture());
  const path = "xl/worksheets/sheet1.xml";
  zip.file(
    path,
    (await zip.file(path)!.async("string"))
      .replace(
        '<col min="1" max="1" width="24"/>',
        '<col min="1" max="1" width="22" customWidth="1"/><col min="3" max="4" width="14" customWidth="1"/>',
      )
      .replace(
        "<cols>",
        '<sheetFormatPr defaultRowHeight="15" baseColWidth="9" defaultColWidth="10.5"/><cols>',
      ),
  );
  const { file } = await importOffice(
    await zip.generateAsync({ type: "uint8array" }),
    "xlsx",
    "widths.xlsx",
  );
  if (file.kind !== "sheet") throw new Error("Expected sheet");
  return file;
}

async function exportedSheet(file: Awaited<ReturnType<typeof importWorkbook>>) {
  const zip = await JSZip.loadAsync(await exportXlsx(file));
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const columns = new Map<number, Record<string, string>>();
  for (const [tag] of xml.matchAll(/<col\b[^>]*\/>/g)) {
    const attributes = Object.fromEntries(
      Array.from(tag.matchAll(/(\w+)="([^"]*)"/g), (m) => [m[1], m[2]]),
    );
    for (let c = +attributes.min; c <= +attributes.max; c++)
      columns.set(c, attributes);
  }
  const format = Object.fromEntries(
    Array.from(
      (/<sheetFormatPr\b[^>]*\/>/.exec(xml)?.[0] ?? "").matchAll(
        /(\w+)="([^"]*)"/g,
      ),
      (m) => [m[1], m[2]],
    ),
  );
  return { columns, format };
}

describe("XLSX column width round trip", () => {
  it("writes back the stored character widths of an imported workbook", async () => {
    const { columns, format } = await exportedSheet(await importWorkbook());
    expect(columns.get(1)?.width).toBe("22");
    expect(columns.get(2)).toMatchObject({ width: "12", hidden: "true" });
    expect(columns.get(3)?.width).toBe("14");
    expect(columns.get(4)?.width).toBe("14");
    expect(format).toMatchObject({
      baseColWidth: "9",
      defaultColWidth: "10.5",
    });
  });

  for (const [platform, nativeMac] of [
    ["macOS", true],
    ["other platforms", false],
  ] as const) {
    it(`keeps widths resolved from Calibri metrics on ${platform}`, async () => {
      const file = await importWorkbook();
      const book = file.content.workbook;
      const sheet = book.sheets[book.sheetOrder[0]];
      applyExcelColumnWidths(sheet, 7.43, nativeMac);
      const { columns, format } = await exportedSheet(file);
      expect(columns.get(1)?.width).toBe("22");
      expect(columns.get(3)?.width).toBe("14");
      expect(format.defaultColWidth).toBe("10.5");
    });
  }

  it("converts a column resized in SuiteLeaf with the import's character width", async () => {
    const file = await importWorkbook();
    const book = file.content.workbook;
    const sheet = book.sheets[book.sheetOrder[0]];
    applyExcelColumnWidths(sheet, 7.43, true);
    sheet.columnData![0].w = sheet.columnData![0].w! * 2;
    const { columns } = await exportedSheet(file);
    expect(Number(columns.get(1)?.width)).toBeCloseTo(44, 1);
    expect(columns.get(3)?.width).toBe("14");
  });
});

it("keeps distinct original widths when columns round to the same pixel size", async () => {
  const file = await importWorkbook();
  const book = file.content.workbook as any;
  const sheet = book.sheets[book.sheetOrder[0]];
  sheet.columnData[0].w = 83;
  sheet.columnData[2].w = 83;
  sheet.custom.excelLayout.columnPixels[0] = 83;
  sheet.custom.excelLayout.columnPixels[2] = 83;
  sheet.custom.excelLayout.columnWidths[0] = 10.38;
  sheet.custom.excelLayout.columnWidths[2] = 10.5;
  const { columns } = await exportedSheet(file);
  expect(columns.get(1)?.width).toBe("10.38");
  expect(columns.get(3)?.width).toBe("10.5");
});
