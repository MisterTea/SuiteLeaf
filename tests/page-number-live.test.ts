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

  it("leaves format, cover, a different first page, and the watermark until apply", () => {
    const saved = page();
    const shown = livePageNumbers(saved, {
      ...saved,
      pageNumbers: true,
      pageNumberFormat: "roman",
      pageNumberPosition: "top-right",
      pageNumberPositionSet: true,
      pageNumberStart: 4,
      coverHasNoNumber: true,
      differentFirstPage: true,
      watermark: "DRAFT",
    });
    expect(shown.pageNumbers).toBe(true);
    expect(shown.pageNumberFormat).toBe("fraction");
    expect(shown.pageNumberPositionSet).toBe(false);
    expect(shown.pageNumberStart).toBe(1);
    expect(shown.coverHasNoNumber).toBe(false);
    expect(shown.differentFirstPage).toBe(false);
    expect(shown.watermark).toBe("");
    expect(pageFace(shown, 0, 2).pageNumber).toBe("1 / 2");
  });

  it("keeps the saved page when the switch has not moved", () => {
    const saved = page();
    expect(livePageNumbers(saved, saved)).toBe(saved);
    expect(livePageSettings(saved, { ...saved })).toBe(saved);
    expect(livePageNumbers(saved, { ...saved, pageNumbers: "yes" as unknown as boolean })).toBe(
      saved,
    );
  });
});
