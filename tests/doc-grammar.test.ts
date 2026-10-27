import { describe, expect, it } from "vitest";
import type { JsonNode } from "@suiteleaf/core";
import {
  countDocument,
  type ProofingSettings,
} from "../apps/web/src/editors/doc-word-count";
import {
  grammarIssues,
  grammarIsIgnored,
  withIgnoredGrammar,
  withoutIgnoredGrammar,
} from "../apps/web/src/editors/doc-grammar";
import { misspelledWords } from "../apps/web/src/editors/doc-spelling";
import { essayCounts, independenceEssayContent } from "../apps/web/src/editors/independence-essay";
import { grammarEssayContent } from "../apps/web/src/editors/grammar-essay";

const settings = (patch: Partial<ProofingSettings> = {}): ProofingSettings => ({
  stopAtHeading: null,
  countFootnotes: false,
  ignored: [],
  ignoredGrammar: [],
  ...patch,
});

const paragraph = (text: string): JsonNode => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("grammar", () => {
  it("flags the closed set and leaves names, possessives, and correct agreement alone", () => {
    const flagged = grammarIssues(
      paragraph("the movement were strong and its the reason they was ready"),
    );
    expect(flagged.map((issue) => [issue.text, issue.suggestion, issue.key])).toEqual([
      ["were", "was", "the movement were"],
      ["its", "it's", "its the"],
      ["was", "were", "they was"],
    ]);
    expect(flagged.every((issue) => issue.to - issue.from === issue.text.length)).toBe(true);

    expect(grammarIssues(paragraph("the movement was strong")).map((issue) => issue.text)).toEqual([]);
    expect(grammarIssues(paragraph("they were ready")).map((issue) => issue.text)).toEqual([]);
    expect(grammarIssues(paragraph("its future and its own government")).map((issue) => issue.text)).toEqual([]);
    expect(grammarIssues(paragraph("if it were true")).map((issue) => issue.text)).toEqual([]);
    expect(grammarIssues(paragraph("the people were ready")).map((issue) => issue.text)).toEqual([]);
    expect(grammarIssues(paragraph("this was the day")).map((issue) => issue.text)).toEqual([]);
    expect(grammarIssues(paragraph("Danquah was ready and Danquah were there")).map((issue) => issue.text)).toEqual([]);
    expect(grammarIssues(paragraph("Its the reason")).map((issue) => issue.suggestion)).toEqual(["It's"]);
  });

  it("stores an ignored phrase apart from ignored spellings and can bring it back", () => {
    const doc = paragraph("they was ready and they was late");
    const [issue] = grammarIssues(doc);
    const ignored = withIgnoredGrammar(settings(), issue);
    expect(ignored.ignored).toEqual([]);
    expect(ignored.ignoredGrammar).toEqual(["they was → were"]);
    expect(grammarIssues(doc, ignored.ignoredGrammar)).toEqual([]);
    expect(grammarIsIgnored(ignored.ignoredGrammar, "they was")).toBe(true);
    const restored = withoutIgnoredGrammar(ignored, "they was → were");
    expect(grammarIssues(doc, restored.ignoredGrammar)).toHaveLength(2);
  });

  it("keeps the independence essay's word count and does not mark it for grammar", () => {
    const plain = independenceEssayContent();
    expect(grammarIssues(plain)).toEqual([]);
    const essay = grammarEssayContent();
    expect(countDocument(essay, settings()).words).toBe(essayCounts.total);
    expect(countDocument(essay, settings({ stopAtHeading: "The struggle" })).words).toBe(
      essayCounts.introduction,
    );
    expect(countDocument(essay, settings({ stopAtHeading: "References" })).words).toBe(
      essayCounts.withoutReferences,
    );
    expect(grammarIssues(essay).map((issue) => [issue.text, issue.suggestion])).toEqual([
      ["were", "was"],
      ["its", "it's"],
      ["was", "were"],
    ]);
    expect(grammarIssues(essay).some((issue) => /danquah|movment/i.test(issue.text))).toBe(false);
    expect(misspelledWords(essay)).toEqual(["movment", "Danquah"]);
  });

  it("flags articles, pronouns, and common mix-ups", () => {
    const flagged = grammarIssues(
      paragraph("a apple and an book and your going and could of been more then ready and i am here"),
    );
    expect(flagged.map((issue) => [issue.text, issue.suggestion])).toEqual([
      ["a", "an"],
      ["an", "a"],
      ["your", "you're"],
      ["of", "have"],
      ["then", "than"],
      ["i", "I"],
    ]);
  });

  it("keeps bold, italic, and the link on words the suggestion does not replace", () => {
    const essay = grammarEssayContent();
    const marks: { text: string; types: string[] }[] = [];
    const visit = (node: JsonNode) => {
      if (node.text && node.marks?.length)
        marks.push({ text: node.text, types: node.marks.map((mark) => mark.type) });
      for (const child of node.content ?? []) visit(child);
    };
    visit(essay);
    expect(marks).toEqual([
      { text: "Ghana", types: ["link"] },
      { text: "movement", types: ["bold"] },
      { text: "strong", types: ["italic"] },
    ]);
  });
});
