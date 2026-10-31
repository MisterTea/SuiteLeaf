import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { presentationSchema } from "../packages/core/src/index";
import { symbolFontChar } from "../packages/core/src/pptx-lists";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { backgroundCss, duotoneColors } from "../packages/core/src/pptx-theme";
import { groupFillXml, repeatsSlideBackground, slidePointScale, shapeArtwork } from "../packages/core/src/pptx-geometry";
import { svgFillMarkup } from "../packages/core/src/pptx-theme";
import { presetTextBox, presetVector } from "../packages/core/src/pptx-preset-geometry";
import type { ShapePaint } from "../packages/core/src/pptx-theme";

const theme = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements>
<a:clrScheme name="Facet"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="2C3C43"/></a:dk2><a:lt2><a:srgbClr val="EBEBEB"/></a:lt2>
<a:accent1><a:srgbClr val="90C226"/></a:accent1><a:accent2><a:srgbClr val="54A021"/></a:accent2>
<a:accent3><a:srgbClr val="E6B91E"/></a:accent3><a:accent4><a:srgbClr val="E76618"/></a:accent4>
<a:accent5><a:srgbClr val="C42F1A"/></a:accent5><a:accent6><a:srgbClr val="918655"/></a:accent6>
<a:hlink><a:srgbClr val="99CA3C"/></a:hlink><a:folHlink><a:srgbClr val="B9D181"/></a:folHlink></a:clrScheme>
<a:fontScheme><a:majorFont><a:latin typeface="Trebuchet MS"/></a:majorFont><a:minorFont><a:latin typeface="Trebuchet MS"/></a:minorFont></a:fontScheme>
<a:fmtScheme><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:bgFillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill>
</a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;

const relation = (id: string, kind: string, target: string) =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}"/>`;

async function deck(
  slide: string,
  layout: string,
  master = `<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>`,
  extra?: { slideRels?: string; files?: Record<string, Uint8Array | string> },
) {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  zip.file("ppt/slides/slide1.xml", slide);
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships>${relation("l", "slideLayout", "../slideLayouts/slideLayout1.xml")}${extra?.slideRels || ""}</Relationships>`,
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", layout);
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships>${relation("m", "slideMaster", "../slideMasters/slideMaster1.xml")}</Relationships>`,
  );
  zip.file("ppt/slideMasters/slideMaster1.xml", master);
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships>${relation("t", "theme", "../theme/theme1.xml")}</Relationships>`,
  );
  zip.file("ppt/theme/theme1.xml", theme);
  for (const [path, data] of Object.entries(extra?.files || {})) zip.file(path, data);
  return parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
}

function svg(src: string | undefined) {
  const data = /^data:image\/svg\+xml;base64,(.+)$/.exec(src || "");
  return data ? Buffer.from(data[1], "base64").toString("utf8") : "";
}

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

  it("draws preset outlines that are not rectangles", () => {
    const paint: ShapePaint = { fill: "#90c226", stroke: "#000000", strokeEmu: 9525 };
    const box = { x: 0, y: 0, width: 100, height: 80 };
    const slide = { width: 960, emuWidth: 12192000 };
    const shape = (name: string) =>
      shapeArtwork(
        `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm><a:prstGeom prst="${name}"><a:avLst/></a:prstGeom></p:spPr></p:sp>`,
        paint,
        box,
        slide,
      );
    for (const name of [
      "chevron",
      "homePlate",
      "parallelogram",
      "diamond",
      "rightArrow",
      "leftArrow",
      "upDownArrow",
      "donut",
      "cube",
      "flowChartDecision",
      "star7",
      "round2SameRect",
      "mathMultiply",
    ]) {
      const art = shape(name);
      expect(art?.type, name).toBe("image");
      expect(svg(art?.src), name).toContain("<path");
    }
    expect(svg(shape("star7")?.src).match(/L /g)?.length).toBeGreaterThan(8);
    expect(svg(shape("round2SameRect")?.src)).toContain("A ");
    expect(svg(shape("mathMultiply")?.src).match(/Z/g)?.length).toBe(2);
    const turned = shapeArtwork(
      `<p:sp><p:spPr><a:xfrm rot="5400000"><a:off x="0" y="0"/><a:ext cx="674797" cy="6598750"/></a:xfrm><a:prstGeom prst="round2SameRect"><a:avLst/></a:prstGeom></p:spPr></p:sp>`,
      paint,
      box,
      slide,
    );
    expect(turned?.rotation).toBe(90);
    const unknown = shapeArtwork(
      `<p:sp><p:spPr><a:xfrm rot="5400000"><a:off x="0" y="0"/><a:ext cx="1000" cy="4000"/></a:xfrm><a:prstGeom prst="notAShape"><a:avLst/></a:prstGeom></p:spPr></p:sp>`,
      paint,
      box,
      slide,
    );
    expect(unknown).toMatchObject({ type: "shape", shapeType: "rect", rotation: 90 });
    expect(svg(shape("donut")?.src)).toContain("evenodd");
    const line = shapeArtwork(
      `<p:cxnSp><p:spPr><a:xfrm rot="5400000" flipH="1"><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="9525"><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>`,
      paint,
      box,
      slide,
    );
    expect(line).toMatchObject({ type: "shape", shapeType: "arrow", flipH: true, rotation: 90 });
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

  it("draws a cloud callout with its tail and keeps a large top inset off the other edges", async () => {
    const paint: ShapePaint = { fill: "#f4c430", stroke: "#000000", strokeEmu: 12700 };
    const box = { x: 40, y: 30, width: 200, height: 140 };
    const cloud = shapeArtwork(
      `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2736304" cy="2553147"/></a:xfrm>
        <a:prstGeom prst="cloudCallout"><a:avLst><a:gd name="adj1" fmla="val 0"/><a:gd name="adj2" fmla="val 150000"/></a:avLst></a:prstGeom>
        <a:solidFill><a:srgbClr val="F4C430"/></a:solidFill></p:spPr></p:sp>`,
      paint,
      box,
      { width: 960, emuWidth: 12192000 },
    );
    expect(cloud?.type).toBe("image");
    const markup = svg(cloud?.src);
    expect(markup.match(/<path /g)?.length).toBeGreaterThan(2);
    expect(markup).toContain(" A ");
    expect((cloud?.y ?? 0) + (cloud?.height ?? 0)).toBeGreaterThan(box.y + box.height);

    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:sp><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="5B9BD5"/></a:solidFill></p:spPr>
          <p:txBody><a:bodyPr tIns="2560320" bIns="45720" lIns="91440" rIns="91440" anchor="ctr"/><a:lstStyle/>
            <a:p><a:r><a:rPr sz="1800"/><a:t>Inset</a:t></a:r></a:p></p:txBody></p:sp>
        <p:sp><p:spPr><a:xfrm><a:off x="500000" y="400000"/><a:ext cx="3000000" cy="1800000"/></a:xfrm>
          <a:prstGeom prst="bentConnector3"><a:avLst><a:gd name="adj1" fmla="val 50000"/></a:avLst></a:prstGeom>
          <a:ln w="19050"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr></p:sp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const text = slide.elements.find((el) => el.content === "Inset");
    expect(text?.inset).toBeGreaterThan(200);
    expect(text?.padBottom).toBeCloseTo((45720 / 12192000) * 960, 3);
    expect(text?.padRight).toBeUndefined();
    const bend = slide.elements.find((el) => el.alt === "Slide shape");
    expect(bend?.type).toBe("image");
    expect(svg(bend?.src)).toContain("L ");
    expect(svg(bend?.src)).not.toContain('fill="#');
  });

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

  it("keeps an oval callout on the ellipse", () => {
    const w = 400;
    const h = 200;
    const drawn = presetVector(
      "wedgeEllipseCallout",
      `<a:prstGeom prst="wedgeEllipseCallout"><a:avLst/></a:prstGeom>`,
      w,
      h,
      "#78bcd0",
      "#245a78",
      20,
    );
    const path = svg(drawn?.src);
    const arc = /A [\d.]+ [\d.]+ 0 \d \d ([\d.-]+) ([\d.-]+)/.exec(path);
    expect(arc).toBeTruthy();
    const ex = Number(arc?.[1]);
    const ey = Number(arc?.[2]);
    const nx = (ex - w / 2) / (w / 2);
    const ny = (ey - h / 2) / (h / 2);
    expect(nx * nx + ny * ny).toBeCloseTo(1, 2);
    expect(path).toContain('fill="#78bcd0"');
    const large = presetVector(
      "wedgeEllipseCallout",
      `<a:prstGeom prst="wedgeEllipseCallout"><a:avLst/></a:prstGeom>`,
      4_000_000,
      2_000_000,
      "linear-gradient(0deg, #69c1ec 0%, #bbe5ff 100%)",
      "#245a78",
      9525,
    );
    const view = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg(large?.src));
    expect(Number(view?.[1])).toBeLessThanOrEqual(1024);
    expect(Number(view?.[2])).toBeLessThanOrEqual(1024);
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

  it("rotates a pie wedge about the shape center", () => {
    const box = { x: 40, y: 30, width: 160, height: 150 };
    const art = shapeArtwork(
      `<p:sp><p:spPr><a:xfrm rot="10379217"><a:off x="0" y="0"/><a:ext cx="2123110" cy="2114565"/></a:xfrm>
        <a:prstGeom prst="pie"><a:avLst><a:gd name="adj1" fmla="val 3691650"/><a:gd name="adj2" fmla="val 14119269"/></a:avLst></a:prstGeom>
        <a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="65000"/></a:srgbClr></a:solidFill></p:spPr></p:sp>`,
      { fill: "rgba(255,255,255,0.65)" },
      box,
      { width: 960, emuWidth: 12192000 },
    );
    expect(art?.type).toBe("image");
    expect(art!.x + art!.width / 2).toBeCloseTo(box.x + box.width / 2, 3);
    expect(art!.y + art!.height / 2).toBeCloseTo(box.y + box.height / 2, 3);
    expect(art?.rotation).toBeCloseTo(10379217 / 60000, 3);
    expect(svg(art?.src)).toContain("A ");
  });

  it("insets cloud-callout text and draws the callout bubbles", () => {
    const xml = `<p:sp><a:prstGeom prst="cloudCallout"><a:avLst><a:gd name="adj1" fmla="val 0"/><a:gd name="adj2" fmla="val 150000"/></a:avLst></a:prstGeom></p:sp>`;
    const box = { x: 10, y: 20, width: 200, height: 120 };
    const text = presetTextBox(xml, box);
    expect(text && text.width).toBeLessThan(box.width);
    expect(text && text.x).toBeGreaterThan(box.x);
    expect(presetTextBox(`<p:sp><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:sp>`, box)).toBeUndefined();
    const drawn = presetVector("cloudCallout", xml, 400, 240, "#ffc000", "#000000", 0);
    expect(drawn?.src.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(svg(drawn?.src)).toContain("A ");
    expect(presetVector("notAShape", xml, 10, 10, "#000", "none", 0)).toBeUndefined();
    const curve = presetVector(
      "curvedConnector3",
      `<a:prstGeom prst="curvedConnector3"><a:avLst/></a:prstGeom>`,
      300,
      80,
      "none",
      "#1217E4",
      12700,
    );
    expect(svg(curve?.src)).toContain("C ");
    expect(svg(curve?.src)).toContain('fill="none"');
  });

  it("measures a frame from the transform when an extension list comes first", () => {
    const art = shapeArtwork(
      `<p:sp><p:nvSpPr><p:cNvPr id="10" name="Rahmen"><a:extLst><a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}"/></a:extLst></p:cNvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="2490951" y="2806262"/><a:ext cx="788276" cy="346842"/></a:xfrm>
          <a:prstGeom prst="frame"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
          <a:ln><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></p:spPr></p:sp>`,
      { fill: "#FF0000", stroke: "#FF0000", strokeEmu: 12700 },
      { x: 196, y: 294, width: 62, height: 27 },
      { width: 960, emuWidth: 12192000 },
    );
    expect(art?.type).toBe("image");
    expect(art!.width).toBeLessThan(120);
    expect(art!.x).toBeGreaterThan(100);
    const view = /viewBox="0 0 ([0-9.]+)/.exec(svg(art?.src));
    expect(Number(view?.[1])).toBeGreaterThan(700000);
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

  it("paints a preset gradient as SVG instead of a black CSS fill", () => {
    const fill = "linear-gradient(45deg, rgba(10, 20, 30, 0.06) 0%, #0070c0 100%)";
    const markup = svgFillMarkup(fill);
    expect(markup.value).toBe("url(#sl-fill)");
    expect(markup.defs).toContain("stop-opacity=\"0.06\"");
    expect(markup.defs).toContain("stop-color=\"#0070c0\"");
    const art = shapeArtwork(
      `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5904656" cy="1872208"/></a:xfrm><a:prstGeom prst="snip2DiagRect"><a:avLst/></a:prstGeom></p:spPr></p:sp>`,
      { fill, stroke: "#1f4e79", strokeEmu: 12700 },
      { x: 10, y: 20, width: 400, height: 120 },
      { width: 960, emuWidth: 12192000 },
    );
    expect(art?.type).toBe("image");
    const svg = Buffer.from(String(art?.src).split(",")[1] || "", "base64").toString("utf8");
    expect(svg).toContain("<linearGradient");
    expect(svg).not.toContain("linear-gradient(");
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
  });

  it("scales a grouped preset stroke into the shape's own coordinates", () => {
    const art = shapeArtwork(
      `<p:sp><p:spPr><a:xfrm><a:off x="576" y="2256"/><a:ext cx="192" cy="912"/></a:xfrm>
        <a:prstGeom prst="rightBrace"><a:avLst/></a:prstGeom>
        <a:noFill/><a:ln w="28575"><a:solidFill><a:srgbClr val="009900"/></a:solidFill></a:ln></p:spPr></p:sp>`,
      { stroke: "#009900", strokeEmu: 28575 },
      { x: 72, y: 282, width: 32, height: 152 },
      { width: 960, emuWidth: 9144000 },
    );
    expect(art?.type).toBe("image");
    expect(art!.width).toBeLessThan(80);
    expect(art!.height).toBeLessThan(200);
    const svgText = svg(art?.src);
    const width = Number(/stroke="#009900" stroke-width="([0-9.]+)"/.exec(svgText)?.[1]);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThan(40);
  });
});
