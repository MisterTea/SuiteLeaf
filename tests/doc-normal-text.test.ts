import { describe, expect, it } from "vitest";
import {
  blockAcceptsNormalText,
  normalTextStyle,
  normalTextToApply,
} from "../apps/web/src/editors/doc-normal-text";

describe("Normal text style", () => {
  it("keeps family, size, and color and drops blanks", () => {
    expect(
      normalTextStyle({
        fontFamily: " Georgia ",
        fontSize: "18pt",
        color: "#1a73e8",
        backgroundColor: "yellow",
      }),
    ).toEqual({ fontFamily: "Georgia", fontSize: "18pt", color: "#1a73e8" });
    expect(normalTextStyle({ fontFamily: "  ", fontSize: null, color: 12 })).toBeNull();
    expect(normalTextStyle({ fontFamily: "Georgia; color: red", fontSize: "huge" })).toBeNull();
  });

  it("fills only the font attributes the text does not already have", () => {
    const style = { fontFamily: "Georgia", fontSize: "18pt", color: "#1a73e8" };
    expect(normalTextToApply(style, { fontFamily: "Courier New" })).toEqual({
      fontSize: "18pt",
      color: "#1a73e8",
    });
    expect(normalTextToApply(style, { fontFamily: "Georgia", fontSize: "18pt", color: "#1a73e8" })).toBeNull();
    expect(normalTextToApply(null, {})).toBeNull();
    expect(normalTextToApply({ fontFamily: "Georgia" }, {})).toEqual({ fontFamily: "Georgia" });
  });

  it("gives the style to paragraphs and leaves headings alone", () => {
    expect(blockAcceptsNormalText("paragraph")).toBe(true);
    expect(blockAcceptsNormalText("heading")).toBe(false);
  });
});
