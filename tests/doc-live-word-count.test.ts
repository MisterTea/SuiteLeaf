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
  formatLiveCount,
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

  it("shows words, characters, and characters without spaces for the sentence", () => {
    const sentence: JsonNode = {
      type: "doc",
      content: [paragraph("Apples were four dollars.")],
    };
    const withBlank = minutes(false);
    const alone = countDocument(sentence, settings);
    const counted = countDocument(withBlank, settings);
    expect(alone).toMatchObject({ words: 4, characters: 25, charactersWithoutSpaces: 22 });
    expect(counted).toMatchObject({ words: 4, characters: 25, charactersWithoutSpaces: 22 });
    expect(
      formatLiveCount({
        totalWords: counted.words,
        totalCharacters: counted.characters,
        totalWithoutSpaces: counted.charactersWithoutSpaces,
        selectionWords: null,
        selectionCharacters: null,
        excludes: [],
      }),
    ).toBe("4 words, 25 characters, and 22 without spaces");
    expect(
      formatLiveCount({
        totalWords: 0,
        totalCharacters: 0,
        totalWithoutSpaces: 0,
        selectionWords: null,
        selectionCharacters: null,
        excludes: [],
      }),
    ).toBe("0 words, 0 characters, and 0 without spaces");

    const doc = prose.nodeFromJSON(sentence);
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
    expect(selected?.stats.characters).toBe(12);
    expect(
      formatLiveCount({
        totalWords: 4,
        totalCharacters: 25,
        totalWithoutSpaces: 22,
        selectionWords: selected?.stats.words ?? null,
        selectionCharacters: selected?.stats.characters ?? null,
        excludes: [],
      }),
    ).toBe("2 of 4 words and 12 of 25 characters");
    expect(selectionSnapshot(doc, from, from, null)).toBeNull();
    expect(
      formatLiveCount({
        totalWords: 4,
        totalCharacters: 25,
        totalWithoutSpaces: 22,
        selectionWords: null,
        selectionCharacters: null,
        excludes: [],
      }),
    ).toBe("4 words, 25 characters, and 22 without spaces");
  });

  it("counts spaces inside a table cell and leaves the label out of Word", async () => {
    const doc: JsonNode = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [row([cell("tableCell", "four dollars")])],
        },
      ],
    };
    expect(countDocument(doc, settings)).toMatchObject({
      words: 2,
      characters: 12,
      charactersWithoutSpaces: 11,
    });

    const file = createFile("doc", "Market minutes");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      content: [paragraph("Apples were four dollars.")],
    };
    const stored = JSON.stringify(file.content);
    expect(stored).toContain("Apples were four dollars.");
    expect(stored).not.toContain("25 characters");
    expect(stored).not.toContain("22 without spaces");
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("Apples were four dollars.");
    expect(xml).not.toContain("25 characters");
    expect(xml).not.toContain("22 without spaces");
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
