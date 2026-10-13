import { describe, expect, it } from "vitest";
import {
  documentPageSettings,
  pageFace,
  pageNumberFormatChips,
  type PageSettings,
} from "../packages/core/src/document-layout";
import {
  acceptPageNumberStart,
  livePageNumbers,
} from "../apps/web/src/editors/page-number-live";
import { livePageSettings } from "../apps/web/src/editors/margin-live";

const inch = (n: number) => n * 96;

function page(patch: Partial<PageSettings> = {}): PageSettings {
  return documentPageSettings({
    type: "doc",
    attrs: {
      pageSettings: {
        margin: inch(1),
        header: "Draft minutes",
        footer: "",
        pageNumbers: false,
        pageNumberFormat: "fraction",
        coverHasNoNumber: false,
        differentFirstPage: false,
        watermark: "",
        ...patch,
      },
    },
  });
}

describe("live page numbers", () => {
  it("draws 1 / 2 and 2 / 2 before apply", () => {
    const saved = page();
    const shown = livePageSettings(saved, { ...saved, pageNumbers: true });
    expect(shown.pageNumbers).toBe(true);
    expect(pageFace(shown, 0, 2).pageNumber).toBe("1 / 2");
    expect(pageFace(shown, 1, 2).pageNumber).toBe("2 / 2");
    expect(pageFace(shown, 0, 2).numberSide).toBe("right");
  });

  it("still draws a header typed in the same dialog", () => {
    const saved = page();
    const shown = livePageSettings(saved, {
      ...saved,
      pageNumbers: true,
      header: "Town council",
    });
    expect(shown.header).toBe("Town council");
    expect(pageFace(shown, 0, 2).header).toBe("Town council");
    expect(pageFace(shown, 0, 2).pageNumber).toBe("1 / 2");
    expect(pageFace(shown, 1, 2).pageNumber).toBe("2 / 2");
  });

  it("hides the numbers before apply when the switch is turned off", () => {
    const saved = page({ pageNumbers: true });
    const shown = livePageNumbers(saved, { ...saved, pageNumbers: false });
    expect(shown.pageNumbers).toBe(false);
    expect(pageFace(shown, 0, 2).pageNumber).toBe("");
    expect(pageFace(shown, 1, 2).pageNumber).toBe("");
    expect(shown.header).toBe("Draft minutes");
  });

  it("changes 1 / 2 into Page 1 at the top right before apply", () => {
    const saved = page({ pageNumbers: true });
    const draft = {
      ...saved,
      pageNumberFormat: "page" as const,
      pageNumberPosition: "top-right" as const,
      pageNumberPositionSet: true,
      coverHasNoNumber: true,
      differentFirstPage: true,
      watermark: "DRAFT",
    };
    const shown = livePageSettings(saved, draft);
    expect(shown.pageNumberFormat).toBe("page");
    expect(shown.pageNumberPosition).toBe("top-right");
    expect(shown.pageNumberPositionSet).toBe(true);
    expect(pageFace(shown, 0, 2)).toMatchObject({
      header: "Draft minutes",
      pageNumber: "Page 1",
      numberSide: "top-right",
    });
    expect(pageFace(shown, 1, 2)).toMatchObject({
      pageNumber: "Page 2",
      numberSide: "top-right",
    });
    expect(pageFace(saved, 0, 2)).toMatchObject({
      pageNumber: "1 / 2",
      numberSide: "right",
    });
    expect(pageFace(saved, 1, 2).pageNumber).toBe("2 / 2");
  });

  it("shows Page 12 and Page 13 before apply and leaves the cover until apply", () => {
    const saved = page({
      pageNumbers: true,
      pageNumberFormat: "page",
      pageNumberPosition: "top-right",
      pageNumberPositionSet: true,
    });
    const shown = livePageNumbers(saved, {
      ...saved,
      pageNumberStart: 12,
      coverHasNoNumber: true,
      differentFirstPage: true,
      watermark: "DRAFT",
    });
    expect(shown.pageNumberStart).toBe(12);
    expect(shown.coverHasNoNumber).toBe(false);
    expect(shown.differentFirstPage).toBe(false);
    expect(shown.watermark).toBe("");
    expect(pageFace(shown, 0, 2)).toMatchObject({
      header: "Draft minutes",
      pageNumber: "Page 12",
      numberSide: "top-right",
    });
    expect(pageFace(shown, 1, 2)).toMatchObject({
      pageNumber: "Page 13",
      numberSide: "top-right",
    });
    expect(pageFace(saved, 0, 2).pageNumber).toBe("Page 1");
    expect(pageFace(saved, 1, 2).pageNumber).toBe("Page 2");
  });

  it("labels both format chips from the live start", () => {
    const saved = page({
      pageNumbers: true,
      pageNumberFormat: "page",
      pageNumberPosition: "top-right",
      pageNumberPositionSet: true,
    });
    const atTwelve = livePageNumbers(saved, { ...saved, pageNumberStart: 12 });
    expect(pageNumberFormatChips(atTwelve.pageNumberStart, 2)).toEqual({
      fraction: "12 / 13",
      page: "Page 12",
      roman: "xii, xiii",
    });
    expect(pageFace(atTwelve, 0, 2).pageNumber).toBe("Page 12");
    const atThree = livePageNumbers(atTwelve, { ...atTwelve, pageNumberStart: 3 });
    expect(pageNumberFormatChips(atThree.pageNumberStart, 2)).toEqual({
      fraction: "3 / 4",
      page: "Page 3",
      roman: "iii, iv",
    });
    expect(pageFace(atThree, 0, 2).pageNumber).toBe("Page 3");
    const refused = acceptPageNumberStart(atThree.pageNumberStart, "0");
    expect(refused.refused).toBe(true);
    const kept = refused.refused ? atThree.pageNumberStart : refused.start;
    expect(pageNumberFormatChips(kept, 2)).toEqual({
      fraction: "3 / 4",
      page: "Page 3",
      roman: "iii, iv",
    });
    expect(pageFace(atThree, 0, 2).pageNumber).toBe("Page 3");
  });

  it("labels the roman chip from the live start and keeps it below 1", () => {
    const saved = page({
      pageNumbers: true,
      pageNumberFormat: "page",
      pageNumberPosition: "top-right",
      pageNumberPositionSet: true,
    });
    const atFour = livePageNumbers(saved, {
      ...saved,
      pageNumberStart: 4,
      pageNumberFormat: "roman",
    });
    expect(pageNumberFormatChips(atFour.pageNumberStart, 2)).toEqual({
      fraction: "4 / 5",
      page: "Page 4",
      roman: "iv, v",
    });
    expect(pageFace(atFour, 0, 2).pageNumber).toBe("iv");
    expect(pageFace(atFour, 1, 2).pageNumber).toBe("v");
    const refused = acceptPageNumberStart(atFour.pageNumberStart, "0");
    expect(refused).toEqual({ start: 4, refused: true, text: "0" });
    const kept = refused.refused ? atFour.pageNumberStart : refused.start;
    expect(pageNumberFormatChips(kept, 2).roman).toBe("iv, v");
    expect(livePageNumbers(atFour, { ...atFour, pageNumberStart: 0 })).toBe(atFour);
    const atTwelve = livePageNumbers(atFour, { ...atFour, pageNumberStart: 12 });
    expect(pageNumberFormatChips(atTwelve.pageNumberStart, 2).roman).toBe(
      "xii, xiii",
    );
    expect(pageFace(atTwelve, 0, 2).pageNumber).toBe("xii");
    expect(pageFace(atTwelve, 1, 2).pageNumber).toBe("xiii");
  });

  it("refuses a start below 1 and keeps the last valid number", () => {
    expect(acceptPageNumberStart(12, "0")).toEqual({
      start: 12,
      refused: true,
      text: "0",
    });
    expect(acceptPageNumberStart(12, "-2")).toEqual({
      start: 12,
      refused: true,
      text: "-2",
    });
    expect(acceptPageNumberStart(1, "12")).toEqual({
      start: 12,
      refused: false,
      text: "12",
    });
    expect(acceptPageNumberStart(12, "")).toEqual({
      start: 12,
      refused: false,
      text: "",
    });
    const saved = page({
      pageNumbers: true,
      pageNumberFormat: "page",
      pageNumberPosition: "top-right",
      pageNumberPositionSet: true,
      pageNumberStart: 12,
    });
    const shown = livePageNumbers(saved, { ...saved, pageNumberStart: 0 });
    expect(shown).toBe(saved);
    expect(pageFace(shown, 0, 2).pageNumber).toBe("Page 12");
    expect(pageFace(shown, 1, 2).pageNumber).toBe("Page 13");
    const atOne = page({ pageNumbers: true });
    expect(livePageNumbers(atOne, { ...atOne, pageNumberStart: 0 })).toBe(atOne);
  });

  it("draws a roman format before apply and ignores a format it does not know", () => {
    const saved = page({ pageNumbers: true });
    expect(
      pageFace(
        livePageSettings(saved, { ...saved, pageNumberFormat: "roman" }),
        1,
        2,
      ).pageNumber,
    ).toBe("ii");
    expect(
      livePageNumbers(saved, {
        ...saved,
        pageNumberFormat: "words" as PageSettings["pageNumberFormat"],
      }),
    ).toBe(saved);
  });

  it("keeps the saved page when the switch, format, and position have not moved", () => {
    const saved = page();
    expect(livePageNumbers(saved, saved)).toBe(saved);
    expect(livePageSettings(saved, { ...saved })).toBe(saved);
    expect(
      livePageSettings(saved, {
        ...saved,
        watermark: "DRAFT",
        coverHasNoNumber: true,
        differentFirstPage: true,
      }),
    ).toBe(saved);
    expect(livePageSettings(saved, { ...saved, pageNumberStart: 12 }).pageNumberStart).toBe(
      12,
    );
    expect(
      livePageNumbers(saved, {
        ...saved,
        pageNumbers: "yes" as unknown as boolean,
        pageNumberFormat: "page",
      }),
    ).toBe(saved);
  });
});
