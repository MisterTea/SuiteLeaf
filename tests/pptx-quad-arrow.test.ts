import { expect, it } from "vitest";
import { shapeArtwork } from "../packages/core/src/pptx-geometry";
import type { ShapePaint } from "../packages/core/src/pptx-theme";

const paint: ShapePaint = { fill: "#ffd966", stroke: "#000000", strokeEmu: 9525 };
const box = { x: 0, y: 0, width: 100, height: 80 };
const slide = { width: 960, emuWidth: 12192000 };

function svg(src: string | undefined) {
  const data = /^data:image\/svg\+xml;base64,(.+)$/.exec(src || "");
  return data ? Buffer.from(data[1], "base64").toString("utf8") : "";
}

function art(name: string, av = "") {
  return shapeArtwork(
    `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm><a:prstGeom prst="${name}"><a:avLst>${av}</a:avLst></a:prstGeom></p:spPr></p:sp>`,
    paint,
    box,
    slide,
  );
}

it("paints a four-way arrow instead of its bounding box", () => {
  const drawn = svg(art("quadArrow")?.src);
  expect(art("quadArrow")?.type).toBe("image");
  expect(drawn).toContain("M 0 500000");
  expect(drawn).toContain("L 1000000 0");
  expect(drawn).not.toContain("M 0 0 L 2000000 0");
});

it("uses adj1 as the arrow shaft and adj2 as the head", () => {
  const fullShaft = svg(
    art("rightArrow", `<a:gd name="adj1" fmla="val 100000"/><a:gd name="adj2" fmla="val 50000"/>`)?.src,
  );
  expect(fullShaft).toContain("M 0 0");
  const longHead = svg(
    art("rightArrow", `<a:gd name="adj1" fmla="val 50000"/><a:gd name="adj2" fmla="val 100000"/>`)?.src,
  );
  expect(longHead).toContain("M 0 20");
  expect(longHead).toContain("L 50 20");
});
