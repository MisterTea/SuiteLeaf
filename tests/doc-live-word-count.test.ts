import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { Schema } from "@tiptap/pm/model";
import { createFile } from "@suiteleaf/core";
import type { JsonNode } from "@suiteleaf/core";
import { exportDocx } from "@suiteleaf/core/docx-export";
import { searchCommands } from "../apps/web/src/commands";
import {
  countDocument,
  defaultProofing,
  formatWordCount,
  selectionSnapshot,
} from "../apps/web/src/editors/doc-word-count";

const settings = { ...defaultProofing, ignored: [], ignoredGrammar: [] };

function paragraph(text = ""): JsonNode {
  return {
    type: "paragraph",
    content: text ? [{ type: "text", text }] : [],
  };
}

function cell(type: "tableCell" | "tableHeader", text: string): JsonNode {
  return { type, content: [paragraph(text)] };
}

function row(cells: JsonNode[]): JsonNode {
  return { type: "tableRow", content: cells };
}

/** A word is a run of non-whitespace characters. */
function minutes(withSecondSentence: boolean): JsonNode {
  return {
    type: "doc",
    content: [
      paragraph("Apples were four dollars."),
      paragraph(),
      ...(withSecondSentence ? [paragraph("Pears were ten.")] : []),
    ],
  };
}

const prose = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: {},
  },
});

describe("live word count", () => {
  it("counts an empty document as 0 words", () => {
    expect(
      countDocument(
        { type: "doc", content: [paragraph()] },
        settings,
      ).words,
    ).toBe(0);
    expect(
      formatWordCount({ totalWords: 0, selectionWords: null, excludes: [] }),
    ).toBe("0 words");
  });

  it("counts each non-whitespace run, including a number, and skips empty paragraphs", () => {
    expect(countDocument(minutes(false), settings).words).toBe(4);
    const both = minutes(true);
    expect(countDocument(both, settings).words).toBe(7);
    expect(
      countDocument({ type: "doc", content: [paragraph("10")] }, settings).words,
    ).toBe(1);
  });

  it("says how many of the document's words are selected", () => {
    const json = minutes(true);
    const doc = prose.nodeFromJSON(json);
    let from = 0;
    let to = 0;
    doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return;
      const at = node.text.indexOf("four dollars");
      if (at < 0) return;
      from = pos + at;
      to = from + "four dollars".length;
    });
    const selected = selectionSnapshot(doc, from, to, null);
    expect(selected?.stats.words).toBe(2);
    expect(
      formatWordCount({
        totalWords: countDocument(json, settings).words,
        selectionWords: selected?.stats.words ?? null,
        excludes: [],
      }),
    ).toBe("2 of 7 words");
    expect(selectionSnapshot(doc, from, from, null)).toBeNull();
    expect(
      formatWordCount({
        totalWords: 7,
        selectionWords: null,
        excludes: [],
      }),
    ).toBe("7 words");
  });

  it("counts words in a table header and in a table body", () => {
    const doc: JsonNode = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            row([cell("tableHeader", "Fruit"), cell("tableHeader", "Price")]),
            row([cell("tableCell", "Pears"), cell("tableCell", "10")]),
          ],
        },
      ],
    };
    expect(countDocument(doc, settings).words).toBe(4);
  });

  it("keeps the count out of the document and the Word export", async () => {
    const file = createFile("doc", "Market minutes");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = minutes(true);
    expect(JSON.stringify(file.content)).not.toContain("7 words");
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("Apples were four dollars.");
    expect(xml).toContain("Pears were ten.");
    expect(xml).not.toContain("7 words");
  });

  it("does not say SuiteLeaf lacks word count", () => {
    const [missing] = searchCommands([], "word count");
    expect(missing?.disabledReason ?? "").not.toMatch(/doesn't have word count/);
    const [live] = searchCommands(
      [
        {
          id: "Tools/Word count",
          label: "Word count",
          path: ["Tools"],
          synonyms: ["word count", "count", "words"],
        },
      ],
      "count",
    );
    expect(live.label).toBe("Word count");
    expect(live.id).toBe("Tools/Word count");
    expect(live.disabledReason).toBeUndefined();
  });
});
