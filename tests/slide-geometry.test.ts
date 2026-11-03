import { expect, it } from "vitest";
import { placeSlideObject, readSlideGeometry } from "../packages/core/src/slide-align";

it("reads a position and refuses a value that is not a number", () => {
  expect(readSlideGeometry({ x: "80", y: "20", width: "100", height: "40" })).toEqual({
    x: 80,
    y: 20,
    width: 100,
    height: 40,
  });
  const refused = readSlideGeometry({
    x: "secret-value",
    y: "20",
    width: "100",
    height: "40",
  });
  expect(refused).toEqual({ error: "Enter a number for x." });
  expect(JSON.stringify(refused)).not.toContain("secret-value");
  expect(readSlideGeometry({ x: "0", y: "0", width: "0", height: "40" })).toEqual({
    error: "Width and height must be greater than zero.",
  });
  const title = { id: "title", x: 10, y: 20, width: 100, height: 40, locked: true, rotation: 15 };
  const placed = placeSlideObject(title, { x: 80, y: 20, width: 100, height: 40, rotation: 90 });
  expect(placed.x).toBe(10);
  expect(placed.rotation).toBe(15);
  expect(title.x).toBe(10);
  expect(title.rotation).toBe(15);
  expect(readSlideGeometry({ x: "80", y: "20", width: "100", height: "40", rotation: "90" })).toEqual({
    x: 80,
    y: 20,
    width: 100,
    height: 40,
    rotation: 90,
  });
  const turned = readSlideGeometry({
    x: "80",
    y: "20",
    width: "100",
    height: "40",
    rotation: "secret-value",
  });
  expect(turned).toEqual({ error: "Enter a number for rotation." });
  expect(JSON.stringify(turned)).not.toContain("secret-value");
  expect(
    readSlideGeometry({ x: "80", y: "20", width: "100", height: "40", rotation: "361" }),
  ).toEqual({ error: "Keep rotation between 0 and 360." });
});
