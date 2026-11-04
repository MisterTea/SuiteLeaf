import { describe, expect, it } from "vitest";
import { presetFillPath } from "../packages/core/src/pptx-preset-geometry";
describe("mathematical shape geometry", () => {
  it("draws a plus with open corners rather than a filled bounding rectangle", () => {
    const path = presetFillPath('<a:prstGeom prst="mathPlus"/>', 100, 100)!;
    expect(path).toContain("13.26");
    expect(path.match(/L/g)).toHaveLength(11);
    expect(path).not.toContain("M 0 0");
  });
  it("honors plus thickness adjustment and clamps it", () => {
    const p = (v: number) =>
      presetFillPath(
        `<a:prstGeom prst="mathPlus"><a:avLst><a:gd name="adj1" fmla="val ${v}"/></a:avLst></a:prstGeom>`,
        100,
        100,
      );
    expect(p(40000)).not.toBe(p(23520));
    expect(p(-100)).toBe(p(0));
    expect(p(999999)).toBe(p(73490));
  });
});
it("draws two separated equal bars and honors the gap adjustment", () => {
  const base = presetFillPath('<a:prstGeom prst="mathEqual"/>', 100, 100)!;
  expect(base.match(/M/g)).toHaveLength(2);
  expect(base.match(/Z/g)).toHaveLength(2);
  const changed = presetFillPath(
    '<a:prstGeom prst="mathEqual"><a:avLst><a:gd name="adj2" fmla="val 20000"/></a:avLst></a:prstGeom>',
    100,
    100,
  );
  expect(changed).not.toBe(base);
});
