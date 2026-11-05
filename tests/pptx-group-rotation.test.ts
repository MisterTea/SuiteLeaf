import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { readableTextRotation, verticalTextFlow } from "../packages/core/src/pptx-geometry";
import {
  mapThroughGroups,
  placeGroupedBox,
  readGroups,
  type GroupXfrm,
} from "../packages/core/src/pptx-group-xform";

const theme = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements>
<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="000000"/></a:dk2><a:lt2><a:srgbClr val="FFFFFF"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
<a:accent3><a:srgbClr val="A9D08E"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>
<a:fmtScheme><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme></a:themeElements></a:theme>`;

async function deck(slide: string) {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  zip.file("ppt/slides/slide1.xml", slide);
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`);
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>`);
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  zip.file("ppt/theme/theme1.xml", theme);
  return parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
}

describe("rotated DrawingML groups", () => {
  it("turns a child about the group center and keeps the pre-rotation box", async () => {
    const parsed = await deck(`<p:sld><p:cSld><p:spTree>
      <p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="Stem"/></p:nvGrpSpPr>
        <p:grpSpPr><a:xfrm rot="5400000"><a:off x="0" y="0"/><a:ext cx="4000000" cy="4000000"/><a:chOff x="0" y="0"/><a:chExt cx="4000000" cy="4000000"/></a:xfrm></p:grpSpPr>
        <p:sp><p:nvSpPr><p:cNvPr id="3" name="Mark"/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="2000000" y="1500000"/><a:ext cx="1000000" cy="1000000"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
          </p:spPr>
        </p:sp>
      </p:grpSp>
    </p:spTree></p:cSld></p:sld>`);
    const mark = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
      (el) => el.type === "shape",
    );
    expect(mark?.rotation).toBe(90);
    const centerX = (mark?.x ?? 0) + (mark?.width ?? 0) / 2;
    const centerY = (mark?.y ?? 0) + (mark?.height ?? 0) / 2;
    expect(centerX).toBeCloseTo((2000000 / 12192000) * 960, 3);
    expect(centerY).toBeCloseTo((2500000 / 6858000) * 540, 3);
  });

  it("lays eaVert sideways so a half-turn still reads upward", async () => {
    expect(verticalTextFlow("eaVert")).toBe("down");
    const parsed = await deck(`<p:sld><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="6" name="Cite"/><p:cNvSpPr txBox="1"/></p:nvSpPr>
        <p:spPr><a:xfrm rot="10800000"><a:off x="6000000" y="3000000"/><a:ext cx="400000" cy="3000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
        <p:txBody><a:bodyPr vert="eaVert" wrap="square"/><a:p><a:r><a:t>Staff et al. 2018</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree></p:cSld></p:sld>`);
    const cite = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
      (el) => el.content?.includes("Staff"),
    );
    expect(cite?.textFlow).toBe("down");
    expect(cite?.rotation).toBe(180);
  });

  it("keeps letters upright when a half turn only cancels one flip", async () => {
    expect(readableTextRotation(180, false, true)).toBeUndefined();
    expect(readableTextRotation(180, true, false)).toBeUndefined();
    expect(readableTextRotation(0, true, false)).toBeUndefined();
    expect(readableTextRotation(180, false, false)).toBe(180);
    expect(readableTextRotation(90, true, false)).toBe(90);
    const parsed = await deck(`<p:sld><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm rot="10800000" flipV="1"><a:off x="684367" y="531223"/><a:ext cx="8496010" cy="818606"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:p><a:r><a:t>Overview</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="3" name="Sideways"/></p:nvSpPr>
        <p:spPr><a:xfrm rot="10800000"><a:off x="0" y="2000000"/><a:ext cx="2000000" cy="800000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody><a:bodyPr/><a:p><a:r><a:t>Upside down</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree></p:cSld></p:sld>`);
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const title = slide.elements.find((el) => el.content === "Overview");
    const turned = slide.elements.find((el) => el.content === "Upside down");
    expect(title?.rotation).toBeUndefined();
    expect(title?.flipV).toBeUndefined();
    expect(title?.flipH).toBeUndefined();
    expect(turned?.rotation).toBe(180);
  });

  it("leaves an unrotated group where the child was placed", () => {
    const group: GroupXfrm = {
      childStart: 0,
      end: 10,
      ox: 100,
      oy: 200,
      cx: 400,
      cy: 200,
      chx: 0,
      chy: 0,
      chcx: 400,
      chcy: 200,
      rot: 0,
      pr: "",
    };
    expect(mapThroughGroups([group], 1, 10, 20, 30, 40)).toEqual({
      emuX: 110,
      emuY: 220,
      emuW: 30,
      emuH: 40,
      rotation: 0,
    });
  });

  it("scales a diagram box with its group and leaves a box alone when the slide has no size", () => {
    const group: GroupXfrm = {
      childStart: 0,
      end: 20,
      ox: 0,
      oy: 0,
      cx: 200,
      cy: 100,
      chx: 0,
      chy: 0,
      chcx: 100,
      chcy: 100,
      rot: 0,
      pr: "",
    };
    const metrics = { width: 100, height: 100, emuWidth: 100, emuHeight: 100 };
    expect(placeGroupedBox([group], 1, { x: 10, y: 20, width: 30, height: 40 }, metrics)).toEqual({
      x: 20,
      y: 20,
      width: 60,
      height: 40,
    });
    expect(
      placeGroupedBox([group], 1, { x: 10, y: 20, width: 30, height: 40 }, { ...metrics, width: 0 }),
    ).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(
      placeGroupedBox([group], 1, { x: 10, y: 20, width: 30, height: 40, rotation: 270 }, metrics),
    ).toMatchObject({
      x: 35,
      y: 0,
      width: 30,
      height: 80,
      rotation: 270,
    });
  });

  it("mirrors a child across a flipped group before rotation", () => {
    const group: GroupXfrm = {
      childStart: 0,
      end: 10,
      ox: 0,
      oy: 0,
      cx: 4000,
      cy: 2000,
      chx: 0,
      chy: 0,
      chcx: 4000,
      chcy: 2000,
      rot: 0,
      flipH: true,
      pr: "",
    };
    expect(mapThroughGroups([group], 1, 0, 100, 1000, 500)).toEqual({
      emuX: 3000,
      emuY: 100,
      emuW: 1000,
      emuH: 500,
      rotation: 0,
      flipH: true,
    });
    expect(mapThroughGroups([group], 1, 0, 0, 4000, 2000)).toMatchObject({
      emuX: 0,
      emuY: 0,
      emuW: 4000,
      emuH: 2000,
      flipH: true,
    });
    const vertical: GroupXfrm = { ...group, flipH: undefined, flipV: true };
    expect(mapThroughGroups([vertical], 1, 50, 0, 100, 400)).toMatchObject({
      emuX: 50,
      emuY: 1600,
      flipV: true,
    });
    const read = readGroups(
      `<p:grpSp><p:grpSpPr><a:xfrm flipV="1"><a:off x="0" y="0"/><a:ext cx="10" cy="20"/><a:chOff x="0" y="0"/><a:chExt cx="10" cy="20"/></a:xfrm></p:grpSpPr></p:grpSp>`,
    );
    expect(read[0]?.flipV).toBe(true);
    expect(read[0]?.flipH).toBeUndefined();
    const metrics = { width: 100, height: 100, emuWidth: 100, emuHeight: 100 };
    expect(placeGroupedBox([group], 1, { x: 0, y: 0, width: 10, height: 10 }, metrics).flipH).toBe(
      true,
    );
    expect(
      placeGroupedBox([group], 1, { x: 0, y: 0, width: 10, height: 10, flipH: true }, metrics).flipH,
    ).toBeUndefined();
  });

  it("mirrors custom geometry when the group transform is flipped", async () => {
    const parsed = await deck(`<p:sld><p:cSld><p:spTree>
      <p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="Road"/></p:nvGrpSpPr>
        <p:grpSpPr><a:xfrm flipH="1"><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/><a:chOff x="0" y="0"/><a:chExt cx="4000000" cy="2000000"/></a:xfrm></p:grpSpPr>
        <p:sp><p:nvSpPr><p:cNvPr id="3" name="Lane"/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:solidFill><a:srgbClr val="666666"/></a:solidFill>
          </p:spPr>
        </p:sp>
      </p:grpSp>
    </p:spTree></p:cSld></p:sld>`);
    const lane = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
      (el) => el.type === "shape",
    );
    expect(lane?.flipH).toBe(true);
    expect(lane?.x).toBeCloseTo((3000000 / 12192000) * 960, 3);
    expect(lane?.y).toBeCloseTo(0, 3);
  });
});
