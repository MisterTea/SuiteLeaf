import { describe, expect, it } from "vitest";
import { groupFillXml } from "../packages/core/src/pptx-geometry";
import { deck, svg } from "./pptx-geometry-fixtures";

describe("PowerPoint geometry", () => {
  it("scales a custom curve stroke into the path viewBox", async () => {
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2667000" cy="965200"/></a:xfrm>
          <a:custGeom><a:pathLst><a:path w="1680" h="608">
            <a:moveTo><a:pt x="1680" y="160"/></a:moveTo>
            <a:cubicBezTo><a:pt x="800" y="0"/><a:pt x="400" y="608"/><a:pt x="0" y="400"/></a:cubicBezTo>
          </a:path></a:pathLst></a:custGeom>
          <a:noFill/><a:ln w="127000"><a:solidFill><a:srgbClr val="000066"/></a:solidFill></a:ln>
        </p:spPr></p:sp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
    );
    const curve = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
      (el) => el.alt === "Slide shape",
    );
    const markup = svg(curve?.src);
    expect(markup).toContain('fill="none"');
    expect(markup).toContain('stroke="#000066"');
    const width = Number(/stroke-width="([^"]+)"/.exec(markup)?.[1]);
    expect(width).toBeGreaterThan(70);
    expect(width).toBeLessThan(90);
  });

  it("leaves a custom path unfilled when the path declines the shape fill", async () => {
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:custGeom><a:pathLst>
            <a:path w="200" h="100" fill="none" stroke="1">
              <a:moveTo><a:pt x="20" y="0"/></a:moveTo>
              <a:lnTo><a:pt x="0" y="20"/></a:lnTo>
              <a:lnTo><a:pt x="0" y="80"/></a:lnTo>
              <a:lnTo><a:pt x="180" y="100"/></a:lnTo>
            </a:path>
            <a:path w="200" h="100" stroke="0">
              <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
              <a:lnTo><a:pt x="40" y="0"/></a:lnTo>
              <a:lnTo><a:pt x="0" y="40"/></a:lnTo>
              <a:close/>
            </a:path>
          </a:pathLst></a:custGeom>
          <a:solidFill><a:srgbClr val="5E2028"/></a:solidFill>
          <a:ln w="19050"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="dot"/></a:ln>
        </p:spPr></p:sp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
    );
    const markup = svg(
      parsed.content.slides[parsed.content.slideOrder[0]].elements.find((el) => el.alt === "Slide shape")?.src,
    );
    expect(markup).toContain('d="M 20 0 L 0 20 L 0 80 L 180 100" fill="none"');
    expect(markup).toContain('d="M 0 0 L 40 0 L 0 40 Z" fill="#5E2028"');
    expect(markup).not.toContain('d="M 20 0 L 0 20 L 0 80 L 180 100" fill="#5E2028"');
    expect(markup).toContain("stroke-dasharray");
  });

  it("scales a grouped curve stroke by the group's slide size", async () => {
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:grpSp><p:nvGrpSpPr><p:cNvPr id="8"/></p:nvGrpSpPr>
          <p:grpSpPr><a:xfrm><a:off x="1181100" y="4724400"/><a:ext cx="4724400" cy="1854200"/><a:chOff x="744" y="2976"/><a:chExt cx="2976" cy="1168"/></a:xfrm></p:grpSpPr>
          <p:sp><p:spPr><a:xfrm><a:off x="744" y="2976"/><a:ext cx="2976" cy="1168"/></a:xfrm>
            <a:custGeom><a:pathLst><a:path w="2976" h="1168">
              <a:moveTo><a:pt x="0" y="1168"/></a:moveTo>
              <a:cubicBezTo><a:pt x="800" y="400"/><a:pt x="2000" y="100"/><a:pt x="2976" y="200"/></a:cubicBezTo>
            </a:path></a:pathLst></a:custGeom>
            <a:noFill/><a:ln w="127000"><a:solidFill><a:srgbClr val="CC0000"/></a:solidFill></a:ln>
          </p:spPr></p:sp>
        </p:grpSp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
    );
    const curve = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
      (el) => el.alt === "Slide shape",
    );
    const width = Number(/stroke-width="([^"]+)"/.exec(svg(curve?.src))?.[1]);
    expect(width).toBeGreaterThan(70);
    expect(width).toBeLessThan(90);
  });

  it("paints a child that inherits its group's fill", async () => {
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:grpSp><p:nvGrpSpPr><p:cNvPr id="4"/></p:nvGrpSpPr>
          <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/><a:chOff x="0" y="0"/><a:chExt cx="4000000" cy="2000000"/></a:xfrm>
            <a:solidFill><a:srgbClr val="0070C0"/></a:solidFill></p:grpSpPr>
          <p:sp><p:nvSpPr><p:cNvPr id="5" name="Land"/></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="800"/></a:xfrm>
              <a:custGeom><a:pathLst><a:path w="100" h="80"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="50" y="80"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>
              <a:grpFill/></p:spPr>
          </p:sp>
        </p:grpSp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
    );
    const land = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
      (el) => el.alt === "Slide shape",
    );
    expect(land?.type).toBe("image");
    expect(svg(land?.src)).toContain('fill="#0070C0"');
    const slide = `<p:grpSp><p:grpSpPr><a:solidFill><a:srgbClr val="0070C0"/></a:solidFill></p:grpSpPr><p:sp>child</p:sp></p:grpSp>`;
    expect(groupFillXml(slide, slide.indexOf("child"))).toContain("0070C0");
  });

  it("inherits a group fill, skips hidden art and an omitted slide number, and paints a placeholder band", async () => {
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
          <p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="3"/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="2850357"/><a:ext cx="9144000" cy="848643"/></a:xfrm>
            <a:solidFill><a:srgbClr val="C00000"><a:alpha val="70000"/></a:srgbClr></a:solidFill></p:spPr>
        </p:sp>
      </p:spTree></p:cSld></p:sldLayout>`,
      `<p:sldMaster><p:cSld><p:spTree>
        <p:grpSp><p:nvGrpSpPr><p:cNvPr id="4"/></p:nvGrpSpPr>
          <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="1124744"/><a:chOff x="0" y="0"/><a:chExt cx="9144000" cy="1124744"/></a:xfrm>
            <a:solidFill><a:srgbClr val="BDD7EE"/></a:solidFill></p:grpSpPr>
          <p:sp><p:nvSpPr><p:cNvPr id="8" name="Header"/></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="1124744"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:grpFill/></p:spPr>
            <p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style>
          </p:sp>
        </p:grpSp>
        <p:sp><p:nvSpPr><p:cNvPr id="9" name="Note" hidden="1"/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="400000" cy="400000"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="000000"/></a:solidFill></p:spPr>
        </p:sp>
        <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" idx="4"/></p:nvPr></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="609938" y="4773600"/><a:ext cx="601313" cy="351000"/></a:xfrm></p:spPr>
          <p:txBody><a:bodyPr/><a:p><a:fld type="slidenum"><a:t>‹#›</a:t></a:fld></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld></p:sldMaster>`,
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const header = slide.elements.find((el) => el.fill?.toLowerCase() === "#bdd7ee");
    expect(header?.type).toBe("shape");
    expect(slide.elements.some((el) => el.fill?.toLowerCase() === "#000000")).toBe(false);
    expect(slide.elements.some((el) => el.content === "1")).toBe(false);
    expect(slide.elements.some((el) => el.fill === "rgba(192, 0, 0, 0.7)")).toBe(true);
  });

  it("omits shapes inside a hidden group on the slide and the master", async () => {
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:grpSp><p:nvGrpSpPr><p:cNvPr id="1" name="Grid" hidden="1"/></p:nvGrpSpPr>
          <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="400000"/><a:chOff x="0" y="0"/><a:chExt cx="9144000" cy="400000"/></a:xfrm></p:grpSpPr>
          <p:sp><p:nvSpPr><p:cNvPr id="2" name="Band"/></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="400000"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              <a:solidFill><a:srgbClr val="9EBA2E"><a:alpha val="50000"/></a:srgbClr></a:solidFill></p:spPr>
            <p:txBody><a:bodyPr/><a:p><a:r><a:t>Hidden band</a:t></a:r></a:p></p:txBody>
          </p:sp>
        </p:grpSp>
        <p:sp><p:nvSpPr><p:cNvPr id="3" name="Footer"/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="6400000"/><a:ext cx="9144000" cy="400000"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:solidFill><a:srgbClr val="0C2577"/></a:solidFill></p:spPr>
        </p:sp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
      `<p:sldMaster><p:cSld><p:spTree>
        <p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="Master grid" hidden="1"/></p:nvGrpSpPr>
          <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/><a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/></a:xfrm></p:grpSpPr>
          <p:sp><p:nvSpPr><p:cNvPr id="5" name="Master band"/></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="300000"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              <a:solidFill><a:srgbClr val="FF00AA"/></a:solidFill></p:spPr>
          </p:sp>
        </p:grpSp>
        <p:sp><p:nvSpPr><p:cNvPr id="6" name="Shown master"/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="200000"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:spPr>
        </p:sp>
      </p:spTree></p:cSld></p:sldMaster>`,
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const fills = slide.elements.map((el) => (el.fill || "").toLowerCase());
    expect(fills.some((fill) => fill.includes("9eba2e") || fill.includes("158, 186, 46"))).toBe(false);
    expect(fills.some((fill) => fill.includes("ff00aa"))).toBe(false);
    expect(slide.elements.some((el) => el.content?.includes("Hidden band"))).toBe(false);
    expect(fills).toContain("#0c2577");
    expect(fills).toContain("#112233");
  });
});
