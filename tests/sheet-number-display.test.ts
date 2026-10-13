import { expect, test, vi } from "vitest";
import { FontCache, SpreadsheetSkeleton } from "@univerjs/engine-render";

const prototype = SpreadsheetSkeleton.prototype as any;
// The engine's own General display, stubbed: it switches to scientific
// notation as soon as the full-precision text overflows the cell.
prototype[Symbol.for("suiteleaf.excel-number-display.original")] = (
  _row: number,
  _col: number,
  cache: any,
) => {
  cache.displayText = cache.engineText;
};
vi.spyOn(FontCache, "getMeasureText").mockImplementation(
  (text: string) => ({ width: text.length * 7 }) as any,
);
await import("../apps/web/src/excel-number-display");

const display = (v: number, engineText: string, style: object = {}) => {
  const skeleton = {
    worksheet: { getConfig: () => ({}) },
    getCellWithCoordByIndex: () => ({ startX: 0, endX: 74 }),
  };
  const cache: any = { cellData: { v, t: 2 }, engineText, fontString: "" };
  prototype._applyNumberDisplay.call(skeleton, 1, 4, cache, style);
  return cache.displayText;
};

test("native sheets round overflowing General fractions instead of using scientific notation", () => {
  expect(display(1020 / 1880, "5.42553E-01")).toBe("0.54255319");
  expect(display(-560 / 1880, "-2.9787E-01")).toBe("-0.2978723");
});

test("native sheets keep fitting numbers and explicit formats as the engine drew them", () => {
  expect(display(1020, "1020")).toBe("1020");
  expect(display(0.000000000012, "1.2E-11")).toBe("1.2E-11");
  expect(display(-5, "####", { n: { pattern: '"$"#,##0.00' } })).toBe("####");
});
