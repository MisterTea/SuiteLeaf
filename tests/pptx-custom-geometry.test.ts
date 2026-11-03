import { describe, expect, it } from "vitest";
import { shapeArtwork } from "../packages/core/src/pptx-geometry";

function svg(src: string | undefined) {
  const data = /^data:image\/svg\+xml;base64,(.+)$/.exec(src || "");
  return data ? Buffer.from(data[1], "base64").toString("utf8") : "";
}

describe("custom geometry guides", () => {
  it("resolves guide points and arcTo corners into the shape extent", () => {
    const xml = `<p:sp><p:spPr>
      <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
      <a:custGeom>
        <a:avLst><a:gd name="adj" fmla="val 5000"/></a:avLst>
        <a:gdLst>
          <a:gd name="a" fmla="pin 0 adj 50000"/>
          <a:gd name="x1" fmla="*/ ss a 100000"/>
          <a:gd name="x2" fmla="+- r 0 x1"/>
          <a:gd name="y2" fmla="+- b 0 x1"/>
        </a:gdLst>
        <a:pathLst><a:path>
          <a:moveTo><a:pt x="x1" y="t"/></a:moveTo>
          <a:lnTo><a:pt x="x2" y="t"/></a:lnTo>
          <a:arcTo wR="x1" hR="x1" stAng="3cd4" swAng="cd4"/>
          <a:lnTo><a:pt x="r" y="y2"/></a:lnTo>
          <a:lnTo><a:pt x="l" y="b"/></a:lnTo>
          <a:close/>
        </a:path></a:pathLst>
      </a:custGeom>
      <a:solidFill><a:srgbClr val="70AD47"/></a:solidFill>
      <a:ln w="12700"><a:solidFill><a:srgbClr val="507E32"/></a:solidFill></a:ln>
    </p:spPr></p:sp>`;
    const art = shapeArtwork(
      xml,
      { fill: "#70AD47", stroke: "#507E32", strokeEmu: 12700 },
      { x: 10, y: 20, width: 160, height: 80 },
      { width: 960, emuWidth: 12192000 },
    );
    expect(art?.type).toBe("image");
    const markup = svg(art?.src);
    expect(markup).toContain('viewBox="0 0 2000000 1000000"');
    expect(markup).toContain("M 50000 0");
    expect(markup).toContain("L 1950000 0");
    expect(markup).toContain("A 50000 50000");
    expect(markup).toContain('fill="#70AD47"');
    expect(markup).not.toContain("M 0 0 L 2000000 0 L 2000000 1000000");
  });
});
