import { expect, it } from "vitest";
import { clipBoxToSlide, offslideShiftStyle } from "../apps/web/src/editors/slide-print-clip";

it("pulls a text box that starts above the slide onto the page", () => {
  const clip = clipBoxToSlide({ x: 40, y: -80, width: 300, height: 400 }, 960, 720);
  expect(clip).toMatchObject({
    x: 40,
    y: 0,
    width: 300,
    height: 320,
    originWidth: 300,
    originHeight: 400,
    shiftX: 0,
    shiftY: 80,
  });
  expect(offslideShiftStyle(clip!).top).toBe(`${(-80 / 320) * 100}%`);
  expect(offslideShiftStyle(clip!).height).toBe(`${(400 / 320) * 100}%`);
});

it("leaves a text box that already starts on the slide", () => {
  expect(clipBoxToSlide({ x: 10, y: 10, width: 100, height: 40 }, 960, 720)).toBeUndefined();
  expect(
    clipBoxToSlide({ x: 900, y: 680, width: 200, height: 80 }, 960, 720),
  ).toBeUndefined();
  expect(clipBoxToSlide({ x: -8, y: 40, width: 200, height: 80 }, 960, 720)).toBeUndefined();
});

it("skips a rotated box and one parked fully outside the slide", () => {
  expect(
    clipBoxToSlide({ x: -20, y: 10, width: 80, height: 40, rotation: 90 }, 960, 720),
  ).toBeUndefined();
  expect(clipBoxToSlide({ x: -40, y: -40, width: 20, height: 20 }, 960, 720)).toBeUndefined();
});
