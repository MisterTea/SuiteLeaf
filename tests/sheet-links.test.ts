import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { importOffice } from "../packages/core/src/office";
import { exportXlsx } from "../packages/core/src/xlsx-export";
import { createFile, linkTarget, parseFile, serializeFile } from "../packages/core/src";
import {
  cellHyperlink,
  cellLabel,
  linkedCell,
  removedLinkWarning,
  takeExcelHyperlink,
} from "../packages/core/src/sheet-links";

describe("spreadsheet cell links", () => {
  it("keeps the label separate from a normalized address", () => {
    const cell = linkedCell("Northwind", linkTarget("example.org/northwind")!);
    expect(cell.v).toBe("Northwind");
    expect(cellHyperlink(cell)).toBe("https://example.org/northwind");
    expect(cellLabel(cell)).toBe("Northwind");
    expect(JSON.stringify(cell)).not.toContain("javascript:");
  });

  it("refuses an unsafe address and leaves the cell unchanged", () => {
    const cell = { v: "Northwind", t: 1 };
    const dropped: string[] = [];
    takeExcelHyperlink({ l: { Target: "javascript:alert(1)" } }, cell, dropped);
    expect(cell).toEqual({ v: "Northwind", t: 1 });
    expect(cellHyperlink(cell)).toBeNull();
    expect(dropped).toEqual(["javascript:alert(1)"]);
    expect(removedLinkWarning(dropped)).toBe(
      "1 link with an unsafe or unsupported address (javascript:) was removed; its text was kept.",
    );
  });

  it("imports Excel hyperlinks and writes the address back out", async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Supplier"],
      ["Northwind"],
      ["Contoso"],
    ]);
    sheet.A2.l = { Target: "https://example.org/northwind" };
    sheet.A3.l = { Target: "javascript:alert(1)" };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Suppliers");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" });
    const imported = await importOffice(bytes, "xlsx", "Suppliers.xlsx");
    if (imported.file.kind !== "sheet") throw new Error("Expected a workbook");
    const cells =
      imported.file.content.workbook.sheets[
        imported.file.content.workbook.sheetOrder[0]
      ].cellData!;
    expect(cells[1][0].v).toBe("Northwind");
    expect(cellHyperlink(cells[1][0])).toBe("https://example.org/northwind");
    expect(cells[2][0].v).toBe("Contoso");
    expect(cellHyperlink(cells[2][0])).toBeNull();
    expect(imported.report.warnings).toContain(
      "1 link with an unsafe or unsupported address (javascript:) was removed; its text was kept.",
    );
    expect(imported.report.warnings.join("\n")).not.toContain(
      "hyperlink targets are not recreated",
    );
    expect(parseFile(serializeFile(imported.file)).kind).toBe("sheet");

    const out = XLSX.read(await exportXlsx(imported.file), { type: "array" });
    const again = out.Sheets[out.SheetNames[0]];
    expect(again.A2.v).toBe("Northwind");
    expect(again.A2.l.Target).toBe("https://example.org/northwind");
    expect(again.A3.l).toBeUndefined();
  });

  it("round-trips a link stored on a SuiteLeaf cell", async () => {
    const file = createFile("sheet", "Suppliers");
    if (file.kind !== "sheet") throw new Error("Expected a workbook");
    const id = file.content.workbook.sheetOrder[0];
    file.content.workbook.sheets[id].cellData = {
      1: { 0: linkedCell("Northwind", "https://example.org/northwind/orders") },
    };
    const saved = parseFile(serializeFile(file));
    if (saved.kind !== "sheet") throw new Error("Expected a workbook");
    const cell = saved.content.workbook.sheets[id].cellData![1][0];
    expect(cell.v).toBe("Northwind");
    expect(cellHyperlink(cell)).toBe("https://example.org/northwind/orders");
    const out = XLSX.read(await exportXlsx(saved), { type: "array" });
    expect(out.Sheets[out.SheetNames[0]].A2.l.Target).toBe(
      "https://example.org/northwind/orders",
    );
  });
});
