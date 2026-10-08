import { describe, expect, it } from "vitest";
import { excelColumnWidthPixels } from "../apps/web/src/excel-layout";

describe("Excel Normal font character widths", () => {
  it("matches a native Times substitute's default eight-character column", () => {
    // Frutiger 10 pt is substituted with Times by native Excel and Chromium.
    expect(excelColumnWidthPixels(6.664993)).toBe(60);
  });
  it("matches the Calibri native column widths including source padding", () => {
    expect(excelColumnWidthPixels(7.43, 15.28515625)).toBe((92 * 96) / 72);
    expect(excelColumnWidthPixels(7.43, 12.42578125)).toBe((75 * 96) / 72);
  });
  it("matches all source column boundaries in a genuine native form capture", () => {
    const chars = [
      4.77734375, 8.33203125, 4.6640625, 4.6640625, 4, 4.33203125, 6.33203125,
      5, 6.109375, 3.33203125, 3.33203125, 8.6640625, 8.6640625, 8.6640625,
      10.6640625,
    ];
    const points = [29, 50, 28, 28, 24, 26, 38, 30, 37, 20, 20, 52, 52, 52, 64];
    expect(chars.map((w) => excelColumnWidthPixels(8, w))).toEqual(
      points.map((w) => (w * 96) / 72),
    );
  });
  it("uses the standard 96 dpi stored-width conversion on other platforms", () => {
    expect(excelColumnWidthPixels(7, 15.28515625, 8, false)).toBe(107);
  });
  it("uses the workbook's base width and respects narrow padded columns", () => {
    expect(excelColumnWidthPixels(8, undefined, 10)).toBe((65 * 96) / 72);
    expect(excelColumnWidthPixels(7, 0)).toBe(0);
  });
});
