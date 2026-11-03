import { expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, type DocFile } from "../packages/core/src";
import { captionPagesForExport } from "../packages/core/src/caption-pages";
import { applyStyleFormats, refreshCaptions, type StyleDef } from "../packages/core/src/doc-styles";
import { exportDocx } from "../packages/core/src/docx-export";

const styles: StyleDef[] = [
  { id: "body", name: "Body", fontSize: 12 },
  { id: "heading", name: "Heading", basedOn: "body", bold: true, fontSize: 22 },
];

it("writes a named style's bold and size into a Word file", async () => {
  const file = createFile("doc", "Beds") as DocFile;
  file.content = applyStyleFormats(
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { styleId: "heading" },
          content: [{ type: "text", text: "Beds" }],
        },
        {
          type: "paragraph",
          attrs: { styleId: "heading", direct: { fontSize: 16 } },
          content: [{ type: "text", text: "Note" }],
        },
      ],
    },
    styles,
  ) as DocFile["content"];
  const xml = await (
    await JSZip.loadAsync(await exportDocx(file))
  )
    .file("word/document.xml")!
    .async("string");
  const beds = xml.slice(xml.indexOf("Beds") - 400, xml.indexOf("Beds") + 40);
  const note = xml.slice(xml.indexOf("Note") - 400, xml.indexOf("Note") + 40);
  expect(beds).toContain('w:val="44"');
  expect(beds).toContain("<w:b/>");
  expect(note).toContain('w:val="32"');
  expect(xml).not.toContain("Heading");
});

it("applies paragraph styles stored on the document during a Word export", async () => {
  const file = createFile("doc", "Beds") as DocFile;
  file.content = {
    type: "doc",
    attrs: { paragraphStyles: styles },
    content: [
      {
        type: "paragraph",
        attrs: { styleId: "heading" },
        content: [{ type: "text", text: "Beds" }],
      },
      {
        type: "paragraph",
        attrs: { styleId: "heading", direct: { fontSize: 16 } },
        content: [{ type: "text", text: "Note" }],
      },
      {
        type: "paragraph",
        attrs: { styleId: "Not a style" },
        content: [{ type: "text", text: "Plain" }],
      },
    ],
  } as DocFile["content"];
  const zip = await JSZip.loadAsync(await exportDocx(file));
  const xml = await zip.file("word/document.xml")!.async("string");
  const stylesXml = await zip.file("word/styles.xml")!.async("string");
  const beds = xml.slice(xml.indexOf("Beds") - 500, xml.indexOf("Beds") + 40);
  expect(beds).toContain('w:val="44"');
  expect(beds).toContain("<w:b/>");
  expect(beds).toContain('w:val="heading"');
  expect(xml).not.toContain("Heading");
  expect(stylesXml).toContain('w:styleId="heading"');
  expect(stylesXml).toContain('w:val="Heading"');
  expect(stylesXml).toContain('w:val="body"');
  const heading = stylesXml.slice(stylesXml.indexOf('w:styleId="heading"'), stylesXml.indexOf('w:styleId="heading"') + 500);
  expect(heading).toContain('w:val="44"');
  expect(heading).toContain("<w:b");
  const note = xml.slice(xml.indexOf("Note") - 500, xml.indexOf("Note") + 40);
  expect(note).toContain('w:val="32"');
  expect(stylesXml).not.toContain("Not a style");
  expect(xml).not.toContain('w:val="Not a style"');
});

it("refreshes a stale caption while exporting and leaves the open document", async () => {
  const file = createFile("doc", "Report") as DocFile;
  file.content = {
    type: "doc",
    content: [
      { type: "figureList", attrs: { kind: "figure" }, content: [] },
      {
        type: "paragraph",
        attrs: { captionId: "fig-b", captionKind: "figure" },
        content: [{ type: "text", text: "Paths" }],
      },
      {
        type: "paragraph",
        attrs: { captionTarget: "fig-a" },
        content: [{ type: "text", text: "see Figure 9" }],
      },
    ],
  } as DocFile["content"];
  const xml = await (
    await JSZip.loadAsync(await exportDocx(file))
  )
    .file("word/document.xml")!
    .async("string");
  expect(xml).toContain("Figure 1 Paths");
  expect(xml).toContain("That caption is missing. Update or remove this reference.");
  expect(xml).not.toContain("see Figure 9");
  expect(JSON.stringify(file.content)).toContain("see Figure 9");
});

it("exports a figure list that was rebuilt after a caption was removed", async () => {
  const file = createFile("doc", "Report") as DocFile;
  const refreshed = refreshCaptions({
    type: "doc",
    content: [
      { type: "figureList", attrs: { kind: "figure" }, content: [] },
      {
        type: "paragraph",
        attrs: { captionId: "fig-b", captionKind: "figure" },
        content: [{ type: "text", text: "Paths" }],
      },
      {
        type: "paragraph",
        attrs: { captionTarget: "fig-a" },
        content: [{ type: "text", text: "see Figure 1" }],
      },
    ],
  });
  file.content = refreshed as DocFile["content"];
  const xml = await (
    await JSZip.loadAsync(await exportDocx(file))
  )
    .file("word/document.xml")!
    .async("string");
  expect(xml).toContain("Figure 1 Paths");
  expect(xml).toContain("That caption is missing. Update or remove this reference.");
  expect(xml).not.toContain("fig-a is missing");
  expect(xml).not.toContain("Figure 2");
});

it("writes a figure list page when the document numbers pages", async () => {
  const file = createFile("doc", "Report") as DocFile;
  file.content = {
    type: "doc",
    attrs: { pageSettings: { pageNumbers: true, size: "letter" } },
    content: [
      { type: "figureList", attrs: { kind: "figure" }, content: [] },
      {
        type: "paragraph",
        attrs: { captionId: "fig-a", captionKind: "figure" },
        content: [{ type: "text", text: "Beds" }],
      },
      { type: "pageBreak" },
      {
        type: "paragraph",
        attrs: { captionId: "fig-b", captionKind: "figure" },
        content: [{ type: "text", text: "Paths" }],
      },
    ],
  } as DocFile["content"];
  const xml = await (
    await JSZip.loadAsync(await exportDocx(file))
  )
    .file("word/document.xml")!
    .async("string");
  expect(xml).toContain("Figure 1 Beds, 1");
  expect(xml).toContain("Figure 2 Paths, 2");
  expect(xml).not.toContain("fig-a");
  expect(xml).not.toContain("fig-b");
  expect(JSON.stringify(file.content)).not.toContain("Figure 1 Beds, 1");
});

it("writes a table list page when the document numbers pages", async () => {
  const file = createFile("doc", "Report") as DocFile;
  file.content = {
    type: "doc",
    attrs: { pageSettings: { pageNumbers: true, size: "letter" } },
    content: [
      { type: "figureList", attrs: { kind: "table" }, content: [] },
      {
        type: "paragraph",
        attrs: { captionId: "secret-value", captionKind: "table" },
        content: [{ type: "text", text: "Harvest" }],
      },
      { type: "pageBreak" },
      {
        type: "paragraph",
        attrs: { captionId: "tab-b", captionKind: "table" },
        content: [{ type: "text", text: "Paths" }],
      },
    ],
  } as DocFile["content"];
  const xml = await (
    await JSZip.loadAsync(await exportDocx(file))
  )
    .file("word/document.xml")!
    .async("string");
  expect(xml).toContain("Table 1 Harvest, 1");
  expect(xml).toContain("Table 2 Paths, 2");
  expect(xml).not.toContain("secret-value");
  expect(xml).not.toContain("tab-b");
});

it("leaves figure pages off when page numbers are turned off", () => {
  const source = {
    type: "doc",
    attrs: { pageSettings: { pageNumbers: false, size: "letter" } },
    content: [
      {
        type: "paragraph",
        attrs: { captionId: "secret-value", captionKind: "figure" },
        content: [{ type: "text", text: "Beds" }],
      },
    ],
  };
  expect(captionPagesForExport(source)).toBeUndefined();
});
