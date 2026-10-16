import { describe, expect, it } from "vitest";
import { continueList, listShortcut } from "../apps/web/src/editors/slide-list";

describe("slide list shortcuts", () => {
  it("turns a line that is only - * or + into a bullet", () => {
    expect(listShortcut("- ", 2)).toMatchObject({ text: "• ", caret: 2, bullet: true });
    expect(listShortcut("* ", 2)?.text).toBe("• ");
    expect(listShortcut("+ ", 2)?.text).toBe("• ");
    expect(listShortcut("Title\n- ", 8)).toMatchObject({
      text: "Title\n• ",
      caret: 8,
      bullet: true,
    });
  });

  it("leaves 1. as a numbered item and does not convert a marker mid-sentence", () => {
    expect(listShortcut("1. ", 3)).toBeNull();
    expect(listShortcut("see - ", 6)).toBeNull();
    expect(listShortcut("- hello", 7)).toBeNull();
  });

  it("continues a bullet or number on Enter and leaves an empty item", () => {
    expect(continueList("• apples", 8)).toMatchObject({
      text: "• apples\n• ",
      caret: 11,
    });
    expect(continueList("1. apples", 9)).toMatchObject({
      text: "1. apples\n2. ",
      caret: 13,
    });
    expect(continueList("• ", 2)).toMatchObject({ text: "", caret: 0 });
    expect(continueList("1. ", 3)).toMatchObject({ text: "", caret: 0 });
    expect(continueList("• one", 1)).toBeNull();
  });
});