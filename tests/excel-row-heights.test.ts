import { expect, it } from "vitest";
import JSZip from "jszip";
import { excelFixture } from "./office-fixtures";
import { importOffice } from "../packages/core/src/office";
import { exportXlsx } from "../packages/core/src/xlsx-export";

it("preserves Excel point heights through the editor's pixel model", async () => {
  const source = await JSZip.loadAsync(await excelFixture());
  const path = "xl/worksheets/sheet1.xml";
  source.file(
    path,
    (await source.file(path)!.async("string")).replace(
      /<row\b[^>]*r="1"[^>]*>/,
      '<row r="1" ht="71.25" customHeight="1">',
    ),
  );
  const { file } = await importOffice(
    await source.generateAsync({ type: "uint8array" }),
    "xlsx",
    "heights.xlsx",
  );
  if (file.kind !== "sheet") throw new Error("Expected sheet");
  const workbook = file.content.workbook as any;
  expect(workbook.sheets[workbook.sheetOrder[0]].rowData[0].h).toBe(95);
  const output = await JSZip.loadAsync(await exportXlsx(file));
  expect(await output.file(path)!.async("string")).toMatch(
    /<row\b[^>]*\bht="71.25"/,
  );
});
