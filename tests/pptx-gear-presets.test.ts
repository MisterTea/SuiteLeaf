import { describe, expect, it } from "vitest";
import { shapeArtwork } from "../packages/core/src/pptx-geometry";
import type { ShapePaint } from "../packages/core/src/pptx-theme";

const paint: ShapePaint = { fill: "#e39b6a", stroke: "#333333", strokeEmu: 9525 };
const box = { x: 10, y: 20, width: 120, height: 120 };
const slide = { width: 960, emuWidth: 12192000 };

function art(name: string, adjusts = "") {
  return shapeArtwork(
    `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="2000000"/></a:xfrm><a:prstGeom prst="${name}"><a:avLst>${adjusts}</a:avLst></a:prstGeom></p:spPr></p:sp>`,
    paint,
    box,
    slide,
  );
}

function svg(src: string | undefined) {
  const match = src?.match(/^data:image\/svg\+xml;base64,(.+)$/);
  if (!match) return "";
  return Buffer.from(match[1], "base64").toString("utf8");
}

describe("gear and left circular arrow presets", () => {
  it("paints a toothed gear instead of the shape box", () => {
    for (const name of ["gear6", "gear9"]) {
      const drawn = art(name);
      expect(drawn?.type, name).toBe("image");
      const markup = svg(drawn?.src);
      expect(markup.match(/A /g)?.length ?? 0, name).toBeGreaterThanOrEqual(6);
      expect(markup, name).not.toContain("M 0 0 L 2000000 0 L 2000000 2000000");
    }
  });

  it("paints a left circular arrow from its stored angles", () => {
    const adjusts = [
      ["adj1", 6452],
      ["adj2", 429999],
      ["adj3", 10489124],
      ["adj4", 14837806],
      ["adj5", 7527],
    ]
      .map(([name, value]) => `<a:gd name="${name}" fmla="val ${value}"/>`)
      .join("");
    const drawn = art("leftCircularArrow", adjusts);
    expect(drawn?.type).toBe("image");
    const markup = svg(drawn?.src);
    expect(markup.match(/A /g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(markup).toContain("L ");
    expect(markup).not.toContain("M 0 0 L 2000000 0");
  });
});
