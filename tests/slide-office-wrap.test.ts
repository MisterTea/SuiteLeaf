// @vitest-environment jsdom
import { expect, it } from "vitest";
import { officeWrapLines, textAreaWidthPt } from "../apps/web/src/editors/slide-office-wrap";

const measure = (text: string) => text.length;
const words = (lines: ReturnType<typeof officeWrapLines>) => lines?.map(line => line.map(run => run.text).join(""));

it("fits words using supplied device extents while retaining spaces and run styles", () => {
  const lines = officeWrapLines([{ text: "One two", underline: true }, { text: ", three" }], 8, measure);
  expect(words(lines)).toEqual(["One two, ", "three"]);
  expect(lines?.[0][0].underline).toBe(true);
  expect(lines?.flat().map(run => run.text).join("")).toBe("One two, three");
});

it("keeps nonbreaking spaces, long tokens, and words crossing run boundaries intact", () => {
  expect(words(officeWrapLines([{ text: "A B\u00a0C D" }], 4, measure))).toEqual(["A ", "B\u00a0C ", "D"]);
  expect(words(officeWrapLines([{ text: "Long" }, { text: "word x" }], 4, measure))).toEqual(["Longword ", "x"]);
  expect(officeWrapLines([{ text: "longtoken" }], 4, measure)).toBeUndefined();
});

it("excludes list-marker text from line fitting and preserves it on the first line", () => {
  expect(words(officeWrapLines([{ text: "• One two three" }], 7, measure, 2))).toEqual(["• One two ", "three"]);
});

it("allows different first-line indentation and continuation hanging widths", () => {
  expect(words(officeWrapLines([{ text: "One two three four" }], 9, measure, 0, 4))).toEqual(["One ", "two three ", "four"]);
  expect(words(officeWrapLines([{ text: "One two three four" }], 5, measure, 0, 9))).toEqual(["One two ", "three ", "four"]);
});

it("leaves hard lines, tab stops, equations, and unconstrained boxes to their existing layout paths", () => {
  for (const runs of [[{ text: "A\nB" }], [{ text: "A\tB" }], [{ text: "A", math: true }], [{ text: "A", fraction: { num: "1", den: "2" } }]]) {
    expect(officeWrapLines(runs as never, 1, measure)).toBeUndefined();
  }
  expect(officeWrapLines([{ text: "A B" }], 0, measure)).toBeUndefined();
  expect(officeWrapLines([{ text: "A B" }], 3, measure)).toBeUndefined();
  expect(officeWrapLines([{ text: "A long-hyphenated phrase" }], 4, measure)).toBeUndefined();
  expect(officeWrapLines([{ text: "中文文本" }], 1, measure)).toBeUndefined();
});

it("converts subpixel content-box dimensions to points without transformed rectangle rounding", () => {
  const node = document.createElement("div");
  node.style.cssText = "width:100.5px;font-size:14px;padding-left:3.25px;padding-right:4.25px";
  document.body.append(node);
  expect(textAreaWidthPt(node, 28)).toBe(186);
  expect(textAreaWidthPt(node)).toBeUndefined();
  node.style.width = "0px";
  expect(textAreaWidthPt(node, 28)).toBeUndefined();
  node.remove();
});
