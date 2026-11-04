import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { styleBlipElement } from "../packages/core/src/pptx-style-blip";
import { backgroundWindowSrc, paintSlideBackgroundWindow, themePaint, styleFillBlip } from "../packages/core/src/pptx-theme";
import { theme } from "./pptx-theme-paint-fixtures";

it("does not paint a style fill behind a picture fill", () => {
  const paint = themePaint(
    theme,
    `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:blipFill><a:blip r:embed="rId2"><a:alphaModFix amt="27000"/></a:blip></a:blipFill></p:spPr><p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style></p:sp>`,
  );
  expect(paint.fill).toBeUndefined();
  expect(paint.stroke).toBeTruthy();
});

it("paints a background fill style when fillRef is 1001 or above", () => {
  const paint = themePaint(
    theme,
    `<p:sp><p:spPr><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></p:spPr>
      <p:style><a:fillRef idx="1001"><a:schemeClr val="accent2"/></a:fillRef></p:style></p:sp>`,
  );
  expect(paint.fill?.toLowerCase()).toBe("#e73037");
  const tinted = theme.replace(
    "<a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:bgFillStyleLst>",
    `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      <a:solidFill><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:solidFill></a:bgFillStyleLst>`,
  );
  const second = themePaint(
    tinted,
    `<p:sp><p:spPr><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></p:spPr>
      <p:style><a:fillRef idx="1002"><a:schemeClr val="dk2"/></a:fillRef></p:style></p:sp>`,
  );
  expect(second.fill?.toLowerCase()).toBe("#bcc4ce");
  const ordinary = themePaint(
    tinted,
    `<p:sp><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
      <p:style><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef></p:style></p:sp>`,
  );
  expect(ordinary.fill?.toLowerCase()).toBe("#e73037");
});

it("keeps a useBgFill shape from painting its style fill over the slide", () => {
  const paint = themePaint(
    theme,
    `<p:sp useBgFill="1"><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></p:spPr><p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style></p:sp>`,
  );
  expect(paint.fill).toBeUndefined();
});

it("fills a useBgFill shape with the slide background, not its style colour", () => {
  const xml = `<p:sp useBgFill="1"><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="6858000"/></a:xfrm><a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="80" y="0"/></a:lnTo><a:lnTo><a:pt x="0" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom><a:noFill/></p:spPr><p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style></p:sp>`;
  expect(themePaint(theme, xml, undefined, "#ffffff").fill).toBe("#ffffff");
  expect(
    themePaint(theme, xml, undefined, "linear-gradient(90deg, #ffffff 0%, #000000 100%)").fill,
  ).toContain("linear-gradient(");
  expect(themePaint(theme, xml, undefined, 'url("data:image/png;base64,aaaa")').fill).toBe(
    'url("data:image/png;base64,aaaa")',
  );
});

it("clips a picture slide background to a useBgFill shape", () => {
  const src = backgroundWindowSrc(
    { x: 40, y: 20, width: 200, height: 100, fill: "data:image/png;base64,aaaa" },
    { width: 960, height: 540 },
  );
  const svg = Buffer.from(src!.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain('viewBox="0 0 200 100"');
  expect(svg).toContain('x="-40" y="-20" width="960" height="540"');
  expect(svg).toContain("data:image/png;base64,aaaa");
  expect(
    backgroundWindowSrc(
      { x: 1, y: 2, width: 3, height: 4, fill: 'url("data:image/png;base64,bbbb")' },
      { width: 10, height: 10 },
    ),
  ).toContain("data:image/svg+xml;base64,");
  expect(backgroundWindowSrc({ x: 0, y: 0, width: 0, height: 10, fill: "data:image/png;base64,aaaa" }, { width: 10, height: 10 })).toBeUndefined();
  expect(backgroundWindowSrc({ x: 0, y: 0, width: 10, height: 10, fill: "#ffffff" }, { width: 10, height: 10 })).toBeUndefined();
  const painted = paintSlideBackgroundWindow(
    {
      type: "shape",
      x: 40,
      y: 20,
      width: 200,
      height: 100,
      fill: "data:image/png;base64,aaaa",
      shapeType: "rect",
      alt: "Inherited slide artwork",
    },
    { width: 960, height: 540 },
  );
  expect(painted.type).toBe("image");
  expect(painted.fill).toBeUndefined();
  expect(painted.alt).toBe("Inherited slide artwork");
  expect(
    paintSlideBackgroundWindow(
      { type: "shape", x: 0, y: 0, width: 10, height: 10, fill: "#ffffff" },
      { width: 960, height: 540 },
    ).type,
  ).toBe("shape");
});

it("paints a useBgFill card with the theme picture, over a photo", async () => {
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:spTree/></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>
      <p:pic><p:nvPicPr><p:cNvPr id="7" name="Brick"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
      </p:pic>
      <p:sp useBgFill="1"><p:nvSpPr><p:cNvPr id="11" name="Card"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="9144000" cy="5486400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style>
      </p:sp>
    </p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1"/></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships>
      <Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
      <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/brick.png"/>
    </Relationships>`,
  );
  zip.file("ppt/media/brick.png", Buffer.from(png, "base64"));
  zip.file("ppt/media/paper.png", Buffer.from(png, "base64"));
  zip.file(
    "ppt/theme/theme1.xml",
    theme.replace(
      "<a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:bgFillStyleLst>",
      `<a:bgFillStyleLst><a:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId2"/><a:stretch/></a:blipFill></a:bgFillStyleLst>`,
    ),
  );
  zip.file(
    "ppt/theme/_rels/theme1.xml.rels",
    `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/paper.png"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const slide = parsed.content.slides[parsed.content.slideOrder[0]];
  const card = slide.elements.find((el) => (el.src || "").startsWith("data:image/svg+xml"));
  expect(card?.type).toBe("image");
  const svg = Buffer.from((card?.src || "").split(",")[1] || "", "base64").toString("utf8");
  expect(svg).toContain("<image ");
  expect(svg).toContain("data:image/png;base64,");
  expect(svg).toMatch(/x="-[0-9.]+"/);
  expect(svg).not.toContain("#9FB1BD");
  expect(card!.width).toBeLessThan(1200);
});

it("paints a useBgFill freeform over a picture with the slide background", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="2" name="Photo"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="2244AA"/></a:solidFill>
        </p:spPr>
      </p:sp>
      <p:sp useBgFill="1"><p:nvSpPr><p:cNvPr id="3" name="Torn edge"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="6858000"/></a:xfrm>
          <a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="80" y="0"/></a:lnTo><a:lnTo><a:pt x="60" y="50"/></a:lnTo><a:lnTo><a:pt x="0" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>
          <a:noFill/>
        </p:spPr>
        <p:style><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef></p:style>
      </p:sp>
    </p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  zip.file("ppt/theme/theme1.xml", theme);
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const slide = parsed.content.slides[parsed.content.slideOrder[0]];
  const mask = slide.elements.find((el) => el.alt === "Slide shape");
  const data = /^data:image\/svg\+xml;base64,(.+)$/.exec(mask?.src || "");
  const svg = data ? Buffer.from(data[1], "base64").toString("utf8") : "";
  expect(svg).toContain('fill="#ffffff"');
  expect(svg).toContain("L 251.97 0");
  expect(svg.toLowerCase()).not.toContain("e73037");
});

it("paints a gif or jpeg theme tile and skips a missing image", async () => {
  const themeXml = `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><a:themeElements>
<a:clrScheme name="Q"><a:accent1><a:srgbClr val="00C6BB"/></a:accent1></a:clrScheme>
<a:fmtScheme name="Office"><a:fillStyleLst><a:blipFill><a:blip r:embed="rId1"/><a:tile sx="100000" sy="100000" algn="tl"/></a:blipFill></a:fillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;
  const shape = `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style></p:sp>`;
  const box = { x: 0, y: 0, width: 40, height: 20 };
  const slide = { width: 960, emuWidth: 12192000 };
  const gif = new JSZip();
  gif.file("ppt/media/tile.gif", new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]));
  const painted = await styleBlipElement(
    gif,
    { path: "ppt/theme/theme1.xml", xml: themeXml, rels: { rId1: { target: "../media/tile.gif" } } },
    shape,
    box,
    slide,
  );
  expect(painted?.type).toBe("image");
  const jpeg = new JSZip();
  jpeg.file("ppt/media/tile.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  const photo = await styleBlipElement(
    jpeg,
    { path: "ppt/theme/theme1.xml", xml: themeXml, rels: { rId1: { target: "../media/tile.jpg" } } },
    shape,
    box,
    slide,
  );
  expect(photo?.type).toBe("image");
  expect(
    await styleBlipElement(
      gif,
      { path: "ppt/theme/theme1.xml", xml: themeXml, rels: { rId1: { target: "../media/missing.gif" } } },
      shape,
      box,
      slide,
    ),
  ).toBeUndefined();
});

it("paints a theme fill-style picture on a layout shape", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const blipTheme = `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><a:themeElements>
<a:clrScheme name="Q"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
<a:accent1><a:srgbClr val="00C6BB"/></a:accent1><a:accent6><a:srgbClr val="ED515C"/></a:accent6></a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Office"><a:fillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:blipFill><a:blip r:embed="rId1"><a:duotone><a:schemeClr val="phClr"><a:tint val="98000"/></a:schemeClr><a:schemeClr val="phClr"><a:shade val="98000"/></a:schemeClr></a:duotone></a:blip><a:tile tx="0" ty="0" sx="100000" sy="100000" flip="none" algn="tl"/></a:blipFill>
</a:fillStyleLst>
<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme></a:themeElements></a:theme>`;
  const shape = `<p:sp><p:nvSpPr><p:cNvPr id="11" name="Freeform 6"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm>
<a:custGeom><a:pathLst><a:path w="100" h="40"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="80" y="40"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>
<a:ln/><a:extLst><a:ext uri="{91240B29-F687-4f45-9708-019B960494DF}"><a14:hiddenLine xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a14:hiddenLine></a:ext></a:extLst>
</p:spPr><p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="3"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style></p:sp>`;
  expect(styleFillBlip(blipTheme, shape)?.embed).toBe("rId1");
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:cSld><p:spTree></p:spTree></p:cSld></p:sld>`);
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:spTree>${shape}</p:spTree></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:cSld><p:spTree></p:spTree></p:cSld></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  zip.file("ppt/theme/theme1.xml", blipTheme);
  zip.file(
    "ppt/theme/_rels/theme1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  zip.file("ppt/media/image1.png", png);
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const slide = parsed.content.slides[parsed.content.slideOrder[0]];
  const picture = slide.elements.find((el) => el.alt === "Shape style picture fill");
  expect(picture?.type).toBe("image");
  expect(picture && "src" in picture ? picture.src : "").toContain("data:image/svg+xml;base64,");
  expect(picture && "clipPath" in picture ? picture.clipPath : "").toContain("M ");
  expect(picture && "tile" in picture ? picture.tile : undefined).toBeTruthy();
  const dash = `<p:sld><p:cSld><p:spTree><p:cxnSp><p:nvCxnSpPr><p:cNvPr id="4" name="Dash"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
<p:spPr><a:xfrm><a:off x="0" y="100000"/><a:ext cx="4000000" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>
<a:ln w="76200"><a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="50000"/></a:srgbClr></a:solidFill><a:prstDash val="sysDash"/></a:ln></p:spPr></p:cxnSp></p:spTree></p:cSld></p:sld>`;
  zip.file("ppt/slides/slide1.xml", dash);
  const dashed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const line = dashed.content.slides[dashed.content.slideOrder[0]].elements.find(
    (el) => el.type === "shape" && el.shapeType === "line",
  );
  expect(line?.strokeStyle).toBe("sysDash");
});
