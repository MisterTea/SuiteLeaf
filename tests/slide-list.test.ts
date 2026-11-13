import { describe, expect, it } from "vitest";
import type { TextRun } from "../packages/core/src";
import { changeListDepth, effectiveListFontSizes, continueList, listShortcut } from "../apps/web/src/editors/slide-list";

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

describe("list font size inheritance", () => {
  const runs = (): TextRun[] => [
    { text: "▪ ", listDepth: 0, fontSize: 95.28, listFontSizes: Array(9).fill(18) },
    { text: "Communication", fontSize: 51.5 },
    { text: "\n", paragraphBreak: true, listDepth: 1,
      listFontSizes: [51.5, 47.5, 18, 18, 18, 18, 18, 18, 18] },
    { text: "▪ ", fontSize: 87.88 }, { text: "Grades", fontSize: 47.5 },
  ];

  it("inherits the established body size at unused levels with generic template defaults", () => {
    expect(effectiveListFontSizes(runs())).toEqual([51.5, ...Array(8).fill(47.5)]);
    const original = runs();
    const text = original.map(run => run.text).join("");
    const selection = { start: text.indexOf("Grades"), end: text.length };
    let changed = changeListDepth(original, selection, 1)!;
    expect(changed.find(run => run.paragraphBreak)?.listDepth).toBe(2);
    expect(changed.at(-1)?.fontSize).toBe(47.5);
    expect(changed.at(-2)?.fontSize).toBeCloseTo(87.88);
    changed = changeListDepth(changed, selection, 1)!;
    expect(changed.find(run => run.paragraphBreak)?.listDepth).toBe(3);
    expect(changed.at(-1)?.fontSize).toBe(47.5);
    changed = changeListDepth(changed, selection, -1)!;
    changed = changeListDepth(changed, selection, -1)!;
    expect(changed.at(-1)?.fontSize).toBe(47.5);
    expect(original).toEqual(runs());
  });

  it("preserves independently authored level sizes and existing deeper paragraph sizes", () => {
    expect(effectiveListFontSizes([
      { text: "Title", fontSize: 40, listDepth: 0, listFontSizes: [40, 30, 24] },
    ]).slice(0, 3)).toEqual([40, 30, 24]);
    expect(effectiveListFontSizes([
      ...runs(), { text: "\n", paragraphBreak: true, listDepth: 2 },
      { text: "Authored smaller text", fontSize: 24 },
    ]).slice(0, 4)).toEqual([51.5, 47.5, 24, 24]);
  });
});
