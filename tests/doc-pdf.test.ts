import { describe, expect, it } from "vitest";
import type { JsonNode } from "../packages/core/src";
import { documentPdf, documentPdfLines } from "../packages/core/src/doc-pdf";

const doc: JsonNode = {
  type: "doc",
  attrs: {
    citationStyle: "apa",
    citationSources: [
      {
        id: "rosa",
        tag: "Gar20",
        guid: "{44444444-4444-4444-4444-444444444444}",
        kind: "article",
        author: "Rosa Garcia",
        title: "North beds",
        year: "2020",
        page: "",
      },
    ],
  },
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Beds (north)" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "See " },
        { type: "citation", attrs: { sourceId: "rosa" } },
      ],
    },
    { type: "image", attrs: { alt: "North beds" } },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Crop" }] }],
            },
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Tomato" }] }],
            },
          ],
        },
      ],
    },
  ],
};

describe("document text PDF", () => {
  it("writes the heading, citation, image description, and table in order", () => {
    expect(documentPdfLines(doc)).toEqual([
      "Beds (north)",
      "See (Rosa Garcia, 2020)",
      "North beds",
      "Crop",
      "Tomato",
    ]);
    const text = new TextDecoder().decode(documentPdf(doc));
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("(Beds \\(north\\))");
    expect(text).toContain("(See \\(Rosa Garcia, 2020\\))");
    expect(text).toContain("(North beds)");
    expect(text).toContain("(Crop)");
    expect(text).toContain("(Tomato)");
    expect(text).toContain("/StructTreeRoot");
    expect(text).toContain("/MarkInfo << /Marked true >>");
    expect(text).toContain("/S /H1");
    expect(text).toContain("/S /P");
    expect(text).toContain("/S /Figure");
    expect(text).toContain("/S /Table");
    expect(text).toContain("/S /TR");
    expect(text).toContain("/S /TH");
    expect(text).toContain("/S /TD");
  });

  it("rebuilds a stale index before writing the PDF", () => {
    const stale: JsonNode = {
      type: "doc",
      content: [
        {
          type: "index",
          content: [{ type: "paragraph", content: [{ type: "text", text: "secret-value" }] }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Beds are north",
              marks: [{ type: "index", attrs: { term: "Tomato" } }],
            },
          ],
        },
      ],
    };
    expect(documentPdfLines(stale)).toEqual(["Tomato, section 1", "Beds are north"]);
    expect(new TextDecoder().decode(documentPdf(stale))).not.toContain("secret-value");
    expect(JSON.stringify(stale)).toContain("secret-value");
  });
});
