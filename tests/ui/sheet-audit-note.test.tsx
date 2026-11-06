// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFile, type SheetFile } from "@suiteleaf/core";
import { SheetAuditNote } from "../../apps/web/src/editors/sheet-audit-note";

afterEach(cleanup);

describe("formula audit note", () => {
  it("provides a way back to the sheet", async () => {
    const onClose = vi.fn();
    const file = createFile("sheet", "Budget") as SheetFile;
    render(<SheetAuditNote content={file.content} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Back to sheet" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("shows the cycle for A1 and not a cell value", async () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const id = file.content.workbook.sheetOrder[0];
    file.content.workbook.sheets[id].cellData = {
      "0": {
        "0": { f: "=B1" },
        "1": { f: "=A1", v: "secret tomato" },
      },
    };
    render(<SheetAuditNote content={file.content} />);
    const region = screen.getByRole("region", { name: "Formula audit" });
    expect(region.textContent).toContain("A1 reads B1");
    expect(region.textContent).toContain("A1 refers to B1, and B1 refers to A1.");
    expect(region.textContent).toContain("Recalculate: A1, B1.");
    expect(region.textContent).toContain("Calculated: none. Left: A1, B1.");
    expect(region.textContent).toContain("an absolute value");
    expect(region.textContent).toContain("a choice between two cells");
    expect(region.textContent).toContain("does not show cell values");
    expect(region.textContent).not.toContain("secret tomato");
    await userEvent.clear(screen.getByLabelText("Audit cell"));
    await userEvent.type(screen.getByLabelText("Audit cell"), "B1");
    await userEvent.click(screen.getByRole("button", { name: "Show references" }));
    expect(region.textContent).toContain("B1 reads A1");
    expect(region.textContent).not.toContain("secret tomato");
  });

  it("names a formula on another sheet and leaves the cell value out", () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const id = file.content.workbook.sheetOrder[0];
    const current = file.content.workbook.sheets[id];
    current.name = "Beds";
    current.cellData = { "0": { "0": { f: "=Fees!B2" } } };
    file.content.workbook.sheetOrder.push("fees");
    file.content.workbook.sheets.fees = {
      ...current,
      id: "fees",
      name: "Fees",
      cellData: { "1": { "1": { f: "=Beds!A1", v: "secret-value" } } },
    };
    render(<SheetAuditNote content={file.content} />);
    const region = screen.getByRole("region", { name: "Formula audit" });
    expect(region.textContent).toContain("A1 reads Fees!B2");
    expect(region.textContent).toContain("A1 refers to Fees!B2, and Fees!B2 refers to A1.");
    expect(region.textContent).not.toContain("secret-value");
    expect(region.textContent).not.toContain("Other sheets:");
  });

  it("names the other sheet that copied the changed cell", () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const id = file.content.workbook.sheetOrder[0];
    const current = file.content.workbook.sheets[id];
    current.name = "Beds";
    current.cellData = { "0": { "0": { v: "secret-value" } } };
    file.content.workbook.sheetOrder.push("fees");
    file.content.workbook.sheets.fees = {
      ...current,
      id: "fees",
      name: "Fees",
      cellData: { "1": { "1": { f: "=Beds!A1" } } },
    };
    render(<SheetAuditNote content={file.content} />);
    const region = screen.getByRole("region", { name: "Formula audit" });
    expect(region.textContent).toContain("Other sheets: Fees!B2.");
    expect(region.textContent).not.toContain("secret-value");
  });

  it("moves the audit to the next formula error", async () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const id = file.content.workbook.sheetOrder[0];
    file.content.workbook.sheets[id].cellData = {
      "0": {
        "0": { v: "secret-value" },
        "1": { f: "=A1", v: "#DIV/0!" },
        "3": { f: "=C1", v: "#VALUE!" },
      },
    };
    render(<SheetAuditNote content={file.content} />);
    const region = screen.getByRole("region", { name: "Formula audit" });
    expect(region.textContent).toContain("Next error is B1, #DIV/0!.");
    expect(region.textContent).not.toContain("secret-value");
    await userEvent.click(screen.getByRole("button", { name: "Next error" }));
    expect((screen.getByLabelText("Audit cell") as HTMLInputElement).value).toBe("B1");
    expect(region.textContent).toContain("Next error is D1, #VALUE!.");
    await userEvent.click(screen.getByRole("button", { name: "Next error" }));
    expect((screen.getByLabelText("Audit cell") as HTMLInputElement).value).toBe("D1");
    expect(region.textContent).not.toContain("secret-value");
  });

  it("names a copied reference and leaves a wide sum", () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const id = file.content.workbook.sheetOrder[0];
    file.content.workbook.sheets[id].cellData = {
      "0": {
        "0": { v: 10 },
        "1": { f: "=A1", v: 4 },
        "2": { f: "=SUM(A1:A80)", v: 4 },
      },
      "2": { "0": { v: "secret-value" } },
    };
    render(<SheetAuditNote content={file.content} />);
    const region = screen.getByRole("region", { name: "Formula audit" });
    expect(region.textContent).toContain("Calculated: B1.");
    expect(region.textContent).toContain("Left: C1.");
    expect(region.textContent).not.toContain("secret-value");
    expect(region.textContent).not.toContain("10");
  });

  it("calculates a structured column when that column changes", async () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const id = file.content.workbook.sheetOrder[0];
    file.content.tables = [
      {
        name: "Sales",
        sheetId: id,
        headerRow: 0,
        startColumn: 0,
        endColumn: 2,
        endRow: 3,
      },
    ];
    file.content.workbook.sheets[id].cellData = {
      "0": {
        "0": { v: "Date" },
        "1": { v: "Team" },
        "2": { v: "Revenue" },
        "3": { f: "=SUM(Sales[Revenue])" },
      },
      "1": { "1": { v: "secret-value" }, "2": { v: 10 } },
      "2": { "2": { v: 20 } },
      "3": { "2": { v: 5 } },
    };
    render(<SheetAuditNote content={file.content} />);
    await userEvent.clear(screen.getByLabelText("Audit cell"));
    await userEvent.type(screen.getByLabelText("Audit cell"), "C2");
    await userEvent.click(screen.getByRole("button", { name: "Show references" }));
    const region = screen.getByRole("region", { name: "Formula audit" });
    expect(region.textContent).toContain("Calculated: D1.");
    expect(region.textContent).toContain("Left: none.");
    expect(region.textContent).not.toContain("secret-value");
    expect(region.textContent).not.toContain("35");
    expect(region.textContent).not.toContain("10");
  });

  it("shows the numbers in a small sum and leaves text out", async () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const id = file.content.workbook.sheetOrder[0];
    file.content.workbook.sheets[id].cellData = {
      "0": {
        "0": { v: 10 },
        "1": { v: "secret-value" },
      },
      "1": { "0": { f: "=SUM(A1:B1)" } },
    };
    render(<SheetAuditNote content={file.content} />);
    await userEvent.clear(screen.getByLabelText("Audit cell"));
    await userEvent.type(screen.getByLabelText("Audit cell"), "A2");
    await userEvent.click(screen.getByRole("button", { name: "Show references" }));
    const region = screen.getByRole("region", { name: "Formula audit" });
    expect(region.textContent).toContain("Evaluation: A1 is 10. B1 is text. The sum was not calculated.");
    expect(region.textContent).not.toContain("secret-value");
    expect(region.textContent).not.toContain("SUM");
  });
});
