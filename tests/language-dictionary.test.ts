import { describe, expect, it } from "vitest";
import {
  addLanguageWord,
  isMisspelling,
  misspelledWords,
  type PersonalDictionary,
} from "../apps/web/src/editors/doc-spelling";

const arabic = "\u0633\u0631\u064A\u0631";

const none: PersonalDictionary = { added: [], flagged: [] };

describe("language dictionary", () => {
  it("remembers a word for one language and does not repeat a refusal", () => {
    const spanish = addLanguageWord({}, "es", "secret-value");
    expect(spanish.ok).toBe(true);
    expect(spanish.notice).toBe("That word was remembered.");
    expect(spanish.notice).not.toContain("secret-value");
    expect(spanish.book.es).toEqual(["secret-value"]);
    expect(isMisspelling("recieve", none, [], false, "en", spanish.book)).toBe(true);
    const english = addLanguageWord({}, "en", "recieve");
    expect(isMisspelling("recieve", none, [], false, "en", english.book)).toBe(false);
    const refused = addLanguageWord({ es: ["camas"] }, "fr", "secret value");
    expect(refused.ok).toBe(false);
    expect(refused.notice).toBe("Remember one word.");
    expect(refused.notice).not.toContain("secret");
    expect(refused.book).toEqual({ es: ["camas"] });
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "recieve" }] }],
    };
    expect(misspelledWords(doc, none, [], "en", english.book)).toEqual([]);
    expect(misspelledWords(doc, none, [], "en", spanish.book)).toEqual(["recieve"]);
  });

  it("remembers an Arabic word and still marks one the reader flagged", () => {
    const remembered = addLanguageWord({}, "ar", arabic);
    expect(remembered.ok).toBe(true);
    expect(remembered.notice).toBe("That word was remembered.");
    expect(remembered.notice).not.toContain(arabic);
    expect(remembered.book.ar).toEqual([arabic]);
    expect(isMisspelling(arabic, none, [], false, "ar", remembered.book)).toBe(false);
    expect(isMisspelling(arabic, none, [], false, "ar")).toBe(false);
    expect(isMisspelling("recieve", none, [], false, "ar")).toBe(false);
    const flagged = { added: [], flagged: [arabic] };
    const paragraph = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: `${arabic} recieve` }] }],
    };
    expect(misspelledWords(paragraph, flagged, [], "ar")).toEqual([arabic]);
    expect(misspelledWords(paragraph, none, [], "ar", remembered.book)).toEqual([]);
    const refused = addLanguageWord(remembered.book, "ar", "secret value");
    expect(refused.ok).toBe(false);
    expect(refused.notice).toBe("Remember one word.");
    expect(refused.notice).not.toContain("secret");
    expect(refused.book.ar).toEqual([arabic]);
  });
});
