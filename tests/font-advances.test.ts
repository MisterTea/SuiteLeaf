import { describe, expect, it } from "vitest";
import { fontAdvance } from "../packages/core/src/font-advances";

const width = (text: string, font?: string, bold = false, italic = false) =>
  [...text].reduce((sum, ch) => sum + fontAdvance(font, bold, italic)(ch), 0);

describe("shipped horizontal font advances", () => {
  it("uses actual hmtx values without a synthetic bold multiplier", () => {
    expect(width("New  England   Journal  of Medicine", "Calibri") * 14).toBeCloseTo(202.712890625, 8);
    expect(width("New  England   Journal  of Medicine", "Arial Narrow") * 14).toBeCloseTo(183.778, 8);
    expect(width("Citaciones en 2019 a DC 2017-2018", "Calibri", true) * 14).toBeCloseTo(202.548828125, 8);
    expect(width("P(Xt|Xt-1)", "Calibri", true) * 18).toBeCloseTo(76.2890625, 8);
  });

  it("uses shared aliases, styles, and renderer fallback", () => {
    expect(width("Wide mm", "SuiteLeaf Pine")).toBe(width("Wide mm", "Arial Narrow"));
    expect(width("Wide mm", "CALIBRI")).toBe(width("Wide mm", "Calibri"));
    expect(width("Wide mm", "missing face")).toBe(width("Wide mm"));
    expect(width("Wide mm", "Calibri", false, true)).not.toBe(width("Wide mm", "Calibri", true, true));
    expect(fontAdvance("Calibri")(String.fromCodePoint(0x10ffff))).toBeGreaterThan(0);
    expect(fontAdvance("Calibri")(" ")).toBeCloseTo(463 / 2048, 10);
    expect(fontAdvance("Calibri")("i")).toBeLessThan(fontAdvance("Calibri")("W"));
    expect(fontAdvance("Calibri")("")).toBeGreaterThanOrEqual(0);
  });
});
