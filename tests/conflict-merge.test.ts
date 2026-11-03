import { describe, expect, it } from "vitest";
import { createFile, mergeDocumentBlocks, type DrawingFile, type FormFile, type JsonNode, type SheetFile, type SlideFile } from "@suiteleaf/core";
import {
  combineDocuments,
  keepBothDrawings,
  keepBothForms,
  keepBothSheets,
  keepBothSlides,
  keepSelectedCells,
  keptLocalCopy,
} from "../apps/web/src/conflict-merge";
import type { SuiteFile } from "@suiteleaf/core";

function doc(paragraphs: string[]): JsonNode {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
}

function file(content: JsonNode, title = "Notes"): SuiteFile {
  return {
    id: "file",
    version: 1,
    kind: "doc",
    title,
    createdAt: "2026-10-30T22:00:00.000Z",
    updatedAt: "2026-10-30T22:00:00.000Z",
    content,
  };
}

describe("mergeDocumentBlocks", () => {
  it("combines edits in different blocks and keeps both sources", () => {
    const base = doc(["one", "two"]);
    const local = doc(["ONE", "two"]);
    const remote = doc(["one", "TWO"]);
    const result = mergeDocumentBlocks(base, local, remote);
    expect(result.merged).toEqual(doc(["ONE", "TWO"]));
    expect(result.kept.local).toEqual(local);
    expect(result.kept.remote).toEqual(remote);
    local.content![0]!.content![0]!.text = "changed after";
    expect(result.kept.local.content![0]!.content![0]!.text).toBe("ONE");
  });

  it("refuses a block that both sides changed", () => {
    const result = mergeDocumentBlocks(doc(["one"]), doc(["local"]), doc(["remote"]));
    expect(result.merged).toBeUndefined();
    expect(result.reason).toContain("Block 1");
    expect(result.kept.local).toEqual(doc(["local"]));
  });

  it("stacks a block that both sides changed and leaves the sources", () => {
    const base = doc(["one"]);
    const local = doc(["North"]);
    const remote = doc(["secret-value"]);
    const result = mergeDocumentBlocks(base, local, remote, "stack");
    expect(result.merged).toEqual(doc(["North", "secret-value"]));
    expect(result.reason).toBeUndefined();
    expect(result.kept.local).toEqual(local);
    expect(result.kept.remote).toEqual(remote);
    const separate = mergeDocumentBlocks(base, local, remote);
    expect(separate.merged).toBeUndefined();
    expect(separate.reason).not.toContain("secret-value");
    const plan = combineDocuments(file(base), file(local), file(remote), { keepBoth: true });
    expect(plan.merged?.content).toEqual(doc(["North", "secret-value"]));
    expect(plan.localCopy.title).toBe("Notes (your edits)");
  });

  it("keeps comment threads from the side that changed them", () => {
    const base = { ...doc(["one"]), attrs: { commentThreads: [] as unknown[] } };
    const local = { ...doc(["ONE"]), attrs: { commentThreads: [] as unknown[] } };
    const thread = { id: "c1", text: "Water the beds" };
    const remote = {
      ...doc(["one"]),
      attrs: { commentThreads: [thread] },
    };
    const result = mergeDocumentBlocks(base, local, remote);
    expect(result.merged?.content).toEqual(doc(["ONE"]).content);
    expect(result.merged?.attrs).toEqual({ commentThreads: [{ id: "c1", text: "Water the beds" }] });
    expect(JSON.stringify(result.kept.remote)).toContain("Water the beds");
    thread.text = "changed after";
    expect(result.merged?.attrs).toEqual({ commentThreads: [{ id: "c1", text: "Water the beds" }] });
  });

  it("leaves both copies separate when document settings changed on both sides", () => {
    const base = { ...doc(["one"]), attrs: { commentThreads: [] as unknown[] } };
    const local = { ...doc(["one"]), attrs: { commentThreads: [{ text: "North" }] } };
    const remote = { ...doc(["one"]), attrs: { commentThreads: [{ text: "secret-value" }] } };
    const result = mergeDocumentBlocks(base, local, remote, "stack");
    expect(result.merged).toBeUndefined();
    expect(result.reason).toBe("Document settings changed in both copies, so they stay separate.");
    expect(result.reason).not.toContain("secret-value");
    expect(JSON.stringify(result.kept.remote)).toContain("secret-value");
  });

  it("keeps a comment from each copy when the threads have different ids", () => {
    const base = { ...doc(["one"]), attrs: { commentThreads: [] as unknown[] } };
    const local = { ...doc(["one"]), attrs: { commentThreads: [{ id: "c1", text: "North" }] } };
    const remote = { ...doc(["one"]), attrs: { commentThreads: [{ id: "c2", text: "Water the beds" }] } };
    const result = mergeDocumentBlocks(base, local, remote);
    expect(result.reason).toBeUndefined();
    expect(result.merged?.attrs?.commentThreads).toEqual([
      { id: "c1", text: "North" },
      { id: "c2", text: "Water the beds" },
    ]);
    expect(local.attrs?.commentThreads).toEqual([{ id: "c1", text: "North" }]);
  });

  it("keeps a paragraph style and a comment that changed on different copies", () => {
    const base = doc(["one"]);
    const local = { ...doc(["one"]), attrs: { paragraphStyles: { body: "North" } } };
    const remote = { ...doc(["one"]), attrs: { commentThreads: [{ id: "c1", text: "Water the beds" }] } };
    const result = mergeDocumentBlocks(base, local, remote);
    expect(result.merged?.attrs).toEqual({
      paragraphStyles: { body: "North" },
      commentThreads: [{ id: "c1", text: "Water the beds" }],
    });
  });

  it("leaves a comment both copies rewrote separate", () => {
    const base = { ...doc(["one"]), attrs: { commentThreads: [{ id: "c1", text: "Beds" }] } };
    const local = { ...doc(["one"]), attrs: { commentThreads: [{ id: "c1", text: "North" }] } };
    const remote = { ...doc(["one"]), attrs: { commentThreads: [{ id: "c1", text: "secret-value" }] } };
    const result = mergeDocumentBlocks(base, local, remote, "stack");
    expect(result.merged).toBeUndefined();
    expect(result.reason).toBe("Document settings changed in both copies, so they stay separate.");
    expect(result.reason).not.toContain("secret-value");
    expect(JSON.stringify(result.kept.remote)).toContain("secret-value");
  });

  it("keeps an appended paragraph when the other side is unchanged", () => {
    const base = doc(["one"]);
    const result = mergeDocumentBlocks(base, doc(["one", "more"]), base);
    expect(result.merged).toEqual(doc(["one", "more"]));
  });
});

describe("keptLocalCopy", () => {
  it("keeps the edits in a new file and leaves the open file unchanged", () => {
    const local = file(doc(["draft"]));
    const copy = keptLocalCopy(local);
    expect(copy.id).not.toBe(local.id);
    expect(copy.title).toBe("Notes (your edits)");
    expect(copy.content).toEqual(local.content);
    expect(local.title).toBe("Notes");
    expect(local.content).toEqual(doc(["draft"]));
  });
});

describe("combineDocuments", () => {
  it("names the local copy and returns the combined document", () => {
    const base = file(doc(["one", "two"]));
    const plan = combineDocuments(base, file(doc(["ONE", "two"])), file(doc(["one", "TWO"])));
    expect(plan.localCopy.title).toBe("Notes (your edits)");
    expect(plan.merged?.content).toEqual(doc(["ONE", "TWO"]));
    expect(plan.merged?.title).toBe("Notes");
  });

  it("keeps a changed spreadsheet sheet as another sheet", () => {
    const local = createFile("sheet", "Beds") as SheetFile;
    const remote = structuredClone(local);
    const id = local.content.workbook.sheetOrder[0];
    local.content.workbook.sheets[id].cellData = { 0: { 0: { v: "North" } } };
    remote.content.workbook.sheets[id].cellData = { 0: { 0: { v: "secret-value" } } };
    const plan = keepBothSheets(local, remote);
    expect(plan.reason).toBeUndefined();
    expect(plan.localCopy.title).toBe("Beds (your edits)");
    const merged = plan.merged as SheetFile;
    expect(merged.content.workbook.sheets[id].cellData).toEqual({ 0: { 0: { v: "North" } } });
    const copyId = merged.content.workbook.sheetOrder[1];
    expect(merged.content.workbook.sheets[copyId].cellData).toEqual({
      0: { 0: { v: "secret-value" } },
    });
    expect(merged.content.workbook.sheets[copyId].name).toBe("Sheet1 (other copy)");
    expect(local.content.workbook.sheetOrder).toEqual([id]);
    expect(JSON.stringify(plan.reason ?? "")).not.toContain("secret-value");
    expect(combineDocuments(local, local, remote).merged).toBeUndefined();
    const occupiedId = `other-${id}`.slice(0, 80);
    const occupied = structuredClone(local.content.workbook.sheets[id]);
    occupied.id = occupiedId;
    occupied.name = "Taken";
    occupied.cellData = { 0: { 0: { v: "West" } } };
    local.content.workbook.sheets[occupiedId] = occupied;
    local.content.workbook.sheetOrder.push(occupiedId);
    const again = keepBothSheets(local, remote);
    const againMerged = again.merged as SheetFile;
    expect(againMerged.content.workbook.sheets[occupiedId].cellData).toEqual({
      0: { 0: { v: "West" } },
    });
    const added = againMerged.content.workbook.sheetOrder.find(
      (sheetId) => sheetId !== id && sheetId !== occupiedId,
    );
    expect(added).toBeTruthy();
    expect(againMerged.content.workbook.sheets[added!].cellData).toEqual({
      0: { 0: { v: "secret-value" } },
    });
    expect(againMerged.content.workbook.sheets[added!].name).toBe("Sheet1 (other copy 2)");
    expect(local.content.workbook.sheets[occupiedId].name).toBe("Taken");
  });

  it("keeps a chart from the other spreadsheet on the copied sheet", () => {
    const local = createFile("sheet", "Beds") as SheetFile;
    const remote = structuredClone(local);
    const id = local.content.workbook.sheetOrder[0];
    local.content.workbook.sheets[id].cellData = { 0: { 0: { v: "North" } } };
    remote.content.workbook.sheets[id].cellData = { 0: { 0: { v: "West" } } };
    remote.content.charts = [
      {
        id: "fees",
        title: "Fees",
        type: "bar",
        source: { sheetId: id, startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
        sheetId: id,
        x: 0,
        y: 0,
        width: 200,
        height: 120,
      },
    ];
    const plan = keepBothSheets(local, remote);
    expect(plan.reason).toBeUndefined();
    const merged = plan.merged as SheetFile;
    const copyId = merged.content.workbook.sheetOrder[1];
    expect(merged.content.charts).toEqual([
      expect.objectContaining({
        id: "fees",
        title: "Fees",
        sheetId: copyId,
        source: expect.objectContaining({ sheetId: copyId }),
      }),
    ]);
    expect(local.content.charts).toEqual([]);
    expect(remote.content.charts[0].sheetId).toBe(id);
  });

  it("keeps a pivot from the other spreadsheet on the copied sheet", () => {
    const local = createFile("sheet", "Beds") as SheetFile;
    const remote = structuredClone(local);
    const id = local.content.workbook.sheetOrder[0];
    local.content.workbook.sheets[id].cellData = { 0: { 0: { v: "North" } } };
    remote.content.workbook.sheets[id].cellData = { 0: { 0: { v: "West" } } };
    remote.content.pivots = [
      {
        id: "sales",
        title: "Sales",
        source: { sheetId: id, startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
        targetSheetId: id,
        rows: [0],
        columns: [],
        value: 0,
        aggregate: "SUM",
      },
    ];
    const plan = keepBothSheets(local, remote);
    expect(plan.reason).toBeUndefined();
    const merged = plan.merged as SheetFile;
    const copyId = merged.content.workbook.sheetOrder[1];
    expect(merged.content.pivots).toEqual([
      expect.objectContaining({
        id: "sales",
        title: "Sales",
        targetSheetId: copyId,
        source: expect.objectContaining({ sheetId: copyId }),
      }),
    ]);
    expect(local.content.pivots).toEqual([]);
    expect(remote.content.pivots[0].targetSheetId).toBe(id);
    expect(remote.content.pivots[0].source.sheetId).toBe(id);
  });

  it("takes named cells from the other spreadsheet and leaves the rest", () => {
    const local = createFile("sheet", "Beds") as SheetFile;
    const remote = structuredClone(local);
    const id = local.content.workbook.sheetOrder[0];
    local.content.workbook.sheets[id].cellData = { 0: { 0: { v: "North" }, 1: { v: "Bean" } } };
    remote.content.workbook.sheets[id].cellData = {
      0: { 0: { v: "South" }, 1: { v: "secret-value" } },
    };
    const plan = keepSelectedCells(local, remote, ["B1"]);
    expect(plan.reason).toBeUndefined();
    const merged = plan.merged as SheetFile;
    expect(merged.content.workbook.sheets[id].cellData).toEqual({
      0: { 0: { v: "North" }, 1: { v: "secret-value" } },
    });
    expect(local.content.workbook.sheets[id].cellData).toEqual({
      0: { 0: { v: "North" }, 1: { v: "Bean" } },
    });
    remote.content.workbook.sheets[id].cellData = {
      0: { 0: { v: "South" }, 1: { v: "secret-value" } },
      1: { 1: { v: "Other" } },
    };
    const ranged = keepSelectedCells(local, remote, ["B1:B2"]);
    expect(ranged.reason).toBeUndefined();
    expect((ranged.merged as SheetFile).content.workbook.sheets[id].cellData).toEqual({
      0: { 0: { v: "North" }, 1: { v: "secret-value" } },
      1: { 1: { v: "Other" } },
    });
    const wide = keepSelectedCells(local, remote, ["A1:A257"]);
    expect(wide.merged).toBeUndefined();
    expect(wide.reason).toBe("Name a smaller range.");
    expect(wide.reason).not.toContain("A257");
    const refused = keepSelectedCells(local, remote, ["secret-value"]);
    expect(refused.merged).toBeUndefined();
    expect(refused.reason).toBe("Name a cell, such as B2.");
    expect(refused.reason).not.toContain("secret-value");
    expect(keepSelectedCells(local, remote, []).reason).toBe(
      "Name the cells to take from the other copy.",
    );
    const fees = structuredClone(local.content.workbook.sheets[id]);
    fees.id = "fees";
    fees.name = "Fees";
    fees.cellData = { 1: { 1: { v: 1 } } };
    local.content.workbook.sheets.fees = fees;
    local.content.workbook.sheetOrder.push("fees");
    remote.content.workbook.sheets.fees = structuredClone(fees);
    remote.content.workbook.sheets.fees.cellData = { 1: { 1: { v: 9 } } };
    remote.content.workbook.sheetOrder.push("fees");
    remote.content.workbook.sheets.fees.cellData = { 1: { 1: { v: 9 }, 2: { v: 4 } } };
    const rangedFees = keepSelectedCells(local, remote, ["Fees!B2:C2"]);
    expect((rangedFees.merged as SheetFile).content.workbook.sheets.fees.cellData).toEqual({
      1: { 1: { v: 9 }, 2: { v: 4 } },
    });
    const taken = keepSelectedCells(local, remote, ["Fees!B2"]);
    const takenSheet = taken.merged as SheetFile;
    expect(takenSheet.content.workbook.sheets.fees.cellData).toEqual({ 1: { 1: { v: 9 } } });
    expect(takenSheet.content.workbook.sheets[id].cellData[0][0]).toEqual({ v: "North" });
    const missing = keepSelectedCells(local, remote, ["secret-value!B2"]);
    expect(missing.reason).toBe("That sheet is not in the other copy.");
    expect(missing.reason).not.toContain("secret-value");
    expect(missing.merged).toBeUndefined();
  });

  it("keeps a changed slide as another slide", () => {
    const local = createFile("slide", "Talk") as SlideFile;
    const remote = structuredClone(local);
    const id = local.content.slideOrder[0];
    local.content.slides[id].elements[0].content = "North";
    remote.content.slides[id].elements[0].content = "secret-value";
    const plan = keepBothSlides(local, remote);
    expect(plan.reason).toBeUndefined();
    const merged = plan.merged as SlideFile;
    expect(merged.content.slides[id].elements[0].content).toBe("North");
    const copyId = merged.content.slideOrder[1];
    expect(merged.content.slides[copyId].elements[0].content).toBe("secret-value");
    expect(merged.content.slides[copyId].title).toBe("Slide (other copy)");
    expect(local.content.slideOrder).toEqual([id]);
    expect(JSON.stringify(plan.reason ?? "")).not.toContain("secret-value");
    const occupiedId = `other-${id}`.slice(0, 80);
    const occupied = structuredClone(local.content.slides[id]);
    occupied.id = occupiedId;
    occupied.title = "Taken";
    occupied.elements[0].content = "West";
    local.content.slides[occupiedId] = occupied;
    local.content.slideOrder.push(occupiedId);
    const again = keepBothSlides(local, remote);
    const againMerged = again.merged as SlideFile;
    expect(againMerged.content.slides[occupiedId].elements[0].content).toBe("West");
    const added = againMerged.content.slideOrder.find(
      (slideId) => slideId !== id && slideId !== occupiedId,
    );
    expect(added).toBeTruthy();
    expect(againMerged.content.slides[added!].elements[0].content).toBe("secret-value");
    expect(againMerged.content.slides[added!].title).toBe("Slide (other copy 2)");
    expect(local.content.slides[occupiedId].title).toBe("Taken");
  });

  it("keeps a master object from the other presentation", () => {
    const local = createFile("slide", "Talk") as SlideFile;
    const remote = structuredClone(local);
    local.content.master = {
      background: { color: "#ffffff" },
      elements: [{ id: "title", type: "text", x: 0, y: 0, width: 10, height: 10, content: "North" }],
    };
    remote.content.master = {
      background: { color: "#000000" },
      elements: [
        { id: "title", type: "text", x: 0, y: 0, width: 10, height: 10, content: "North" },
        { id: "mark", type: "text", x: 0, y: 20, width: 10, height: 10, content: "Beds" },
      ],
    };
    const plan = keepBothSlides(local, remote);
    expect(plan.reason).toBeUndefined();
    const merged = plan.merged as SlideFile;
    expect(merged.content.master?.background?.color).toBe("#ffffff");
    expect(merged.content.master?.elements.map((element) => element.content)).toEqual(["North", "Beds"]);
    expect(local.content.master?.elements).toHaveLength(1);
    expect(remote.content.master?.elements).toHaveLength(2);
    expect(remote.content.master?.background?.color).toBe("#000000");
  });

  it("keeps a changed form response as another response", () => {
    const local = createFile("form", "Beds") as FormFile;
    const remote = structuredClone(local);
    const question = { id: "plot", prompt: "Plot", kind: "text" as const, required: false };
    local.content.questions = [question];
    remote.content.questions = [question];
    local.content.responses = [
      { id: "r1", at: "2026-10-30T22:00:00.000Z", answers: { plot: "North" } },
    ];
    remote.content.responses = [
      { id: "r1", at: "2026-10-30T22:00:00.000Z", answers: { plot: "secret-value" } },
      { id: "r2", at: "2026-10-30T22:01:00.000Z", answers: { plot: "West" } },
    ];
    const plan = keepBothForms(local, remote);
    expect(plan.reason).toBeUndefined();
    const merged = plan.merged as FormFile;
    expect(merged.content.responses[0].answers.plot).toBe("North");
    expect(merged.content.responses.map((row) => row.answers.plot)).toEqual(["North", "secret-value", "West"]);
    expect(merged.content.responses[1].id).not.toBe("r1");
    expect(local.content.responses).toHaveLength(1);
    const changed = structuredClone(local);
    changed.content.questions[0].prompt = "Bed";
    const refused = keepBothForms(changed, remote);
    expect(refused.merged).toBeUndefined();
    expect(refused.reason).toBe("The questions changed, so both versions stay separate.");
    expect(refused.reason).not.toContain("secret-value");
  });

  it("keeps the other drawing under the local one", () => {
    const local = createFile("drawing", "Beds") as DrawingFile;
    const remote = structuredClone(local);
    remote.content.source = local.content.source.replace("Hello", "secret-value");
    const plan = keepBothDrawings(local, remote);
    expect(plan.reason).toBeUndefined();
    const source = (plan.merged as DrawingFile).content.source;
    expect(source).toContain("Hello");
    expect(source).toContain("secret-value");
    expect(source).toContain('y="420"');
    expect(local.content.source).toContain("Hello");
    expect(local.content.source).not.toContain("secret-value");
    const scripted = structuredClone(remote);
    scripted.content.source = `<svg xmlns="http://www.w3.org/2000/svg"><script>secret-value</script></svg>`;
    const refused = keepBothDrawings(local, scripted);
    expect(refused.merged).toBeUndefined();
    expect(refused.reason).toBe("The other drawing could not be kept.");
    expect(refused.reason).not.toContain("secret-value");
    const chart = structuredClone(local);
    chart.content = { format: "mermaid", source: "flowchart TD\n  A[Beds]\n" };
    const other = structuredClone(chart);
    other.content.source = "flowchart TD\n  B[West]\n";
    const diagrams = keepBothDrawings(chart, other);
    expect((diagrams.merged as DrawingFile).content.source).toContain("%% other copy");
    expect((diagrams.merged as DrawingFile).content.source).toContain("B[West]");
    expect(chart.content.source).not.toContain("other copy");
  });

  it("does not combine a spreadsheet", () => {
    const sheet = {
      ...file(doc(["one"])),
      kind: "sheet",
      content: { workbook: { id: "b", sheetOrder: [], sheets: {} }, images: [] },
    } as SuiteFile;
    const plan = combineDocuments(sheet, sheet, sheet);
    expect(plan.merged).toBeUndefined();
    expect(plan.reason).toContain("document");
    expect(plan.localCopy.title).toContain("your edits");
  });
});
