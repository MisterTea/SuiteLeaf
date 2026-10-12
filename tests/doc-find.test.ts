import { describe, expect, it } from "vitest";
import {
  clampToView,
  matchCounter,
  positionClearOf,
} from "../apps/web/src/editors/doc-find";

const view = { width: 1280, height: 800 };
// The dialog's default spot: top right, 440 × 317.
const dialog = { left: 800, top: 85, right: 1240, bottom: 402 };

describe("find dialog placement", () => {
  it("stays put when the current match is not under it", () => {
    expect(
      positionClearOf(dialog, { left: 480, top: 244, right: 527, bottom: 260 }, view),
    ).toBeNull();
  });

  it("moves below a match it would cover, keeping its column", () => {
    expect(
      positionClearOf(dialog, { left: 850, top: 283, right: 897, bottom: 299 }, view),
    ).toEqual({ left: 800, top: 315 });
  });

  it("moves above a match near the bottom of the window", () => {
    const low = { left: 800, top: 420, right: 1240, bottom: 737 };
    expect(
      positionClearOf(low, { left: 900, top: 600, right: 950, bottom: 616 }, view),
    ).toEqual({ left: 800, top: 600 - 16 - 317 });
  });

  it("moves beside the match when neither above nor below fits", () => {
    const tall = { left: 800, top: 20, right: 1240, bottom: 760 };
    expect(
      positionClearOf(tall, { left: 900, top: 380, right: 950, bottom: 396 }, view),
    ).toEqual({ left: 900 - 16 - 440, top: 20 });
  });

  it("keeps a dragged dialog inside the window", () => {
    const size = { width: 440, height: 317 };
    expect(clampToView({ left: -50, top: -10 }, size, view)).toEqual({ left: 8, top: 8 });
    expect(clampToView({ left: 1200, top: 700 }, size, view)).toEqual({
      left: 1280 - 440 - 8,
      top: 800 - 317 - 8,
    });
  });
});

describe("match counter", () => {
  it("says No results instead of 0 of 0", () => {
    expect(matchCounter("recieve", 0, -1)).toBe("No results");
  });

  it("counts the current match, or all matches when none is selected", () => {
    expect(matchCounter("recieve", 3, 0)).toBe("1 of 3");
    expect(matchCounter("recieve", 3, -1)).toBe("3 results");
    expect(matchCounter("recieve", 1, -1)).toBe("1 result");
    expect(matchCounter("", 0, -1)).toBe("");
  });
});
