/** @vitest-environment jsdom */
import { Editor, generateHTML } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import { DocShape } from "../apps/web/src/editors/doc-shape";
import { documentPlainText } from "../apps/web/src/editors/doc-text";
import { TextBox } from "../apps/web/src/editors/doc-text-box";

const extensions = [StarterKit, TextBox, DocShape];

function editorWith(content: Record<string, unknown>) {
  return new Editor({ extensions, content });
}

describe("document text boxes and shapes", () => {
  it("shows an imported text box that only has a text attribute", () => {
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Around" }] },
        { type: "textBox", attrs: { text: "Inside the box" } },
      ],
    };
    const editor = editorWith(content);
    const box = editor.view.dom.querySelector("[data-text-box]");
    expect(box?.textContent).toContain("Inside the box");
    const stored = editor.getJSON().content?.find((node) => node.type === "textBox");
    expect((stored?.content ?? []).map((child) => child.text ?? "").join("")).toBe(
      "Inside the box",
    );
    expect(generateHTML(content, extensions)).toContain("Inside the box");
    expect(documentPlainText(content)).toBe("\ufeffAround\r\nInside the box");
    editor.destroy();
  });

  it("keeps imported words when the first character is typed", () => {
    const editor = editorWith({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Around" }] },
        { type: "textBox", attrs: { text: "Inside the box" } },
      ],
    });
    let pos = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "textBox") pos = position;
    });
    editor.commands.setTextSelection(pos + 1);
    editor.commands.insertContent("!");
    const box = editor.getJSON().content?.find((node) => node.type === "textBox");
    const written = (box?.content ?? []).map((child) => child.text ?? "").join("");
    expect(written.replace("!", "")).toBe("Inside the box");
    expect(written).toContain("!");
    expect(editor.view.dom.querySelector("[data-text-box]")?.textContent).toContain(
      "Inside the box",
    );
    expect(documentPlainText(editor.getJSON())).toContain("Inside the box");
    editor.destroy();
  });

  it("inserts an empty text box, keeps the words around it, and stores a drag offset", () => {
    const editor = editorWith({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before the box." }] },
      ],
    });
    editor.commands.focus("end");
    expect(editor.commands.insertTextBox()).toBe(true);
    expect(editor.state.selection.$from.parent.type.name).toBe("textBox");
    editor.commands.insertContent("Plot notes");
    expect(editor.commands.exitTextBox()).toBe(true);
    editor.commands.insertContent("After the box.");

    const nodes = editor.getJSON().content ?? [];
    const paragraphs = nodes
      .filter((node) => node.type === "paragraph")
      .map((node) => (node.content ?? []).map((child) => child.text ?? "").join(""));
    expect(paragraphs).toContain("Before the box.");
    expect(paragraphs).toContain("After the box.");
    const box = nodes.find((node) => node.type === "textBox");
    expect(box?.content?.map((child) => child.text ?? "").join("")).toBe("Plot notes");
    expect(box?.content?.map((child) => child.text ?? "").join("")).not.toContain("After the box.");

    let pos = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "textBox") pos = position;
    });
    editor.commands.setNodeSelection(pos);
    editor.commands.updateAttributes("textBox", { x: 48, y: 36 });
    const el = editor.view.dom.querySelector("[data-text-box]") as HTMLElement;
    expect(el.style.transform).toBe("translate(48px, 36px)");
    expect(editor.getJSON().content?.find((node) => node.type === "textBox")?.attrs).toMatchObject({
      x: 48,
      y: 36,
    });
    editor.destroy();
  });

  it("inserts a rectangle and an ellipse without replacing the text box", () => {
    const editor = editorWith({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Before the box." }] }],
    });
    editor.commands.focus("end");
    editor.commands.insertTextBox();
    editor.commands.insertContent("Plot notes");
    editor.commands.exitTextBox();
    expect(editor.commands.insertShape("rect")).toBe(true);
    expect(editor.commands.insertShape("ellipse")).toBe(true);
    const nodes = editor.getJSON().content ?? [];
    expect(nodes.some((node) => node.type === "textBox")).toBe(true);
    expect(nodes.find((node) => node.type === "docShape" && node.attrs?.kind === "rect")).toBeTruthy();
    expect(nodes.find((node) => node.type === "docShape" && node.attrs?.kind === "ellipse")).toBeTruthy();
    expect(editor.view.dom.querySelector("[data-doc-shape='rect']")).toBeTruthy();
    expect(editor.view.dom.querySelector("[data-doc-shape='ellipse']")).toBeTruthy();
    editor.destroy();
  });

  it("exports a hard break in a text box as two lines", async () => {
    const file = createFile("doc", "Plot notes");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      content: [
        {
          type: "textBox",
          content: [
            { type: "text", text: "First line" },
            { type: "hardBreak" },
            { type: "text", text: "Second line" },
          ],
        },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const doc = await zip.file("word/document.xml")!.async("string");
    const first = doc.indexOf("First line");
    const second = doc.indexOf("Second line");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    const between = doc.slice(first, second);
    expect(between).toContain("<w:br/>");
    const region = doc.slice(Math.max(0, first - 40), second + "Second line".length);
    expect(region).not.toMatch(/<w:t\b[^>]*>[^<]*\n[^<]*<\/w:t>/);
  });
});
