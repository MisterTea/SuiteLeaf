// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/web/src/ai/tools/sheet-cells", async (original) => ({
  ...(await original<typeof import("../apps/web/src/ai/tools/sheet-cells")>()),
  wait: () => Promise.resolve(),
}));
vi.mock("../apps/web/src/ai/cursor", () => ({ moveCursor: async () => {} }));

import { cellHyperlink } from "@suiteleaf/core";
import { startRequest } from "../apps/web/src/ai/guard";
import { sheetToolKit } from "../apps/web/src/ai/tools/sheet-tool-kit";
import { linkRequestNotes, sheetLinkTools } from "../apps/web/src/ai/tools/sheet-link-tools";
import { sheetNoteTools } from "../apps/web/src/ai/tools/sheet-note-tools";
import { sheetUndoTools, sheetWorkbookTools } from "../apps/web/src/ai/tools/sheet-workbook-tools";
import { sheetBeforeTool } from "../apps/web/src/ai/tools/sheets";
import { makeHarness, runTool, type Harness } from "./ai-sheet-harness";

const clients = () =>
  makeHarness([
    {
      name: "Sheet1",
      rows: [
        ["Client", "Budget", "Site"],
        ["Northwind", 100, "Contoso"],
        ["Fabrikam", 200, "=B2*2"],
        ["northwind", 300, "Litware"],
      ],
    },
    { name: "Notes", rows: [["Plan"]] },
  ]);

let h: Harness;
const tools = () => {
  const kit = sheetToolKit(h.ctx);
  return [...sheetLinkTools(h.ctx, kit), ...sheetNoteTools(h.ctx, kit), ...sheetWorkbookTools(h.ctx), ...sheetUndoTools(h.ctx)];
};
const run = (name: string, args: Record<string, unknown> = {}) => runTool(tools(), name, args);
const data = (ref: string) => h.sheet().getRange(ref).getCellData();

beforeEach(() => {
  startRequest("");
  h = clients();
});

describe("cell links", () => {
  it("reads loose argument names", () => {
    const link = tools().find((item) => item.name === "set_cell_link")!;
    expect(link.prepare!({ label: "'Contoso'", url: '"contoso.com"' })).toEqual({ cell: "Contoso", address: "contoso.com" });
    expect(tools().find((item) => item.name === "remove_cell_link")!.prepare!({ name: "Contoso" })).toEqual({ cell: "Contoso" });
  });

  it("links the label in a cell, keeps its text, and changes only the address on a second call", async () => {
    expect(await run("set_cell_link", { cell: "Contoso", address: "contoso.com" })).toBe(
      'Linked C2. The cell still says "Contoso". Its address is https://contoso.com.',
    );
    expect(cellHyperlink(data("C2"))).toBe("https://contoso.com");
    expect(h.sheet().getRange("C2").getValue()).toBe("Contoso");
    expect(await run("set_cell_link", { cell: "C2", address: "https://contoso.com/about" })).toBe(
      'Linked C2. The cell still says "Contoso". Its address is https://contoso.com/about.',
    );
    expect(await run("remove_cell_link", { cell: "Contoso" })).toBe('Removed the link from C2. It still says "Contoso" and has no address.');
    expect(cellHyperlink(data("C2"))).toBeNull();
    expect(h.sheet().getRange("C2").getValue()).toBe("Contoso");
  });

  it("prefers the exact spelling when two cells differ only by case", async () => {
    expect(await run("set_cell_link", { cell: "Sheet1!northwind", address: "nw.example" })).toContain("Linked A4.");
    await expect(run("set_cell_link", { cell: "NORTHWIND", address: "nw.example" })).rejects.toThrow(
      'More than one cell says "NORTHWIND". Give the cell address, such as A2.',
    );
  });

  it("links an empty cell with its own address as the text, and takes a one-cell range", async () => {
    expect(await run("set_cell_link", { cell: "D2:D2", address: "mailto:ana@example.org" })).toBe(
      'Linked D2. The cell still says "mailto:ana@example.org". Its address is mailto:ana@example.org.',
    );
  });

  it("refuses addresses that are not links, formulas, and cells it cannot find", async () => {
    expect(await run("set_cell_link", { cell: "Fabrikam", address: "javascript:alert(1)" })).toBe(
      'Refused "javascript:alert(1)". It is not a web address. A3 still says "Fabrikam" and has no new address. Leave it as plain text. Do not type the address into the cell.',
    );
    await expect(run("set_cell_link", { cell: "C3", address: "x.org" })).rejects.toThrow("C3 is a formula. Link a cell that holds words. Nothing was changed.");
    await expect(run("remove_cell_link", { cell: "C3" })).rejects.toThrow("C3 is a formula. Nothing was changed.");
    await expect(run("set_cell_link", { cell: "Tailspin", address: "x.org" })).rejects.toThrow('No cell says "Tailspin".');
    await expect(run("set_cell_link", { cell: "A2:B3", address: "x.org" })).rejects.toThrow("Link one cell, not A2:B3.");
    await expect(run("set_cell_link", { cell: "", address: "x.org" })).rejects.toThrow('Give cell, such as {"cell":"Northwind","address":"example.org/northwind"}.');
    await expect(run("set_cell_link", { cell: "A2" })).rejects.toThrow('Give address, such as "example.org/northwind".');
    await expect(run("remove_cell_link", {})).rejects.toThrow('Give cell, such as {"cell":"Contoso"}.');
  });

  it("lists links the request asked for that are missing or wrong", async () => {
    startRequest('Link Contoso to contoso.com. Then set_cell_link with cell "Fabrikam" and address "fabrikam.com". Link Tailspin to tailspin.org.');
    expect(linkRequestNotes(h.ctx)).toEqual([
      'A3 should say "Fabrikam" and link to https://fabrikam.com. Call set_cell_link with cell "Fabrikam" and address "https://fabrikam.com". Leave the label as Fabrikam.',
      'C2 should say "Contoso" and link to https://contoso.com. Call set_cell_link with cell "Contoso" and address "https://contoso.com". Leave the label as Contoso.',
      'No cell says "Tailspin". Restore that label, then call set_cell_link with cell "Tailspin" and address "https://tailspin.org". Do not type the address over the label.',
    ]);
    await run("set_cell_link", { cell: "Contoso", address: "contoso.com" });
    expect(linkRequestNotes(h.ctx)).toHaveLength(2);
    startRequest("");
    expect(linkRequestNotes(h.ctx)).toEqual([]);
  });
});

describe("notes and comments", () => {
  it("adds a note, opens it, and names the cell's row and column", async () => {
    expect(await run("add_note", { cell: "B3", text: "Check this" })).toBe(
      'Added a note to B3 (Fabrikam, Budget): "Check this". It pops up when the pointer is over the cell.',
    );
    expect(h.popups).toEqual(["sheet.operation.add-note-popup"]);
    expect(await run("add_note", { cell: "A1", text: "Header" })).toBe('Added a note to A1: "Header". It pops up when the pointer is over the cell.');
  });

  it("adds a comment, taking the signature out of its text", async () => {
    const text = await run("add_comment", { cell: "B2", text: "Please confirm\nthe total - Sam.", signed_as: " Sam " });
    expect(h.ctx.setAuthor).toHaveBeenCalledWith("Sam");
    expect(text).toBe(
      'Commented on B2 (Northwind, Budget), unsigned: no name is set on this computer, so it shows as "You" here and "Anonymous" to others: "Please confirm\nthe total".',
    );
    expect(h.popups).toEqual(["sheet.operation.show-comment-modal"]);
    h.ctx.signature = () => "Alex Kim";
    expect(await run("add_comment", { cell: "C2", text: "Looks good", signed_as: "Sam" })).toContain(
      `signed "Alex Kim" (the signed-in account's name; "Sam" can't be used): "Looks good".`,
    );
    expect(await run("add_comment", { cell: "A2", text: "Hi" })).toBe('Commented on A2 (Client), signed "Alex Kim": "Hi".');
  });

  it("lists the notes and comments on the sheet", async () => {
    expect(await run("read_notes_and_comments")).toBe("There are no notes or comments.");
    await run("add_note", { cell: "B3", text: "Check this" });
    await run("add_comment", { cell: "C2", text: "Is this right?" });
    expect(await run("read_notes_and_comments")).toBe("C2 comment (unsigned): Is this right?\nB3 note: Check this");
  });

  it("says when a comment could not be added", async () => {
    const range = h.sheet().getRange("B2");
    const proto = Object.getPrototypeOf(range);
    const add = vi.spyOn(proto, "addCommentAsync").mockResolvedValue(false);
    await expect(run("add_comment", { cell: "B2", text: "x" })).rejects.toThrow("Could not add a comment to B2.");
    add.mockRestore();
  });
});

describe("switching sheets and exporting", () => {
  it("goes to a sheet by name, adds one when asked, and lists the sheets otherwise", async () => {
    expect(await run("switch_sheet", { name: "notes" })).toBe('On sheet "Notes". Used range A1.');
    expect(h.sheet().getSheetName()).toBe("Notes");
    expect(await run("switch_sheet", { name: "Summary", add: true })).toBe('On sheet "Summary". Used range A1.');
    await expect(run("switch_sheet", { name: "Archive" })).rejects.toThrow('No sheet is called "Archive". Sheets: Sheet1, Notes, Summary.');
  });

  it("reads the export format from loose words", () => {
    const exporter = tools().find((item) => item.name === "export_spreadsheet")!;
    expect(exporter.prepare!({ type: "Excel workbook" })).toEqual({ format: "xlsx" });
    expect(exporter.prepare!({ file_type: "tab separated" })).toEqual({ format: "tsv" });
    expect(exporter.prepare!({ format: "Comma" })).toEqual({ format: "csv" });
    expect(exporter.prepare!({ format: "pdf" })).toEqual({ format: "pdf" });
    startRequest("Use export_spreadsheet to save an Excel xlsx with the outline.");
    expect(exporter.prepare!({})).toEqual({ format: "xlsx" });
  });

  it("exports and says where the file went, or that the dialog was closed", async () => {
    expect(await run("export_spreadsheet", { format: "csv" })).toBe('Exported the sheet "Sheet1" as "Budget.csv".');
    vi.mocked(h.ctx.exportAs).mockResolvedValueOnce("/Users/ana/Budget.xlsx");
    expect(await run("export_spreadsheet", { format: "xlsx" })).toBe('Exported every sheet as "Budget.xlsx"; the user saved it as /Users/ana/Budget.xlsx.');
    vi.mocked(h.ctx.exportAs).mockResolvedValueOnce(null);
    expect(await run("export_spreadsheet", { format: "xlsx" })).toBe(
      'The user closed the save dialog, so "Budget.xlsx" was not exported. Tell them; export again only if they ask.',
    );
  });

  it("exports an Excel outline when the request is about the existing groups", async () => {
    startRequest("Use export_spreadsheet to save an Excel xlsx with the outline. Do not delete the groups.");
    await expect(run("export_spreadsheet", { format: "csv" })).rejects.toThrow("That format is not an Excel workbook. Call export_spreadsheet with format \"xlsx\".");
    expect(await run("export_spreadsheet", { format: "xlsx" })).toBe(
      'Exported every sheet as "Budget.xlsx". The month columns and the expense rows are an Excel outline. Cell values are unchanged and the groups are still there. Stop.',
    );
  });
});

describe("undo", () => {
  it("undoes only the assistant's own changes in this request", async () => {
    startRequest("Change the budget.");
    await h.ctx.settle();
    sheetBeforeTool(h.ctx);
    await expect(run("undo")).rejects.toThrow("Nothing you changed in this request is left to undo.");
    h.sheet().getRange("B2").setValue(150);
    h.sheet().getRange("B4").setValue(350);
    await h.ctx.settle();
    expect(await run("undo")).toBe("Undid your last change: B4 350 → 300. 1 more of your changes in this request can be undone.");
    expect(await run("undo")).toBe("Undid your last change: B2 150 → 100; C3 =B2*2 (300) → =B2*2 (200). None of your changes in this request are left to undo.");
    expect(h.sheet().getRange("B2").getValue()).toBe(100);
  });

  it("still undoes when the history is full, and reports a change it cannot see", async () => {
    h.ctx.undoCount = () => 50;
    await h.ctx.settle();
    h.sheet().getRange("A1").setFontWeight("bold");
    expect(await run("undo")).toBe(
      "Undid your last change: nothing visible changed (a setting or a style). None of your changes in this request are left to undo.",
    );
  });

  it("is refused for a print layout or a column-group request", async () => {
    startRequest("Insert a page break above row 3.");
    await expect(run("undo")).rejects.toThrow("Do not undo a print layout.");
    startRequest("Group columns B through M.");
    await expect(run("undo")).rejects.toThrow("Do not use undo.");
  });
});
