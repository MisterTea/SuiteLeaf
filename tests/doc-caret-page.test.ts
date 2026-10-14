import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { Schema } from "@tiptap/pm/model";
import { createFile } from "@suiteleaf/core";
import type { JsonNode } from "@suiteleaf/core";
import { exportDocx } from "@suiteleaf/core/docx-export";
import {
  formatCaretPage,
  pageAtPosition,
  pageStartsFromMarks,
} from "../apps/web/src/editors/doc-caret-page";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    pageBreak: { group: "block", atom: true },
    text: {},
  },
});

const minutes: JsonNode = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Apples were four dollars." }],
    },
    { type: "pageBreak" },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Pears were ten." }],
    },
  ],
};

describe("caret page", () => {
  it("follows the caret's position on the pages pagination already assigned", () => {
    const doc = schema.nodeFromJSON(minutes);
    let apples = -1;
    let pears = -1;
    let breakPos = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === "pageBreak") breakPos = pos;
      if (node.isText && node.text?.startsWith("Apples")) apples = pos;
      if (node.isText && node.text?.startsWith("Pears")) pears = pos;
    });
    expect(apples).toBeGreaterThanOrEqual(0);
    expect(pears).toBeGreaterThan(breakPos);

    // The pagination pass puts the page break, and everything after it, on page 2.
    const starts = pageStartsFromMarks([
      { pos: 0, page: 0 },
      { pos: apples, page: 0 },
      { pos: breakPos, page: 1 },
      { pos: pears, page: 1 },
    ]);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBe(breakPos);

    expect(pageAtPosition(apples, [0])).toBe(1);
    expect(formatCaretPage(pageAtPosition(apples, [0]), 1)).toBe("Page 1 of 1");

    expect(pageAtPosition(pears, starts)).toBe(2);
    expect(formatCaretPage(2, 2)).toBe("Page 2 of 2");

    // The same page starts still report page 1 when the caret moves back.
    // Scroll position is not an input.
    expect(pageAtPosition(apples, starts)).toBe(1);
    expect(formatCaretPage(pageAtPosition(apples, starts), 2)).toBe("Page 1 of 2");
  });

  it("keeps the status label out of the Word export", async () => {
    const file = createFile("doc", "Market minutes");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = minutes;
    expect(JSON.stringify(file.content)).not.toContain("Page 2 of 2");
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("Apples were four dollars.");
    expect(xml).toContain("Pears were ten.");
    expect(xml).toContain("<w:pageBreakBefore");
    expect(xml).not.toContain("Page 2 of 2");
    expect(xml).not.toContain("Page 1 of 2");
  });
});
