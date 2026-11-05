import { expect, it } from "vitest";
import { presetFillPath, presetTextBox, presetVector } from "../packages/core/src/pptx-preset-geometry";

const cube = (adjust = 25000) => `<a:prstGeom prst="cube"><a:avLst><a:gd name="adj" fmla="val ${adjust}"/></a:avLst></a:prstGeom>`;

it("lays cube text on the front face rather than the entire shape", () => {
  expect(presetTextBox(cube(), { x: 10, y: 20, width: 200, height: 100 }))
    .toEqual({ x: 10, y: 45, width: 175, height: 75 });
  expect(presetTextBox(cube(50000), { x: 0, y: 0, width: 100, height: 200 }))
    .toEqual({ x: 0, y: 50, width: 50, height: 150 });
});

it("draws three closed faces and a separate edge path, respecting adjusted depth", () => {
  const path = (adjust = 25000) => presetFillPath(cube(adjust), 200, 100)!;
  expect(path().match(/Z/g)).toHaveLength(3);
  expect(path()).toContain("M 0 25 L 175 25 L 175 100 L 0 100 Z");
  expect(path()).toContain("L 200 75");
  expect(path(50000)).toContain("M 0 50 L 150 50");
  expect(path(-20)).toEqual(path(0));
  expect(path(120000)).toEqual(path(100000));
  expect(presetVector("cube", cube(), 200, 100, "#4472c4", "#000000", 1)?.src)
    .toMatch(/^data:image\/svg\+xml;base64,/);
});
