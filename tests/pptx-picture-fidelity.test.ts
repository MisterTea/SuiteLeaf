import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { lineFrame } from "../packages/core/src/pptx-geometry";
import { hostedPictureClip, pictureOutline } from "../packages/core/src/pptx-picture-clip";
import { blipOpacity, pictureClip, sourceCrop, stretchFill, uprightQuarterTurn } from "../packages/core/src/pptx-pictures";
import { croppedPictureStyle } from "../apps/web/src/editors/slide-surface";
import { clipPictureToSlide } from "../apps/web/src/editors/slide-picture-crop";
import { uncompressedTiff } from "./pptx-picture-fidelity-fixtures";

it("gives a zero-thickness connector room for its stroke", () => {
  expect(lineFrame({ x: 40, y: 10, width: 0, height: 80, strokeWidth: 2 })).toEqual({
    x: 39,
    y: 10,
    width: 2,
    height: 80,
  });
});

it("imports picture crops, superscripts, unwrapped text, and skips empty pictures", async () => {
  const tiff = uncompressedTiff(new Uint8Array([9, 8, 7, 255]), 1, 1);
  const zip = new JSZip();
  zip.file("ppt/media/image1.tiff", tiff);
  zip.file(
    "ppt/theme/theme1.xml",
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements>
      <a:clrScheme name="Office"><a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="222222"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
      <a:accent1><a:srgbClr val="333333"/></a:accent1><a:accent2><a:srgbClr val="444444"/></a:accent2>
      <a:accent3><a:srgbClr val="555555"/></a:accent3><a:accent4><a:srgbClr val="666666"/></a:accent4>
      <a:accent5><a:srgbClr val="777777"/></a:accent5><a:accent6><a:srgbClr val="888888"/></a:accent6>
      <a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="999999"/></a:folHlink></a:clrScheme>
      <a:fontScheme><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>
      <a:fmtScheme><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst/><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
      </a:fmtScheme></a:themeElements></a:theme>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld><p:spTree>
        <p:pic><p:nvPicPr><p:cNvPr id="3" name="Plate"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
          <p:blipFill><a:blip r:embed="rId2"/><a:srcRect l="11103" t="7927" r="10021" b="12291"/><a:stretch/></p:blipFill>
          <p:spPr><a:xfrm><a:off x="1000" y="1000"/><a:ext cx="400000" cy="400000"/></a:xfrm></p:spPr></p:pic>
        <p:pic><p:nvPicPr><p:cNvPr id="4" name="Empty"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
          <p:blipFill><a:blip r:embed="rId2"/></p:blipFill>
          <p:spPr><a:xfrm><a:off x="10" y="10"/><a:ext cx="0" cy="0"/></a:xfrm></p:spPr></p:pic>
        <p:sp><p:nvSpPr><p:cNvPr id="5" name="Power"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="500000" cy="300000"/></a:xfrm></p:spPr>
          <p:txBody><a:bodyPr wrap="none"><a:spAutoFit/></a:bodyPr><a:p>
            <a:r><a:rPr lang="en-US"/><a:t>10</a:t></a:r>
            <a:r><a:rPr lang="en-US" baseline="30000"/><a:t>-5</a:t></a:r>
            <a:r><a:rPr lang="en-US" sz="1200" baseline="30000"/><a:t>2</a:t></a:r>
          </a:p></p:txBody></p:sp>
        <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="6" name="Bracket"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="2000000"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="12700"/></p:spPr>
          <p:style><a:lnRef idx="1"><a:schemeClr val="dk1"/></a:lnRef><a:fillRef idx="0"><a:schemeClr val="dk1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="dk1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></p:style>
        </p:cxnSp>
      </p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships>
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.tiff"/>
    </Relationships>`,
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", `<p:sldLayout/>`);
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>`);
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const elements = parsed.content.slides[parsed.content.slideOrder[0]].elements;
  const pictures = elements.filter((el) => el.type === "image");
  expect(pictures).toHaveLength(1);
  expect(pictures[0].src).toMatch(/^data:image\/png;base64,/);
  expect(pictures[0]).toMatchObject({
    cropLeft: 11.103,
    cropTop: 7.927,
    cropRight: 10.021,
    cropBottom: 12.291,
  });
  const power = elements.find((el) => el.content === "10-52");
  // Resize-shape-to-fit grows the box in PowerPoint. It never shrinks the words.
  expect(power).toMatchObject({ nowrap: true });
  expect(power?.autofit).toBeUndefined();
  expect(power?.runs?.map((run) => [run.text, run.baseline, run.scriptScale, run.fontSize])).toEqual([
    ["10", undefined, undefined, undefined],
    ["-5", 30, true, undefined],
    ["2", 30, true, 12],
  ]);
  const bracket = elements.find((el) => el.shapeType === "line");
  expect(bracket?.width).toBe(0);
  expect(bracket?.stroke?.toLowerCase()).toBe("#111111");
  expect(bracket?.strokeWidth).toBeCloseTo((12700 / 9144000) * 960, 5);
});

it("reads a picture fade from alphaModFix", () => {
  expect(blipOpacity('<a:blip r:embed="rId3"><a:alphaModFix amt="48000"/></a:blip>')).toEqual({
    opacity: 0.48,
  });
  expect(blipOpacity('<a:blip r:embed="rId3"><a:alphaModFix/></a:blip>')).toBeUndefined();
});

it("paints a picture shape fill behind transparent pixels", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const zip = new JSZip();
  zip.file("ppt/media/image1.png", png);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="2" name="Picture"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const elements = parsed.content.slides[parsed.content.slideOrder[0]].elements;
  const shape = elements.find((el) => el.type === "shape");
  const picture = elements.findIndex((el) => el.type === "image");
  expect(shape?.fill).toBe("#FFFFFF");
  expect(elements.indexOf(shape!)).toBeLessThan(picture);
});

it("uses the master box when a picture placeholder layout has no transform", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const zip = new JSZip();
  zip.file("ppt/media/image1.png", png);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="7" name="Shape"/><p:cNvPicPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp></p:spTree></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="1500000"/><a:ext cx="8000000" cy="4000000"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sldMaster>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const picture = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.type === "image",
  );
  expect(picture?.y).toBeGreaterThan(100);
  expect(picture?.height).toBeGreaterThan(300);
  expect(picture?.clipPath).toBeUndefined();
});

it("clips a placeholder picture to the layout's custom geometry", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const zip = new JSZip();
  zip.file("ppt/media/image1.png", png);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="7" name="Picture"/><p:cNvPicPr/><p:nvPr><p:ph type="pic" idx="13"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr/></p:pic></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="4" name="Picture Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="pic" idx="13"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:custGeom><a:pathLst><a:path w="200" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="200" y="0"/></a:lnTo><a:lnTo><a:pt x="200" y="100"/></a:lnTo><a:lnTo><a:pt x="50" y="40"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom></p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>`);
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const picture = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.type === "image",
  );
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const width = picture?.width ?? 0;
  const height = picture?.height ?? 0;
  expect(picture?.clipPath).toBe(
    `M 0 0 L ${round(width)} 0 L ${round(width)} ${round(height)} L ${round(width * 0.25)} ${round(height * 0.4)} Z`,
  );
  const direct = hostedPictureClip(
    `<p:spPr/>`,
    [
      `<a:custGeom><a:pathLst><a:path w="100" h="50"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="50"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>`,
    ],
    10,
    20,
  );
  expect(direct?.clipPath).toBe("M 0 0 L 10 20 Z");
  const own = hostedPictureClip(
    `<p:pic><p:spPr><a:custGeom><a:pathLst><a:path w="100" h="40"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="40" y="40"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom></p:spPr></p:pic>`,
    [],
    50,
    20,
  );
  expect(own?.clipPath).toBe("M 0 0 L 50 0 L 20 20 Z");
  expect(
    hostedPictureClip(
      `<p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`,
      [
        `<a:custGeom><a:pathLst><a:path w="10" h="10"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:close/></a:path></a:pathLst></a:custGeom>`,
      ],
      10,
      10,
    ),
  ).toBeUndefined();
});

it("clips a picture that hangs off the slide without moving one that fits", () => {
  const photo = {
    id: "photo",
    type: "image" as const,
    x: 10,
    y: -40,
    width: 200,
    height: 160,
    cropTop: 10,
    cropBottom: 20,
  };
  const clipped = clipPictureToSlide(photo, 960, 540);
  expect(clipped.x).toBe(10);
  expect(clipped.y).toBe(0);
  expect(clipped.width).toBe(200);
  expect(clipped.height).toBe(120);
  expect(clipped.cropTop).toBeCloseTo(10 + (40 / 160) * 70, 5);
  expect(clipped.cropBottom).toBeCloseTo(20, 5);
  const inside = { ...photo, y: 20 };
  expect(clipPictureToSlide(inside, 960, 540)).toBe(inside);
  const turned = { ...photo, rotation: 90 };
  expect(clipPictureToSlide(turned, 960, 540)).toBe(turned);
});

it("letterboxes a picture when srcRect outsets the photo", () => {
  const crop = sourceCrop('<a:srcRect l="-75656" r="-75656"/>');
  expect(crop).toEqual({ cropLeft: -75.656, cropRight: -75.656 });
  const style = croppedPictureStyle({
    id: "photo",
    type: "image",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    ...crop,
  });
  expect(parseFloat(String(style?.width))).toBeCloseTo(39.791, 2);
  expect(parseFloat(String(style?.left))).toBeCloseTo(30.105, 2);
  expect(style?.top).toBe("0%");
  expect(style?.clipPath).toBeUndefined();
  const tight = croppedPictureStyle({
    id: "photo",
    type: "image",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    cropLeft: 12.199,
    cropRight: 39.048,
  });
  expect(tight?.clipPath).toBe("inset(0% 39.048% 0% 12.199%)");
  expect(sourceCrop('<a:srcRect l="11103" r="10021"/>')).toEqual({
    cropLeft: 11.103,
    cropRight: 10.021,
  });
});

it("clips a picture to a parallelogram and a flowchart input", () => {
  const parallelogram = `<a:prstGeom prst="parallelogram"><a:avLst><a:gd name="adj" fmla="val 36005"/></a:avLst></a:prstGeom>`;
  const path = pictureClip(parallelogram, 960, 540)?.clipPath;
  expect(path).toBe("M 194.427 0 L 960 0 L 765.573 540 L 0 540 Z");
  expect(pictureClip(`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`, 100, 40)).toBeUndefined();
  expect(
    pictureClip(
      `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 0"/></a:avLst></a:prstGeom>`,
      100,
      40,
    ),
  ).toBeUndefined();
  const flow = pictureClip(
    `<a:prstGeom prst="flowChartInputOutput"><a:avLst/></a:prstGeom>`,
    500,
    200,
  )?.clipPath;
  expect(flow).toContain("M 0 200");
  expect(flow).toContain("L 100 0");
  expect(flow).toContain("L 400 200");
  const diag = pictureClip(
    `<a:prstGeom prst="round2DiagRect"><a:avLst><a:gd name="adj1" fmla="val 2550"/><a:gd name="adj2" fmla="val 0"/></a:avLst></a:prstGeom>`,
    400,
    200,
  )?.clipPath;
  expect(diag).toContain("M 5.1 0");
  expect(diag).toContain("A 5.1 5.1 0 0 1 394.9 200");
});

it("centers a picture outline on the shape edge", () => {
  const slide = { width: 960, emuWidth: 9144000 };
  const box = { x: 10, y: 20, width: 108, height: 108 };
  const xml = `<p:pic><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1080000" cy="1080000"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:ln w="88900"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></p:spPr></p:pic>`;
  const outline = pictureOutline(xml, box, slide);
  const stroke = (88900 / 9144000) * 960;
  expect(outline).toMatchObject({ type: "shape", fill: "transparent", stroke: "#FFFFFF" });
  expect(outline?.strokeWidth).toBeCloseTo(stroke, 4);
  expect(outline?.x).toBeCloseTo(box.x - stroke / 2, 4);
  expect(outline?.width).toBeCloseTo(box.width + stroke, 4);
  expect(outline?.y).toBeCloseTo(box.y - stroke / 2, 4);
  const inside = pictureOutline(xml.replace("<a:ln w", '<a:ln algn="in" w'), box, slide);
  expect(inside?.x).toBe(box.x);
  expect(inside?.width).toBe(box.width);
  expect(pictureOutline(xml.replace(/<a:ln\b[\s\S]*<\/a:ln>/, "<a:ln><a:noFill/></a:ln>"), box, slide)).toBeUndefined();
});

it("lets a negative fillRect hang a background picture off the slide", () => {
  const box = { x: 0, y: 0, width: 960, height: 540 };
  expect(stretchFill(`<a:stretch><a:fillRect/></a:stretch>`, box)).toEqual(box);
  expect(
    stretchFill(`<a:stretch><a:fillRect l="-43000" r="-43000"/></a:stretch>`, box),
  ).toEqual({ x: -412.8, y: 0, width: 1785.6, height: 540 });
});

it("places a quarter-turned metafile that is already upright in its display frame", () => {
  const svg = (w: number, h: number) =>
    `data:image/svg+xml;base64,${Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`,
    ).toString("base64")}`;
  const upright = uprightQuarterTurn(
    { x: 137, y: -49, width: 598, height: 847, rotation: 270 },
    svg(1169, 826),
  );
  expect(upright.rotation).toBeUndefined();
  expect(upright.width).toBe(847);
  expect(upright.height).toBe(598);
  expect(upright.x + upright.width / 2).toBeCloseTo(137 + 598 / 2);
  expect(upright.y + upright.height / 2).toBeCloseTo(-49 + 847 / 2);
  const turned = uprightQuarterTurn(
    { x: 10, y: 20, width: 200, height: 100, rotation: 90 },
    svg(400, 200),
  );
  expect(turned).toMatchObject({ x: 10, y: 20, width: 200, height: 100, rotation: 90 });
});

it("turns a picture-filled shape with the shape, including a group", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const zip = new JSZip();
  zip.file("ppt/media/image1.png", png);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="8" name="Round"/></p:nvSpPr><p:spPr>
        <a:xfrm rot="16200000"><a:off x="2000000" y="0"/><a:ext cx="3000000" cy="6000000"/></a:xfrm>
        <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
        <a:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>
        <a:ln w="76200"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
      </p:spPr></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="9" name="Flat"/></p:nvSpPr><p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:blipFill><a:blip r:embed="rId2"/></a:blipFill>
      </p:spPr></p:sp>
      <p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="Group"/></p:nvGrpSpPr>
        <p:grpSpPr><a:xfrm rot="5400000"><a:off x="0" y="0"/><a:ext cx="4000000" cy="4000000"/><a:chOff x="0" y="0"/><a:chExt cx="4000000" cy="4000000"/></a:xfrm></p:grpSpPr>
        <p:sp><p:nvSpPr><p:cNvPr id="5" name="Child"/></p:nvSpPr><p:spPr>
          <a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="800000" cy="500000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:blipFill><a:blip r:embed="rId2"/></a:blipFill>
        </p:spPr></p:sp>
      </p:grpSp>
    </p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const elements = parsed.content.slides[parsed.content.slideOrder[0]].elements;
  const photos = elements.filter((el) => el.alt === "Shape image fill");
  const turned = photos.find((el) => el.rotation === 270);
  const flat = photos.find((el) => !el.rotation);
  const grouped = photos.find((el) => el.rotation === 90);
  expect(turned?.clipPath).toMatch(/^M /);
  expect(turned && turned.width < (turned.height ?? 0)).toBe(true);
  const outline = elements.find((el) => el.type === "shape" && el.stroke && el.rotation === 270);
  expect(outline).toBeTruthy();
  expect(elements.indexOf(outline!)).toBeGreaterThan(elements.indexOf(turned!));
  const mid = (el: { x: number; y: number; width: number; height: number }) => ({
    x: el.x + el.width / 2,
    y: el.y + el.height / 2,
  });
  expect(mid(outline!).x).toBeCloseTo(mid(turned!).x, 3);
  expect(mid(outline!).y).toBeCloseTo(mid(turned!).y, 3);
  expect(flat?.rotation).toBeUndefined();
  expect(grouped?.rotation).toBe(90);
});
