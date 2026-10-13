import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  annotateWidowLines,
  avoidSingleLine,
  type WidowBoundary,
} from "../apps/web/src/editors/doc-widow-control";

function paragraphLines(
  count: number,
  top: number,
  widow = true,
): WidowBoundary[] {
  return annotateWidowLines(
    Array.from({ length: count }, (_, line) => ({ top: top + line * 20 })),
    5,
    widow,
  );
}

describe("don't leave one line", () => {
  it("pulls the previous line when the last line would sit alone", () => {
    const boundaries: WidowBoundary[] = [
      { top: 760 },
      ...paragraphLines(5, 800),
    ];
    expect(avoidSingleLine(boundaries, 5, 0, 0)).toBe(4);
    expect(boundaries[4].line).toBe(3);
    expect(boundaries[5].line).toBe(4);
  });

  it("moves a single opening line onto the next page with the rest", () => {
    const boundaries = paragraphLines(4, 860);
    expect(avoidSingleLine(boundaries, 1, 0, 0)).toBe(0);
  });

  it("keeps a three-line paragraph together when any split would leave one line", () => {
    const boundaries = paragraphLines(3, 800);
    expect(avoidSingleLine(boundaries, 2, 0, 0)).toBe(0);
  });

  it("leaves the break where it is when the control is off", () => {
    const boundaries = paragraphLines(5, 800, false);
    expect(avoidSingleLine(boundaries, 4, 0, 0)).toBe(4);
  });

  it("does not pull a heading that stays with the next block", () => {
    const boundaries: WidowBoundary[] = [
      { top: 780 },
      ...paragraphLines(2, 820),
    ];
    expect(avoidSingleLine(boundaries, 2, 0, 0)).toBe(1);
  });

  it("does not pull a line that already sits on the previous page", () => {
    const boundaries = paragraphLines(4, 0);
    boundaries[0].top = 0;
    boundaries[1].top = 20;
    boundaries[2].top = 900;
    boundaries[3].top = 920;
    expect(avoidSingleLine(boundaries, 3, 880, 0)).toBe(2);
  });

  it("sets widow and orphan control on that paragraph only", async () => {
    const file = createFile("doc", "Garden club news");
    if (file.kind !== "doc") throw new Error();
    const paragraph = (text: string, widowControl?: boolean) => ({
      type: "paragraph",
      attrs: widowControl ? { widowControl: true } : undefined,
      content: [{ type: "text", text }],
    });
    file.content = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "This month" }],
        },
        paragraph("See you Saturday.", true),
        paragraph("The board meets Monday."),
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const doc = await zip.file("word/document.xml")!.async("string");
    const paras = [...doc.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(
      (match) => match[0],
    );
    const closing = paras.find((para) => para.includes("See you Saturday"));
    const heading = paras.find((para) => para.includes("This month"));
    const later = paras.find((para) => para.includes("The board meets Monday"));
    expect(closing).toContain("<w:widowControl");
    expect(closing).not.toContain('w:val="false"');
    expect(heading).not.toContain("<w:widowControl");
    expect(later).not.toContain("<w:widowControl");
  });
});
