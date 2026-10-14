import { describe, expect, it } from "vitest";
import { hsvToHex, hsvToRgb, parseHex, rgbToHex, rgbToHsv } from "../apps/web/src/editors/color-picker";

describe("color picker", () => {
  it("round-trips a saturated color through hsv", () => {
    const rgb = parseHex("#a8a88a");
    expect(rgb).toEqual({ r: 168, g: 168, b: 138 });
    const hsv = rgbToHsv(rgb!);
    const back = hsvToRgb(hsv);
    expect(rgbToHex(back)).toBe("#a8a88a");
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe("#ff0000");
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe("#00ff00");
  });
});