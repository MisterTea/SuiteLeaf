// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createFile, type SheetFile } from "@suiteleaf/core";
import { SheetAccessNote } from "../../apps/web/src/editors/sheet-access-note";

afterEach(cleanup);

describe("spreadsheet accessibility notes", () => {
  it("names a column with values and no header, and hides the cell value", () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const id = file.content.workbook.sheetOrder[0];
    file.content.workbook.sheets[id].cellData = {
      "1": { "1": { v: "secret tomato count" } },
    };
    const calls: string[] = [];
    render(
      <SheetAccessNote
        content={file.content}
        onSelect={(sheetId, column) => calls.push(`${sheetId}:${column}`)}
      />,
    );
    const region = screen.getByRole("region", { name: "Spreadsheet accessibility" });
    expect(region.textContent).toContain("Column 2 has values and no header.");
    expect(region.textContent).toContain("not a WCAG claim");
    expect(region.textContent).not.toContain("secret tomato");
    fireEvent.click(screen.getByRole("button", { name: /Column 2 has values and no header/ }));
    expect(calls).toEqual([`${id}:1`]);
    file.content.workbook.sheets[id].name = " ";
    cleanup();
    render(<SheetAccessNote content={file.content} />);
    const unnamed = screen.getByRole("region", { name: "Spreadsheet accessibility" });
    expect(unnamed.textContent).toContain("Sheet: Column 2 has values and no header.");
    expect(unnamed.textContent).not.toContain(id);
  });

  it("describes a chart without the cell value or the series color", () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const sheetId = file.content.workbook.sheetOrder[0];
    file.content.charts.push({
      id: "fees",
      title: "Plot fees",
      type: "bar",
      source: { sheetId, startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 },
      sheetId,
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      excel: {
        anchorResolved: true,
        series: [{ name: "Dues", values: { sheetId, startRow: 1, endRow: 2, startColumn: 1, endColumn: 1 }, color: "#112233" }],
        legend: "bottom",
        markers: false,
        biff: { axes: [], categories: ["North"], axisTitles: [], annotations: [], dataTable: false },
        anchor: {
          fromColumn: 0,
          fromRow: 0,
          fromColumnOffset: 0,
          fromRowOffset: 0,
          toColumn: 4,
          toRow: 10,
          toColumnOffset: 0,
          toRowOffset: 0,
        },
      },
    });
    file.content.workbook.sheets[sheetId].cellData = {
      "1": { "1": { v: "secret tomato" } },
    };
    render(<SheetAccessNote content={file.content} />);
    const region = screen.getByRole("region", { name: "Spreadsheet accessibility" });
    expect(region.textContent).toContain("Bar chart Plot fees. Series Dues. Categories North. Legend bottom.");
    expect(region.textContent).not.toContain("secret tomato");
    expect(region.textContent).not.toContain("#112233");
  });

  it("names the right axis of a combo chart and leaves the data row out", () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const sheetId = file.content.workbook.sheetOrder[0];
    file.content.charts.push({
      id: "fees",
      title: "Plot fees",
      type: "combo",
      source: { sheetId, startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 },
      sheetId,
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    file.content.workbook.sheets[sheetId].cellData = {
      "0": { "0": { v: "Plot" }, "1": { v: "Dues" }, "2": { v: "Rate" } },
      "1": { "1": { v: "secret tomato" } },
    };
    render(<SheetAccessNote content={file.content} />);
    const region = screen.getByRole("region", { name: "Spreadsheet accessibility" });
    expect(region.textContent).toContain(
      "Combo chart Plot fees. Series Dues and Rate. Right axis Rate.",
    );
    expect(region.textContent).not.toContain("secret tomato");
  });

  it("names a formula error and selects that cell", () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const id = file.content.workbook.sheetOrder[0];
    file.content.workbook.sheets[id].cellData = {
      "1": {
        "1": { v: "#REF!", f: "secret-value" } as { v: string },
        "2": { v: "secret-value" },
      },
    };
    const calls: string[] = [];
    render(
      <SheetAccessNote
        content={file.content}
        onSelect={(sheetId, column, row) => calls.push(`${sheetId}:${row}:${column}`)}
      />,
    );
    const region = screen.getByRole("region", { name: "Spreadsheet accessibility" });
    expect(region.textContent).toContain("B2 shows #REF!.");
    expect(region.textContent).not.toContain("secret-value");
    fireEvent.click(screen.getByRole("button", { name: /B2 shows #REF!/ }));
    expect(calls).toEqual([`${id}:1:1`]);
  });
});
