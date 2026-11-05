import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createFile, type DocFile, type JsonNode } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import { bookmarkName, headingBookmarks, linkedHeadingSlugs, relinkWordBookmarks, slugify } from "../packages/core/src/heading-anchors";
import { importOffice } from "../packages/core/src/office";

const text = (value: string, href?: string): JsonNode => ({
  type: "text",
  text: value,
  ...(href ? { marks: [{ type: "link", attrs: { href } }] } : {}),
});
const heading = (value: string): JsonNode => ({ type: "heading", attrs: { level: 1 }, content: [text(value)] });
const para = (...content: JsonNode[]): JsonNode => ({ type: "paragraph", content });

describe("links within a document", () => {
  it("makes slugs and Word-safe bookmark names", () => {
    expect(slugify("Planting Plan — Été!")).toBe("planting-plan-ete");
    expect(slugify("!!!")).toBe("heading");
    expect(bookmarkName("planting-plan")).toBe("h_planting_plan");
    const long = bookmarkName("a".repeat(60));
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).not.toBe(bookmarkName(`${"a".repeat(59)}b`));
  });

  it("finds bookmarks in headings only and points links at the heading", () => {
    const xml =
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:bookmarkStart w:id="0" w:name="plan"/><w:r><w:t>Planting plan</w:t></w:r></w:p>' +
      '<w:p><w:bookmarkStart w:id="1" w:name="body"/><w:r><w:t>Body</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Plain heading</w:t></w:r></w:p>';
    expect(headingBookmarks(xml)).toEqual([
      { names: ["plan"], text: "Planting plan" },
      { names: ["body"], text: "Body" },
    ]);
    expect(headingBookmarks('<w:p><w:bookmarkStart w:name="_GoBack"/><w:r><w:t>x</w:t></w:r></w:p>')).toEqual([]);
    const content: JsonNode = {
      type: "doc",
      content: [heading("Planting plan"), para(text("see", "#plan"), text("body", "#body"), text("same", "#planting-plan"), text("web", "https://x"))],
    };
    expect(relinkWordBookmarks(content, xml)).toEqual({ relinked: 1, unresolved: 1 });
    expect(content.content![1]!.content!.map((n) => n.marks?.[0]?.attrs?.href)).toEqual(["#planting-plan", "#body", "#planting-plan", "https://x"]);
    expect([...linkedHeadingSlugs(content)]).toEqual(["planting-plan"]);
  });

  it("exports a heading bookmark and an internal link that come back as the same link", async () => {
    const file = createFile("doc") as DocFile;
    file.content = { type: "doc", content: [heading("Planting plan"), heading("Planting plan"), para(text("the plan", "#planting-plan"))] };
    const bytes = await exportDocx(file);
    const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
    expect(xml.match(/<w:bookmarkStart\b[^>]*w:name="h_planting_plan"/g)).toHaveLength(1);
    expect(xml).toMatch(/<w:hyperlink\b[^>]*w:anchor="h_planting_plan"/);
    const back = (await importOffice(bytes, "docx", "links.docx")).file.content as JsonNode;
    const link = JSON.stringify(back).match(/"href":"(#[^"]+)"/)?.[1];
    expect(link).toBe("#planting-plan");
  });
});
