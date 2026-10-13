import { describe, expect, it } from "vitest";
import {
  documentPageSettings,
  pageNumberFormatChips,
  romanPageChip,
  type PageSettings,
} from "../packages/core/src/document-layout";
import {
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

  it("keeps the odd and even sample on the first three faces of a long file", () => {
    const settings = pages({
      pageNumberFormat: "fraction",
      pageNumberStart: 1,
      differentOddEven: true,
      pageNumberPositionSet: false,
    });
    expect(previewPlan(4, true).slots).toEqual([
      { kind: "page", index: 0 },
      { kind: "page", index: 1 },
      { kind: "page", index: 2 },
    ]);
    expect(previewPlan(4, true).total).toBe(4);
    expect(previewSheetNumbers(settings, 4)).toEqual(["1 / 4", "2 / 4", "3 / 4"]);
  });

  it("names a fraction file's skipped pages by number, not by a third sheet", () => {
    const settings = pages({ pageNumberFormat: "fraction" });
    expect(previewSheetNumbers(settings, 5)).toEqual(["4 / 8", "8 / 8"]);
    expect(previewSkipLabel(settings, 1, 3, 5)).toBe("Pages 5\u20137 skipped");
    expect(pageNumberFormatChips(4, 5).fraction).toBe("4 / 8");
  });
});
