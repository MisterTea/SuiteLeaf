import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { exportPptx } from "../packages/core/src/pptx-export";

it("preserves mixed text styles, hard breaks, and supplementary numeric characters", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr b="1" u="sng"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>Bold</a:t></a:r><a:br/><a:r><a:rPr b="0" u="none"/><a:t>Plain &#x1F600; &#128512;</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:sld>`,
  );
  const first = await parsePowerPoint(
    await zip.generateAsync({ type: "uint8array" }),
  );
  const element = first.content.slides[first.content.slideOrder[0]].elements[0];
  expect(element.content).toBe("Bold\nPlain 😀 😀");
  expect(element.runs).toEqual([
    {
      text: "Bold",
      bold: true,
      italic: false,
      underline: true,
      color: "#FF0000",
    },
    { text: "\n" },
    { text: "Plain 😀 😀", bold: false, italic: false, underline: false },
  ]);
  const second = await parsePowerPoint(await exportPptx(first));
  const output =
    second.content.slides[second.content.slideOrder[0]].elements[0];
  expect(output.content).toBe(element.content);
  const plain = output.runs?.find((run) => run.text.startsWith("Plain"));
  expect(plain?.bold).toBe(false);
  expect(plain?.underline).toBe(false);
});

it("centers a free text box from the presentation default, not master otherStyle", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:defaultTextStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="2400"><a:latin typeface="Times New Roman"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Conclusions</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`);
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster><p:cSld><p:spTree/></p:cSld><p:txStyles><p:otherStyle><a:lvl1pPr algn="l"><a:defRPr sz="1800"><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const title = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.content === "Conclusions",
  );
  expect(title?.align).toBe("center");
  expect(title?.fontSize).toBe(24);
  expect(title?.fontFamily).toBe("SuiteLeaf Maple");
});

it("tightens glyphs with defRPr spc and uses exact spcPts line spacing", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr algn="r"><a:lnSpc><a:spcPts val="9600"/></a:lnSpc><a:defRPr sz="11000" spc="-300"/></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr sz="8800"/><a:t>Dashboard</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const title = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  expect(title?.align).toBe("right");
  expect(title?.runs?.[0]?.tracking).toBe(-3);
  expect(title?.lineHeight).toBeCloseTo(96 / 88, 5);
});
