import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import type { JsonNode } from "../packages/core/src";
import { indentedStoryDocx } from "./word-indent-fixtures";

function plainText(node: JsonNode): string {
  return (node.text ?? "") + (node.content ?? []).map(plainText).join("");
}

describe("Word special indent import", () => {
  it("keeps a first-line indent, a hanging indent, and a plain paragraph", async () => {
    const { file } = await importOffice(
      await indentedStoryDocx(),
      "docx",
      "The lamps on the bridge.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const paragraphs = (file.content.content ?? []).filter(
      (node) => node.type === "paragraph",
    );
    const story = paragraphs.find((node) =>
      plainText(node).includes("old bridge"),
    );
    const plain = paragraphs.find((node) =>
      plainText(node).includes("wooden crate"),
    );
    const citation = paragraphs.find((node) =>
      plainText(node).includes("Riverside Press"),
    );
    expect(story?.attrs?.firstLineIndent).toBe(0.5);
    expect(story?.attrs?.hangingIndent).toBeUndefined();
    expect(plain?.attrs?.firstLineIndent).toBeUndefined();
    expect(plain?.attrs?.hangingIndent).toBeUndefined();
    expect(citation?.attrs?.hangingIndent).toBe(0.5);
    expect(citation?.attrs?.firstLineIndent).toBeUndefined();

    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    const exported = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(
      (match) => match[0],
    );
    const storyXml = exported.find((item) => item.includes("old bridge"));
    const plainXml = exported.find((item) => item.includes("wooden crate"));
    const citationXml = exported.find((item) =>
      item.includes("Riverside Press"),
    );
    expect(storyXml).toContain('w:firstLine="720"');
    expect(storyXml).not.toContain("w:hanging");
    expect(citationXml).toContain('w:left="720"');
    expect(citationXml).toContain('w:hanging="720"');
    expect(citationXml).not.toContain("w:firstLine");
    expect(plainXml).not.toContain("w:ind");
  });
});
