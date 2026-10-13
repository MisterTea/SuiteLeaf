import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import JSZip from "jszip";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  breakPosBeforeList,
  keepWithNextBreak,
  markKeepNextLine,
  staysWithFollowingBlock,
} from "../apps/web/src/editors/doc-keep-next";
import { createFile } from "../packages/core/src";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*" },
    bulletList: { group: "block", content: "listItem+" },
    listItem: { content: "paragraph block*" },
  },
});

describe("keep with next", () => {
  it("keeps a heading with the next paragraph, and with a list only when asked", () => {
    expect(staysWithFollowingBlock({ type: "heading" }, "paragraph")).toBe(true);
    expect(staysWithFollowingBlock({ type: "heading" }, "heading")).toBe(true);
    expect(staysWithFollowingBlock({ type: "heading" }, "bulletList")).toBe(false);
    expect(staysWithFollowingBlock({ type: "heading" }, "orderedList")).toBe(false);
    expect(staysWithFollowingBlock({ type: "heading", keepNext: true }, "bulletList")).toBe(
      true,
    );
    expect(staysWithFollowingBlock({ type: "paragraph" }, "paragraph")).toBe(false);
    expect(staysWithFollowingBlock({ type: "paragraph", keepNext: true }, "paragraph")).toBe(
      true,
    );
  });

  it("puts a page break in front of a list instead of inside its first item", () => {
    const tree = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "heading", content: [{ type: "text", text: "This week" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Seed" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Prune" }] }],
            },
          ],
        },
      ],
    });
    let list = -1;
    let first = -1;
    let second = -1;
    tree.descendants((node, pos) => {
      if (node.type.name === "bulletList") list = pos;
      if (!node.isTextblock) return;
      if (node.textContent === "Seed") first = pos;
      if (node.textContent === "Prune") second = pos;
    });
    expect(breakPosBeforeList(tree, first)).toBe(list);
    expect(breakPosBeforeList(tree, second)).toBeNull();
  });

  it("pulls only paragraphs that asked to stay with the next one", () => {
    const kept = [
      { top: 800, keepNext: true },
      { top: 860, keepNext: true },
      { top: 920 },
    ];
    expect(keepWithNextBreak(kept, 2, 0, 0)).toBe(0);
    const stranded = [{ top: 800 }, { top: 920 }];
    expect(keepWithNextBreak(stranded, 1, 0, 0)).toBe(1);
    const manual = [
      { top: 800, keepNext: true },
      { top: 920, manual: true },
    ];
    expect(keepWithNextBreak(manual, 1, 0, 0)).toBe(1);
    const alreadyAtTop = [
      { top: 0, keepNext: true },
      { top: 40 },
    ];
    expect(keepWithNextBreak(alreadyAtTop, 1, 0, 0)).toBe(1);
  });

  it("marks the last line of a tall paragraph", () => {
    const lines = [
      { top: 10, keepNext: false },
      { top: 30 },
      { top: 20 },
    ];
    markKeepNextLine(lines, true);
    expect(lines.map((line) => line.keepNext)).toEqual([false, true, undefined]);
    const plain = [{ top: 10 }];
    expect(markKeepNextLine(plain, false)[0].keepNext).toBeUndefined();
  });

  it("sets keep-with-next on the heading and not on paragraphs left off", async () => {
    const file = createFile("doc", "Garden club news");
    if (file.kind !== "doc") throw new Error();
    const paragraph = (text: string, keepNext?: boolean) => ({
      type: "paragraph",
      attrs: keepNext ? { keepNext: true } : undefined,
      content: [{ type: "text", text }],
    });
    file.content = {
      type: "doc",
      content: [
        paragraph("The beds along the fence are ready for winter."),
        {
          type: "heading",
          attrs: { level: 2, keepNext: true },
          content: [{ type: "text", text: "This week" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [paragraph("Seed swap on Saturday")],
            },
          ],
        },
        paragraph("Meet at the gate."),
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const doc = await zip.file("word/document.xml")!.async("string");
    const paras = [...doc.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(
      (match) => match[0],
    );
    const heading = paras.find((para) => para.includes("This week"));
    const lead = paras.find((para) => para.includes("ready for winter"));
    const item = paras.find((para) => para.includes("Seed swap"));
    const close = paras.find((para) => para.includes("Meet at the gate"));
    expect(heading).toContain("<w:keepNext");
    expect(heading).not.toContain('w:val="false"');
    expect(lead).not.toContain("<w:keepNext");
    expect(item).not.toContain("<w:keepNext");
    expect(close).not.toContain("<w:keepNext");
  });
});
