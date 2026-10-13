import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import { tabGapPx } from "../apps/web/src/editors/doc-tab-stops";

describe("tab stops", () => {
  it("lands every line on the same stop, and a different stop stays on its own line", () => {
    const column = (at: number, inches: number) => at + tabGapPx(at, inches, 0);
    expect(column(80, 3)).toBe(288);
    expect(column(40, 3)).toBe(288);
    expect(column(96, 3)).toBe(288);
    expect(column(40, 4)).toBe(384);
    expect(column(40, 4) - column(80, 3)).toBe(96);
  });

  it("writes each paragraph's left tab stop into the docx", async () => {
    const file = createFile("doc", "Saturday agenda");
    if (file.kind !== "doc") throw new Error("expected a document");
    const line = (name: string, time: string, inches: number) => ({
      type: "paragraph",
      attrs: { tabStop: inches },
      content: [
        { type: "text", text: `${name} ` },
        { type: "tab" },
        { type: "text", text: time },
      ],
    });
    file.content = {
      type: "doc",
      content: [
        line("Plant sale", "9:00", 3),
        line("Compost", "10:30", 3),
        line("Officers", "11:00", 4),
        { type: "paragraph", content: [{ type: "text", text: "Notes" }] },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(
      (match) => match[0],
    );
    const stop = (paragraph: string) => {
      const found = /<w:tab\b[^>]*w:pos="(\d+)"[^>]*w:val="left"|<w:tab\b[^>]*w:val="left"[^>]*w:pos="(\d+)"/.exec(
        paragraph,
      );
      return found ? Number(found[1] ?? found[2]) : null;
    };
    const agenda = paragraphs.filter((paragraph) => /9:00|10:30|11:00/.test(paragraph));
    expect(agenda.map(stop)).toEqual([3 * 1440, 3 * 1440, 4 * 1440]);
    for (const paragraph of agenda) expect(paragraph).toContain("<w:tab/>");
    const notes = paragraphs.find((paragraph) => paragraph.includes("Notes"));
    expect(notes).toBeTruthy();
    expect(stop(notes!)).toBeNull();
    expect(notes).not.toContain("<w:tab/>");
  });
});