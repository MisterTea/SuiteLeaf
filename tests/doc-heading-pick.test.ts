import { describe, expect, it } from "vitest";
import { nextHeadingPick } from "../apps/web/src/editors/doc-arabic-start";

const contents = { text: "Contents", startArabic: false };
const chapter = { text: "Chapter 1", startArabic: false };

describe("Arabic start heading pick", () => {
  it("stays hidden when page setup leaves the caret in the opening heading", () => {
    expect(nextHeadingPick(null, contents, "document")).toBeNull();
  });

  it("appears when the caret moves into a heading", () => {
    expect(nextHeadingPick(null, chapter, "selection")).toEqual(chapter);
  });

  it("clears when the caret leaves the heading", () => {
    expect(nextHeadingPick(chapter, null, "selection")).toBeNull();
  });

  it("refreshes the pressed state without jumping to another heading", () => {
    const marked = { text: "Chapter 1", startArabic: true };
    expect(nextHeadingPick(chapter, marked, "document")).toEqual(marked);
    expect(nextHeadingPick(chapter, contents, "document")).toEqual(chapter);
  });
});
