// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { DOMParser } from "@tiptap/pm/model";
import type { TextRun } from "@suiteleaf/core";
import { authoredOffset, documentPosition, markerLength, safeOfficeRun, slideDocumentToRuns, slideParagraphs, slideRunsToDocument } from "../../apps/web/src/editors/slide-tiptap-model";
import { renderSlideText, slideTextKit } from "../../apps/web/src/editors/slide-tiptap-schema";
import { slideTextTrialEnabled } from "../../apps/web/src/editors/slide-text-trial";

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.replaceChildren(); });
function model(runs: TextRun[]) { return slideTextKit({ fontSize: 22, fontFamily: "SuiteLeaf Willow" }).schema.nodeFromJSON(slideRunsToDocument(runs)); }
function editor(runs: TextRun[]) {
  const el = document.createElement("div"); document.body.append(el);
  const instance = new Editor({ element: el, extensions: slideTextKit({}).extensions, content: slideRunsToDocument(runs), injectCSS: false });
  editors.push(instance);
  return instance;
}
const words = (runs: TextRun[]) => runs.map(run => run.text).join("");

describe("slide text's structured model", () => {
  it("roundtrips ordinary paragraphs, blank lines, hard breaks and all inline marks", () => {
    const runs: TextRun[] = [{ text: "Bold", bold: true, italic: true, underline: true, strike: true }, { text: "\nnext", font: "Arial", fontSize: 12 }, { text: "\n", paragraphBreak: true, paraAlign: "right", paraLinePt: 20 }, { text: "\n", paragraphBreak: true }, { text: "last" }];
    const output = slideDocumentToRuns(model(runs));
    expect(words(output)).toBe(words(runs));
    expect(output[0]).toMatchObject(runs[0]);
    expect(output.find(run => run.text === "next")).toMatchObject({ font: "Arial", fontSize: 12 });
    expect(output.filter(run => run.paragraphBreak)).toHaveLength(2);
    expect(output.find(run => run.paraAlign === "right")).toMatchObject({ paraLinePt: 20 });
    expect(slideDocumentToRuns(model([]))).toEqual([]);
  });

  it("retains Office effects, tabs, links, math, fractions and automatic numbering metadata", () => {
    const runs: TextRun[] = [{ text: "Effects", caps: "all", stroke: "#123456", strokeWidth: 1, shadow: { x: 1, y: 2, blur: 3, color: "#123456" }, gradient: "linear-gradient(90deg, #112233, #445566)", reflection: { startAlpha: 0.5, endAlpha: 0, endPos: 1 }, paraTab: 36, paraTabs: [{ pos: 50, align: "r" }], tracking: 2, href: "https://example.com", baseline: 30, scriptScale: true, scriptStrut: 22, unbroken: true }, { text: "x", math: true, latex: "x", officeMath: { xml: "<m:r/>", count: 1, signature: "x" } }, { text: "1/2", fraction: { num: [{ text: "1" }], den: [{ text: "2" }] } }];
    expect(slideDocumentToRuns(model(runs))).toEqual(runs);
    const host = document.createElement("div"); host.append(renderSlideText(model(runs)));
    expect(host.querySelector("[data-office-inline]")).not.toBeNull();
    expect(host.querySelector("[data-office-run]")).not.toBeNull();
    expect(words(slideDocumentToRuns(DOMParser.fromSchema(model(runs).type.schema).parse(host)))).toBe(words(runs));
  });

  it("keeps bullets outside editable text, preserving marker fonts and nested paragraph metrics", () => {
    const runs: TextRun[] = [{ text: "▪ ", font: "SuiteLeaf Sprig", paraHang: 24, listDepth: 0 }, { text: "First" }, { text: "\n", paragraphBreak: true, paraMargin: 36, paraHang: 22, listDepth: 1 }, { text: "▪ ", font: "SuiteLeaf Sprig" }, { text: "Second" }];
    const doc = model(runs);
    expect(doc.firstChild?.type.name).toBe("bulletList");
    expect(doc.textContent).toBe("FirstSecond");
    expect(words(slideDocumentToRuns(doc))).toBe(words(runs));
    expect(slideParagraphs(doc).map(p => p.depth)).toEqual([0, 1]);
    const root = document.createElement("div"); root.append(renderSlideText(doc));
    expect(root.querySelectorAll("ul")).toHaveLength(2);
    expect(root.querySelectorAll("li")).toHaveLength(2);
    expect(root.querySelector(".slide-para")?.getAttribute("style")).toContain("SuiteLeaf Willow");
    expect(root.querySelector("[data-slide-content]")?.textContent).toBe("First");
    expect(words(slideDocumentToRuns(DOMParser.fromSchema(doc.type.schema).parse(root)))).toBe(words(runs));
  });

  it("recognizes legacy, numbered, picture and symbol markers without classifying ordinary text", () => {
    for (const text of ["• ", "▪ ", "1. ", "12) "]) expect(markerLength([{ text: text + "words" }])).toBe(text.length);
    expect(markerLength([{ text: "v ", font: "Wingdings" }])).toBe(2);
    expect(markerLength([{ text: "icon", bulletSrc: "data:image/png;base64,AA==" }])).toBe(4);
    expect(markerLength([{ text: "A. ", listMarker: true }])).toBe(3);
    expect(markerLength([{ text: "ordinary words" }])).toBe(0);
    expect(markerLength([])).toBe(0);
    const doc = model([{ text: "1. First\n2. Second" }]);
    expect(doc.firstChild?.type.name).toBe("orderedList");
    expect(words(slideDocumentToRuns(doc))).toBe("1. First\n2. Second");
    expect(model([{ text: "• A" }, { text: "\n", paragraphBreak: true }, { text: "plain" }, { text: "\n", paragraphBreak: true }, { text: "1. B" }]).childCount).toBe(3);
  });

  it("maps authored offsets across hidden markers, paragraphs, hard breaks and atomic math", () => {
    const doc = model([{ text: "• First" }, { text: "\n", paragraphBreak: true }, { text: "• Second" }, { text: "\n" }, { text: "x+y", math: true }]);
    const paragraphs = slideParagraphs(doc);
    for (const p of paragraphs) {
      const start = p.start + words(p.marker).length;
      for (let offset = start; offset <= start + p.node.textContent.length; offset++) expect(authoredOffset(doc, documentPosition(doc, offset))).toBe(offset);
    }
    expect(documentPosition(doc, -1)).toBe(paragraphs[0].pos + 1);
    expect(documentPosition(doc, 999)).toBe(paragraphs.at(-1)!.pos + paragraphs.at(-1)!.node.nodeSize - 1);
    expect(authoredOffset(model([]), 0)).toBe(0);
  });

  it("rejects malformed Office metadata and supports the legacy opt-out", () => {
    expect(safeOfficeRun({ text: "ok", fontSize: -1 })).toEqual({ text: "" });
    expect(slideTextTrialEnabled()).toBe(true);
    history.replaceState(null, "", "/?slideText=legacy");
    expect(slideTextTrialEnabled()).toBe(false);
    history.replaceState(null, "", "/");
    expect(slideTextKit({})).toBe(slideTextKit({}));
    for (let i = 1; i < 35; i++) slideTextKit({ fontSize: i });
  });

  it("validates Office metadata in pasted editor HTML before rendering it", () => {
    const schema = slideTextKit({}).schema;
    const root = document.createElement("div");
    const paragraph = document.createElement("span");
    paragraph.dataset.officeParagraph = JSON.stringify({ office: { paraMargin: -1 }, marker: [{ text: "▪ ", fontSize: -3 }], breakRun: { text: 123 } });
    paragraph.innerHTML = '<span data-slide-content="1">Words</span>';
    root.append(paragraph);
    const doc = DOMParser.fromSchema(schema).parse(root);
    expect(doc.firstChild?.attrs.office).toEqual({});
    expect(doc.firstChild?.attrs.marker).toEqual([]);
    expect(doc.firstChild?.attrs.breakRun).toEqual({ text: "" });
    for (const invalid of ["{broken", "null", "[]"]) {
      paragraph.dataset.officeParagraph = invalid;
      expect(DOMParser.fromSchema(schema).parse(root).firstChild?.attrs.marker).toBeNull();
    }
  });
});

describe("Tiptap list editing", () => {
  it("applies and restores Office level font sizes in existing decks, including after reopening", () => {
    const e = editor([
      { text: "§ ", font: "SuiteLeaf Sprig", listDepth: 0 }, { text: "Professor", fontSize: 59, bold: true },
      { text: "\n", paragraphBreak: true, listDepth: 1, fontSize: 52 },
      { text: "§ ", font: "SuiteLeaf Sprig" }, { text: "Details", fontSize: 52 },
      { text: "\n", paragraphBreak: true, listDepth: 0 }, { text: "§ ", font: "SuiteLeaf Sprig" }, { text: "Other", fontSize: 59 },
    ]);
    e.commands.setTextSelection(documentPosition(e.state.doc, 5));
    e.commands.keyboardShortcut("Tab");
    let runs = slideDocumentToRuns(e.state.doc);
    expect(runs.find(run => run.text === "Professor")).toMatchObject({ fontSize: 52, bold: true });
    expect(runs[0].listFontSizes?.slice(0, 2)).toEqual([59, 52]);
    const reopened = editor(runs);
    reopened.commands.setTextSelection(documentPosition(reopened.state.doc, 5));
    reopened.commands.keyboardShortcut("Shift-Tab");
    runs = slideDocumentToRuns(reopened.state.doc);
    expect(runs.find(run => run.text === "Professor")?.fontSize).toBe(59);
  });

  it("keeps the second-level body size on deeper indents instead of using a generic template size", () => {
    const defaults = Array(9).fill(18);
    const e = editor([
      { text: "▪ ", fontSize: 95.28, listDepth: 0, listFontSizes: defaults },
      { text: "Communication:", fontSize: 51.5 },
      { text: "\n", paragraphBreak: true, listDepth: 1, fontSize: 47.5,
        listFontSizes: [51.5, 47.5, 18, 18, 18, 18, 18, 18, 18] },
      { text: "▪ ", fontSize: 87.88 },
      { text: "Announcements", fontSize: 47.5 },
      { text: "\n", paragraphBreak: true, listDepth: 1, fontSize: 47.5, listFontSizes: defaults },
      { text: "▪ ", fontSize: 87.88 },
      { text: "Grades", fontSize: 47.5 },
    ]);
    const offset = slideDocumentToRuns(e.state.doc).map(run => run.text).join("").indexOf("Grades") + 2;
    e.commands.setTextSelection(documentPosition(e.state.doc, offset));
    e.commands.keyboardShortcut("Tab");
    let runs = slideDocumentToRuns(e.state.doc);
    expect(runs.find(run => run.text === "Grades")?.fontSize).toBe(47.5);
    expect(runs.filter(run => run.paragraphBreak).at(-1)).toMatchObject({ listDepth: 2, fontSize: 47.5 });
    expect(runs.filter(run => run.text === "▪ ").at(-1)?.fontSize).toBeCloseTo(87.88);
    const reopened = editor(runs);
    reopened.commands.setTextSelection(documentPosition(reopened.state.doc, offset));
    reopened.commands.keyboardShortcut("Tab");
    runs = slideDocumentToRuns(reopened.state.doc);
    expect(runs.find(run => run.text === "Grades")?.fontSize).toBe(47.5);
    expect(runs.filter(run => run.paragraphBreak).at(-1)?.listDepth).toBe(3);
    reopened.commands.keyboardShortcut("Shift-Tab");
    reopened.commands.keyboardShortcut("Shift-Tab");
    expect(slideDocumentToRuns(reopened.state.doc).find(run => run.text === "Grades")?.fontSize).toBe(47.5);
  });

  it("uses unused-level sizes while preserving special-size runs and marker proportions", () => {
    const e = editor([
      { text: "▪ ", fontSize: 30, listDepth: 0, listFontSizes: [20, 16] },
      { text: "Body", fontSize: 20 }, { text: "small", fontSize: 10 }, { text: "2", fontSize: 8, baseline: 30 },
      { text: "link", fontSize: 20, href: "https://example.com", color: "#ff0000" },
    ]);
    e.commands.setTextSelection(documentPosition(e.state.doc, 4));
    e.commands.keyboardShortcut("Tab");
    const runs = slideDocumentToRuns(e.state.doc);
    expect(runs[0].fontSize).toBe(24);
    expect(runs.find(run => run.text === "Body")?.fontSize).toBe(16);
    expect(runs.find(run => run.text === "small")?.fontSize).toBe(10);
    expect(runs.find(run => run.text === "2")?.fontSize).toBe(8);
    expect(runs.find(run => run.href)).toMatchObject({ fontSize: 16, color: "#ff0000" });
  });
  it("indents the first outermost item, applies its level color and restores both on outdent", () => {
    const e = editor([
      { text: "▪ ", font: "SuiteLeaf Sprig", color: "#333399", listDepth: 0, listColors: ["#333399", "#000000"], paraHang: 24 },
      { text: "First", bold: true, color: "#333399" },
      { text: " link", href: "https://example.com", color: "#ff0000" },
      { text: "\n", paragraphBreak: true, listDepth: 0 },
      { text: "▪ Second", color: "#333399" },
    ]);
    e.commands.setTextSelection(documentPosition(e.state.doc, 7));
    e.commands.keyboardShortcut("Tab");
    let runs = slideDocumentToRuns(e.state.doc);
    expect(slideParagraphs(e.state.doc).map(p => p.depth)).toEqual([1, 0]);
    expect(runs.find(run => run.text === "First")).toMatchObject({ bold: true, color: "#000000" });
    expect(runs[0]).toMatchObject({ color: "#000000", listDepth: 1, paraMargin: 36 });
    expect(runs.find(run => run.href)).toMatchObject({ color: "#ff0000" });
    expect(e.getHTML()).toContain("color:#000000");
    const reopened = editor(runs);
    reopened.commands.setTextSelection(documentPosition(reopened.state.doc, 7));
    reopened.commands.keyboardShortcut("Shift-Tab");
    expect(slideParagraphs(reopened.state.doc)[0]).toMatchObject({ depth: 0, list: true });
    expect(slideDocumentToRuns(reopened.state.doc).find(run => run.text === "First")?.color).toBe("#333399");
    e.commands.keyboardShortcut("Shift-Tab");
    runs = slideDocumentToRuns(e.state.doc);
    expect(slideParagraphs(e.state.doc).map(p => p.depth)).toEqual([0, 0]);
    expect(runs.find(run => run.text === "First")).toMatchObject({ color: "#333399" });
    e.commands.keyboardShortcut("Shift-Tab");
    expect(slideParagraphs(e.state.doc)[0].list).toBe(true);
  });

  it("infers authored level colors from older Office lists and recolors a natively nested item", () => {
    const colors = ["#000000", "#000000", "#000000"];
    const e = editor([
      { text: "▪ Root", color: "#333399", listDepth: 0, listColors: colors },
      { text: "\n", paragraphBreak: true, listDepth: 0, listColors: colors },
      { text: "▪ ", font: "SuiteLeaf Sprig", color: "#333399" }, { text: "Welcome", color: "#333399" },
      { text: "\n", paragraphBreak: true, listDepth: 1, listColors: colors, paraMargin: 36 },
      { text: "▪ ", font: "SuiteLeaf Sprig", color: "#333399" }, { text: "Details", color: "#000000" },
    ]);
    e.commands.setTextSelection(documentPosition(e.state.doc, 12));
    e.commands.keyboardShortcut("Tab");
    expect(slideDocumentToRuns(e.state.doc).find(run => run.text === "Welcome")?.color).toBe("#000000");
    e.commands.keyboardShortcut("Shift-Tab");
    expect(slideDocumentToRuns(e.state.doc).find(run => run.text === "Welcome")?.color).toBe("#333399");
  });

  it("continues imported symbol bullets with Enter and exits an empty item", () => {
    const e = editor([{ text: "▪ ", font: "SuiteLeaf Sprig", paraHang: 24 }, { text: "First" }]);
    e.commands.setTextSelection(documentPosition(e.state.doc, 7));
    expect(e.commands.keyboardShortcut("Enter")).toBe(true);
    e.commands.insertContent("Next");
    expect(words(slideDocumentToRuns(e.state.doc))).toBe("▪ First\n▪ Next");
    e.commands.keyboardShortcut("Enter");
    e.commands.keyboardShortcut("Enter");
    expect(slideParagraphs(e.state.doc).at(-1)?.list).toBe(false);
    expect(slideParagraphs(e.state.doc).at(-1)?.marker).toEqual([]);
  });

  it("uses structural nesting for Tab and Shift+Tab, and inserts tabs in ordinary text", () => {
    const e = editor([{ text: "• First\n• Second" }]);
    e.commands.setTextSelection(documentPosition(e.state.doc, 12));
    e.commands.keyboardShortcut("Tab");
    expect(slideParagraphs(e.state.doc).map(p => p.depth)).toEqual([0, 1]);
    expect(slideDocumentToRuns(e.state.doc).find(run => run.paragraphBreak)).toMatchObject({ listDepth: 1, paraMargin: 36 });
    e.commands.keyboardShortcut("Shift-Tab");
    expect(slideParagraphs(e.state.doc).map(p => p.depth)).toEqual([0, 0]);
    const plain = editor([{ text: "plain" }]);
    plain.commands.keyboardShortcut("Tab");
    expect(words(slideDocumentToRuns(plain.state.doc))).toContain("\t");
  });

  it("imports HTML lists and formatting through the editor schema", () => {
    const e = editor([]);
    e.commands.setContent('<ul><li><p><strong>First</strong></p></li><li><p>Second</p></li></ul>');
    const output = slideDocumentToRuns(e.state.doc);
    expect(words(output)).toBe("• First\n• Second");
    expect(output.find(run => run.text === "First")?.bold).toBe(true);
  });

  it("continues and renumbers ordered items while retaining imported list metadata", () => {
    const automatic = { kind: "arabicPeriod", prefix: "3.", startAt: 3, level: 2 };
    const e = editor([{ text: "3. ", autoNumber: automatic, listMarker: true, listDepth: 2 }, { text: "First" }]);
    expect(slideParagraphs(e.state.doc)[0].depth).toBe(2);
    expect(slideDocumentToRuns(e.state.doc)[0].autoNumber).toEqual(automatic);
    e.commands.setTextSelection(documentPosition(e.state.doc, 8));
    e.commands.keyboardShortcut("Enter");
    e.commands.insertContent("Next");
    expect(words(slideDocumentToRuns(e.state.doc))).toBe("3. First\n4. Next");
    expect(slideDocumentToRuns(e.state.doc).find(run => run.text === "4. ")?.autoNumber?.prefix).toBe("4.");
    expect(e.getHTML()).toContain("4. ");
  });
});

it("sizes each paragraph's strut from its words instead of the larger box", () => {
  const runs: TextRun[] = [
    { text: "§ ", font: "SuiteLeaf Sprig", paraHang: 27 },
    { text: "Heading", fontSize: 64, font: "SuiteLeaf Willow" },
    { text: "\n", paragraphBreak: true, fontSize: 56, paraHang: 22, paraMargin: 36 },
    { text: "§ ", font: "SuiteLeaf Sprig" },
    { text: "Smaller body", fontSize: 56, font: "SuiteLeaf Willow" },
    { text: "\n", paragraphBreak: true, paraLinePt: 20 },
    { text: "Large", fontSize: 64 }, { text: " small", fontSize: 32 },
    { text: "\n", paragraphBreak: true, fontSize: 40 },
  ];
  const kit = slideTextKit({ fontSize: 64, fontFamily: "SuiteLeaf Willow", lineHeight: 1.08 });
  const root = document.createElement("div");
  root.append(renderSlideText(kit.schema.nodeFromJSON(slideRunsToDocument(runs))));
  const paragraphs = [...root.querySelectorAll<HTMLElement>("[data-slide-para]")];
  expect(paragraphs.map(p => p.style.fontSize)).toEqual([
    "calc(64 * var(--slide-pt, 1) * 1px)",
    "calc(56 * var(--slide-pt, 1) * 1px)",
    "calc(32 * var(--slide-pt, 1) * 1px)",
    "calc(40 * var(--slide-pt, 1) * 1px)",
  ]);
  expect(paragraphs[1].style.lineHeight).toBe("1.08");
  expect(paragraphs[2].style.lineHeight).toBe("calc(20 * var(--slide-pt, 1) * 1px)");
  expect(root.querySelector<HTMLElement>(".slide-bullet-slot span")?.style.fontFamily).toContain("SuiteLeaf Sprig");
});
