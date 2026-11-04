import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { presentationSchema } from "../packages/core/src/index";
import { symbolFontChar } from "../packages/core/src/pptx-lists";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { backgroundCss, duotoneColors } from "../packages/core/src/pptx-theme";
import { repeatsSlideBackground, slidePointScale } from "../packages/core/src/pptx-geometry";
import { theme, relation, deck, svg } from "./pptx-geometry-fixtures";

describe("PowerPoint geometry", () => {
  it("paints layout polygons and triangles with theme alpha, and skips an unplaced slide number", async () => {
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="1507067" y="2404534"/><a:ext cx="7766936" cy="3108370"/></a:xfrm></p:spPr>
          <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="4000" cap="small"/><a:t>SunCatcher</a:t></a:r></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout showMasterSp="0"><p:cSld><p:spTree>
        <p:grpSp><p:nvGrpSpPr><p:cNvPr id="7" name="Group"/></p:nvGrpSpPr>
          <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/><a:chOff x="0" y="0"/><a:chExt cx="12192000" cy="6858000"/></a:xfrm></p:grpSpPr>
          <p:sp><p:nvSpPr><p:cNvPr id="24" name="Polygon"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="6858000"/></a:xfrm>
              <a:custGeom><a:pathLst><a:path w="3000000" h="6858000"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="3000000" y="0"/></a:lnTo><a:lnTo><a:pt x="0" y="6858000"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>
              <a:solidFill><a:schemeClr val="accent1"><a:alpha val="30000"/></a:schemeClr></a:solidFill>
              <a:ln><a:noFill/></a:ln>
            </p:spPr>
          </p:sp>
          <p:sp><p:nvSpPr><p:cNvPr id="26" name="Triangle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="9000000" y="0"/><a:ext cx="2000000" cy="6858000"/></a:xfrm>
              <a:prstGeom prst="triangle"><a:avLst><a:gd name="adj" fmla="val 100000"/></a:avLst></a:prstGeom>
              <a:solidFill><a:srgbClr val="54A021"/></a:solidFill><a:ln><a:noFill/></a:ln>
            </p:spPr>
          </p:sp>
        </p:grpSp>
        <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" idx="12"/></p:nvPr></p:nvSpPr><p:spPr/>
          <p:txBody><a:bodyPr/><a:p><a:fld type="slidenum"><a:t>‹#›</a:t></a:fld></a:p></p:txBody>
        </p:sp>
        <p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
          <p:txBody><a:bodyPr anchor="b" lIns="0" tIns="0" rIns="0" bIns="0"/></p:txBody>
        </p:sp>
      </p:spTree></p:cSld></p:sldLayout>`,
      `<p:sldMaster><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" idx="4"/></p:nvPr></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="8590663" y="6041362"/><a:ext cx="683339" cy="365125"/></a:xfrm></p:spPr>
        </p:sp>
      </p:spTree></p:cSld></p:sldMaster>`,
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const pictures = slide.elements.filter((el) => el.type === "image");
    expect(pictures).toHaveLength(2);
    expect(svg(pictures[0].src)).toContain('preserveAspectRatio="none"');
    expect(svg(pictures[0].src)).toContain('fill="rgba(144, 194, 38, 0.3)"');
    expect(svg(pictures[0].src)).toContain("M 0 0 L 3000000 0 L 0 6858000 Z");
    expect(pictures[0].width).toBeCloseTo((3000000 / 12192000) * 960, 3);
    expect(svg(pictures[1].src)).toContain("L 2000000 6858000 L 0 6858000 Z");
    const title = slide.elements.find((el) => el.content === "SunCatcher");
    expect(title).toMatchObject({
      valign: "bottom",
      inset: 0,
      align: "center",
      fontSize: 40,
    });
    expect(title?.runs?.[0]).toMatchObject({ caps: "small", fontSize: 40 });
    expect(slide.elements.some((el) => el.content === "1")).toBe(false);
    expect(parsed.content.pointWidth).toBeCloseTo(960, 3);
    expect(parsed.content.pointHeight).toBeCloseTo(540, 3);
    expect(slidePointScale(960, 2381)).toBeCloseTo(960 / 2381, 5);
  });

  it("paints a placeholder style fill behind its text", async () => {
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
          <p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Services</a:t></a:r></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="3000000"/><a:ext cx="8000000" cy="2000000"/></a:xfrm></p:spPr>
          <p:style><a:fillRef idx="1"><a:schemeClr val="accent4"/></a:fillRef></p:style>
        </p:sp>
      </p:spTree></p:cSld></p:sldLayout>`,
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const bar = slide.elements.find((el) => el.type === "shape");
    expect(bar?.fill).toBe("#e76618");
    expect(slide.elements.some((el) => el.content === "Services")).toBe(true);
  });

  it("paints a slide color-map override that turns bg1 black", async () => {
    const parsed = await deck(
      `<p:sld><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="400000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:solidFill><a:schemeClr val="tx1"/></a:solidFill></p:spPr>
          <p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Dark</a:t></a:r></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"/></p:clrMapOvr></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree/></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
      `<p:sldMaster><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree/></p:cSld></p:sldMaster>`,
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    expect(slide.background?.color?.toLowerCase()).toBe("#000000");
    const text = slide.elements.find((el) => el.content === "Dark");
    expect(text?.color?.toLowerCase()).toBe("#ffffff");
  });

  it("uses the theme background fill a bgRef points at", () => {
    const css = backgroundCss(
      theme,
      `<p:bg><p:bgRef idx="1002"><a:schemeClr val="accent1"/></p:bgRef></p:bg>`,
    );
    expect(css).toContain("linear-gradient(");
    expect(css).toContain("#90c226");
  });

  it("reads a scheme colour background and the smaller default top inset", async () => {
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="400000"/></a:xfrm></p:spPr>
          <p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1800" cap="all"/><a:t>Poster</a:t></a:r></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:bgPr></p:bg><p:spTree/></p:cSld></p:sldLayout>`,
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    expect(slide.background?.color?.toLowerCase()).toBe("#90c226");
    const text = slide.elements.find((el) => el.content === "Poster");
    expect(text?.inset).toBeCloseTo((45720 / 12192000) * 960, 3);
    expect(text?.padLeft).toBeCloseTo((91440 / 12192000) * 960, 3);
    expect(text?.runs?.[0]?.caps).toBe("all");
  });

  it("places a picture placeholder on its layout frame and skips an unfilled text box", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="4" name="Rectangle 3"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="158613" y="1262599"/><a:ext cx="8877103" cy="5330706"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
          <p:txBody><a:bodyPr/><a:p><a:endParaRPr/></a:p></p:txBody>
        </p:sp>
        <p:pic><p:nvPicPr><p:cNvPr id="5" name="Picture Placeholder 7"/><p:cNvPicPr/><p:nvPr><p:ph type="pic" idx="15"/></p:nvPr></p:nvPicPr>
          <p:blipFill><a:blip r:embed="rId2"/><a:srcRect t="15585" b="15585"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
          <p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        </p:pic>
        <p:sp><p:nvSpPr><p:cNvPr id="8"/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm></p:spPr>
          <p:txBody><a:bodyPr/><a:p><a:pPr marL="342900" indent="-342900"><a:buClr><a:srgbClr val="0099AB"/></a:buClr><a:buFont typeface="Wingdings"/><a:buSzPct val="130000"/><a:buChar char="Ø"/></a:pPr>
            <a:r><a:rPr sz="2200"><a:solidFill><a:srgbClr val="0099AB"/></a:solidFill></a:rPr><a:t>Next</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout showMasterSp="0"><p:cSld><p:spTree>
        <p:pic><p:nvPicPr><p:cNvPr id="9" name="Picture Placeholder 9"/><p:cNvPicPr/><p:nvPr><p:ph type="pic" idx="15"/></p:nvPr></p:nvPicPr>
          <p:spPr><a:xfrm rot="21240000"><a:off x="857677" y="632632"/><a:ext cx="5009597" cy="3255264"/></a:xfrm></p:spPr>
        </p:pic>
      </p:spTree></p:cSld></p:sldLayout>`,
      undefined,
      {
        slideRels: relation("rId2", "image", "../media/photo.png"),
        files: { "ppt/media/photo.png": png },
      },
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    expect(slide.elements.some((el) => el.fill === "#e2e8f0")).toBe(false);
    expect(slide.elements.some((el) => el.type === "shape")).toBe(false);
    const photo = slide.elements.find((el) => el.type === "image");
    expect(photo?.rotation).toBe(354);
    expect(photo?.cropTop).toBeCloseTo(15.585, 3);
    expect(photo?.cropBottom).toBeCloseTo(15.585, 3);
    expect(photo?.x).toBeCloseTo((857677 / 12192000) * 960, 3);
    expect(photo?.y).toBeCloseTo((632632 / 6858000) * 540, 3);
    expect(photo?.width).toBeCloseTo((5009597 / 12192000) * 960, 3);
    expect(photo?.height).toBeCloseTo((3255264 / 6858000) * 540, 3);
    const list = slide.elements.find((el) => el.content?.includes("Next"));
    expect(list?.content).toBe("Ø Next");
    expect(list?.runs?.[0]).toMatchObject({
      text: "Ø ",
      font: "SuiteLeaf Sprig",
      color: "#0099AB",
    });
    expect(list?.runs?.[0]?.fontSize).toBeCloseTo(22 * 1.3, 3);
    expect(list?.runs?.[1]?.text).toBe("Next");
    expect(list?.hang).toBeCloseTo((342900 / 12192000) * 960, 3);
  });

  it("recolors a picture between its duotone stops", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:pic><p:nvPicPr><p:cNvPr id="2" name="Photo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
          <p:blipFill><a:blip r:embed="rId2"><a:duotone><a:prstClr val="black"/><a:schemeClr val="accent4"><a:tint val="45000"/><a:satMod val="400000"/></a:schemeClr></a:duotone></a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        </p:pic>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
      undefined,
      {
        slideRels: relation("rId2", "image", "../media/photo.png"),
        files: { "ppt/media/photo.png": png },
      },
    );
    const photo = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
      (el) => el.type === "image",
    );
    expect(photo?.src?.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const svgText = Buffer.from(photo!.src!.split(",")[1], "base64").toString("utf8");
    const stops = duotoneColors(
      `<a:duotone><a:prstClr val="black"/><a:schemeClr val="accent4"><a:tint val="45000"/><a:satMod val="400000"/></a:schemeClr></a:duotone>`,
      { accent4: "#e76618" },
    );
    expect(stops?.[0]).toBe("#000000");
    expect(stops?.[1]?.startsWith("#")).toBe(true);
    expect(stops?.[1]).not.toBe("#e76618");
    const red = Math.round((parseInt(stops![1].slice(1, 3), 16) / 255) * 1000) / 1000;
    expect(svgText).toContain(`feFuncR type="table" tableValues="0 ${red}"`);
  });

  it("does not stack a layout rectangle that repeats the slide gradient", () => {
    const background = "linear-gradient(180deg, #3789de 0%, rgba(255, 255, 255, 0) 100%)";
    const slide = { width: 960, height: 540 };
    expect(
      repeatsSlideBackground(
        { type: "shape", shapeType: "rect", x: 0, y: 0, width: 960, height: 447, fill: background },
        background,
        slide,
      ),
    ).toBe(true);
    expect(
      repeatsSlideBackground(
        { type: "shape", shapeType: "rect", x: 0, y: 0, width: 200, height: 80, fill: background },
        background,
        slide,
      ),
    ).toBe(false);
    expect(
      repeatsSlideBackground(
        {
          type: "shape",
          shapeType: "rect",
          x: 0,
          y: 0,
          width: 960,
          height: 447,
          fill: "linear-gradient(180.0002deg, #3789DE 0%, rgba(255, 255, 255, 0) 100%)",
        },
        "linear-gradient(180.0002deg, #3889de 0%, rgba(255, 255, 255, 0) 100%)",
        slide,
      ),
    ).toBe(true);
    expect(
      repeatsSlideBackground(
        { type: "shape", shapeType: "rect", x: 0, y: 0, width: 960, height: 447, fill: "#ffffff" },
        background,
        slide,
      ),
    ).toBe(false);
  });

  it("keeps flipped shape text upright and accepts a wide hanging indent", async () => {
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="3" name="Callout"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm flipH="1"><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm>
            <a:prstGeom prst="wedgeRoundRectCallout"><a:avLst/></a:prstGeom>
            <a:solidFill><a:srgbClr val="CCCCCC"/></a:solidFill>
            <a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
          </p:spPr>
          <p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1800"/><a:t>Data Stewards</a:t></a:r></a:p></p:txBody>
        </p:sp>
        <p:sp><p:nvSpPr><p:cNvPr id="4"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="2200000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </p:spPr>
          <p:txBody><a:bodyPr/><a:p><a:pPr marL="4000000" indent="-4000000"/><a:r><a:rPr sz="1800"/><a:t>Wide hang</a:t></a:r></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const label = slide.elements.find((el) => el.content === "Data Stewards");
    expect(label?.flipH).toBeUndefined();
    expect(slide.elements.some((el) => el.flipH)).toBe(true);
    const hung = slide.elements.find((el) => el.content === "Wide hang");
    expect(hung?.hang).toBeCloseTo((4000000 / 12192000) * 960, 3);
    expect(() => presentationSchema.parse(parsed.content)).not.toThrow();
  });

  it("keeps Symbol font codes in the SuiteLeaf face drawn the same way", async () => {
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="2"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
          <p:txBody><a:bodyPr/><a:p>
            <a:r><a:rPr sz="1800"><a:latin typeface="Symbol"/></a:rPr><a:t>m</a:t></a:r>
            <a:r><a:rPr sz="1800"><a:latin typeface="Tahoma"/><a:sym typeface="Symbol"/></a:rPr><a:t>\uF0B1</a:t></a:r>
          </a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const text = slide.elements.find((el) => el.type === "text");
    expect(text?.content).toBe("m\uF0B1");
    expect(text?.runs?.map((run) => [run.text, run.font])).toEqual([
      ["m", "SuiteLeaf Thistle"],
      ["\uF0B1", "SuiteLeaf Thistle"],
    ]);
    // The box keeps the text font; only the symbol runs are in the symbol face.
    expect(text?.fontFamily).not.toBe("SuiteLeaf Thistle");
  });

  it("keeps a deeper list level further right than its parent", async () => {
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="3"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="8000000" cy="4000000"/></a:xfrm></p:spPr>
          <p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1800"/><a:t>Parent</a:t></a:r></a:p>
            <a:p><a:pPr lvl="1"/><a:r><a:rPr sz="1800"/><a:t>Child</a:t></a:r></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
          <p:txBody><a:bodyPr/><a:lstStyle>
            <a:lvl1pPr marL="200000" indent="-100000"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:lvl1pPr>
            <a:lvl2pPr marL="500000" indent="-100000"><a:spcBef><a:spcPts val="400"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="○"/></a:lvl2pPr>
          </a:lstStyle></p:txBody>
        </p:sp>
      </p:spTree></p:cSld></p:sldLayout>`,
    );
    const list = parsed.content.slides[parsed.content.slideOrder[0]].elements.find((el) =>
      el.content?.includes("Child"),
    );
    const px = (emu: number) => (emu / 12192000) * 960;
    expect(list?.hang).toBeUndefined();
    expect(list?.runs?.[0]).toMatchObject({
      text: "• Parent",
      paraMargin: px(100000),
      paraHang: px(100000),
    });
    expect(list?.runs?.find((run) => run.paragraphBreak)).toMatchObject({
      paraMargin: px(400000),
      paraHang: px(100000),
      spaceBefore: (4 / 72) * (960 / (12192000 / 914400)),
    });
    expect(() => presentationSchema.parse(parsed.content)).not.toThrow();
  });

  it("places a footer from the master when the layout uses another index", async () => {
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="4" name="Footer"/><p:nvPr><p:ph type="ftr" idx="11"/></p:nvPr></p:nvSpPr>
          <p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1200"/><a:t>Grenoble</a:t></a:r></a:p></p:txBody>
        </p:sp>
        <p:sp><p:nvSpPr><p:cNvPr id="5"/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="400000"/></a:xfrm></p:spPr>
          <p:txBody><a:bodyPr/><a:p><a:pPr><a:buFont typeface="Wingdings"/><a:buChar char="&#xF06E;"/></a:pPr>
            <a:r><a:rPr sz="1800"/><a:t>Shell</a:t></a:r></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="4"/><p:nvPr><p:ph type="ftr" idx="11"/></p:nvPr></p:nvSpPr>
          <p:txBody><a:bodyPr/><a:p><a:endParaRPr/></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld></p:sldLayout>`,
      `<p:sldMaster><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="6"/><p:nvPr><p:ph type="ftr" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="2843808" y="6356350"/><a:ext cx="3756248" cy="274320"/></a:xfrm></p:spPr>
          <p:txBody><a:bodyPr/><a:p><a:endParaRPr/></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld></p:sldMaster>`,
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const footer = slide.elements.find((el) => el.content === "Grenoble");
    expect(footer?.y).toBeCloseTo((6356350 / 6858000) * 540, 3);
    expect(footer?.x).toBeCloseTo((2843808 / 12192000) * 960, 3);
    expect(symbolFontChar("\uF06E")).toBe("n");
    const bullet = slide.elements.find((el) => el.content?.includes("Shell"));
    expect(bullet?.runs?.[0]).toMatchObject({ text: "n ", font: "SuiteLeaf Sprig" });
    expect(() => presentationSchema.parse(parsed.content)).not.toThrow();
  });

  it("keeps a picture soft edge in slide units", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:pic><p:nvPicPr><p:cNvPr id="4" name="Photo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
          <p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="3000000"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
            <a:effectLst><a:softEdge rad="635000"/></a:effectLst>
          </p:spPr>
        </p:pic>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
      undefined,
      {
        slideRels: relation("rId2", "image", "../media/photo.png"),
        files: { "ppt/media/photo.png": png },
      },
    );
    const photo = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
      (el) => el.type === "image",
    );
    expect(photo?.softEdge).toBeCloseTo((635000 / 12192000) * 960, 3);
    const glow = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
      (el) => el.type === "shape",
    );
    expect(glow?.fill?.toLowerCase()).toBe("#ffffff");
    expect(glow?.softEdge).toBeCloseTo(photo!.softEdge!, 3);
  });
});

it("keeps vert270 text running upward inside its box", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Axis"/><p:cNvSpPr txBox="1"/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="100000" y="200000"/><a:ext cx="400000" cy="700000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr vert="vert270" wrap="square"/><a:p><a:r><a:t>Risk</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const label = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.content === "Risk",
  );
  expect(label?.textFlow).toBe("up");
});
