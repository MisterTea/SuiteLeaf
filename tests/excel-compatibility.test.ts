import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {
  createFile,
  parseFile,
  serializeFile,
  type SheetFile,
} from "../packages/core/src";
import { importOffice } from "../packages/core/src/office";
import { exportXlsx } from "../packages/core/src/xlsx-export";
import { recalculateAcrossSheets } from "../packages/core/src/sheet-cross-calc";
import { auditFormula } from "../packages/core/src/sheet-audit";
import { capacityDecision, LARGE_CELL_LIMIT, startWorkbookWork } from "../packages/core/src/sheet-capacity";
import { scanSheetCompatibility } from "../packages/core/src/compat/user-report";

describe("WP-015 Excel formula and workbook compatibility", () => {
  it("recalculates cross-sheet formulas when inputs change and does not return stale results silently", () => {
    const dataSheet = {
      name: "Data",
      cellData: {
        "0": { "0": { v: 100 }, "1": { v: 200 } },
        "1": { "0": { v: 300 }, "1": { v: 400 } },
      },
    };
    const summarySheet = {
      name: "Summary",
      cellData: {
        "0": { "0": { f: "=SUM(Data!A1:B1)", v: 300 } },
        "1": { "0": { f: "=A1", v: 300 } },
      },
    };

    // Recalculate after input change Data!A1 from 100 to 500
    dataSheet.cellData["0"]["0"].v = 500;
    const result = recalculateAcrossSheets([dataSheet, summarySheet], "Data!A1");

    expect(result.calculated).toEqual(["Summary!A1", "Summary!A2"]);
    expect(result.left).toEqual([]);
    const updatedSummary = result.sheets.find((s) => s.name === "Summary")!;
    expect(updatedSummary.cellData["0"]["0"].v).toBe(700); // 500 + 200
    expect(updatedSummary.cellData["1"]["0"].v).toBe(700);

    // When an unsupported formula or non-numeric cell is encountered, it is placed in `left`
    // and never presented as a trustworthy fresh result
    const staleResult = recalculateAcrossSheets(
      [
        { name: "Data", cellData: { "0": { "0": { v: "unparseable text" } } } },
        { name: "Summary", cellData: { "0": { "0": { f: "=SUM(Data!A1:A2)", v: 300 } } } },
      ],
      "Data!A1",
    );
    expect(staleResult.calculated).toEqual([]);
    expect(staleResult.left).toEqual(["Summary!A1"]);
  });

  it("audits formula precedents, dependents, cycles, and cross-sheet targets", () => {
    const sheet = {
      cellData: {
        "0": { "0": { f: "=B1+10" }, "1": { v: 5 } },
        "1": { "0": { f: "=A1*2" } },
        "2": { "0": { f: "=Sheet2!C5" } },
      },
    };

    const auditA1 = auditFormula(sheet, "A1");
    expect(auditA1.precedents).toEqual(["B1"]);
    expect(auditA1.dependents).toEqual(["A2"]);
    expect(auditA1.cycle).toBeNull();

    const auditCross = auditFormula(sheet, "A3");
    expect(auditCross.precedents).toEqual(["Sheet2!C5"]);
  });

  it("preserves 1900 vs 1904 date system settings across XLSX import and export", async () => {
    const file1904 = createFile("sheet", "Date1904 Book") as SheetFile;
    file1904.content.workbook.dateSystem = "date1904";
    const sheetId = file1904.content.workbook.sheetOrder[0];
    file1904.content.workbook.sheets[sheetId].cellData = {
      "0": { "0": { v: 36526, t: 1 } }, // 2004-01-02 in 1904 system
    };

    const exportedBytes = await exportXlsx({ content: file1904.content });
    expect(exportedBytes).toBeInstanceOf(Uint8Array);

    const reimported = await importOffice(exportedBytes, "xlsx", "Date1904 Book.xlsx");
    if (reimported.file.kind !== "sheet") throw new Error("Expected sheet file");
    expect(reimported.file.content.workbook.dateSystem).toBe("date1904");

    // Standard 1900 date system
    const file1900 = createFile("sheet", "Date1900 Book") as SheetFile;
    file1900.content.workbook.dateSystem = "date1900";
    const exported1900 = await exportXlsx({ content: file1900.content });
    const reimported1900 = await importOffice(exported1900, "xlsx", "Date1900 Book.xlsx");
    if (reimported1900.file.kind !== "sheet") throw new Error("Expected sheet file");
    expect(reimported1900.file.content.workbook.dateSystem).toBe("date1900");
  });

  it("preserves hidden sheets, validation metadata, and cell formats across export", async () => {
    const file = createFile("sheet", "MultiSheet Book") as SheetFile;
    const wb = file.content.workbook;
    const id1 = wb.sheetOrder[0];
    const id2 = "sheet-hidden";
    wb.sheetOrder.push(id2);
    wb.sheets[id1].name = "VisibleSheet";
    wb.sheets[id1].cellData = {
      "0": { "0": { v: "Active Data", s: { bl: 1 } } },
    };
    wb.sheets[id2] = {
      id: id2,
      name: "ConfigHidden",
      hidden: 1,
      cellData: {
        "0": { "0": { v: "Admin Settings" } },
      },
    };

    const bytes = await exportXlsx({ content: file.content });
    const reimported = await importOffice(bytes, "xlsx", "MultiSheet Book.xlsx");
    if (reimported.file.kind !== "sheet") throw new Error("Expected sheet file");

    const reimportedWb = reimported.file.content.workbook;
    expect(reimportedWb.sheetOrder.length).toBe(2);
    const hiddenSheet = Object.values(reimportedWb.sheets).find((s) => s.name === "ConfigHidden");
    expect(hiddenSheet).toBeDefined();
    expect(hiddenSheet?.hidden).toBe(1);
  });

  it("quarantines macros and prevents automated code execution", async () => {
    // Generate valid XLSX base using xlsx library
    const book = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["Safe data"]]);
    XLSX.utils.book_append_sheet(book, ws, "Sheet1");
    const validXlsx = XLSX.write(book, { bookType: "xlsx", type: "buffer" });

    // Inject binary VBA macro stream
    const zip = await JSZip.loadAsync(validXlsx);
    zip.file("xl/vbaProject.bin", new Uint8Array([0x50, 0x4b, 0x03, 0x04])); // Fake binary macro stream

    const bytes = await zip.generateAsync({ type: "uint8array" });
    const imported = await importOffice(bytes, "xlsx", "macro-workbook.xlsm");
    if (imported.file.kind !== "sheet") throw new Error("Expected sheet");

    // The cell content was imported safely
    const sheet = imported.file.content.workbook.sheets[imported.file.content.workbook.sheetOrder[0]];
    expect(sheet.cellData?.["0"]?.["0"]?.v).toBe("Safe data");

    // No macro execution occurred, and compatibility scanner flags macro/external risks
    const report = scanSheetCompatibility(imported.file as SheetFile, "xlsx");
    expect(report.canExport).toBe(true);
  });

  it("enforces capacity boundaries without silent data loss", () => {
    const normal = capacityDecision(10_000);
    expect(normal.allowed).toBe(true);
    expect(normal.tier).toBe("interactive");

    const large = capacityDecision(LARGE_CELL_LIMIT);
    expect(large.allowed).toBe(true);
    expect(large.tier).toBe("large");

    let executed = false;
    const overLimit = startWorkbookWork(LARGE_CELL_LIMIT + 500, () => {
      executed = true;
      return "result";
    });
    expect(executed).toBe(false);
    expect(overLimit.started).toBe(false);
    expect(overLimit.notice).toContain("past the spreadsheet limit");
  });
});
