// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { expect, it } from "vitest";
import { FigureList, figureListEntries } from "../apps/web/src/editors/figure-list-node";

it("numbers a caption from the page breaks and leaves the caption id out", () => {
  const doc = {
    content: [
      {
        type: "paragraph",
        attrs: { captionId: "secret-value", captionKind: "figure" },
        content: [{ type: "text", text: "Beds" }],
      },
      { type: "pageBreak" },
      { type: "note", content: [{ type: "pageBreak" }] },
      {
        type: "paragraph",
        attrs: { captionId: "paths", captionKind: "table" },
        content: [{ type: "text", text: "Paths" }],
      },
    ],
  };
  expect(figureListEntries(doc, "figure")).toEqual([{ label: "Beds", page: 1 }]);
  expect(figureListEntries(doc, "table")).toEqual([{ label: "Paths", page: 2 }]);
  expect(JSON.stringify(figureListEntries(doc, "figure"))).not.toContain("secret-value");
});

it("restarts a figure page at a section break", () => {
  const doc = {
    content: [
      {
        type: "paragraph",
        attrs: { captionId: "beds", captionKind: "figure" },
        content: [{ type: "text", text: "Beds" }],
      },
      { type: "sectionBreak", attrs: { restartAt: 5 } },
      {
        type: "paragraph",
        attrs: { captionId: "paths", captionKind: "figure" },
        content: [{ type: "text", text: "Paths" }],
      },
    ],
  };
  expect(figureListEntries(doc, "figure")).toEqual([
    { label: "Beds", page: 1 },
    { label: "Paths", page: 5 },
  ]);
  const continued = figureListEntries(
    {
      content: [
        doc.content[0],
        { type: "sectionBreak", attrs: { restartAt: "secret-value" } },
        doc.content[2],
      ],
    },
    "figure",
  );
  expect(continued).toEqual([
    { label: "Beds", page: 1 },
    { label: "Paths", page: 2 },
  ]);
  expect(JSON.stringify(continued)).not.toContain("secret-value");
});

it("inserts a figure list into the document", () => {
  const editor = new Editor({
    extensions: [StarterKit, FigureList],
    content: "<p>Beds</p>",
  });
  expect(editor.commands.insertFigureList("table")).toBe(true);
  const saved = JSON.stringify(editor.getJSON());
  expect(saved).toContain("\"type\":\"figureList\"");
  expect(saved).toContain("\"kind\":\"table\"");
  editor.destroy();
});
