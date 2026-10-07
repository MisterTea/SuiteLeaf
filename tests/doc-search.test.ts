import { describe, expect, it } from "vitest";
import {
  searchText,
  type SearchOptions,
} from "../apps/web/src/editors/doc-search";
const defaults: SearchOptions = {
  matchCase: false,
  regex: false,
  ignoreDiacritics: true,
};
describe("document search positions", () => {
  it("finds case-insensitive literal text without interpreting punctuation", () => {
    expect(searchText("Cedar cedar CEDAR", "cedar", defaults).matches).toEqual([
      { from: 0, to: 5 },
      { from: 6, to: 11 },
      { from: 12, to: 17 },
    ]);
    expect(searchText("a.b axb", "a.b", defaults).matches).toEqual([
      { from: 0, to: 3 },
    ]);
    expect(
      searchText("Cedar cedar", "cedar", { ...defaults, matchCase: true })
        .matches,
    ).toEqual([{ from: 6, to: 11 }]);
  });
  it("maps accent normalization, combining marks and emoji to original positions", () => {
    expect(searchText("😀 café cafe\u0301", "cafe", defaults).matches).toEqual([
      { from: 3, to: 7 },
      { from: 8, to: 13 },
    ]);
    expect(
      searchText("café cafe", "cafe", { ...defaults, ignoreDiacritics: false })
        .matches,
    ).toEqual([{ from: 5, to: 9 }]);
  });
  it("supports regex and reports invalid patterns without throwing", () => {
    expect(
      searchText("cedar 12 cedar 34", "cedar \\d+", {
        ...defaults,
        regex: true,
      }).matches,
    ).toEqual([
      { from: 0, to: 8 },
      { from: 9, to: 17 },
    ]);
    expect(
      searchText("cedar", "[", { ...defaults, regex: true }).error,
    ).toBeDefined();
    expect(
      searchText("cedar", "^", { ...defaults, regex: true }).matches,
    ).toEqual([]);
  });
});
