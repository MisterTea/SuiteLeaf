import { expect, test } from "vitest";
import { excelWrappedLines } from "../apps/web/src/excel-wrap";
test("trailing spaces do not move a fitting word to a new line", () => {
  const value = "Name in Chinese        (if applicable):";
  expect(excelWrappedLines(value, 15, (x) => x.length)).toEqual([
    "Name in Chinese",
    "(if",
    "applicable):",
  ]);
  expect(excelWrappedLines(value, 40, (x) => x.length)).toEqual([value]);
});
test("keeps explicit paragraphs and Unicode graphemes intact", () => {
  expect(excelWrappedLines("A\n\nB", 10, (x) => x.length)).toEqual([
    "A",
    "",
    "B",
  ]);
  expect(
    excelWrappedLines(
      "a\u0301b\u0301",
      1,
      (x) =>
        Array.from(
          new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(x),
        ).length,
    ),
  ).toEqual(["a\u0301", "b\u0301"]);
});
