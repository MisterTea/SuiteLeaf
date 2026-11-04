import { describe, expect, it } from "vitest";
import { classifyRoundTrip, emptyDigest } from "../packages/core/src/roundtrip-digest";

describe("office export round trip", () => {
  it("treats a line break as the same sentence", () => {
    const reader = emptyDigest();
    reader.texts = ["Hello world"];
    const model = emptyDigest();
    model.texts = ["Helloworld"];
    const again = emptyDigest();
    again.texts = ["Helloworld"];
    expect(classifyRoundTrip(reader, model, again)).toEqual([]);
  });

  it("treats a heading bullet or number as the same heading", () => {
    const reader = emptyDigest();
    reader.texts = ["foo", "No"];
    const model = emptyDigest();
    model.texts = ["\uF0B7 foo", "1. No"];
    const again = emptyDigest();
    again.texts = ["\uF0B7 foo", "1. No"];
    expect(classifyRoundTrip(reader, model, again)).toEqual([]);
    const sectionReader = emptyDigest();
    sectionReader.texts = ["No"];
    const section = emptyDigest();
    section.texts = ["Sect 1.1 No"];
    expect(classifyRoundTrip(sectionReader, section, section)).toEqual([]);
    const spaced = emptyDigest();
    spaced.texts = ["a b c"];
    const tight = emptyDigest();
    tight.texts = ["abc"];
    expect(classifyRoundTrip(spaced, tight, tight)).toEqual([]);
    const replaced = emptyDigest();
    replaced.texts = ["bar"];
    expect(classifyRoundTrip(reader, replaced, replaced).some((diff) => diff.feature === "import.text")).toBe(
      true,
    );
    const listed = emptyDigest();
    listed.texts = [
      "A. Changing how we publish B. Reducing scope",
      "a) Beratung b) Datenmanagementplan",
      "Provide tools v Building relationships",
      "Final proposal o Template follows",
      "• Practice – Protocol stays",
    ];
    const source = emptyDigest();
    source.texts = [
      "Changing how we publish Reducing scope",
      "Beratung Datenmanagementplan",
      "Provide tools Building relationships",
      "Final proposal Template follows",
      "Practice – Protocol stays",
    ];
    expect(classifyRoundTrip(source, listed, listed)).toEqual([]);
    const droppedLetter = emptyDigest();
    droppedLetter.texts = ["section A vehicles stay"];
    const withoutLetter = emptyDigest();
    withoutLetter.texts = ["section vehicles stay"];
    expect(
      classifyRoundTrip(droppedLetter, withoutLetter, withoutLetter).some(
        (diff) => diff.feature === "import.text",
      ),
    ).toBe(true);
  });

  it("classifies import losses as SuiteLeaf and reader gaps as third-party", () => {
    const reader = emptyDigest();
    reader.texts = ["Kept sentence"];
    reader.thirdParty = ["doc.legacy-formatting"];
    const model = emptyDigest();
    const again = emptyDigest();
    again.texts = ["Kept sentence"];
    const differences = classifyRoundTrip(reader, model, again);
    expect(differences).toEqual([
      {
        feature: "doc.legacy-formatting",
        owner: "third-party",
        description: "The legacy DOC extractor returns text and paragraph breaks only.",
      },
      {
        feature: "import.text",
        owner: "suiteleaf",
        description: "Import dropped text on 1 item.",
      },
    ]);
  });
});
