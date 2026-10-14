import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createFile, type SuiteFile } from "@suiteleaf/core";
import { exportXlsx } from "../packages/core/src/xlsx-export";
import {
  documentZoom,
  rememberDocumentZoom,
} from "../apps/web/src/editors/doc-zoom";
import {
  attachSpreadsheetZoom,
  rememberSpreadsheetZoom,
  spreadsheetZoom,
} from "../apps/web/src/editors/sheet-zoom";

const DOCUMENT_ZOOM_KEY = "suiteleaf.doc-zoom";

describe("spreadsheet zoom", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    // A previous test may have held a zoom for a file with no id.
    rememberSpreadsheetZoom("reset", "100%");
    rememberDocumentZoom("reset", "100%");
    store.clear();
  });

  it("keeps 150% on spreadsheet A and leaves spreadsheet B and a document at 100%", () => {
    rememberDocumentZoom("minutes", "100%");
    const documentStore = localStorage.getItem(DOCUMENT_ZOOM_KEY);

    expect(spreadsheetZoom("sheet-a")).toBe("100%");
    expect(spreadsheetZoom("sheet-b")).toBe("100%");

    rememberSpreadsheetZoom("sheet-a", "150%");

    expect(spreadsheetZoom("sheet-a")).toBe("150%");
    expect(spreadsheetZoom("sheet-b")).toBe("100%");
    expect(spreadsheetZoom("minutes")).toBe("100%");
    expect(documentZoom("minutes", 1280)).toBe("100%");
    expect(documentZoom("sheet-a", 1280)).toBe("100%");
    expect(localStorage.getItem(DOCUMENT_ZOOM_KEY)).toBe(documentStore);
    expect(localStorage.getItem(DOCUMENT_ZOOM_KEY)).not.toContain("150%");
  });

  it("holds zoom in memory until an unsaved spreadsheet receives an id", () => {
    rememberSpreadsheetZoom("", "150%");
    expect(spreadsheetZoom("")).toBe("150%");
    expect(spreadsheetZoom("sheet-b")).toBe("100%");
    expect(documentZoom("", 1280)).toBe("100%");

    attachSpreadsheetZoom("sheet-a");

    expect(spreadsheetZoom("sheet-a")).toBe("150%");
    expect(spreadsheetZoom("sheet-b")).toBe("100%");
    expect(spreadsheetZoom("")).toBe("100%");
    expect(documentZoom("sheet-a", 1280)).toBe("100%");
  });

  it("does not write 150% into a cell or the workbook", async () => {
    const file = createFile("sheet", "Grocery budget") as Extract<
      SuiteFile,
      { kind: "sheet" }
    >;
    const id = file.content.workbook.sheetOrder[0];
    file.content.workbook.sheets[id].cellData = {
      0: { 0: { v: "Groceries" }, 1: { v: "Amount" } },
      1: { 0: { v: "Milk" }, 1: { v: 4 } },
      2: { 0: { v: "Bread" }, 1: { v: 2 } },
    };
    const before = JSON.stringify(file);

    rememberSpreadsheetZoom(file.id, "150%");

    expect(JSON.stringify(file)).toBe(before);
    expect(before).not.toContain("150%");
    expect(spreadsheetZoom(file.id)).toBe("150%");
    expect(documentZoom(file.id, 1280)).toBe("100%");

    const zip = await JSZip.loadAsync(await exportXlsx(file));
    const xml = [
      await zip.file("xl/worksheets/sheet1.xml")!.async("string"),
      (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "",
    ].join("\n");
    expect(xml).toContain("Groceries");
    expect(xml).toContain("Milk");
    expect(xml).toContain("Bread");
    expect(xml).not.toContain("150%");
  });
});
