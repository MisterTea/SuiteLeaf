import { expect, it } from "vitest";
import { createFile, type DocFile } from "../packages/core/src";
import { refreshReport } from "../packages/core/src/doc-contents";
import { exportDocx } from "../packages/core/src/docx-export";
import { refreshHeadingRefs } from "../packages/core/src/doc-styles";
import JSZip from "jszip";

it("points a reference at the heading and does not repeat a missing id", () => {
  const doc = {
    content: [
      { type: "heading", attrs: { id: "paths" }, content: [{ type: "text", text: "Paths" }] },
      { type: "heading", attrs: { id: "blank" }, content: [{ type: "text", text: "  " }] },
      {
        type: "paragraph",
        attrs: { headingTarget: "paths" },
        content: [{ type: "text", text: "see" }],
      },
      {
        type: "paragraph",
        attrs: { headingTarget: "secret-value" },
        content: [{ type: "text", text: "gone" }],
      },
      {
        type: "paragraph",
        attrs: { headingTarget: "blank" },
        content: [{ type: "text", text: "empty" }],
      },
    ],
  };
  const next = refreshHeadingRefs(doc);
  expect(next.content?.[2].content?.[0].text).toBe("Paths");
  expect(next.content?.[3].content?.[0].text).toBe(
    "That heading is missing. Update or remove this reference.",
  );
  expect(next.content?.[3].content?.[0].text).not.toContain("secret-value");
  expect(next.content?.[4].content?.[0].text).toBe("That heading has no title.");
  expect(doc.content[2].content?.[0].text).toBe("see");
  expect(doc.content[0].content?.[0].text).toBe("Paths");
});

it("treats a heading that is only an invisible character as having no title", () => {
  const doc = {
    content: [
      { type: "heading", attrs: { id: "hidden" }, content: [{ type: "text", text: "\u200b" }] },
      { type: "heading", attrs: { id: "beds" }, content: [{ type: "text", text: "\u200bBeds" }] },
      { type: "heading", attrs: { id: "kept" }, content: [{ type: "text", text: "Be\u200bds" }] },
      { type: "paragraph", attrs: { headingTarget: "hidden" }, content: [{ type: "text", text: "see" }] },
      { type: "paragraph", attrs: { headingTarget: "beds" }, content: [{ type: "text", text: "see" }] },
      { type: "paragraph", attrs: { headingTarget: "kept" }, content: [{ type: "text", text: "see" }] },
    ],
  };
  const before = JSON.stringify(doc);
  const next = refreshHeadingRefs(doc);
  expect(next.content?.[3].content?.[0].text).toBe("That heading has no title.");
  expect(next.content?.[4].content?.[0].text).toBe("Beds");
  expect(next.content?.[5].content?.[0].text).toBe("Be\u200bds");
  expect(JSON.stringify(doc)).toBe(before);
});

it("leaves a heading inside a note out of a heading reference", () => {
  const doc = {
    content: [
      { type: "heading", attrs: { id: "paths" }, content: [{ type: "text", text: "Paths" }] },
      {
        type: "note",
        content: [
          { type: "heading", attrs: { id: "beds" }, content: [{ type: "text", text: "secret-value" }] },
          {
            type: "paragraph",
            attrs: { headingTarget: "paths" },
            content: [{ type: "text", text: "see" }],
          },
          {
            type: "paragraph",
            attrs: { headingTarget: "beds" },
            content: [{ type: "text", text: "also" }],
          },
        ],
      },
    ],
  };
  const next = refreshHeadingRefs(doc);
  const note = next.content?.[1];
  expect(note?.content?.[0].content?.[0].text).toBe("secret-value");
  expect(note?.content?.[1].content?.[0].text).toBe("Paths");
  expect(note?.content?.[2].content?.[0].text).toBe(
    "That heading is missing. Update or remove this reference.",
  );
  expect(JSON.stringify(note?.content?.[2])).not.toContain("secret-value");
  expect(doc.content[1].content?.[0].content?.[0].text).toBe("secret-value");
  expect(doc.content[1].content?.[2].content?.[0].text).toBe("also");
});

it("updates a heading reference when the report fields are rebuilt", () => {
  const doc = {
    content: [
      { type: "tableOfContents", attrs: { maxLevel: 3 }, content: [] },
      {
        type: "heading",
        attrs: { id: "paths", level: 1 },
        content: [{ type: "text", text: "Paths" }],
      },
      {
        type: "paragraph",
        attrs: { headingTarget: "paths" },
        content: [{ type: "text", text: "see" }],
      },
      {
        type: "paragraph",
        attrs: { headingTarget: "secret-value" },
        content: [{ type: "text", text: "gone" }],
      },
    ],
  };
  const next = refreshReport(doc);
  expect(next.content?.[0].content?.[0].content?.[0].text).toBe("Section 1: Paths");
  expect(next.content?.[2].content?.[0].text).toBe("Paths");
  expect(next.content?.[3].content?.[0].text).toBe(
    "That heading is missing. Update or remove this reference.",
  );
  expect(next.content?.[3].content?.[0].text).not.toContain("secret-value");
  expect(doc.content[2].content[0].text).toBe("see");
});

it("updates a heading reference while writing the Word file", async () => {
  const doc = {
    content: [
      {
        type: "heading",
        attrs: { id: "paths", level: 1 },
        content: [{ type: "text", text: "Paths" }],
      },
      {
        type: "paragraph",
        attrs: { headingTarget: "paths" },
        content: [{ type: "text", text: "see" }],
      },
      {
        type: "paragraph",
        attrs: { headingTarget: "secret-value" },
        content: [{ type: "text", text: "gone" }],
      },
    ],
  };
  const file = createFile("doc", "Report") as DocFile;
  file.content = doc as DocFile["content"];
  const xml = await JSZip.loadAsync(await exportDocx(file)).then((zip) =>
    zip.file("word/document.xml")!.async("string"),
  );
  expect(xml).toContain("Paths");
  expect(xml).toContain("That heading is missing. Update or remove this reference.");
  expect(xml).not.toContain("secret-value");
  expect(doc.content[1].content[0].text).toBe("see");
});
