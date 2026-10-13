import { describe, expect, it } from "vitest";
import {
  documentPageSettings,
  pageFace,
  type PageSettings,
} from "../packages/core/src/document-layout";
import { livePageNumbers } from "../apps/web/src/editors/page-number-live";
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
      pageNumberStart: 4,
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

  it("leaves the start, the cover, a different first page, and the watermark until apply", () => {
    const saved = page({ pageNumbers: true });
    const shown = livePageNumbers(saved, {
      ...saved,
      pageNumberFormat: "page",
      pageNumberPosition: "top-right",
      pageNumberPositionSet: true,
      pageNumberStart: 4,
      coverHasNoNumber: true,
      differentFirstPage: true,
      watermark: "DRAFT",
    });
    expect(shown.pageNumberStart).toBe(1);
    expect(shown.coverHasNoNumber).toBe(false);
    expect(shown.differentFirstPage).toBe(false);
    expect(shown.watermark).toBe("");
    expect(pageFace(shown, 0, 2).pageNumber).toBe("Page 1");
    expect(pageFace(shown, 0, 2).header).toBe("Draft minutes");
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
        pageNumberStart: 8,
        differentFirstPage: true,
      }),
    ).toBe(saved);
    expect(
      livePageNumbers(saved, {
        ...saved,
        pageNumbers: "yes" as unknown as boolean,
        pageNumberFormat: "page",
      }),
    ).toBe(saved);
  });
});
