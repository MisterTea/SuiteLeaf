import { describe, expect, it } from "vitest";
import { cssStrokeStyle, strokeDashArray } from "../packages/core/src/pptx-line-dash";
import { shapeArtwork } from "../packages/core/src/pptx-geometry";
import { themePaint } from "../packages/core/src/pptx-theme";

const slide = { width: 960, emuWidth: 12192000 };
const box = { x: 0, y: 0, width: 200, height: 80 };

function svg(src: string | undefined) {
  return Buffer.from(src?.split(",")[1] || "", "base64").toString("utf8");
}

describe("DrawingML preset dashes", () => {
  it("scales a dot pattern by the stroke width", () => {
    expect(strokeDashArray("dot", 10)).toBe("10 30");
    expect(strokeDashArray("solid", 10)).toBeUndefined();
    expect(cssStrokeStyle("dot")).toBe("dotted");
    expect(cssStrokeStyle("sysDash")).toBe("sysDash");
    expect(cssStrokeStyle("sysDot")).toBe("sysDot");
    expect(cssStrokeStyle("solid")).toBeUndefined();
    expect(cssStrokeStyle("not-a-dash")).toBeUndefined();
  });

  it("paints a dotted custom outline and a dashed rectangle", () => {
    const dotted = `<p:sp><p:spPr>
      <a:xfrm><a:off x="0" y="0"/><a:ext cx="400000" cy="200000"/></a:xfrm>
      <a:custGeom><a:pathLst><a:path w="400" h="200">
        <a:moveTo><a:pt x="40" y="0"/></a:moveTo>
        <a:lnTo><a:pt x="360" y="0"/></a:lnTo>
        <a:lnTo><a:pt x="360" y="200"/></a:lnTo>
        <a:close/>
      </a:path></a:pathLst></a:custGeom>
      <a:noFill/><a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:prstDash val="dot"/></a:ln>
    </p:spPr></p:sp>`;
    const paint = themePaint(undefined, dotted);
    expect(paint.dash).toBe("dot");
    const art = shapeArtwork(dotted, paint, box, slide);
    expect(art?.type).toBe("image");
    expect(svg(art && "src" in art ? art.src : undefined)).toContain('stroke-dasharray="');

    const dashed = `<p:sp><p:spPr>
      <a:xfrm><a:off x="0" y="0"/><a:ext cx="400000" cy="200000"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:noFill/><a:ln w="12700"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:prstDash val="sysDash"/></a:ln>
    </p:spPr></p:sp>`;
    const line = themePaint(undefined, dashed);
    expect(line.dash).toBe("sysDash");
    expect(shapeArtwork(dashed, line, box, slide)).toMatchObject({
      type: "shape",
      shapeType: "rect",
      strokeStyle: "sysDash",
    });
  });

  it("lets an explicit solid line replace a styled dash", () => {
    const xml = `<p:sp><p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef></p:style>
      <p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="solid"/></a:ln></p:spPr></p:sp>`;
    expect(themePaint(undefined, xml).dash).toBeUndefined();
  });
});
