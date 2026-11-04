/** @vitest-environment jsdom */
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, type SheetFile } from "../packages/core/src";

const storage = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../apps/web/src/storage", () => ({ storage }));

import { LinkedChart, insertLinkedChart } from "../apps/web/src/editors/doc-linked-chart";
import { stageChartUpdate } from "../apps/web/src/editors/doc-chart";
import { click, mousedown } from "./doc-editor-harness";

const editors: Editor[] = [];

beforeEach(() => storage.get.mockReset());
afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.replaceChildren();
});

function make(content: JSONContent | string, editable = true) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({ element, editable, extensions: [StarterKit, TableKit, LinkedChart], content });
  editors.push(editor);
  return editor;
}

function sheet(title: string, rows: [string, number][]): SheetFile {
  const file = createFile("sheet", title);
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const id = file.content.workbook.sheetOrder[0];
  file.content.workbook.sheets[id].cellData = Object.fromEntries(
    [["Name", "Amount"], ...rows].map((row, index) => [
      index,
      { 0: { v: row[0], t: 1 }, 1: typeof row[1] === "number" ? { v: row[1], t: 2 } : { v: row[1], t: 1 } },
    ]),
  );
  return file;
}

const chart = (attrs: Record<string, unknown> = {}): JSONContent => ({
  type: "linkedChart",
  attrs: { sourceId: "fees", sourceTitle: "Plot fees", labels: ["Dues", "Compost"], values: [40, 10], snapshotAt: "", ...attrs },
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("linked chart in a document", () => {
  it("draws bars for each label with the source and an Update button", () => {
    const editor = make({ type: "doc", content: [chart()] });
    const dom = editor.view.dom.querySelector<HTMLElement>(".linked-chart")!;
    expect(dom.getAttribute("aria-label")).toBe("Chart from Plot fees");
    const rows = [...dom.querySelectorAll(".linked-chart-row")].map((row) => [
      row.querySelector(".linked-chart-label")?.textContent,
      (row.querySelector(".linked-chart-bar") as HTMLElement).style.width,
      row.querySelector(".linked-chart-value")?.textContent,
    ]);
    expect(rows).toEqual([
      ["Dues", "100%", "40"],
      ["Compost", "25%", "10"],
    ]);
    const update = dom.querySelector<HTMLButtonElement>(".linked-chart-update")!;
    expect(update.disabled).toBe(false);
    expect(update.getAttribute("aria-label")).toBe("Update chart from Plot fees");
    editor.commands.setNodeSelection(0);
    expect(dom.classList.contains("ProseMirror-selectednode")).toBe(true);
    editor.commands.setTextSelection(editor.state.doc.content.size);
    expect(dom.classList.contains("ProseMirror-selectednode")).toBe(false);
  });

  it("says when the spreadsheet is missing, and withholds a chart the reader may not see", () => {
    const editor = make({ type: "doc", content: [chart({ missing: true, sourceTitle: " " }), chart({ viewerAllowed: false })] });
    const [missing, withheld] = editor.view.dom.querySelectorAll<HTMLElement>(".linked-chart");
    expect(missing.getAttribute("aria-label")).toBe("Chart from spreadsheet");
    expect(missing.querySelector(".linked-chart-missing")).not.toBeNull();
    expect(withheld.querySelector(".linked-chart-withheld")).not.toBeNull();
    expect(withheld.querySelector(".linked-chart-row")).toBeNull();
    expect(withheld.querySelector(".linked-chart-update")).toBeNull();
  });

  it("disables Update in a read-only document and follows the editable setting", async () => {
    const editor = make({ type: "doc", content: [chart()] }, false);
    const update = () => editor.view.dom.querySelector<HTMLButtonElement>(".linked-chart-update")!;
    click(update());
    expect(storage.get).not.toHaveBeenCalled();
    await flush();
    expect(update().disabled).toBe(true);
    editor.setEditable(true);
    expect(update().disabled).toBe(false);
    editor.setEditable(false);
    expect(update().disabled).toBe(true);
  });

  it("does not offer an update when only the read time is new", () => {
    const current = { sourceId: "fees", sourceTitle: "Plot fees", labels: ["Dues"], values: [40], missing: false, snapshotAt: "" };
    const staged = stageChartUpdate(current, sheet("Plot fees", [["Dues", 40]]), "2026-11-03T10:00:00.000Z");
    expect(staged.proposal).toBeNull();
    expect(staged.notice).toBe("");
    const changed = stageChartUpdate(current, sheet("Plot fees", [["Dues", 41]]), "2026-11-03T10:00:00.000Z");
    expect(changed.proposal?.snapshotAt).toBe("2026-11-03T10:00:00.000Z");
  });

  it("offers a newer copy and applies it only when accepted", async () => {
    storage.get.mockResolvedValue({ file: sheet("Plot fees 2027", [["Dues", 50], ["Water", 20]]) });
    const editor = make({ type: "doc", content: [chart()] });
    const update = () => editor.view.dom.querySelector<HTMLButtonElement>(".linked-chart-update")!;
    mousedown(update());
    click(update());
    expect(update().disabled).toBe(true);
    await flush();
    expect(storage.get).toHaveBeenCalledWith("fees");
    const prompt = editor.view.dom.querySelector(".linked-chart-prompt")!;
    expect(prompt.textContent).toContain("A newer copy is waiting. The chart was not changed.");
    // The open chart is unchanged until the reader accepts.
    expect(editor.getJSON().content?.[0].attrs?.values).toEqual([40, 10]);
    click([...prompt.querySelectorAll("button")].find((b) => b.textContent === "Reject update")!);
    expect(editor.view.dom.querySelector(".linked-chart-prompt")).toBeNull();
    expect(editor.getJSON().content?.[0].attrs?.values).toEqual([40, 10]);

    click(update());
    await flush();
    click(update());
    await flush();
    expect(editor.view.dom.querySelectorAll(".linked-chart-prompt")).toHaveLength(1);
    const accept = [...editor.view.dom.querySelectorAll(".linked-chart-prompt button")].find((b) => b.textContent === "Accept update")!;
    click(accept);
    expect(editor.getJSON().content?.[0].attrs).toMatchObject({ sourceTitle: "Plot fees 2027", labels: ["Dues", "Water"], values: [50, 20] });
    expect(editor.view.dom.querySelector(".linked-chart-label")?.textContent).toBe("Dues");
  });

  it("explains when nothing changed, the sheet cannot be read, or it is gone", async () => {
    const editor = make({ type: "doc", content: [chart({ sourceTitle: "Plot fees", labels: ["Dues"], values: [40] })] });
    const update = () => editor.view.dom.querySelector<HTMLButtonElement>(".linked-chart-update")!;
    storage.get.mockResolvedValueOnce({ file: sheet("Plot fees", [["Dues", 40]]) });
    click(update());
    await flush();
    expect(editor.view.dom.querySelector(".linked-chart-notice")).toBeNull();
    expect(update().disabled).toBe(false);

    storage.get.mockResolvedValueOnce({ file: sheet("Plot fees", []) });
    click(update());
    await flush();
    expect(editor.view.dom.querySelector(".linked-chart-notice")?.textContent).toBe("There are no data rows to chart.");

    storage.get.mockRejectedValueOnce(new Error("disk"));
    click(update());
    await flush();
    expect([...editor.view.dom.querySelectorAll(".linked-chart-notice")].map((n) => n.textContent)).toContain(
      "Could not read that spreadsheet.",
    );
    expect(update().disabled).toBe(false);

    storage.get.mockResolvedValueOnce({ trashedAt: "2026-01-01", file: { kind: "sheet" } });
    click(update());
    await flush();
    expect(editor.view.dom.querySelector(".linked-chart-prompt")?.textContent).toContain("A newer copy is waiting");
  });

  it("skips the library for a chart with no source and ignores a stale answer", async () => {
    const editor = make({ type: "doc", content: [chart({ sourceId: "" })] });
    click(editor.view.dom.querySelector(".linked-chart-update")!);
    await flush();
    expect(storage.get).not.toHaveBeenCalled();
    expect(editor.view.dom.querySelector(".linked-chart-prompt")).not.toBeNull();

    let answer: (value: unknown) => void = () => {};
    storage.get.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const other = make({ type: "doc", content: [chart()] });
    click(other.view.dom.querySelector(".linked-chart-update")!);
    other.destroy();
    answer({ file: sheet("New", [["A", 1]]) });
    await flush();
    expect(other.isDestroyed).toBe(true);
  });

  it("reads and writes its attributes in HTML", () => {
    const html =
      '<div data-linked-chart="true" data-source-id="s1" data-source-title="Budget" data-labels=\'["A","B"]\' data-values="[1,2]" data-missing="true" data-snapshot-at="2026-01-01T00:00:00.000Z"></div>' +
      '<div data-linked-chart="true" data-labels="{bad" data-withheld="true"></div>';
    const editor = make(html);
    const [first, second] = editor.getJSON().content ?? [];
    expect(first.attrs).toMatchObject({ sourceId: "s1", sourceTitle: "Budget", labels: ["A", "B"], values: [1, 2], missing: true, viewerAllowed: true });
    expect(second.attrs).toMatchObject({ labels: [], values: [], viewerAllowed: false });
    expect(editor.getHTML()).toContain('data-source-id="s1"');
  });

  it("inserts at the caret, replacing an empty paragraph but not inside a table", () => {
    const editor = make({ type: "doc", content: [{ type: "paragraph" }, { type: "paragraph", content: [{ type: "text", text: "Text" }] }] });
    editor.commands.setTextSelection(1);
    expect(insertLinkedChart(editor, chart().attrs!)).toBe(true);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["linkedChart", "paragraph"]);
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    expect(insertLinkedChart(editor, chart().attrs!)).toBe(true);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["linkedChart", "paragraph", "linkedChart", "paragraph"]);
    editor.commands.setNodeSelection(0);
    expect(insertLinkedChart(editor, chart({ sourceTitle: "Swap" }).attrs!)).toBe(true);
    expect(editor.getJSON().content?.[0].attrs?.sourceTitle).toBe("Swap");
    editor.commands.insertTable({ rows: 1, cols: 1, withHeaderRow: false });
    expect(insertLinkedChart(editor, chart().attrs!)).toBe(false);
  });
});
