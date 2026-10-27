import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importOffice } from "@suiteleaf/core/office";
import type { JsonNode } from "@suiteleaf/core";
import {
  countDocument,
  countPlainText,
  formatWordCount,
  type ProofingSettings,
} from "../apps/web/src/editors/doc-word-count";
import {
  addToPersonalDictionary,
  flagWord,
  isMisspelling,
  misspelledWords,
  spellingSuggestions,
  type PersonalDictionary,
} from "../apps/web/src/editors/doc-spelling";
import {
  essayCounts,
  independenceEssayContent,
} from "../apps/web/src/editors/independence-essay";

const settings = (patch: Partial<ProofingSettings> = {}): ProofingSettings => ({
  stopAtHeading: null,
  countFootnotes: false,
  ignored: [],
  ignoredGrammar: [],
  ...patch,
});
const none: PersonalDictionary = { added: [], flagged: [] };
const paragraph = (text: string): JsonNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const heading = (text: string): JsonNode => ({
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text }],
});

describe("word count", () => {
  it("counts like Word: hyphenated words, dashes, and no paragraph marks", () => {
    expect(countPlainText("Hello world.").words).toBe(2);
    expect(countPlainText("Hello world.").characters).toBe(12);
    expect(countPlainText("Hello world.").charactersWithoutSpaces).toBe(11);
    expect(countPlainText("well-known").words).toBe(1);
    expect(countPlainText("word—count").words).toBe(2);
    expect(countPlainText("one\n\ntwo").words).toBe(2);
    expect(countPlainText("...").words).toBe(0);
  });

  it("stops at a heading and leaves footnotes out until asked", () => {
    const doc: JsonNode = {
      type: "doc",
      content: [
        heading("Introduction"),
        paragraph("Two words"),
        heading("References"),
        paragraph("Three extra words"),
        {
          type: "footnote",
          content: [paragraph("A note")],
        },
      ],
    };
    const excluded = countDocument(doc, settings({ stopAtHeading: "References" }));
    expect(excluded.words).toBe(3);
    expect(excluded.footnoteWords).toBe(2);
    expect(excluded.hasFootnotes).toBe(true);
    expect(countDocument(doc, settings({ countFootnotes: true })).words).toBe(9);
    expect(
      formatWordCount({
        totalWords: 1488,
        selectionWords: null,
        excludes: ["References"],
      }),
    ).toBe("1,488 words (excludes References)");
    expect(
      formatWordCount({
        totalWords: 1612,
        selectionWords: 318,
        excludes: [],
      }),
    ).toBe("318 of 1,612 words");
  });

  it("counts the independence essay the way the storyboard describes", () => {
    const doc = independenceEssayContent();
    const all = countDocument(doc, settings());
    expect(all.words).toBe(essayCounts.total);
    expect(all.headings).toEqual(["Introduction", "The struggle", "References"]);
    const counted = countDocument(
      doc,
      settings({ stopAtHeading: essayCounts.referencesHeading }),
    );
    expect(counted.words).toBe(essayCounts.withoutReferences);
  });

  it("matches Microsoft Word on the checked-in docx, excluding its header and footer", async () => {
    const bytes = readFileSync(new URL("./fixtures/word-count.docx", import.meta.url));
    const result = await importOffice(bytes, "docx", "word-count.docx");
    expect(result.file.kind).toBe("doc");
    if (result.file.kind !== "doc") return;
    const serialized = JSON.stringify(result.file.content);
    expect(serialized).toContain("Hello world.");
    expect(serialized).toContain("well-known");
    expect(serialized).not.toContain("Secret header");
    expect(serialized).not.toContain("Secret footer");
    const counts = countDocument(result.file.content, settings());
    // Word's dialog for this file: 7 words, 38 characters, 33 without spaces, 2 paragraphs.
    // "well-known" is one word. The header and footer are separate stories.
    expect(counts.words).toBe(7);
    expect(counts.characters).toBe(38);
    expect(counts.charactersWithoutSpaces).toBe(33);
    expect(counts.paragraphs).toBe(2);
  });
});

describe("spelling", () => {
  it("suggests the ordinary word first and flags rare typos the dictionary accepts elsewhere", () => {
    expect(spellingSuggestions("movment")[0]).toBe("movement");
    expect(spellingSuggestions("teh")[0]).toBe("the");
    expect(spellingSuggestions("recieve")[0]).toBe("receive");
    expect(spellingSuggestions("seperate")[0]).toBe("separate");
    expect(spellingSuggestions("occured")[0]).toBe("occurred");
    expect(spellingSuggestions("definately")[0]).toBe("definitely");
    expect(isMisspelling("wer", none, [])).toBe(true);
    expect(isMisspelling("were", none, [])).toBe(false);
    expect(isMisspelling("were", flagWord(none, "wer"), [])).toBe(false);
    expect(isMisspelling("were", flagWord(none, "were"), [])).toBe(true);
    expect(isMisspelling("Ghana's", none, [])).toBe(false);
    expect(isMisspelling("colonies", none, [])).toBe(false);
  });

  it("leaves the essay's names alone, clears a word after it is added, and brings an un-ignored word back", () => {
    const doc = independenceEssayContent();
    expect(misspelledWords(doc)).toEqual(["kente", "kente", "seperate", "recieve", "occured", "definately", "teh"]);
    const taught = addToPersonalDictionary(none, "kente");
    expect(misspelledWords(doc, taught)).toEqual(["seperate", "recieve", "occured", "definately", "teh"]);
    expect(misspelledWords(doc, taught, ["teh"])).toEqual(["seperate", "recieve", "occured", "definately"]);
    expect(isMisspelling("teh", taught, [])).toBe(true);
    expect(isMisspelling("kente", none, [])).toBe(true);
    expect(isMisspelling("Danquah", none, [])).toBe(false);
  });
});
