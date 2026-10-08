import { expect, test } from "vitest";
import { excelGeneralNumberText } from "../apps/web/src/excel-number-display";
const measure = (text: string) => text.length;
test("General first rounds fractions to retain visible integer digits", () => {
  expect(excelGeneralNumberText(75994296.25, "75994296.25", 8, measure)).toBe(
    "75994296",
  );
  expect(excelGeneralNumberText(4471025.26, "4471025.26", 7, measure)).toBe(
    "4471025",
  );
});
test("scientific display retains precision and removes empty decimal separators", () => {
  expect(excelGeneralNumberText(409660132.9, "409660132.9", 7, measure)).toBe(
    "4.1E+08",
  );
  expect(excelGeneralNumberText(500382422.83, "500382422.83", 5, measure)).toBe(
    "5E+08",
  );
  expect(excelGeneralNumberText(230110270.55, "230110270.55", 7, measure)).toBe(
    "2.3E+08",
  );
});
test("unfitting significant digits produce overflow, preserving fitting values", () => {
  expect(excelGeneralNumberText(409660132.9, "409660132.9", 5, measure)).toBe(
    "#####",
  );
  expect(excelGeneralNumberText(12.25, "12.25", 5, measure)).toBe("12.25");
});

test("import keeps numeric values and formulas while preserving explicit number formats", async () => {
  const { importOffice } = await import("../packages/core/src/office");
  const { excelFixture } = await import("./office-fixtures");
  const { file } = await importOffice(
    await excelFixture(),
    "xlsx",
    "numbers.xlsx",
  );
  if (file.kind !== "sheet") throw new Error("Expected sheet");
  const sheet =
    file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  expect(sheet.cellData![0][1]).toMatchObject({
    v: 100,
    t: 2,
    s: { pd: { l: 0, r: 96 / 72 } },
  });
  expect(sheet.cellData![1][0]).toMatchObject({ v: 200, f: "=B1*2" });
  expect(sheet.cellData![3][0].s).toBe("excel-1");
  expect(sheet.cellData![0][0].s).toBe("excel-0");
});
