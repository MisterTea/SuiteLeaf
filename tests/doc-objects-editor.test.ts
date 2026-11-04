/** @vitest-environment jsdom */
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { DocShape } from "../apps/web/src/editors/doc-shape";
import { TextBox } from "../apps/web/src/editors/doc-text-box";
import { canPlaceObject, objectInsertPos, offsetOf } from "../apps/web/src/editors/doc-object-move";

let editor: Editor;

afterEach(() => {
  editor?.destroy();
  document.body.replaceChildren();
});

function make(content: JSONContent | string, editable = true) {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, editable, extensions: [StarterKit, TextBox, DocShape], content });
  return editor;
}

const p = (text?: string): JSONContent => (text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" });
const types = () => editor.getJSON().content?.map((node) => node.type);
const posOf = (name: string) => {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === name) found = pos;
  });
  return found;
};

function mouse(target: EventTarget, type: string, x: number, y: number, button = 0) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button }));
}

describe("text boxes", () => {
  it("inserts a box after the paragraph end with the caret inside", () => {
    make({ type: "doc", content: [p("Intro")] });
    editor.commands.setTextSelection(6);
    expect(editor.commands.insertTextBox()).toBe(true);
    expect(types()).toEqual(["paragraph", "textBox", "paragraph"]);
    expect(editor.state.selection.$from.parent.type.name).toBe("textBox");
    editor.commands.insertContent("Note");
    // A second box goes after this one, not inside it.
    expect(editor.commands.insertTextBox()).toBe(true);
    expect(types()).toEqual(["paragraph", "textBox", "textBox", "paragraph"]);
    expect(editor.getJSON().content?.[1].content?.[0].text).toBe("Note");
  });

  it("replaces an empty paragraph and splits a sentence around a box", () => {
    make({ type: "doc", content: [p(), p("left right")] });
    editor.commands.setTextSelection(1);
    editor.commands.insertTextBox();
    // The empty line itself becomes the box; the sentence below is kept.
    expect(types()).toEqual(["textBox", "paragraph"]);
    expect(editor.state.selection.$from.parent.type.name).toBe("textBox");
    editor.commands.setTextSelection(posOf("paragraph") + 6);
    editor.commands.insertTextBox();
    expect(editor.getJSON().content?.filter((node) => node.type === "textBox")).toHaveLength(2);
  });

  it("leaves a box with Escape and keeps Enter as a line break inside it", () => {
    make({ type: "doc", content: [p("A"), { type: "textBox", content: [{ type: "text", text: "In" }] }] });
    const box = posOf("textBox");
    editor.commands.setTextSelection(box + 3);
    const press = (key: string, shiftKey = false) =>
      editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
    press("Enter");
    press("Enter", true);
    const inside = editor.state.doc.nodeAt(box)!;
    expect(inside.content.childCount).toBe(3);
    expect([inside.child(1).type.name, inside.child(2).type.name]).toEqual(["hardBreak", "hardBreak"]);
    press("Escape");
    expect(types()).toEqual(["paragraph", "textBox", "paragraph"]);
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    editor.commands.setTextSelection(1);
    expect(editor.commands.exitTextBox()).toBe(false);
    press("Enter");
    expect(types()).toEqual(["paragraph", "paragraph", "textBox", "paragraph"]);
    editor.commands.setNodeSelection(posOf("textBox"));
    expect(editor.commands.exitTextBox()).toBe(true);
  });

  it("drags a selected box and stores the offset", () => {
    make({ type: "doc", content: [p("A"), { type: "textBox", attrs: { x: 4, y: 6 }, content: [{ type: "text", text: "Box" }] }] });
    const dom = editor.view.dom.querySelector<HTMLElement>(".doc-text-box")!;
    expect(dom.style.transform).toBe("translate(4px, 6px)");
    const frame = dom.querySelector(".doc-object-move")!;
    mouse(frame, "mousedown", 10, 10, 2);
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
    mouse(frame, "mousedown", 10, 10);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    mouse(window, "mousemove", 11, 11);
    expect(dom.style.transform).toBe("translate(4px, 6px)");
    mouse(window, "mousemove", 40, 30);
    expect(dom.style.transform).toBe("translate(34px, 26px)");
    mouse(window, "mouseup", 40, 30);
    expect(offsetOf(editor.state.doc.nodeAt(posOf("textBox"))!.attrs)).toEqual({ x: 34, y: 26 });
    expect(editor.getHTML()).toContain('data-x="34" data-y="26"');
  });

  it("puts the caret where a box's text is clicked without dragging", () => {
    make({ type: "doc", content: [p("A"), { type: "textBox", content: [{ type: "text", text: "Box" }] }] });
    const box = posOf("textBox");
    const text = editor.view.dom.querySelector(".doc-text-box-content")!;
    editor.view.posAtCoords = () => ({ pos: box + 2, inside: -1 });
    mouse(text, "mousedown", 5, 5);
    mouse(window, "mouseup", 5, 5);
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.state.selection.from).toBe(box + 2);
    // With the caret already inside, a press edits text instead of moving the box.
    mouse(text, "mousedown", 5, 5);
    mouse(window, "mousemove", 50, 50);
    mouse(window, "mouseup", 50, 50);
    expect(offsetOf(editor.state.doc.nodeAt(box)!.attrs)).toEqual({ x: 0, y: 0 });
    editor.view.posAtCoords = () => ({ pos: 0, inside: -1 });
    editor.commands.setNodeSelection(box);
    mouse(text, "mousedown", 5, 5);
    mouse(window, "mouseup", 5, 5);
    editor.view.posAtCoords = () => null;
    editor.commands.setNodeSelection(box);
    mouse(text, "mousedown", 5, 5);
    mouse(window, "mouseup", 5, 5);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  });

  it("does not drag in a read-only document", () => {
    make({ type: "doc", content: [p("A"), { type: "textBox", content: [{ type: "text", text: "Box" }] }] }, false);
    const dom = editor.view.dom.querySelector<HTMLElement>(".doc-text-box")!;
    editor.view.setProps({ editable: () => false });
    mouse(dom.querySelector(".doc-object-move")!, "mousedown", 1, 1);
    mouse(window, "mousemove", 50, 50);
    expect(dom.style.transform).toBe("translate(0px, 0px)");
  });

  it("reads boxes from HTML and keeps the imported text until it becomes content", () => {
    make('<p>a</p><div data-text-box="" data-text="Imported" data-x="nope" data-y="3"></div>');
    const box = editor.getJSON().content?.[1];
    expect(box?.attrs).toMatchObject({ x: 0, y: 3, text: "" });
    expect(box?.content?.[0].text).toBe("Imported");
    expect(editor.view.dom.querySelector<HTMLElement>(".doc-text-box-fallback")!.hidden).toBe(true);
  });
});

describe("shapes", () => {
  it("inserts a rectangle or ellipse and keeps it selected", () => {
    make({ type: "doc", content: [p("Text")] });
    editor.commands.setTextSelection(5);
    expect(editor.commands.insertShape("ellipse")).toBe(true);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    const dom = editor.view.dom.querySelector<HTMLElement>(".doc-shape")!;
    expect(dom.getAttribute("aria-label")).toBe("Ellipse");
    expect(editor.commands.insertShape("triangle" as never)).toBe(true);
    expect(editor.getJSON().content?.filter((node) => node.type === "docShape").map((node) => node.attrs?.kind)).toEqual(["ellipse", "rect"]);
    expect(editor.view.dom.querySelectorAll(".doc-shape")[1].getAttribute("aria-label")).toBe("Rectangle");
  });

  it("drags a shape and snaps back on a click", () => {
    make({ type: "doc", content: [p("A"), { type: "docShape", attrs: { kind: "rect", x: 2, y: 2 } }] });
    const dom = editor.view.dom.querySelector<HTMLElement>(".doc-shape")!;
    mouse(dom, "mousedown", 0, 0);
    mouse(window, "mousemove", 30, 0);
    mouse(window, "mouseup", 1, 1);
    expect(dom.style.transform).toBe("translate(2px, 2px)");
    mouse(dom, "mousedown", 0, 0);
    mouse(dom, "mousedown", 0, 0);
    mouse(window, "mouseup", 20, 10);
    expect(offsetOf(editor.state.doc.nodeAt(posOf("docShape"))!.attrs)).toEqual({ x: 22, y: 12 });
    expect(dom.className).toBe("doc-shape doc-shape-rect");
  });

  it("reads shapes from HTML", () => {
    make('<div data-doc-shape="ellipse" data-x="5" data-y="x"></div>');
    expect(editor.getJSON().content?.[0].attrs).toEqual({ kind: "ellipse", x: 5, y: 0 });
    expect(editor.getHTML()).toContain('class="doc-shape doc-shape-ellipse" style="transform: translate(5px, 0px);"');
  });

  it("finds where an object can go", () => {
    make({ type: "doc", content: [p("A"), { type: "docShape" }, { type: "blockquote", content: [p("q")] }] });
    const shape = posOf("docShape");
    editor.commands.setNodeSelection(shape);
    expect(objectInsertPos(editor.state.selection)).toBe(shape + 1);
    expect(canPlaceObject(editor.state, editor.schema.nodes.textBox)).toBe(true);
    editor.commands.setTextSelection(1);
    expect(objectInsertPos(editor.state.selection)).toBeNull();
    expect(canPlaceObject(editor.state, editor.schema.nodes.docShape)).toBe(true);
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    expect(canPlaceObject(editor.state, editor.schema.nodes.docShape)).toBe(true);
  });
});
