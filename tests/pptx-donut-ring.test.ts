import { describe, expect, it } from "vitest";
import { shapeArtwork } from "../packages/core/src/pptx-geometry";
import type { ShapePaint } from "../packages/core/src/pptx-theme";

const paint: ShapePaint = { fill: "#2896F9" };
const box = { x: 0, y: 0, width: 100, height: 80 };
const slide = { width: 960, emuWidth: 12192000 };

function svg(src: string | undefined) {
  const data = /^data:image\/svg\+xml;base64,(.+)$/.exec(src || "");
  return data ? Buffer.from(data[1], "base64").toString("utf8") : "";
}

function donut(av: string, cx = "2000000", cy = "1000000") {
  return shapeArtwork(
    `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="donut"><a:avLst>${av}</a:avLst></a:prstGeom></p:spPr></p:sp>`,
    paint,
    box,
    slide,
  );
}

describe("DrawingML donut ring", () => {
  it("subtracts the adjust as ring thickness so the hole stays open", () => {
    // Default adj 25000 on a 2:1 box: thickness is a quarter of the short side.
    const open = svg(donut("").src);
    expect(open).toContain("evenodd");
    expect(open).toContain("A 37.5 20");
    // A small adjust is a thin ring. The hole is most of the ellipse, not a pinprick.
    const cycle = svg(donut(`<a:gd name="adj" fmla="val 12597"/>`, "2000000", "2000000").src);
    expect(cycle).toContain("A 37.4 29.92");
    expect(cycle).not.toContain("A 6.2985");
  });

  it("omits the hole when the thickness closes the shorter radius", () => {
    const closed = svg(donut(`<a:gd name="adj" fmla="val 50000"/>`, "1000000", "1000000").src);
    expect(closed).toContain("evenodd");
    expect(closed.match(/A /g)?.length).toBe(2);
  });
});
