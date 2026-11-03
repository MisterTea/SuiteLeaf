import { expect, it } from "vitest";
import { createFile, parseFile, serializeFile } from "../packages/core/src";
import { readProofing } from "../apps/web/src/editors/doc-word-count";
import { isMisspelling, languageOnMarks, misspelledWords } from "../apps/web/src/editors/doc-spelling";
import { spellingLanguageNote, proofingTextDirection } from "../apps/web/src/editors/proofing-language";

const none = { added: [], flagged: [] };

it("does not check a Spanish document against the English word list", () => {
  expect(isMisspelling("recieve", none, [], false, "es")).toBe(false);
  expect(isMisspelling("camas", none, [], false, "es")).toBe(false);
  expect(isMisspelling("camas", { added: [], flagged: ["camas"] }, [], false, "es")).toBe(true);
  expect(isMisspelling("camas", { added: ["camas"], flagged: [] }, [], false, "es")).toBe(false);
  expect(spellingLanguageNote("es")).toContain("not sent");
  expect(spellingLanguageNote("es")).toContain("English dictionary");
  expect(proofingTextDirection("es")).toBe("ltr");
  expect(proofingTextDirection("ar")).toBe("rtl");
  expect(proofingTextDirection("he")).toBe("rtl");
  expect(proofingTextDirection("en")).toBe("ltr");
  expect(spellingLanguageNote("he")).toContain("Hebrew");
  expect(spellingLanguageNote("he")).toContain("right to left");
  expect(spellingLanguageNote("he")).not.toContain("secret-value");
  expect(spellingLanguageNote("ar")).toContain("right to left");
  expect(spellingLanguageNote("ar")).not.toContain("secret-value");
});

it("keeps an unknown language as English and stores a chosen language on the document", () => {
  expect(readProofing({ type: "doc", attrs: { proofing: { language: "he" } } }).language).toBe("he");
  expect(readProofing({ type: "doc", attrs: { proofing: { language: "fr" } } }).language).toBe("fr");
  expect(readProofing({ type: "doc", attrs: { proofing: { language: "klingon" } } }).language).toBe("en");
  expect(readProofing({ type: "doc" }).language).toBe("en");
  expect(isMisspelling("recieve", none, [])).toBe(true);
});

it("checks an English range inside a Spanish document and leaves the Spanish words", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "recieve " },
          {
            type: "text",
            text: "camas ",
            marks: [{ type: "proofingLanguage", attrs: { language: "es" } }],
          },
          {
            type: "text",
            text: "recieve",
            marks: [{ type: "proofingLanguage", attrs: { language: "en" } }],
          },
        ],
      },
    ],
  };
  expect(misspelledWords(doc, none, [], "es")).toEqual(["recieve"]);
  expect(languageOnMarks([{ type: "proofingLanguage", attrs: { language: "he" } }])).toBe("he");
  expect(languageOnMarks([{ type: "proofingLanguage", attrs: { language: "secret-value" } }])).toBeUndefined();
  const file = createFile("sheet", "Beds");
  if (file.kind !== "sheet") throw new Error("expected a spreadsheet");
  file.content.proofingLanguage = "he";
  const reopened = parseFile(serializeFile(file));
  if (reopened.kind !== "sheet") throw new Error("expected a spreadsheet");
  expect(reopened.content.proofingLanguage).toBe("he");
  expect(JSON.stringify(misspelledWords(doc, none, [], "es"))).not.toContain("secret-value");
});
