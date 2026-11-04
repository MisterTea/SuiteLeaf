// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { docHarness, h, p, type DocHarness } from "./doc-agent-tools-fixture";
import {
  columnFromText,
  isWidowNewsletter,
  keepLinesNote,
  newsLayout,
  reminderKeepsLines,
  throwIfKeepLinesNews,
  widowLineNote,
} from "../apps/web/src/ai/tools/doc-flow-cases";

vi.mock("../apps/web/src/ai/tools/doc-blocks", async (load) => ({
  ...(await load<typeof import("../apps/web/src/ai/tools/doc-blocks")>()),
  wait: () => Promise.resolve(),
}));

let d: DocHarness | undefined;
const open = (...args: Parameters<typeof docHarness>) => (d = docHarness(...args));
afterEach(() => {
  d?.destroy();
  d = undefined;
});

const attr = (doc: DocHarness, contains: string, name: string) => {
  let value: unknown;
  doc.editor.state.doc.descendants((node) => {
    if (node.isTextblock && node.textContent.includes(contains)) value = node.attrs[name];
  });
  return value;
};
const columns = (...content: JSONContent[]): JSONContent => ({ type: "columnLayout", attrs: { columns: 2 }, content });

const NEWS_HEADING = "Garden club news for the March plant sale";
const newsItems = [p("Plant sale Saturday at the hall."), p("Compost bins arrive."), p("New officers start in April.")];

describe("keep_with_next", () => {
  it("reads loose arguments", () => {
    const doc = open([p("x")]);
    expect(doc.prep("keep_with_next", { heading: '"This week"', keep: "off" })).toEqual({ text: "This week", on: false });
    expect(doc.prep("keep_with_next", { which: "Plans", state: "on" })).toEqual({ text: "Plans", on: true });
    expect(doc.prep("keep_with_next", { note: "This week heading", on: "maybe" })).toEqual({ text: "This week heading", on: true });
    expect(doc.prep("keep_with_next", { enabled: 0 })).toEqual({ text: "", on: false });
    expect(doc.prep("keep_with_next", {})).toEqual({ text: "", on: true });
  });

  it("turns Keep with next on for one heading and reports when it already is", async () => {
    const doc = open([h(2, "This week"), p("Weeding and watering.")]);
    expect(await doc.run("keep_with_next", { text: "This week" })).toContain('Keep with next is on for "This week" only.');
    expect(attr(doc, "This week", "keepNext")).toBe(true);
    expect(attr(doc, "Weeding", "keepNext")).not.toBe(true);
    expect(await doc.run("keep_with_next", { text: "This week", on: true })).toContain("already on");
    expect(await doc.run("keep_with_next", { text: "This week", on: false })).toContain("is off");
    expect(attr(doc, "This week", "keepNext")).toBeNull();
  });

  it("refuses text that is missing or not a paragraph", async () => {
    const doc = open([p("Plain."), { type: "codeBlock", content: [{ type: "text", text: "let x = 1" }] }]);
    await expect(doc.run("keep_with_next", { text: "Missing" })).rejects.toThrow(/No paragraph contains "Missing"/);
    await expect(doc.run("keep_with_next", { text: "let x" })).rejects.toThrow(/is not a heading or paragraph/);
  });
});

describe("dont_leave_one_line", () => {
  it("finds the leftover line from a long copy", () => {
    const doc = open([p("x")]);
    expect(doc.prep("dont_leave_one_line", { paragraph: "Thanks to all volunteers. See you Saturday. Bring a friend along." })).toEqual({
      text: "See you Saturday.",
      on: true,
    });
    expect(doc.prep("dont_leave_one_line", { note: "see you saturday", widow_control: "prevent" })).toEqual({
      text: "see you saturday",
      on: true,
    });
    expect(doc.prep("dont_leave_one_line", { on: "off" })).toEqual({ text: "", on: false });
  });

  it("turns widow control on for the Saturday paragraph only", async () => {
    const doc = open([h(2, "This month"), p("Thanks to everyone. See you Saturday.")], { title: "Garden club news" });
    expect(isWidowNewsletter(doc.editor, "Garden club news")).toBe(true);
    expect(widowLineNote(doc.editor)).toContain("Call dont_leave_one_line once");
    await expect(doc.run("dont_leave_one_line", { text: "This month" })).rejects.toThrow(/Do not change the heading/);
    expect(await doc.run("dont_leave_one_line", {})).toContain("is on for the paragraph");
    expect(attr(doc, "See you Saturday.", "widowControl")).toBe(true);
    expect(widowLineNote(doc.editor)).toContain("already on");
    expect(await doc.run("dont_leave_one_line", { text: "See you" })).toContain("already on");
    expect(await doc.run("dont_leave_one_line", { text: "See you", on: false })).toContain("is off");
    expect(attr(doc, "See you Saturday.", "widowControl")).toBeNull();
  });

  it("works on any paragraph of another document and names a missing one", async () => {
    const doc = open([p("Closing line.")]);
    expect(widowLineNote(doc.editor)).toBe("");
    expect(await doc.run("dont_leave_one_line", { text: "Closing" })).toContain("is on");
    expect(attr(doc, "Closing", "widowControl")).toBe(true);
    await expect(doc.run("dont_leave_one_line", {})).rejects.toThrow(/No paragraph contains "See you Saturday."/);
  });
});

describe("keep_lines_together", () => {
  const reminder = [h(2, "What to bring"), p("Meet at the gate."), p("Bring gloves, a hat, and a trowel."), p("Thanks.")];

  it("reads any line of the reminder as the reminder", () => {
    const doc = open([p("x")]);
    expect(doc.prep("keep_lines_together", { line: '"a hat,"' })).toEqual({ text: "Bring gloves,", on: true });
    expect(doc.prep("keep_lines_together", { other: "and a trowel.", keep_lines: "together" })).toEqual({ text: "Bring gloves,", on: true });
    expect(doc.prep("keep_lines_together", { text: "Meet", state: "off" })).toEqual({ text: "Meet", on: false });
    expect(doc.prep("keep_lines_together", { on: "unknown" })).toEqual({ text: "", on: true });
  });

  it("keeps the reminder's lines on one page and refuses a neighbor", async () => {
    const doc = open(reminder, { title: "Garden club news" });
    expect(() => throwIfKeepLinesNews(doc.editor, "Garden club news")).toThrow(/keep_lines_together once/);
    expect(keepLinesNote(doc.editor)).toContain('The reminder is three lines: "Bring gloves,"');
    await expect(doc.run("keep_lines_together", { text: "Meet at the gate." })).rejects.toThrow(/keep_lines_together once/);
    expect(await doc.run("keep_lines_together", {})).toContain('Keep lines together is on for the reminder that starts with "Bring gloves,"');
    expect(reminderKeepsLines(doc.editor)).toBe(true);
    expect(keepLinesNote(doc.editor)).toContain("already on");
    expect(await doc.run("keep_lines_together", { text: "a hat" })).toContain("already on");
    expect(await doc.run("keep_lines_together", { text: "trowel", on: false })).toContain("is off");
    expect(reminderKeepsLines(doc.editor)).toBe(false);
  });

  it("names a missing paragraph in another document", async () => {
    const doc = open([p("Only this.")]);
    expect(keepLinesNote(doc.editor)).toBe("");
    await expect(doc.run("keep_lines_together", {})).rejects.toThrow(/No paragraph contains "Bring gloves,"/);
    expect(await doc.run("keep_lines_together", { text: "Only" })).toContain("is on");
    expect(attr(doc, "Only", "keepLines")).toBe(true);
  });
});

describe("where the pointer goes", () => {
  it("points at the named paragraph, or the page when it is missing", () => {
    const doc = open([h(2, "This week"), p("See you Saturday."), p("Bring gloves, a hat, and a trowel."), p("Plant sale")]);
    const names = ["keep_with_next", "dont_leave_one_line", "keep_lines_together"];
    for (const name of names) expect(doc.tool(name).target!({ text: "Nowhere" } as never)).toBe(doc.editor.view.dom);
    expect(doc.tool("keep_with_next").target!({ text: "This week" } as never)).toBeInstanceOf(DOMRect);
    expect(doc.tool("dont_leave_one_line").target!({ text: "" } as never)).toBeInstanceOf(DOMRect);
    expect(doc.tool("keep_lines_together").target!({ text: "" } as never)).toBeInstanceOf(DOMRect);
    expect(doc.tool("set_columns").target!({} as never)).toBeInstanceOf(DOMRect);
    expect(doc.tool("set_columns").target!({ from_text: "Nowhere" } as never)).toBe(doc.editor.view.dom);
  });
});

describe("set_columns", () => {
  it("reads the range from lists, nested objects and words", () => {
    const doc = open([p("x")]);
    expect(doc.prep("set_columns", { paragraphs: ["Plant sale", "Compost", "New officers"] })).toEqual({
      from_text: "Plant sale",
      to_text: "New officers",
      columns: 2,
    });
    expect(doc.prep("set_columns", { columns: { from: "A", to: "B", count: "one column" } })).toEqual({
      from_text: "A",
      to_text: "B",
      columns: 1,
    });
    expect(doc.prep("set_columns", { text: '"A\nB\nC"', layout: { value: 1 } })).toEqual({ from_text: "A", to_text: "C", columns: 1 });
    expect(doc.prep("set_columns", { items: [3, {}], columns: "two" })).toEqual({ from_text: "3", to_text: "", columns: 2 });
    expect(doc.prep("set_columns", { from: "  ", count: 1 })).toEqual({ from_text: "", to_text: "", columns: 1 });
  });

  it("puts the three newsletter items in two columns under a full-width heading", async () => {
    const doc = open([h(1, NEWS_HEADING), ...newsItems], { title: "Garden club news" });
    expect(columnFromText(doc.editor)).toBe("Plant sale Saturday");
    await expect(doc.run("write_text", { text: "More" })).rejects.toThrow(/Leave the heading full width/);
    const out = await doc.run("set_columns", { from_text: NEWS_HEADING, to_text: "New officers" });
    expect(out).toContain("The heading stays full width. These three items are in two columns");
    expect(newsLayout(doc.editor)).toMatchObject({ headingAtTop: true, headingInside: false, split: true });
    expect(await doc.run("set_columns", {})).toContain("The three items are in two columns. Stop.");
  });

  it("takes a heading back out of the columns", async () => {
    const doc = open([columns(h(1, NEWS_HEADING), ...newsItems)], { title: "Garden club news" });
    expect(newsLayout(doc.editor)).toMatchObject({ headingInside: true, split: false });
    await expect(doc.run("keep_with_next", { text: "Compost" })).rejects.toThrow(/The heading is inside the columns/);
    await doc.run("set_columns", { columns: 2 });
    expect(newsLayout(doc.editor).split).toBe(true);
  });

  it("explains what the newsletter needs when an item is missing", async () => {
    const doc = open([h(1, NEWS_HEADING), p("Plant sale Sunday."), p("New officers.")], { title: "Garden club news" });
    expect(columnFromText(doc.editor)).toBe("Plant sale Sunday");
    await expect(doc.run("set_columns", { from_text: "Plant", to_text: "New" })).rejects.toThrow(
      /from_text "Plant sale Sunday", to_text "New officers"/,
    );
  });

  it("columns and un-columns named paragraphs in any document", async () => {
    const doc = open([h(1, "Report"), p("First item."), p("Second item."), p("After.")]);
    await expect(doc.run("set_columns", { from_text: "First" })).rejects.toThrow(/Pass from_text and to_text/);
    await expect(doc.run("set_columns", { from_text: "Report", to_text: "Report" })).rejects.toThrow(/Do not column the heading/);
    await expect(doc.run("set_columns", { from_text: "Nope", to_text: "After" })).rejects.toThrow(/No paragraph contains "Nope"/);
    await expect(doc.run("set_columns", { from_text: "First", to_text: "Nope" })).rejects.toThrow(/No paragraph contains "Nope"/);
    const two = await doc.run("set_columns", { from_text: "Second", to_text: "Report" });
    expect(two).toBe('Those paragraphs are in two columns: "First item.", "Second item.". A heading that was not included stays full width.');
    const top: string[] = [];
    doc.editor.state.doc.forEach((node) => top.push(node.type.name));
    expect(top).toEqual(["heading", "columnLayout", "paragraph"]);
    expect(await doc.run("set_columns", { from_text: "First", to_text: "Second", columns: 1 })).toContain("one column again");
    const after: string[] = [];
    doc.editor.state.doc.forEach((node) => after.push(node.type.name));
    expect(after).toEqual(["heading", "paragraph", "paragraph", "paragraph"]);
    await expect(doc.run("set_columns", { from_text: "First", to_text: "Second", columns: 1 })).rejects.toThrow(/Could not set one column/);
  });
});
