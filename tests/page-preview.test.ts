import { describe, expect, it } from "vitest";
import {
  documentPageSettings,
  pageFace,
  pageNumberFormatChips,
  romanPageChip,
  type PageSettings,
} from "../packages/core/src/document-layout";
import {
  previewNumberCorner,
  previewPlan,
  previewSheetNumbers,
  previewSkipLabel,
} from "../apps/web/src/editors/page-preview";

function pages(patch: Partial<PageSettings> = {}): PageSettings {
  return documentPageSettings({
    type: "doc",
    attrs: {
      pageSettings: {
        pageNumbers: true,
        pageNumberFormat: "roman",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        pageNumberStart: 4,
        ...patch,
      },
    },
  });
}

function chipEnds(chip: string): [string, string] {
  if (chip.includes("…")) {
    const [first, last] = chip.split(" … ");
    return [first!, last!];
  }
  const parts = chip.split(", ");
  return [parts[0]!, parts[parts.length - 1]!];
}

describe("page preview ends", () => {
  it("shows the first and last roman pages of a long file, and the fraction count", () => {
    const settings = pages();
    expect(previewPlan(5, false).slots.map((slot) => slot.kind)).toEqual([
      "page",
      "skip",
      "page",
    ]);
    expect(previewSheetNumbers(settings, 5)).toEqual(["iv", "viii"]);
    expect(previewSkipLabel(settings, 1, 3, 5)).toBe("Pages v\u2013vii skipped");
    const chips = pageNumberFormatChips(4, 5);
    expect(chips.roman).toBe("iv … viii");
    expect(chips.fraction).toBe("4 / 8");
    expect(previewSheetNumbers(settings, 5)).toEqual(chipEnds(chips.roman));
    expect(romanPageChip(4, 5)).toBe(chips.roman);
  });

  it("previews a two-page file as two sheets and a three-page file as the whole chip", () => {
    const settings = pages();
    expect(previewPlan(2, false).slots).toEqual([
      { kind: "page", index: 0 },
      { kind: "page", index: 1 },
    ]);
    expect(previewSheetNumbers(settings, 2)).toEqual(["iv", "v"]);
    expect(pageNumberFormatChips(4, 2)).toEqual({
      fraction: "4 / 5",
      page: "Page 4",
      roman: "iv, v",
    });
    expect(previewPlan(3, false).slots).toHaveLength(3);
    expect(previewSheetNumbers(settings, 3)).toEqual(["iv", "v", "vi"]);
    expect(pageNumberFormatChips(4, 3).roman).toBe("iv, v, vi");
    expect(pageNumberFormatChips(4, 3).fraction).toBe("4 / 6");
  });

  it("previews the last even page and the last odd page, not the first three faces", () => {
    const settings = pages({
      pageNumberFormat: "page",
      pageNumberStart: 1,
      pageNumberPosition: "bottom-right",
      pageNumberPositionSet: false,
      differentOddEven: true,
    });
    expect(previewPlan(5, true)).toEqual({
      slots: [
        { kind: "page", index: 3, role: "last-even" },
        { kind: "page", index: 4, role: "last-odd" },
      ],
      total: 5,
    });
    expect(previewSheetNumbers(settings, 5)).toEqual(["Page 4", "Page 5"]);
    expect(pageFace(settings, 3, 5)).toMatchObject({
      numberSide: "left",
      pageNumber: "Page 4",
    });
    expect(pageFace(settings, 4, 5)).toMatchObject({
      numberSide: "right",
      pageNumber: "Page 5",
    });
    expect(previewNumberCorner(pageFace(settings, 3, 5).numberSide)).toBe(
      "bottom-left",
    );
    expect(previewNumberCorner(pageFace(settings, 4, 5).numberSide)).toBe(
      "bottom-right",
    );
    const off = { ...settings, differentOddEven: false };
    expect(previewPlan(5, false).slots).toEqual([
      { kind: "page", index: 0 },
      { kind: "skip", firstIndex: 1, lastIndex: 3 },
      { kind: "page", index: 4 },
    ]);
    expect(previewSheetNumbers(off, 5)).toEqual(["Page 1", "Page 5"]);
    expect(previewNumberCorner(pageFace(off, 0, 5).numberSide)).toBe("bottom-right");
    expect(previewNumberCorner(pageFace(off, 4, 5).numberSide)).toBe("bottom-right");
    expect(previewSkipLabel(off, 1, 3, 5)).toBe("Pages 2\u20134 skipped");
    expect(previewPlan(4, true).slots).toEqual([
      { kind: "page", index: 2, role: "last-odd" },
      { kind: "page", index: 3, role: "last-even" },
    ]);
    expect(previewPlan(1, true).slots).toEqual([
      { kind: "page", index: 0, role: "last-odd" },
    ]);
  });

  it("draws iv and viii in the selected corner, and a two-page file has two sheets", () => {
    const top = pages();
    const first = pageFace(top, 0, 5);
    const last = pageFace(top, 4, 5);
    expect(first.pageNumber).toBe("iv");
    expect(last.pageNumber).toBe("viii");
    expect(previewNumberCorner(first.numberSide)).toBe("top-right");
    expect(previewNumberCorner(last.numberSide)).toBe("top-right");
    expect(previewSheetNumbers(top, 5)).toEqual(["iv", "viii"]);
    const bottom = pages({ pageNumberPosition: "bottom-center" });
    expect(previewNumberCorner(pageFace(bottom, 0, 5).numberSide)).toBe(
      "bottom-center",
    );
    expect(previewNumberCorner(pageFace(bottom, 4, 5).numberSide)).toBe(
      "bottom-center",
    );
    expect(previewSheetNumbers(bottom, 5)).toEqual(["iv", "viii"]);
    expect(previewPlan(2, false).slots).toEqual([
      { kind: "page", index: 0 },
      { kind: "page", index: 1 },
    ]);
    expect(previewSheetNumbers(top, 2)).toEqual(["iv", "v"]);
    expect(pageNumberFormatChips(4, 5)).toEqual({
      fraction: "4 / 8",
      page: "Page 4",
      roman: "iv … viii",
    });
  });

  it("names a fraction file's skipped pages by number, not by a third sheet", () => {
    const settings = pages({ pageNumberFormat: "fraction" });
    expect(previewSheetNumbers(settings, 5)).toEqual(["4 / 8", "8 / 8"]);
    expect(previewSkipLabel(settings, 1, 3, 5)).toBe("Pages 5\u20137 skipped");
    expect(pageNumberFormatChips(4, 5).fraction).toBe("4 / 8");
  });
});
