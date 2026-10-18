import { expect, test } from "vitest";
import { sheetTextRotation } from "../apps/web/src/sheet-text-rotation";

test("rotate up, rotate down, and vertical match the angles the grid paints", () => {
  // Univer rotates with a positive canvas angle, which is clockwise.
  // Its own menu stores rotate-up as -90, rotate-down as 90, and stacked
  // text as the non-numeric rotation { a: 0, v: 1 }.
  expect(sheetTextRotation.up).toBe(-90);
  expect(sheetTextRotation.down).toBe(90);
  expect(sheetTextRotation.vertical).toEqual({ a: 0, v: 1 });
  expect(sheetTextRotation.tiltCounterclockwise).toBe(-45);
  expect(sheetTextRotation.tiltClockwise).toBe(45);
  expect(sheetTextRotation.none).toBeNull();
});
