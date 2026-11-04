// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFile,
  type CellLook,
  type DocFile,
  type SheetDiff,
  type SheetFile,
  type SlideDiff,
  type SlideDiffElement,
  type SlideFile,
} from "../../packages/core/src";
import {
  documentChangeSummary,
  historyPreviewFor,
  SheetVersionPreview,
  SlideVersionPreview,
  type DocCompareTab,
} from "../../apps/web/src/editors/version-compare";

afterEach(cleanup);

const look = (text: string, extra: Partial<CellLook> = {}): CellLook => ({
  text,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: "",
  fill: "",
  ...extra,
});

const sheetDiff: SheetDiff = {
  changedCells: 3,
  sheets: [
    {
      id: "a",
      name: "Plan",
      status: "same",
      rows: 1,
      columns: 1,
      changes: [],
      plain: [{ row: 0, column: 0, look: look("kept", { fill: "#ff0" }) }],
    },
    {
      id: "b",
      name: "Costs",
      status: "changed",
      rows: 2,
      columns: 28,
      changes: [
        { row: 0, column: 0, kind: "value", beforeText: "10", afterText: "12", before: look("10"), after: look("12", { bold: true, underline: true, strike: true }), notes: [] },
        { row: 0, column: 27, kind: "format", beforeText: "x", afterText: "x", before: look("x"), after: look("x", { italic: true }), notes: ["Italic"] },
        { row: 1, column: 1, kind: "both", beforeText: "", afterText: "", before: look(""), after: look(""), notes: ["Fill"] },
        { row: 1, column: 2, kind: "format", beforeText: "", afterText: "", before: look(""), after: look(""), notes: [] },
      ],
      plain: [],
    },
    { id: "c", name: "Old", status: "removed", rows: 0, columns: 0, changes: [], plain: [] },
    { id: "d", name: "New", status: "added", rows: 0, columns: 0, changes: [], plain: [] },
  ],
};

describe("spreadsheet compare", () => {
  it("opens on the first changed worksheet and describes each changed cell", () => {
    render(<SheetVersionPreview diff={sheetDiff} label="3 cells change" />);
    expect(screen.getByText("3 cells change")).toBeTruthy();
    const tabs = within(screen.getByRole("tablist", { name: "Worksheets" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Plan", "Costs", "Old · deleted", "New · added"]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    const grid = screen.getByRole("table", { name: "Spreadsheet compare" });
    expect(within(grid).getByText("AB")).toBeTruthy();
    expect(screen.getByLabelText("A1 was 10, now 12")).toBeTruthy();
    expect(screen.getByLabelText("AB1 format Italic")).toBeTruthy();
    expect(screen.getByLabelText("B2 was empty, now empty, Fill")).toBeTruthy();
    expect(screen.getByLabelText("C2 format changed")).toBeTruthy();
    const added = screen.getByText("12").closest("span")!;
    expect(added.style.fontWeight).toBe("700");
    expect(added.style.textDecoration).toBe("underline line-through");
  });

  it("switches worksheets and keeps unchanged cells on screen", () => {
    render(<SheetVersionPreview diff={sheetDiff} label="Compare" />);
    fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
    const cell = screen.getByText("kept").closest("td")!;
    expect(cell.dataset.change).toBe("same");
    expect(cell.style.background).toBe("rgb(255, 255, 0)");
  });

  it("names a single worksheet, and says when there are no cells", () => {
    const { unmount } = render(
      <SheetVersionPreview diff={{ changedCells: 0, sheets: [sheetDiff.sheets[0]] }} label="One" />,
    );
    expect(screen.getByText("Plan", { selector: ".sheet-compare-tab" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    unmount();
    render(<SheetVersionPreview diff={{ changedCells: 0, sheets: [] }} label="None" />);
    expect(screen.getByText("This spreadsheet has no cells to compare.")).toBeTruthy();
  });

  it("is read-only: typing is stopped, copying and moving around are not", () => {
    render(<SheetVersionPreview diff={sheetDiff} label="Compare" />);
    const surface = screen.getByLabelText("Version preview");
    expect(surface.getAttribute("aria-readonly")).toBe("true");
    expect(fireEvent.keyDown(surface, { key: "a" })).toBe(false);
    expect(fireEvent.keyDown(surface, { key: "c", metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(surface, { key: "ArrowDown" })).toBe(true);
    expect(fireEvent.paste(surface)).toBe(false);
    expect(fireEvent.drop(surface)).toBe(false);
  });
});

const element = (extra: Partial<SlideDiffElement>): SlideDiffElement => ({
  id: "e",
  status: "same",
  type: "text",
  x: 0,
  y: 0,
  width: 480,
  height: 135,
  runs: [],
  notes: [],
  ...extra,
});

const slideDiff: SlideDiff = {
  width: 960,
  height: 540,
  changedSlides: 2,
  slides: [
    { id: "s1", title: "Welcome", status: "same", background: "#fff", elements: [] },
    {
      id: "s2",
      title: "Plan",
      status: "changed",
      background: "#eef",
      elements: [
        element({ id: "box", type: "shape", fill: "#f00", shapeType: "ellipse" }),
        element({ id: "round", type: "shape", shapeType: "roundRect" }),
        element({ id: "rect", type: "shape" }),
        element({ id: "pic", type: "image", src: "data:image/png;base64,AA", alt: "Logo" }),
        element({ id: "unsafe", type: "image", src: "javascript:alert(1)" }),
        element({ id: "grid", type: "table", rows: [["Q1", "Q2"]] }),
        element({
          id: "words",
          fontSize: 48,
          bold: true,
          italic: true,
          color: "#123456",
          align: "center",
          runs: [
            { text: "Old", mark: "del" },
            { text: "New", mark: "add" },
            { text: " plan", mark: "same" },
          ],
          notes: ["Bold"],
        }),
        element({ id: "gone", status: "removed", runs: [{ text: "Gone", mark: "del" }] }),
        element({ id: "empty" }),
      ],
    },
    {
      id: "s3",
      title: "Retired",
      status: "removed",
      background: "#000",
      elements: [element({ id: "t", runs: [{ text: "Bye", mark: "same" }] })],
    },
    { id: "s4", title: "Fresh", status: "added", background: "#fff", elements: [] },
  ],
};

describe("presentation compare", () => {
  it("opens on the first changed slide and draws its elements", () => {
    render(<SlideVersionPreview diff={slideDiff} label="2 slides change" />);
    const strip = screen.getByLabelText("Slides");
    expect(within(strip).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Welcome",
      "Plan, changed slide",
      "Retired, deleted slide",
      "Fresh, added slide",
    ]);
    expect(screen.getByRole("button", { name: "Plan, changed slide" }).getAttribute("aria-pressed")).toBe("true");
    const shapes = document.querySelectorAll<HTMLElement>(".slide-compare-shape");
    expect([...shapes].map((shape) => shape.style.borderRadius)).toEqual(["50%", "12px", "0px"]);
    expect(screen.getByAltText("Logo")).toBeTruthy();
    expect(document.querySelectorAll(".slide-compare-image")).toHaveLength(1);
    expect(screen.getByText("Q2").tagName).toBe("TD");
    const words = screen.getByText("Old").closest(".slide-compare-text") as HTMLElement;
    expect(words.querySelector("s")?.textContent).toBe("Old");
    expect(words.querySelector("br + u")?.textContent).toBe("New");
    expect(words.style.fontSize).toBe("5cqw");
    expect(words.style.textAlign).toBe("center");
    expect(screen.getByText("Gone").closest(".slide-compare-text")!.className).toContain("is-removed");
  });

  it("shows a deleted slide washed out and flags added ones", () => {
    render(<SlideVersionPreview diff={slideDiff} label="Compare" />);
    fireEvent.click(screen.getByRole("button", { name: "Retired, deleted slide" }));
    const frame = document.querySelector<HTMLElement>(".slide-compare-frame")!;
    expect(frame.className).toContain("is-removed");
    expect(frame.querySelector(".slide-compare-wash")).not.toBeNull();
    expect((screen.getByText("Bye").closest(".slide-compare-text") as HTMLElement).style.color).toBe("rgb(197, 34, 31)");
    fireEvent.click(screen.getByRole("button", { name: "Fresh, added slide" }));
    expect(document.querySelector(".slide-compare-flag.add")?.textContent).toBe("Added");
  });

  it("says when there are no slides", () => {
    render(<SlideVersionPreview diff={{ width: 960, height: 540, changedSlides: 0, slides: [] }} label="Empty" />);
    expect(screen.getByText("This presentation has no slides to compare.")).toBeTruthy();
  });
});

describe("choosing what a history entry compares", () => {
  const tab = (title: string, status: DocCompareTab["status"], changedParagraphs: number): DocCompareTab => ({
    id: title,
    title,
    status,
    content: { type: "doc", content: [] },
    changedParagraphs,
  });

  it("names the tabs whose paragraphs changed and the tabs added or removed", () => {
    expect(documentChangeSummary([tab("Minutes", "changed", 1)])).toBe("1 paragraph changes on Minutes");
    expect(documentChangeSummary([tab("A", "changed", 1), tab("B", "changed", 2)])).toBe("3 paragraphs change on A and B");
    expect(
      documentChangeSummary([tab("A", "changed", 1), tab("B", "changed", 1), tab("C", "changed", 1)]),
    ).toBe("3 paragraphs change on A, B, and C");
    expect(documentChangeSummary([tab("A", "changed", 2), tab("Notes", "added", 0)])).toBe(
      "2 paragraphs change on A, and Notes was added",
    );
    expect(
      documentChangeSummary([tab("A", "changed", 2), tab("Notes", "added", 0), tab("Old", "removed", 0)]),
    ).toBe("2 paragraphs change on A, Notes was added, and Old was removed");
    expect(documentChangeSummary([tab("A", "same", 0)])).toBe("");
  });

  it("pairs document tabs by id and lists the earliest version as it was", () => {
    const base = createFile("doc", "Plan") as DocFile;
    const before: DocFile = {
      ...base,
      tabTitle: "Minutes",
      tabs: [{ id: "old", title: "Old", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] } }],
    };
    const after: DocFile = {
      ...base,
      tabs: [{ id: "new", title: "New", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "y" }] }] } }],
    };
    const current = historyPreviewFor(before, after, "current")!;
    expect(current.preview.kind).toBe("doc");
    const tabs = (current.preview as { tabs?: DocCompareTab[] }).tabs!;
    expect(tabs.map((item) => [item.title, item.status])).toEqual([
      ["Document", "same"],
      ["New", "added"],
      ["Old", "removed"],
    ]);
    expect(current.summary).toBe("2 paragraphs change on New and Old");
    const earliest = historyPreviewFor(before, before, "earliest")!;
    expect(earliest.count).toBe(0);
    expect(earliest.summary).toBe("");
    expect((earliest.preview as { tabs?: DocCompareTab[] }).tabs!.map((item) => item.title)).toEqual(["Minutes", "Old"]);
    expect(earliest.preview.label).toContain("earliest version");
  });

  it("counts spreadsheet cells and slides, and refuses mixed kinds", () => {
    const sheet = createFile("sheet", "Budget") as SheetFile;
    const id = sheet.content.workbook.sheetOrder[0];
    const changed = structuredClone(sheet);
    changed.content.workbook.sheets[id].cellData = { 0: { 0: { v: "1" } } };
    const cells = historyPreviewFor(sheet, changed, "previous")!;
    expect(cells).toMatchObject({ count: 1, unit: "cell", summary: "1 cell changes in this version" });
    expect(cells.preview.label).toBe("1 cell changes in this version · read-only. Green was added here. Red was removed.");
    const sheetCurrent = historyPreviewFor(sheet, changed, "current")!;
    expect(sheetCurrent.preview.label).toContain("Format-only changes are marked.");
    expect(historyPreviewFor(sheet, changed, "earliest")).toMatchObject({ count: 0, summary: "Nothing earlier to compare" });

    const deck = createFile("slide", "Talk") as SlideFile;
    const more = structuredClone(deck);
    const first = more.content.slideOrder[0];
    more.content.slides[first].elements = [];
    const slides = historyPreviewFor(deck, more, "current")!;
    expect(slides.unit).toBe("slide");
    expect(slides.preview.label).toContain("Deleted slides stay in the filmstrip.");
    expect(historyPreviewFor(deck, sheet, "current")).toBeNull();
    const form = createFile("form", "Signup");
    expect(historyPreviewFor(form, form, "current")).toBeNull();
  });
});
