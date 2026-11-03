import { expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, type DocFile } from "../packages/core/src";
import { headingPagesForExport } from "../packages/core/src/caption-pages";
import { refreshContents, refreshReport } from "../packages/core/src/doc-contents";
import { exportDocx } from "../packages/core/src/docx-export";

const report = {
  type: "doc",
  content: [
    { type: "tableOfContents", attrs: { maxLevel: 3 }, content: [] },
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Beds" }] },
    { type: "sectionBreak" },
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Paths" }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Detail" }] },
    { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Skip" }] },
  ],
};

it("leaves a heading that is only an invisible character out of the contents", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "tableOfContents", attrs: { maxLevel: 3 }, content: [] as { content?: { text?: string }[] }[] },
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "\u200b" }] },
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "\u200bBeds" }] },
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Be\u200bds" }] },
    ],
  };
  const before = JSON.stringify(doc);
  const refreshed = refreshContents(doc);
  expect(refreshed.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text)).toEqual([
    "Section 1: Beds",
    "Section 1: Be\u200bds",
  ]);
  expect(JSON.stringify(doc)).toBe(before);
});

it("rebuilds a contents list from the headings in each section", async () => {
  const refreshed = refreshContents(report);
  const lines = refreshed.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text);
  expect(lines).toEqual(["Section 1: Beds", "Section 2: Paths", "Section 2: Detail"]);
  expect(report.content[0].content).toEqual([]);

  const withoutBeds = {
    ...report,
    content: report.content.filter((node) => node.type !== "heading" || node.content?.[0].text !== "Beds"),
  };
  const again = refreshContents(withoutBeds);
  expect(again.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text)).toEqual([
    "Section 2: Paths",
    "Section 2: Detail",
  ]);

  const file = createFile("doc", "Report") as DocFile;
  file.content = refreshed as DocFile["content"];
  const xml = await (
    await JSZip.loadAsync(await exportDocx(file))
  )
    .file("word/document.xml")!
    .async("string");
  expect(xml.indexOf("Section 1: Beds")).toBeGreaterThan(-1);
  expect(xml.indexOf("Section 1: Beds")).toBeLessThan(xml.indexOf("Section 2: Paths"));
  expect(xml.indexOf("Section 2: Paths")).toBeLessThan(xml.indexOf("Section 2: Detail"));
  expect(xml).not.toContain("Section 2: Skip");
  expect(xml).toMatch(/<w:instrText[^>]*>[^<]*TOC/);
});

const multi = {
  type: "doc",
  content: [
    { type: "tableOfContents", attrs: { maxLevel: 3 }, content: [] },
    { type: "figureList", attrs: { kind: "figure" }, content: [] },
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Beds" }] },
    {
      type: "paragraph",
      attrs: { captionId: "fig-a", captionKind: "figure" },
      content: [{ type: "text", text: "Beds" }],
    },
    { type: "sectionBreak" },
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Paths" }] },
    {
      type: "paragraph",
      attrs: { captionId: "fig-b", captionKind: "figure" },
      content: [{ type: "text", text: "Paths" }],
    },
    {
      type: "paragraph",
      attrs: { captionTarget: "fig-a" },
      content: [{ type: "text", text: "see later" }],
    },
  ],
};

it("numbers figures by section and exports the contents with the file properties", async () => {
  const refreshed = refreshReport(multi);
  const contents = refreshed.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text);
  const figures = refreshed.content?.[1].content?.map((paragraph) => paragraph.content?.[0].text);
  expect(contents).toEqual(["Section 1: Beds", "Section 2: Paths"]);
  expect(figures).toEqual(["Figure 1.1 Beds", "Figure 2.1 Paths"]);
  expect(refreshed.content?.[7].content?.[0].text).toBe("Figure 1.1");
  expect(multi.content[1].content).toEqual([]);

  const withoutBeds = {
    ...multi,
    content: multi.content.filter(
      (node) => node.attrs?.captionId !== "fig-a" && node.content?.[0]?.text !== "Beds",
    ),
  };
  const again = refreshReport(withoutBeds);
  expect(again.content?.[1].content?.map((paragraph) => paragraph.content?.[0].text)).toEqual([
    "Figure 2.1 Paths",
  ]);
  const reference = again.content?.find((node) => node.attrs?.captionTarget === "fig-a");
  expect(reference?.content?.[0].text).toBe(
    "That caption is missing. Update or remove this reference.",
  );
  expect(reference?.content?.[0].text).not.toContain("fig-a");

  const file = createFile("doc", "Report") as DocFile;
  file.properties = { author: "Ada", subject: "Beds", keywords: ["north"] };
  file.content = refreshed as DocFile["content"];
  const zip = await JSZip.loadAsync(await exportDocx(file));
  const xml = await zip.file("word/document.xml")!.async("string");
  const core = await zip.file("docProps/core.xml")!.async("string");
  expect(xml).toContain("Section 1: Beds");
  expect(xml).toContain("Figure 1.1 Beds");
  expect(xml).toContain("Figure 2.1 Paths");
  expect(xml.indexOf("Figure 1.1 Beds")).toBeLessThan(xml.indexOf("Figure 2.1 Paths"));
  expect(core).toContain("Ada");
  expect(core).toContain("north");
});

it("writes a contents page when the heading has one", () => {
  const doc = {
    type: "doc",
    attrs: { pageSettings: { pageNumbers: true, size: "letter" } },
    content: [
      { type: "tableOfContents", attrs: { maxLevel: 3 }, content: [] },
      {
        type: "heading",
        attrs: { id: "secret-value", level: 1 },
        content: [{ type: "text", text: "Beds" }],
      },
      { type: "pageBreak" },
      {
        type: "heading",
        attrs: { id: "paths", level: 1 },
        content: [{ type: "text", text: "Paths" }],
      },
    ],
  };
  const pages = headingPagesForExport(doc);
  const refreshed = refreshContents(doc, pages);
  const lines = refreshed.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text);
  expect(lines).toEqual(["Section 1: Beds, 1", "Section 1: Paths, 2"]);
  expect(JSON.stringify(lines)).not.toContain("secret-value");
  expect(doc.content[0].content).toEqual([]);
  expect(headingPagesForExport({ ...doc, attrs: { pageSettings: { pageNumbers: false } } })).toBeUndefined();
});

it("leaves a heading inside a note out of the contents", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "tableOfContents", attrs: { maxLevel: 3 }, content: [] as { content?: { text?: string }[] }[] },
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Beds" }] },
      {
        type: "note",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "secret-value" }] },
        ],
      },
    ],
  };
  const refreshed = refreshContents(doc);
  expect(refreshed.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text)).toEqual([
    "Section 1: Beds",
  ]);
  expect(JSON.stringify(refreshed.content?.[0])).not.toContain("secret-value");
  expect(doc.content[2].content?.[0].content?.[0].text).toBe("secret-value");
});

it("restarts a contents page at the section break", () => {
  const doc = {
    type: "doc",
    attrs: { pageSettings: { pageNumbers: true, size: "letter" } },
    content: [
      { type: "tableOfContents", attrs: { maxLevel: 3 }, content: [] as { content?: { text?: string }[] }[] },
      { type: "heading", attrs: { id: "beds", level: 1 }, content: [{ type: "text", text: "Beds" }] },
      { type: "sectionBreak", attrs: { restartAt: 5 } },
      { type: "heading", attrs: { id: "paths", level: 1 }, content: [{ type: "text", text: "Paths" }] },
    ],
  };
  const pages = headingPagesForExport(doc);
  const refreshed = refreshContents(doc, pages);
  expect(refreshed.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text)).toEqual([
    "Section 1: Beds, 1",
    "Section 2: Paths, 5",
  ]);
  const continued = headingPagesForExport({
    ...doc,
    content: [
      doc.content[1],
      { type: "sectionBreak", attrs: { restartAt: "secret-value" } },
      doc.content[3],
    ],
  });
  expect(continued).toEqual({ beds: 1, paths: 2 });
  expect(JSON.stringify(continued)).not.toContain("secret-value");
  expect(doc.content[2].attrs.restartAt).toBe(5);
});
