import { expect, it } from "vitest";
import { rotatedPictureFrame, turnedPictureTransform } from "../apps/web/src/editors/slide-picture-frame";

it("turns a wide picture's frame into the rotated rectangle", () => {
  const flat = rotatedPictureFrame({ x: 10, y: 20, width: 200, height: 80, rotation: 0 });
  expect(flat).toEqual({ x: 10, y: 20, width: 200, height: 80, shapeX: 0, shapeY: 0 });
  const quarter = rotatedPictureFrame({ x: 400, y: 0, width: 500, height: 520, rotation: 90 });
  expect(quarter).toEqual({ x: 390, y: 10, width: 520, height: 500, shapeX: 10, shapeY: -10 });
  const half = rotatedPictureFrame({ x: 8, y: 4, width: 40, height: 16, rotation: 180 });
  expect(half).toMatchObject({ x: 8, y: 4, width: 40, height: 16, shapeX: 0, shapeY: 0 });
});

it("flips a rotated picture before the turn", () => {
  const frame = { width: 40, height: 16 };
  expect(turnedPictureTransform({ rotation: 180 }, frame)).toBe("rotate(180 20 8)");
  expect(turnedPictureTransform({ rotation: 180, flipH: true }, frame)).toBe(
    "translate(20 8) rotate(180) scale(-1 1) translate(-20 -8)",
  );
  expect(turnedPictureTransform({ rotation: 90, flipV: true }, frame)).toContain("scale(1 -1)");
});
