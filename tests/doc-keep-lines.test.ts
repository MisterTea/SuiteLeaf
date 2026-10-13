import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  annotateWidowLines,
  avoidSingleLine,
} from "../apps/web/src/editors/doc-widow-control";
import {
  keepParagraphTogether,
  keepsLines,
} from "../apps/web/src/editors/doc-keep-lines";

describe("keep lines together", () => {
  it("keeps a short paragraph together only when the flag is on", () => {
    expect(keepParagraphTogether(true, 80, 900)).toBe(true);
    expect(keepParagraphTogether(false, 80, 900)).toBe(false);
    expect(keepParagraphTogether(true, 1000, 900)).toBe(false);
  });

  it("is a different switch from keep with next and don't leave one line", () => {
    expect(keepsLines({ attrs: { keepLines: true } })).toBe(true);
    expect(keepsLines({ attrs: { keepNext: true } })).toBe(false);
    expect(keepsLines({ attrs: { widowControl: true } })).toBe(false);
    expect(keepsLines({ attrs: {} })).toBe(false);
    const fourLines = annotateWidowLines(
      Array.from({ length: 4 }, (_, line) => ({ top: 800 + line * 20 })),
      5,
      true,
    );
    // Two lines on each page is allowed when the rule is only "don't leave one line".
    expect(avoidSingleLine(fourLines, 2, 0, 0)).toBe(2);
    expect(keepParagraphTogether(true, 80, 900)).toBe(true);
  });

  it("sets keep-lines on that paragraph only", async () => {
    const file = createFile("doc", "Garden club news");
    if (file.kind !== "doc") throw new Error();
    const paragraph = (text: string, keepLines?: boolean) => ({
      type: "paragraph",
      attrs: keepLines ? { keepLines: true } : undefined,
      content: [{ type: "text", text }],
    });
    file.content = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "What to bring" }],
        },
        paragraph("Meet at the gate."),
        paragraph("Bring gloves, a hat, and a trowel.", true),
        paragraph("The board meets Monday."),
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const doc = await zip.file("word/document.xml")!.async("string");
    const paras = [...doc.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(
      (match) => match[0],
    );
    const reminder = paras.find((para) => para.includes("Bring gloves"));
    const heading = paras.find((para) => para.includes("What to bring"));
    const spacer = paras.find((para) => para.includes("Meet at the gate"));
    const later = paras.find((para) => para.includes("The board meets Monday"));
    expect(reminder).toContain("<w:keepLines");
    expect(reminder).not.toContain('w:val="false"');
    expect(reminder).not.toContain("<w:keepNext");
    expect(reminder).not.toContain("<w:widowControl");
    expect(heading).not.toContain("<w:keepLines");
    expect(spacer).not.toContain("<w:keepLines");
    expect(later).not.toContain("<w:keepLines");
  });
});
