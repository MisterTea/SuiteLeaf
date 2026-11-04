import { describe, expect, it } from "vitest";
import { defaultPageSettings, type PageSettings } from "@suiteleaf/core/document-layout";
import { firstString, flagArg, present, unquoteArg, unwrapName } from "../apps/web/src/ai/tools/doc-args";
import {
  bagValue,
  bindingGutterPx,
  coerceInches,
  coverHasNoNumberArg,
  firstArg,
  gutterInchesFrom,
  marginEdgeArgs,
  minutesStartNote,
  optionalBoolean,
  pageMarginEdges,
  pageNumberFormatArg,
  pageNumberPhrase,
  pageNumberPositionArg,
  pageNumberStartArg,
  uniformMarginInches,
  uniformMarginPx,
  watermarkArg,
} from "../apps/web/src/ai/tools/doc-page-args";
import {
  applyOddEvenHeaders,
  headerArg,
  headerFromEdgeInches,
  oddEvenWords,
  refuseDraftInBody,
  splitOddEvenPhrase,
} from "../apps/web/src/ai/tools/doc-page-cases";

const page = (patch: Partial<PageSettings> = {}): PageSettings => ({ ...defaultPageSettings, ...patch });

describe("assistant argument helpers", () => {
  it("unquotes a quoted string and keeps the spaces inside", () => {
    expect(unquoteArg('"approximately "')).toBe("approximately ");
    expect(unquoteArg("“Jordan”")).toBe("Jordan");
    expect(unquoteArg("plain")).toBe("plain");
    expect(unquoteArg(4)).toBe(4);
  });

  it("reads loose flags", () => {
    expect(flagArg(true)).toBe(true);
    expect(flagArg(0)).toBe(false);
    expect(flagArg(" Yes ")).toBe(true);
    expect(flagArg("all")).toBe(true);
    expect(flagArg("no")).toBe(false);
    expect(flagArg("maybe")).toBeUndefined();
    expect(flagArg("")).toBeUndefined();
    expect(flagArg(null)).toBeUndefined();
    expect(flagArg({})).toBeUndefined();
  });

  it("picks the first non-blank string and trims names", () => {
    expect(present("  ")).toBeUndefined();
    expect(present(" x ")).toBe(" x ");
    expect(firstString({ a: "  ", b: 3, c: " hit " }, ["a", "b", "c"])).toBe("hit");
    expect(firstString({}, ["a"])).toBe("");
    expect(unwrapName(' "Agreed rota" ')).toBe("Agreed rota");
  });
});

describe("page setup arguments", () => {
  it("reads booleans from words and numbers", () => {
    expect(optionalBoolean("on")).toBe(true);
    expect(optionalBoolean("OFF")).toBe(false);
    expect(optionalBoolean(2)).toBe(true);
    expect(optionalBoolean(false)).toBe(false);
    expect(optionalBoolean("sometimes")).toBeUndefined();
    expect(optionalBoolean(undefined)).toBeUndefined();
  });

  it("reads page number formats and refuses unknown ones", () => {
    expect(pageNumberFormatArg("Page N")).toBe("page");
    expect(pageNumberFormatArg("page_n")).toBe("page");
    expect(pageNumberFormatArg("1/2")).toBe("fraction");
    expect(pageNumberFormatArg("fraction")).toBe("fraction");
    expect(pageNumberFormatArg("Roman numerals")).toBe("roman");
    expect(pageNumberFormatArg("i")).toBe("roman");
    expect(pageNumberFormatArg("")).toBeUndefined();
    expect(() => pageNumberFormatArg("words")).toThrow(/page_number_format must be/);
  });

  it("reads page number positions and refuses the left corner", () => {
    expect(pageNumberPositionArg("Top right")).toBe("top-right");
    expect(pageNumberPositionArg("topright")).toBe("top-right");
    expect(pageNumberPositionArg("bottom_centre")).toBe("bottom-center");
    expect(pageNumberPositionArg("center")).toBe("bottom-center");
    expect(pageNumberPositionArg("bottom-right")).toBe("bottom-right");
    expect(pageNumberPositionArg(null)).toBeUndefined();
    expect(() => pageNumberPositionArg("top left")).toThrow(/page_number_position must be/);
  });

  it("finds a value at the top level or in a nested settings bag", () => {
    expect(firstArg({ start_at: 4 }, ["page_number_start", "start_at"])).toBe(4);
    expect(firstArg({ page: { start: 7 } }, ["start"])).toBe(7);
    expect(firstArg({ start: "", setup: { start: 2 } }, ["start"])).toBe(2);
    expect(firstArg({ page: [1] }, ["start"])).toBeUndefined();
  });

  it("reads odd and even headers from a nested headers object by short name", () => {
    expect(bagValue({ headers: { even: "Minutes" } }, ["even_header"])).toBe("Minutes");
    expect(bagValue({ page_headers: { oddHeader: "Garden club" } }, ["oddHeader"])).toBe("Garden club");
    expect(bagValue({ headers: { odd: "Garden club" } }, ["oddHeader"])).toBe("Garden club");
    expect(bagValue({ headers: { even: "" } }, ["even_header"])).toBeUndefined();
    expect(bagValue({ headers: { x: 1 } }, ["odd"])).toBeUndefined();
    expect(bagValue({ settings: { different_odd_even: true } }, ["different_odd_even"])).toBe(true);
  });

  it("reads Start at as a whole page number from 1 to 9999", () => {
    expect(pageNumberStartArg(4)).toBe(4);
    expect(pageNumberStartArg('"Page 4."')).toBe(4);
    expect(pageNumberStartArg({ start: "12" })).toBe(12);
    expect(pageNumberStartArg({ value: 3 })).toBe(3);
    expect(pageNumberStartArg("")).toBeUndefined();
    expect(() => pageNumberStartArg("four")).toThrow(/whole number from 1 to 9999/);
    expect(() => pageNumberStartArg(0)).toThrow(/whole number from 1 to 9999/);
    expect(() => pageNumberStartArg(10000)).toThrow(/whole number from 1 to 9999/);
  });

  it("reads the cover choice from flags and phrases", () => {
    expect(coverHasNoNumberArg(true)).toBe(true);
    expect(coverHasNoNumberArg("no")).toBe(false);
    expect(coverHasNoNumberArg("Unnumbered cover")).toBe(true);
    expect(coverHasNoNumberArg("cover without a number")).toBe(true);
    expect(coverHasNoNumberArg("the cover")).toBeUndefined();
    expect(coverHasNoNumberArg("  ")).toBeUndefined();
    expect(coverHasNoNumberArg({})).toBeUndefined();
  });

  it("reads inches with or without units", () => {
    expect(coerceInches(1.5)).toBe(1.5);
    expect(coerceInches("1.5 in")).toBe(1.5);
    expect(coerceInches('2"')).toBe(2);
    expect(coerceInches("2 inches.")).toBe(2);
    expect(coerceInches("wide")).toBeUndefined();
    expect(coerceInches("in")).toBeUndefined();
    expect(coerceInches(Number.NaN)).toBeUndefined();
    expect(coerceInches(null)).toBeUndefined();
  });

  it("collects per-edge margins from flat names, a nested bag, or a sentence", () => {
    expect(marginEdgeArgs({ topMargin: "1in", margins: { left: 1.25 } })).toEqual({
      margin_top_inches: 1,
      margin_left_inches: 1.25,
    });
    expect(marginEdgeArgs({ margins: "top 1 inch, bottom 2, left 0.5" })).toEqual({
      margin_top_inches: 1,
      margin_bottom_inches: 2,
      margin_left_inches: 0.5,
    });
    expect(marginEdgeArgs({ margin_right: 1, margin_inches: "right 3" })).toEqual({ margin_right_inches: 1 });
    expect(() => marginEdgeArgs({ margin_top: "tall" })).toThrow(/margin_top_inches must be a number/);
  });

  it("turns edge inches into pixels and refuses margins outside 0.25 to 3 inches", () => {
    expect(pageMarginEdges({ margin_top_inches: 1, margin_left_inches: 0.5 })).toEqual([
      ["top", 96],
      ["left", 48],
    ]);
    expect(() => pageMarginEdges({ margin_bottom_inches: 0.1 })).toThrow(/at least 0.25 inches. The bottom margin/);
    expect(() => pageMarginEdges({ margin_right_inches: 4 })).toThrow(/at most 3 inches. The right margin/);
    expect(uniformMarginPx(2)).toBe(192);
    expect(() => uniformMarginPx(5)).toThrow(/cannot be more than 3 inches/);
    expect(() => uniformMarginPx(0.1)).toThrow(/at least 0.25 inches/);
  });

  it("reads one margin for every edge but not an edge sentence", () => {
    expect(uniformMarginInches({ margin_inches: "1.5" })).toBe(1.5);
    expect(uniformMarginInches({ marginInches: "wide", margin: 2 })).toBe(2);
    expect(uniformMarginInches({ margin_inches: "top 1" })).toBeUndefined();
    expect(uniformMarginInches({ margins: "left 1" })).toBeUndefined();
    expect(uniformMarginInches({ margins: { top: 1 } })).toBeUndefined();
    expect(uniformMarginInches({})).toBeUndefined();
  });

  it("reads and checks a binding gutter", () => {
    expect(gutterInchesFrom({ gutter: "0.5in" })).toBe(0.5);
    expect(gutterInchesFrom({ margins: { binding_gutter: 1 } })).toBe(1);
    expect(gutterInchesFrom({})).toBeUndefined();
    expect(() => gutterInchesFrom({ gutter: "wide" })).toThrow(/gutter_inches must be a number/);
    expect(bindingGutterPx(0.5)).toBe(48);
    expect(bindingGutterPx(0)).toBe(0);
    expect(() => bindingGutterPx(3)).toThrow(/larger than 2 inches is refused/);
    expect(() => bindingGutterPx(-1)).toThrow(/from 0 to 2 inches/);
  });

  it("describes page numbering the way the page shows it", () => {
    expect(pageNumberPhrase(page())).toBe("page numbers off");
    expect(pageNumberPhrase(page({ pageNumbers: true }))).toBe('page numbers on as "1 / 2" at the bottom right');
    expect(
      pageNumberPhrase(page({ pageNumbers: true, pageNumberFormat: "page", pageNumberPositionSet: true, pageNumberPosition: "top-right" })),
    ).toBe('page numbers on as "Page N" at the top right');
    expect(
      pageNumberPhrase(page({ pageNumbers: true, pageNumberFormat: "roman", pageNumberPositionSet: true, pageNumberPosition: "bottom-center" })),
    ).toBe("page numbers on as roman numerals at the bottom center");
    expect(pageNumberPhrase(page({ pageNumbers: true, pageNumberPositionSet: true, pageNumberStart: 4 }))).toBe(
      'page numbers on as "1 / 2" at the bottom right, starting at 4',
    );
    expect(pageNumberPhrase(page({ pageNumbers: true, coverHasNoNumber: true, pageNumberStart: 4 }))).toContain(
      "Cover has no number, so the first page has no number and the next page is Page 1. Start at 4 is still stored",
    );
    expect(pageNumberPhrase(page({ pageNumbers: true, differentOddEven: true, differentFirstPage: true }))).toBe(
      "page numbers on, no number on page 1, left on even pages, right on odd pages",
    );
    expect(pageNumberPhrase(page({ pageNumbers: true, differentOddEven: true }))).toBe(
      "page numbers on, left on even pages, right on odd pages",
    );
  });

  it("steers the October minutes toward Start at 4 with a numberless cover", () => {
    expect(minutesStartNote("Other", true, page())).toBe("");
    expect(minutesStartNote("October minutes", false, page())).toBe("");
    const done = minutesStartNote("October minutes", true, page({ footer: "Committee draft", coverHasNoNumber: true, pageNumberStart: 4 }));
    expect(done).toContain('The footer is still "Committee draft".');
    expect(done).toContain("Stop. Do not call another tool.");
    expect(minutesStartNote("October minutes", true, page({ pageNumberStart: 4 }))).toContain("cover_has_no_number true only");
    expect(minutesStartNote("October minutes", true, page({ coverHasNoNumber: true, pageNumberStart: 2 }))).toContain(
      "Start at is 2. Call page_setup once with page_number_start 4 only",
    );
    expect(minutesStartNote("October minutes", true, page({ footer: "F" }))).toBe(' The footer is still "F".');
  });

  it("reads a watermark word, clears it when empty, and refuses a flag", () => {
    expect(watermarkArg({ watermark: '  "DRAFT" ' })).toBe("DRAFT");
    expect(watermarkArg({ page: { watermark_text: "Confidential" } })).toBe("Confidential");
    expect(watermarkArg({ behind: { text: "Copy" } })).toBe("Copy");
    expect(watermarkArg({ watermark: { word: 7 } })).toBe("7");
    expect(watermarkArg({ watermark: { text: "" } })).toBe("");
    expect(watermarkArg({ watermark: "" })).toBe("");
    expect(watermarkArg({ watermark: null, watermarkText: "Late" })).toBe("Late");
    expect(watermarkArg({ watermark: { other: 1 } })).toBeUndefined();
    expect(watermarkArg({})).toBeUndefined();
    expect(() => watermarkArg({ watermark: true })).toThrow(/word behind the text/);
  });
});

describe("page setup cases", () => {
  it("refuses DRAFT typed into the garden minutes only", () => {
    expect(() => refuseDraftInBody("Garden club minutes", "Draft minutes")).toThrow(/Do not type DRAFT/);
    expect(() => refuseDraftInBody("Garden club minutes", "Drafted")).not.toThrow();
    expect(() => refuseDraftInBody("Other", "DRAFT")).not.toThrow();
  });

  it("reads header words without a typed page number", () => {
    expect(oddEvenWords("Minutes 2 / 4")).toBe("Minutes");
    expect(oddEvenWords("Page 3 GARDEN CLUB.")).toBe("Garden club");
    expect(oddEvenWords({ text: "Agenda" })).toBe("Agenda");
    expect(oddEvenWords("Page 2")).toBeUndefined();
    expect(oddEvenWords("")).toBeUndefined();
    expect(headerArg(12)).toBe("12");
    expect(headerArg({ content: { value: "x" } })).toBeUndefined();
    expect(headerArg(["Minutes"])).toBeUndefined();
  });

  it("splits even and odd titles sent in one string", () => {
    expect(splitOddEvenPhrase("even pages: Minutes, odd header = Garden club")).toEqual({ even: "Minutes", odd: "Garden club" });
    expect(splitOddEvenPhrase("Minutes")).toEqual({});
    expect(splitOddEvenPhrase(undefined)).toEqual({});
  });

  it("turns odd and even on without copying the even header onto odd pages", () => {
    const current = page({ header: "Shared" });
    expect(applyOddEvenHeaders(current, {})).toBe(current);
    expect(applyOddEvenHeaders(page({ differentOddEven: true }), { different_odd_even: false }).differentOddEven).toBe(false);
    const on = applyOddEvenHeaders(current, { different_odd_even: true, even_header: "Minutes" });
    expect(on).toMatchObject({ differentOddEven: true, evenHeader: "Minutes", oddHeader: "Shared" });
    const offWithHeaders = applyOddEvenHeaders(current, { different_odd_even: false, odd_header: "Odd" });
    expect(offWithHeaders).toMatchObject({ differentOddEven: false, oddHeader: "Odd" });
  });

  it("reads header distance in inches", () => {
    expect(headerFromEdgeInches({ header_distance: "0.5 in" })).toBe(0.5);
    expect(headerFromEdgeInches({ margins: { header_edge: 1 } })).toBe(1);
    expect(headerFromEdgeInches({})).toBeUndefined();
    expect(() => headerFromEdgeInches({ headerFromEdge: "near" })).toThrow(/header_from_edge_inches must be a number/);
  });
});
