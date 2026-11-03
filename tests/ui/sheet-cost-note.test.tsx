// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFile, type SheetFile } from "@suiteleaf/core";
import { SheetCostNote, costSheets } from "../../apps/web/src/editors/sheet-cost-note";

afterEach(cleanup);

describe("spreadsheet cost note", () => {
  it("names volatile formulas and does not show a cell value", () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const id = file.content.workbook.sheetOrder[0];
    file.content.workbook.sheets[id].cellData = {
      "0": {
        "0": { v: "secret tomato count" },
        "1": { f: "=NOW()" },
        "2": { f: '="NOW()"' },
      },
      "1": { "0": { f: "=TODAY()" } },
      "9": { "0": { f: "=RAND()" } },
    };
    const inputs = costSheets(file.content);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].name).toBe(file.content.workbook.sheets[id].name);
    const named = inputs[0].name;
    file.content.workbook.sheets[id].name = " ";
    expect(costSheets(file.content)[0].name).toBe("Sheet");
    expect(costSheets(file.content)[0].name).not.toBe(id);
    file.content.workbook.sheets[id].name = named;
    render(<SheetCostNote content={file.content} />);
    const region = screen.getByRole("region", { name: "Spreadsheet cost" });
    expect(region.textContent).toContain("Volatile formulas: A2, A10, B1.");
    expect(region.textContent).not.toContain("C1");
    expect(region.textContent).toContain("Interactive spreadsheet.");
    expect(region.textContent).toContain("not a measured latency or memory budget");
    expect(region.textContent).toContain("does not time recalculation");
    expect(region.textContent).toContain("No formula names 64 cells or more.");
    expect(region.textContent).not.toContain("secret tomato");
    expect(screen.queryByRole("button", { name: "Open the query panel" })).toBeNull();
  });

  it("names the sheet of a volatile formula when the workbook has another sheet", () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const id = file.content.workbook.sheetOrder[0];
    const current = file.content.workbook.sheets[id];
    current.name = "secret-value";
    current.cellData = { "0": { "1": { f: "=NOW()", v: "secret-value" } } };
    file.content.workbook.sheetOrder.push("fees");
    file.content.workbook.sheets.fees = {
      ...current,
      id: "fees",
      name: "Fees",
      cellData: { "0": { "0": { f: "=TODAY()" } } },
    };
    render(<SheetCostNote content={file.content} />);
    const region = screen.getByRole("region", { name: "Spreadsheet cost" });
    expect(region.textContent).toContain("Volatile formulas: another sheet B1, Fees A1.");
    expect(region.textContent).not.toContain("secret-value");
    expect(current.cellData["0"]["1"].v).toBe("secret-value");
  });

  it("does not show a sheet name that breaks across lines", () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const id = file.content.workbook.sheetOrder[0];
    const current = file.content.workbook.sheets[id];
    current.name = "Garden\nBeds";
    current.cellData = { "0": { "1": { f: "=NOW()", v: "secret-value" } } };
    file.content.workbook.sheetOrder.push("fees");
    file.content.workbook.sheets.fees = {
      ...current,
      id: "fees",
      name: "Fees",
      cellData: { "0": { "0": { f: "=TODAY()" } } },
    };
    render(<SheetCostNote content={file.content} />);
    const region = screen.getByRole("region", { name: "Spreadsheet cost" });
    expect(region.textContent).toContain("Volatile formulas: another sheet B1, Fees A1.");
    expect(region.textContent).not.toContain("Garden");
    expect(region.textContent).not.toContain("secret-value");
    expect(current.name).toBe("Garden\nBeds");
  });

  it("names a wide formula by its cell and leaves the formula text out", () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const id = file.content.workbook.sheetOrder[0];
    file.content.workbook.sheets[id].cellData = {
      "0": {
        "2": { f: '=SUM(A1:A80)&"secret-value"' },
      },
    };
    render(<SheetCostNote content={file.content} />);
    const region = screen.getByRole("region", { name: "Spreadsheet cost" });
    expect(region.textContent).toContain("Wide formulas: C1 names 80 cells.");
    expect(region.textContent).not.toContain("secret-value");
    expect(region.textContent).not.toContain("A1:A80");
  });

  it("opens the query panel when the workbook is in the large tier", async () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const id = file.content.workbook.sheetOrder[0];
    const cellData: Record<string, Record<string, { v: number }>> = {};
    for (let row = 0; row < 50_001; row += 1) cellData[String(row)] = { "0": { v: 1 } };
    file.content.workbook.sheets[id].cellData = cellData;
    const open = vi.fn();
    render(<SheetCostNote content={file.content} onOpenQuery={open} />);
    const region = screen.getByRole("region", { name: "Spreadsheet cost" });
    expect(region.textContent).toContain("large tier");
    expect(region.textContent).not.toContain("secret-value");
    await userEvent.click(screen.getByRole("button", { name: "Open the query panel" }));
    expect(open).toHaveBeenCalledOnce();
  });

  it("names the longest measured phase and leaves an unnamed phase out", () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    render(
      <SheetCostNote
        content={file.content}
        phases={[
          { name: "parse", elapsedMs: 4 },
          { name: "recalculate", elapsedMs: 30 },
          { name: "secret-value", elapsedMs: 90 },
          { name: "render", elapsedMs: 12, failed: true },
        ]}
      />,
    );
    const region = screen.getByRole("region", { name: "Spreadsheet cost" });
    expect(region.textContent).toContain("The longest measured phase is recalculate at 30 ms.");
    expect(region.textContent).toContain("This is not a speedup claim.");
    expect(region.textContent).not.toContain("secret-value");
    expect(region.textContent).not.toContain("render");
  });
});
