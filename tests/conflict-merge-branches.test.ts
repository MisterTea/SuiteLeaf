import { describe, expect, it } from "vitest";
import {
  createFile,
  type DrawingFile,
  type FormFile,
  type JsonNode,
  type SheetFile,
  type SlideFile,
  type SuiteFile,
} from "../packages/core/src";
import {
  combineDocuments,
  keepBothDrawings,
  keepBothForms,
  keepBothSheets,
  keepBothSlides,
  keepSelectedCells,
} from "../apps/web/src/conflict-merge";

const doc = (paragraphs: string[]): JsonNode => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});
const docFile = (paragraphs: string[], extra: Partial<SuiteFile> = {}) =>
  ({ ...createFile("doc", "Notes"), content: doc(paragraphs), ...extra }) as SuiteFile;

function sheets() {
  const local = createFile("sheet", "Beds") as SheetFile;
  const remote = structuredClone(local);
  const id = local.content.workbook.sheetOrder[0];
  return { local, remote, id };
}
const book = (file: SuiteFile | undefined) => (file as SheetFile).content.workbook;

describe("combining documents", () => {
  it("keeps the local edits as a separate file with its own id", () => {
    const base = docFile(["one", "two"]);
    const local = { ...structuredClone(base), content: doc(["ONE", "two"]) };
    const plan = combineDocuments(base, local, { ...structuredClone(base), content: doc(["one", "TWO"]) });
    expect(plan.localCopy.id).not.toBe(local.id);
    expect(plan.localCopy.title).toBe("Notes (your edits)");
    expect(plan.merged?.id).toBe(local.id);
  });

  it("leaves documents whose extra tabs changed separate", () => {
    const base = docFile(["one"]);
    const local = { ...structuredClone(base), tabTitle: "Mine" } as SuiteFile;
    expect(combineDocuments(base, local, base).reason).toBe(
      "Extra tabs changed, so both versions stay separate.",
    );
    const remote = { ...structuredClone(base), tabs: [{ id: "t", title: "T" }] } as unknown as SuiteFile;
    expect(combineDocuments(base, base, remote).merged).toBeUndefined();
  });

  it("explains overlapping edits", () => {
    const base = docFile(["one"]);
    const plan = combineDocuments(base, docFile(["mine"]), docFile(["theirs"]));
    expect(plan.merged).toBeUndefined();
    expect(plan.reason).toContain("Block 1");
  });
});

describe("keeping both sheets", () => {
  it("only combines spreadsheets", () => {
    expect(keepBothSheets(docFile(["a"]), docFile(["b"])).reason).toBe(
      "Combining sheets is available for a spreadsheet.",
    );
  });

  it("adds a new remote sheet, skips identical and missing ones, and reuses a renamed twin", () => {
    const { local, remote, id } = sheets();
    const added = { ...structuredClone(local.content.workbook.sheets[id]), id: "new", name: "New" };
    remote.content.workbook.sheets.new = added;
    remote.content.workbook.sheetOrder.push("new", "ghost");
    // The same sheet under another id and name is not copied again.
    const twin = { ...structuredClone(local.content.workbook.sheets[id]), id: "twin", name: "Twin" };
    twin.cellData = { 3: { 3: { v: "same" } } };
    local.content.workbook.sheets.mine = { ...structuredClone(twin), id: "mine", name: "Mine" };
    local.content.workbook.sheetOrder.push("mine");
    remote.content.workbook.sheets.twin = twin;
    local.content.workbook.sheets.twin = { ...structuredClone(twin), cellData: { 0: { 0: { v: "x" } } } };
    local.content.workbook.sheetOrder.push("twin");
    remote.content.workbook.sheetOrder.push("twin");
    remote.content.charts = [
      {
        id: "c",
        title: "C",
        type: "bar",
        source: { sheetId: "twin", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
        sheetId: "twin",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
      {
        id: "lost",
        title: "L",
        type: "bar",
        source: { sheetId: "ghost", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
        sheetId: "ghost",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
    ];
    const merged = keepBothSheets(local, remote).merged as SheetFile;
    expect(merged.content.workbook.sheetOrder).toEqual([id, "mine", "twin", "new"]);
    expect(merged.content.workbook.sheets.new.name).toBe("New");
    expect(merged.content.charts!.map((c) => [c.id, c.sheetId])).toEqual([["c", "mine"]]);
  });

  it("renames a chart or pivot whose id is taken, and skips one already there", () => {
    const { local, remote, id } = sheets();
    local.content.workbook.sheets[id].cellData = { 0: { 0: { v: "L" } } };
    remote.content.workbook.sheets[id].cellData = { 0: { 0: { v: "R" } } };
    const chart = {
      id: "c",
      title: "C",
      type: "bar" as const,
      source: { sheetId: "elsewhere", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      sheetId: id,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    };
    local.content.charts = [{ ...chart }, { ...chart, id: "other-c" }];
    remote.content.charts = [{ ...chart }];
    const pivot = {
      id: "p",
      title: "P",
      source: { sheetId: id, startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
      targetSheetId: id,
      rows: [0],
      columns: [],
      value: 0,
      aggregate: "SUM" as const,
    };
    local.content.pivots = [{ ...pivot }];
    remote.content.pivots = [{ ...pivot }, { ...pivot, id: "q", source: { ...pivot.source, sheetId: "ghost" } }];
    const merged = keepBothSheets(local, remote).merged as SheetFile;
    const copy = merged.content.workbook.sheetOrder[1];
    expect(merged.content.charts!.map((c) => c.id)).toEqual(["c", "other-c", "other-c-2"]);
    // The chart reads another sheet, so only its own sheet moves.
    expect(merged.content.charts![2]).toMatchObject({ sheetId: copy, source: { sheetId: "elsewhere" } });
    expect(merged.content.pivots!.map((p) => [p.id, p.targetSheetId])).toEqual([
      ["p", id],
      ["other-p", copy],
    ]);

    const same = sheets();
    same.local.content.pivots = [{ ...pivot, source: { ...pivot.source, sheetId: same.id }, targetSheetId: same.id }];
    same.remote.content.pivots = structuredClone(same.local.content.pivots);
    same.remote.content.charts = [{ ...chart, sheetId: same.id }];
    same.local.content.charts = [{ ...chart, sheetId: same.id }];
    const kept = keepBothSheets(same.local, same.remote).merged as SheetFile;
    expect(kept.content.pivots).toHaveLength(1);
    expect(kept.content.charts).toHaveLength(1);
  });

  it("refuses when no copy id is free", () => {
    const { local, remote, id } = sheets();
    local.content.workbook.sheets[id].cellData = { 0: { 0: { v: "L" } } };
    remote.content.workbook.sheets[id].cellData = { 0: { 0: { v: "R" } } };
    for (let n = 0; n < 50; n++) {
      const taken = `other-${id}${n ? `-${n + 1}` : ""}`;
      local.content.workbook.sheets[taken] = {
        ...structuredClone(local.content.workbook.sheets[id]),
        id: taken,
        cellData: { 0: { 0: { v: n } } },
      };
    }
    expect(keepBothSheets(local, remote).reason).toBe("A changed sheet could not be kept as another sheet.");
  });

  it("refuses when no chart or pivot id is free", () => {
    const { local, remote, id } = sheets();
    const chart = {
      id: "c",
      title: "C",
      type: "bar" as const,
      source: { sheetId: id, startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      sheetId: id,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    };
    local.content.charts = Array.from({ length: 51 }, (_, n) => ({
      ...chart,
      id: n === 0 ? "c" : `other-c${n > 1 ? `-${n}` : ""}`,
      title: `T${n}`,
    }));
    remote.content.charts = [{ ...chart, title: "Remote" }];
    expect(keepBothSheets(local, remote).reason).toBe("A chart could not be kept.");

    const pivot = {
      id: "p",
      title: "P",
      source: { sheetId: id, startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
      targetSheetId: id,
      rows: [0],
      columns: [],
      value: 0,
      aggregate: "SUM" as const,
    };
    local.content.charts = [];
    local.content.pivots = Array.from({ length: 51 }, (_, n) => ({
      ...pivot,
      id: n === 0 ? "p" : `other-p${n > 1 ? `-${n}` : ""}`,
      title: `T${n}`,
    }));
    remote.content.charts = [];
    remote.content.pivots = [{ ...pivot, title: "Remote" }];
    expect(keepBothSheets(local, remote).reason).toBe("A pivot could not be kept.");
  });
});

describe("choosing cells", () => {
  it("only picks from spreadsheets", () => {
    expect(keepSelectedCells(docFile(["a"]), docFile(["b"]), ["A1"]).reason).toBe(
      "Choosing cells is available for a spreadsheet.",
    );
  });

  it("reads quoted sheet names, absolute addresses, and removes cells the other copy cleared", () => {
    const { local, remote, id } = sheets();
    book(local).sheets[id].name = "Bob's plot";
    book(remote).sheets[id].name = "Bob's plot";
    book(local).sheets[id].cellData = { 0: { 0: { v: "keep" }, 1: { v: "gone" } } };
    book(remote).sheets[id].cellData = { 0: { 0: { v: "theirs" } } };
    const plan = keepSelectedCells(local, remote, ["'Bob''s plot'!$A$1", "'Bob''s plot'!$B$1:$B$1"]);
    expect(book(plan.merged).sheets[id].cellData).toEqual({ 0: { 0: { v: "theirs" } } });
    const lower = keepSelectedCells(local, remote, [" a1 "]);
    expect(book(lower.merged).sheets[id].cellData![0][0]).toEqual({ v: "theirs" });
  });

  it("refuses addresses it cannot use", () => {
    const { local, remote } = sheets();
    for (const address of ["'  '!A1", "' '!A1:B2", "XFE1", "A1048577", "A1:XFE2", "'x\ny'!A1"])
      expect(keepSelectedCells(local, remote, [address]).reason).toBe("Name a cell, such as B2.");
  });

  it("explains a sheet that is missing from either copy", () => {
    const { local, remote, id } = sheets();
    book(remote).sheets.extra = { ...structuredClone(book(remote).sheets[id]), id: "extra", name: "Extra" };
    book(remote).sheetOrder.push("extra");
    expect(keepSelectedCells(local, remote, ["Extra!A1"]).reason).toBe("That sheet is not in this copy.");
    const empty = structuredClone(local);
    book(empty).sheetOrder = [];
    expect(keepSelectedCells(empty, remote, ["A1"]).reason).toBe("That spreadsheet has no sheet.");
  });
});

describe("keeping both slides", () => {
  const decks = () => {
    const local = createFile("slide", "Talk") as SlideFile;
    return { local, remote: structuredClone(local), id: local.content.slideOrder[0] };
  };

  it("only combines presentations", () => {
    expect(keepBothSlides(docFile(["a"]), docFile(["b"])).reason).toBe(
      "Combining slides is available for a presentation.",
    );
  });

  it("adds new slides, skips identical ones, and keeps a titled copy", () => {
    const { local, remote, id } = decks();
    remote.content.slides.fresh = { ...structuredClone(remote.content.slides[id]), id: "fresh" };
    remote.content.slideOrder.push("fresh", "ghost");
    local.content.slides.renamed = {
      ...structuredClone(local.content.slides[id]),
      id: "renamed",
      title: "Renamed",
      elements: [],
    };
    remote.content.slides.renamed = { ...structuredClone(local.content.slides.renamed), title: "Other" };
    remote.content.slideOrder.push("renamed");
    const changed = { ...structuredClone(local.content.slides[id]), id: "titled", title: "Plan" };
    local.content.slides.titled = { ...changed, elements: [] };
    remote.content.slides.titled = { ...changed, background: { color: "#123456" } };
    remote.content.slideOrder.push("titled");
    const merged = keepBothSlides(local, remote).merged as SlideFile;
    expect(merged.content.slideOrder).toEqual([id, "fresh", "other-titled"]);
    expect(merged.content.slides["other-titled"].title).toBe("Plan (other copy)");
  });

  it("refuses when no slide copy id is free", () => {
    const { local, remote, id } = decks();
    remote.content.slides[id].elements[0].content = "R";
    for (let n = 0; n < 50; n++) {
      const taken = `other-${id}${n ? `-${n + 1}` : ""}`;
      local.content.slides[taken] = { ...structuredClone(local.content.slides[id]), id: taken, elements: [] };
    }
    expect(keepBothSlides(local, remote).reason).toBe("A changed slide could not be kept as another slide.");
  });

  it("merges master objects, renaming a clashing id, and keeps the remote background when local has none", () => {
    const { local, remote } = decks();
    const text = (id: string, content: string) =>
      ({ id, type: "text", x: 0, y: 0, width: 1, height: 1, content }) as const;
    local.content.master = { elements: [text("a", "Mine"), text("other-a", "Taken")] };
    remote.content.master = { background: { color: "#000000" }, elements: [text("a", "Theirs")] };
    const merged = keepBothSlides(local, remote).merged as SlideFile;
    expect(merged.content.master).toEqual({
      background: { color: "#000000" },
      elements: [text("a", "Mine"), text("other-a", "Taken"), text("other-a-2", "Theirs")],
    });
    const bare = decks();
    bare.remote.content.master = { elements: [text("z", "Z")] };
    expect((keepBothSlides(bare.local, bare.remote).merged as SlideFile).content.master).toEqual({
      elements: [text("z", "Z")],
    });
  });

  it("refuses a master that would grow past 30 objects", () => {
    const { local, remote } = decks();
    const text = (id: string, content: string) =>
      ({ id, type: "text", x: 0, y: 0, width: 1, height: 1, content }) as const;
    local.content.master = { elements: Array.from({ length: 30 }, (_, n) => text(`e${n}`, `${n}`)) };
    remote.content.master = { elements: [text("new", "New")] };
    expect(keepBothSlides(local, remote).reason).toBe("A master object could not be kept.");
    remote.content.master = { elements: [text("e0", "Clash")] };
    expect(keepBothSlides(local, remote).reason).toBe("A master object could not be kept.");
  });
});

describe("keeping both forms", () => {
  const forms = () => {
    const local = createFile("form", "Signup") as FormFile;
    const question = { id: "q", prompt: "Q", kind: "text" as const, required: false };
    local.content.questions = [question];
    return { local, remote: structuredClone(local) };
  };
  const row = (id: string, answer: string) => ({ id, at: "2026-10-30T22:00:00.000Z", answers: { q: answer } });

  it("only combines forms", () => {
    expect(keepBothForms(docFile(["a"]), docFile(["b"])).reason).toBe("Combining responses is available for a form.");
  });

  it("skips responses already kept, even under another id", () => {
    const { local, remote } = forms();
    local.content.responses = [row("r1", "A"), row("r2", "B")];
    remote.content.responses = [row("r1", "A"), row("r1", "B")];
    expect((keepBothForms(local, remote).merged as FormFile).content.responses).toHaveLength(2);
  });

  it("stops at 5000 responses and when no copy id is free", () => {
    const { local, remote } = forms();
    local.content.responses = Array.from({ length: 5000 }, (_, n) => row(`r${n}`, `${n}`));
    remote.content.responses = [row("new", "x")];
    expect(keepBothForms(local, remote).reason).toBe("A response could not be kept.");
    remote.content.responses = [row("r0", "changed")];
    expect(keepBothForms(local, remote).reason).toBe("A response could not be kept.");

    const full = forms();
    full.local.content.responses = [
      row("r", "A"),
      ...Array.from({ length: 50 }, (_, n) => row(`other-r${n ? `-${n + 1}` : ""}`, `t${n}`)),
    ];
    full.remote.content.responses = [row("r", "B")];
    expect(keepBothForms(full.local, full.remote).reason).toBe("A response could not be kept.");
  });
});

describe("keeping both drawings", () => {
  const drawing = (format: "svg" | "mermaid" | "graphviz", source: string) => {
    const file = createFile("drawing", "D") as DrawingFile;
    file.content = { format, source };
    return file;
  };

  it("only combines drawings of the same kind", () => {
    expect(keepBothDrawings(docFile(["a"]), docFile(["b"])).reason).toBe(
      "Combining drawings is available for a drawing.",
    );
    expect(keepBothDrawings(drawing("svg", "<svg></svg>"), drawing("mermaid", "graph")).reason).toBe(
      "The drawing kinds differ, so both versions stay separate.",
    );
  });

  it("keeps one copy of an unchanged drawing and joins Graphviz sources", () => {
    const same = drawing("graphviz", "digraph { a }");
    expect((keepBothDrawings(same, structuredClone(same)).merged as DrawingFile).content.source).toBe("digraph { a }");
    const joined = keepBothDrawings(drawing("graphviz", "digraph { a }\n"), drawing("graphviz", " digraph { b } "));
    expect((joined.merged as DrawingFile).content.source).toBe("digraph { a }\n// other copy\ndigraph { b }\n");
  });

  it("refuses an SVG that is not a whole drawing, or a join that is too long", () => {
    expect(keepBothDrawings(drawing("svg", "<g/>"), drawing("svg", "<svg></svg>")).reason).toBe(
      "The other drawing could not be kept.",
    );
    const long = "x".repeat(3_000_000);
    expect(keepBothDrawings(drawing("mermaid", long), drawing("mermaid", long + "y")).reason).toBe(
      "The other drawing could not be kept.",
    );
  });
});
