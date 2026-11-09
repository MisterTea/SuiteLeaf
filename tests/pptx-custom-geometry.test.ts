import { describe, expect, it } from "vitest";
import { shapeArtwork } from "../packages/core/src/pptx-geometry";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { exportPptx } from "../packages/core/src/pptx-export";

function svg(src: string | undefined) {
  const data = /^data:image\/svg\+xml;base64,(.+)$/.exec(src || "");
  return data ? Buffer.from(data[1], "base64").toString("utf8") : "";
}

describe("custom geometry guides", () => {
  it("exports an ungrouped freeform arrow as editable DrawingML", async () => {
    const source = new JSZip();
    source.file("ppt/slides/slide1.xml", `<p:sld><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="2" name="Curve"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
      <a:custGeom><a:pathLst><a:path w="2000000" h="1000000">
      <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
      <a:cubicBezTo><a:pt x="700000" y="0"/><a:pt x="1200000" y="1000000"/><a:pt x="2000000" y="1000000"/></a:cubicBezTo>
      </a:path></a:pathLst></a:custGeom><a:noFill/>
      <a:ln><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr>
      </p:sp></p:spTree></p:cSld></p:sld>`);
    const file = await parsePowerPoint(await source.generateAsync({ type: "uint8array" }));
    const deck = await JSZip.loadAsync(await exportPptx(file));
    const slide = await deck.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide).toContain("<a:cubicBezTo>");
    expect(slide).toContain('<a:tailEnd type="triangle"/>');
    expect(slide).toContain('<a:ln w="9525">');
    expect(slide).not.toContain("<p:pic>");
  });

  it("uses the shape extent for numeric paths without a path size", () => {
    const xml = `<p:spPr><a:xfrm><a:ext cx="2000000" cy="1000000"/></a:xfrm>
      <a:custGeom><a:pathLst><a:path fill="none">
      <a:moveTo><a:pt x="0" y="500000"/></a:moveTo>
      <a:lnTo><a:pt x="2000000" y="500000"/></a:lnTo>
      </a:path></a:pathLst></a:custGeom></p:spPr>`;
    const art = shapeArtwork(
      xml,
      { stroke: "#123456", strokeEmu: 12700 },
      { x: 0, y: 0, width: 160, height: 80 },
      { width: 960, emuWidth: 12000000 },
    );
    const markup = svg(art?.src);
    expect(markup).toContain('viewBox="0 0 2000000 1000000"');
    expect(markup).toContain("M 0 500000 L 2000000 500000");
  });

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
