/** @vitest-environment jsdom */
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TabCharacter, TabStops, layoutTabStops, tabGapPx } from "../apps/web/src/editors/doc-tab-stops";
import { frameQueue, layoutBoxes, resizeObservers } from "./doc-editor-harness";

let editor: Editor;
let frames: ReturnType<typeof frameQueue>;
let restore: (() => void) | null = null;

beforeEach(() => {
  frames = frameQueue();
  resizeObservers();
});

afterEach(() => {
  restore?.();
  restore = null;
  editor?.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function make(content: JSONContent | string, editable = true) {
  const paper = document.createElement("div");
  paper.className = "paper";
  const element = document.createElement("div");
  paper.append(element);
  document.body.append(paper);
  editor = new Editor({ element, editable, extensions: [StarterKit, TableKit, TabCharacter, TabStops], content });
  return editor;
}

const p = (text: string, attrs?: Record<string, unknown>): JSONContent => ({ type: "paragraph", ...(attrs ? { attrs } : {}), content: [{ type: "text", text }] });
const stops = () => editor.getJSON().content?.slice(0, 3).map((node) => node.attrs?.tabStop ?? null);

describe("tab stops", () => {
  it("sets and clears one stop on each selected paragraph", () => {
    make({ type: "doc", content: [p("one"), p("two"), { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "H" }] }] });
    editor.commands.setTextSelection({ from: 2, to: 7 });
    expect(editor.commands.setTabStop(1.5)).toBe(true);
    expect(stops()).toEqual([1.5, 1.5, null]);
    expect(editor.view.dom.querySelectorAll(".doc-tab-guide")).toHaveLength(2);
    expect(editor.view.dom.querySelector<HTMLElement>(".doc-tab-guide")!.style.left).toBe("1.5in");
    expect(editor.commands.setTabStop(1.5)).toBe(true);
    expect(editor.commands.setTabStop(9)).toBe(false);
    expect(editor.commands.setTabStop(null, { from: 1, to: 2 })).toBe(true);
    expect(stops()).toEqual([null, 1.5, null]);
    expect(editor.commands.setTabStop(1, { from: 0, to: 999 })).toBe(false);
    editor.commands.setTextSelection(12);
    expect(editor.commands.setTabStop(2)).toBe(false);
    expect(editor.getHTML()).toContain('<p data-tab-stop="1.5">two</p>');
  });

  it("reads stops and tabs from HTML", () => {
    make('<p data-tab-stop="2.25">a<span data-tab="true"></span>b</p><p data-tab-stop="40">c</p>');
    expect(stops()).toEqual([2.25, null]);
    expect(editor.getJSON().content?.[0].content?.map((node) => node.type)).toEqual(["text", "tab", "text"]);
    expect(editor.getHTML()).toContain('<span data-tab="true" class="doc-tab" aria-hidden="true"></span>');
  });

  it("types a tab in a paragraph but leaves lists, tables and headings alone", () => {
    make({
      type: "doc",
      content: [
        p("ab"),
        { type: "bulletList", content: [{ type: "listItem", content: [p("item")] }] },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p("cell")] }] }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Head" }] },
      ],
    });
    editor.commands.setTextSelection(2);
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(editor.getJSON().content?.[0].content?.map((node) => node.type)).toEqual(["text", "tab", "text"]);
    const at = (text: string) => {
      let found = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === text) found = pos;
      });
      return found + 1;
    };
    for (const text of ["item", "cell", "Head"]) {
      editor.commands.setTextSelection(at(text));
      expect(editor.commands.insertTab()).toBe(false);
    }
    editor.commands.setTextSelection({ from: 1, to: 3 });
    const before = editor.state.doc;
    expect(editor.commands.insertTab()).toBe(true);
    expect(editor.state.doc.eq(before)).toBe(true);
    editor.commands.setTextSelection(1);
    expect(editor.can().insertTab()).toBe(true);
  });

  it("does not type a tab in a read-only document", () => {
    make({ type: "doc", content: [p("ab")] }, false);
    expect(editor.commands.insertTab()).toBe(false);
  });

  it("widens each tab to its stop after layout", () => {
    make({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { tabStop: 1.5 }, content: [{ type: "text", text: "a" }, { type: "tab" }, { type: "text", text: "b" }, { type: "tab" }] },
      ],
    });
    const tabs = [...editor.view.dom.querySelectorAll<HTMLElement>(".doc-tab")];
    restore = layoutBoxes((el) => {
      if (el.tagName === "P") return { left: 100, width: 600 };
      if (el === tabs[0]) return { left: 150 };
      if (el === tabs[1]) return { left: 300 };
      return undefined;
    });
    frames.flush();
    expect(tabs.map((tab) => tab.style.width)).toEqual(["94px", "40px"]);
    // A tab past the stop moves to the next half inch.
    expect(tabGapPx(200, 1.5, 0)).toBe(40);
    expect(tabGapPx(10, null, 0)).toBe(38);
  });

  it("measures from the paragraph when it is the tab's offset parent, and skips a zero scale", () => {
    const block = document.createElement("p");
    block.setAttribute("data-tab-stop", "1");
    const tab = document.createElement("span");
    tab.className = "doc-tab";
    block.append(tab);
    document.body.append(block);
    Object.defineProperty(tab, "offsetParent", { value: block });
    Object.defineProperty(tab, "offsetLeft", { value: 24 });
    layoutTabStops(document.body);
    expect(tab.style.width).toBe("72px");
    const other = document.createElement("p");
    const loose = document.createElement("span");
    loose.className = "doc-tab";
    other.append(loose);
    document.body.append(other);
    restore = layoutBoxes((el) => (el === other ? { width: 0 } : undefined));
    Object.defineProperty(other, "offsetWidth", { value: 100 });
    layoutTabStops(other.parentElement!);
    expect(loose.style.width).toBe("");
  });
});
