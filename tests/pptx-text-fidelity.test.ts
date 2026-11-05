import { presentationLineHeight } from "../packages/core/src/pptx-line-spacing";
import { expect, it } from "vitest";
import JSZip from "jszip";

import { parsePowerPoint } from "../packages/core/src/pptx";
import { outerShadow, textReflection } from "../packages/core/src/pptx-run-paint";
import { exportPptx } from "../packages/core/src/pptx-export";
import { plainWordArt, wordArtFill, wordArtFrame } from "../packages/core/src/pptx-word-art";

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

it("gives a larger paragraph mark the empty line after a hard break", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr anchor="b"/><a:lstStyle/><a:p>
        <a:r><a:rPr sz="4400"/><a:t>Title</a:t></a:r>
        <a:br><a:rPr sz="4400"/></a:br>
        <a:br><a:rPr sz="6600"/></a:br>
        <a:endParaRPr sz="6600"/>
      </a:p></p:txBody></p:sp></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const element = file.content.slides[file.content.slideOrder[0]].elements[0];
  expect(element.valign).toBe("bottom");
  expect(element.content).toBe("Title\n\n");
  expect(element.runs?.find((run) => run.text === "\u200b")?.fontSize).toBe(66);
});

it("does not stretch a line of words when the paragraph mark is larger", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p>
        <a:pPr><a:defRPr sz="2000"/></a:pPr>
        <a:r><a:rPr/><a:t>Ask what if</a:t></a:r>
        <a:endParaRPr sz="2800"/>
      </a:p></p:txBody></p:sp></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const element = file.content.slides[file.content.slideOrder[0]].elements[0];
  expect(element.runs?.some((run) => run.text === "\u200b")).toBe(false);
  expect(element.fontSize).toBe(20);
});

it("drops a trailing break when the paragraph mark is shorter than that break", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p>
        <a:r><a:rPr sz="2400"/><a:t>promotion decisions.</a:t></a:r>
        <a:br><a:rPr sz="2400"/></a:br>
        <a:endParaRPr sz="600"/>
      </a:p><a:p>
        <a:r><a:rPr sz="2400"/><a:t>She saw</a:t></a:r>
      </a:p></p:txBody></p:sp></p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const element = file.content.slides[file.content.slideOrder[0]].elements[0];
  expect(element.content).toBe("promotion decisions.\nShe saw");
  const breaks = element.runs?.filter((run) => run.text === "\n") ?? [];
  expect(breaks).toEqual([expect.objectContaining({ paragraphBreak: true })]);
  expect(element.runs?.some((run) => run.text === "\u200b")).toBe(false);
});

it("paints a free text box in the presentation default colour", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Conclusions</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  expect(box?.color).toBe("#112233");
  expect(box?.runs?.[0]?.color).toBe("#112233");
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

it("stacks paragraph space after onto the next paragraph's space before", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:defaultTextStyle><a:lvl1pPr><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:spcBef><a:spcPts val="1200"/></a:spcBef><a:spcAft><a:spcPts val="600"/></a:spcAft></a:pPr><a:r><a:rPr sz="1800"/><a:t>One</a:t></a:r></a:p><a:p><a:pPr><a:spcBef><a:spcPts val="1200"/></a:spcBef><a:spcAft><a:spcPts val="600"/></a:spcAft></a:pPr><a:r><a:rPr sz="1800"/><a:t>Two</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  const inch = parsed.content.width / (parsed.content.pointWidth / 72);
  expect(box?.runs?.[0]?.spaceBefore).toBeUndefined();
  expect(box?.runs?.find((run) => run.paragraphBreak)?.spaceBefore).toBeCloseTo((18 / 72) * inch, 5);
});

it("sizes a blank line after a subscript at the script size", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:spcBef><a:spcPct val="20000"/></a:spcBef></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr sz="2400"/><a:t>Start</a:t></a:r></a:p><a:p><a:endParaRPr sz="2400" baseline="-25000"/></a:p><a:p><a:r><a:rPr sz="2800"/><a:t>Next</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  const runs = box?.runs ?? [];
  const blank = runs.filter((run) => run.paragraphBreak);
  expect(blank[0]?.fontSize).toBeCloseTo(24 * (2 / 3), 2);
  expect(blank[1]?.fontSize).toBe(28);
  const inch = parsed.content.width / (parsed.content.pointWidth / 72);
  expect(blank[0]?.spaceBefore).toBeCloseTo((5.76 / 72) * inch, 2);
});

it("sizes a blank line from a subscript paragraph default", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2400"/><a:t>Rewards</a:t></a:r></a:p><a:p><a:pPr><a:defRPr sz="2548" baseline="-26879"/></a:pPr><a:endParaRPr/></a:p><a:p><a:r><a:rPr sz="2800"/><a:t>Quantities</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const blank = parsed.content.slides[parsed.content.slideOrder[0]].elements[0]?.runs?.find(
    (run) => run.paragraphBreak,
  );
  expect(blank?.fontSize).toBeCloseTo(25.48 * (2 / 3), 2);
});

it("lets a paragraph spacing percentage replace an inherited point gap", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:defaultTextStyle><a:lvl1pPr><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:defRPr sz="1900"><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2800"/><a:t>Name</a:t></a:r></a:p><a:p><a:pPr><a:spcBef><a:spcPct val="10000"/></a:spcBef></a:pPr><a:r><a:rPr sz="1900"/><a:t>Role</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  const inch = parsed.content.width / (parsed.content.pointWidth / 72);
  const before = box?.runs?.find((run) => run.paragraphBreak)?.spaceBefore;
  expect(before).toBeCloseTo((2.28 / 72) * inch, 4);
  expect(before).toBeLessThan((10 / 72) * inch);
});

it("lets a paragraph line-spacing multiple replace the list style", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:defaultTextStyle><a:lvl1pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:defRPr sz="1800"><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:lnSpc><a:spcPts val="2400"/></a:lnSpc></a:lvl1pPr></a:lstStyle><a:p><a:pPr><a:lnSpc><a:spcPct val="200000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="3400"><a:latin typeface="Arial"/></a:rPr><a:t>http://example.test</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const line = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  expect(line?.lineHeight).toBeCloseTo(presentationLineHeight() * 2, 5);
});

it("keeps a second paragraph's line spacing when the box uses the first", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="1800"><a:latin typeface="Arial"/></a:rPr><a:t>Open</a:t></a:r></a:p><a:p><a:pPr><a:lnSpc><a:spcPct val="80000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="1800"><a:latin typeface="Arial"/></a:rPr><a:t>Tight</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  const single = presentationLineHeight();
  expect(box?.lineHeight).toBeCloseTo(single, 5);
  const tight = box?.runs?.find((run) => run.paragraphBreak);
  expect(tight?.paraLine).toBeCloseTo(single * 0.8, 5);
  expect(box?.runs?.[0]?.paraLine).toBeCloseTo(single, 5);
});

it("sizes a mixed line from its largest run, not the smaller quote", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="2800"><a:latin typeface="Calibri"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr><a:latin typeface="Calibri"/></a:rPr><a:t>Query:</a:t></a:r><a:r><a:rPr sz="2400"><a:latin typeface="Calibri"/></a:rPr><a:t> “Austin?”</a:t></a:r></a:p><a:p><a:r><a:rPr><a:latin typeface="Calibri"/></a:rPr><a:t>Next</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  expect(box?.fontSize).toBe(28);
  const quote = box?.runs?.find((run) => run.text.includes("Austin"));
  expect(quote?.fontSize).toBe(24);
  expect(box?.runs?.find((run) => run.paragraphBreak)?.fontSize).toBe(28);
});

it("keeps the paragraph strut on the body size when a subscript is larger", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="3200"><a:latin typeface="Calibri"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr><a:latin typeface="Calibri"/></a:rPr><a:t>P</a:t></a:r><a:r><a:rPr sz="3600" baseline="-25000"/><a:t>t</a:t></a:r></a:p><a:p><a:r><a:rPr><a:latin typeface="Calibri"/></a:rPr><a:t>Next</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  expect(box?.fontSize).toBe(32);
  const index = box?.runs?.find((run) => run.text === "t");
  expect(index?.fontSize).toBe(36);
  expect(index?.baseline).toBe(-25);
  const next = box?.runs?.find((run) => run.paragraphBreak);
  expect(next?.fontSize).toBe(32);
});

it("keeps the line-height multiple when a later paragraph uses a smaller font", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="2800"><a:latin typeface="Arial"/></a:rPr><a:t>Heading</a:t></a:r></a:p><a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="1800"><a:latin typeface="Arial"/></a:rPr><a:t>Body</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  const single = presentationLineHeight();
  expect(box?.lineHeight).toBeCloseTo(single, 5);
  const body = box?.runs?.find((run) => run.paragraphBreak);
  expect(body?.paraLine).toBeUndefined();
});

it("keeps a run outline separate from the glyph fill", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="13800" b="1"><a:ln w="12700"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>DA</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const run = parsed.content.slides[parsed.content.slideOrder[0]].elements[0]?.runs?.[0];
  expect(run?.text).toBe("DA");
  expect(run?.color).toBe("#FF0000");
  expect(run?.stroke).toBe("#0000FF");
  expect(run?.strokeWidth).toBe(1);
});

it("sizes a blank paragraph from its end mark, not the list default", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1400"><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2400"/><a:t>Workflow</a:t></a:r></a:p><a:p><a:r><a:t></a:t></a:r><a:endParaRPr sz="2400"/></a:p><a:p><a:r><a:rPr sz="2400"/><a:t>Next</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const runs = parsed.content.slides[parsed.content.slideOrder[0]].elements[0]?.runs ?? [];
  const blanks = runs.filter((run) => run.text === "\n");
  expect(blanks.length).toBeGreaterThan(0);
  expect(blanks.every((run) => run.fontSize === 24)).toBe(true);
});

it("stacks wordArtVert letters upright instead of wrapping the word", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Banner"/><p:cNvSpPr txBox="1"/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="2243937" y="1072355"/><a:ext cx="769121" cy="4328575"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr vert="wordArtVert" wrap="square"/><a:p><a:r><a:rPr sz="3200" b="1"/><a:t>IMPACTS</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const label = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.content === "IMPACTS",
  );
  expect(label?.textFlow).toBe("upright");
});

it("stretches plain WordArt to the shape and leaves ordinary nowrap text at its size", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="4" name="WordArt 8"/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="3008784" y="332656"/><a:ext cx="3168351" cy="6215296"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
        <p:txBody><a:bodyPr wrap="none" fromWordArt="1"><a:prstTxWarp prst="textPlain"><a:avLst/></a:prstTxWarp></a:bodyPr>
          <a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="9600"><a:latin typeface="Arial Black"/></a:rPr><a:t>2</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="5" name="Label"/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="400000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody><a:bodyPr wrap="none"/><a:p><a:r><a:rPr sz="1800"/><a:t>Keep</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const elements = parsed.content.slides[parsed.content.slideOrder[0]].elements;
  const numeral = elements.find((el) => el.content === "2");
  const label = elements.find((el) => el.content === "Keep");
  expect(numeral).toMatchObject({
    stretchText: true,
    nowrap: true,
    fontSize: 96,
    inset: 0,
    padLeft: 0,
  });
  expect(numeral?.width).toBeGreaterThan(200);
  expect(numeral?.height).toBeGreaterThan(numeral?.width ?? 0);
  expect(label?.stretchText).toBeUndefined();
  expect(label?.nowrap).toBe(true);
  expect(label?.fontSize).toBe(18);
  expect(plainWordArt(`<a:bodyPr fromWordArt="1"><a:prstTxWarp prst="textArchUp"/></a:bodyPr>`)).toBe(false);
  const frame = wordArtFrame([
    { left: 8, right: 40, ascent: 70, descent: 4 },
    { left: 2, right: 10, ascent: 20, descent: 2 },
  ]);
  expect(frame?.viewBox).toBe("0 0 48 96");
  expect(frame?.glyphs[0]).toEqual({ x: 8, y: 70 });
  expect(frame?.glyphs[1]).toEqual({ x: 20, y: 94 });
  expect(wordArtFrame([{ left: 0, right: 0, ascent: 0, descent: 0 }])).toBeUndefined();
  expect(wordArtFill("#000000", [{ text: "2", color: "#b9cde5" }])).toBe("#b9cde5");
  expect(wordArtFill("#112233", [{ text: " ", color: "#ff0000" }])).toBe("#112233");
});

it("paints a later latin face when a leading blank paragraph inherits the theme", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1400"><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="8000000" cy="4000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:pPr/></a:p><a:p><a:r><a:rPr sz="2000"><a:latin typeface="Calibri"/></a:rPr><a:t>looking after</a:t></a:r></a:p><a:p><a:r><a:rPr sz="2000"><a:latin typeface="Arial Narrow"/></a:rPr><a:t>http://example.test/long-hyperlink</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  expect(box?.fontFamily).toBe("SuiteLeaf Willow");
  expect(box?.fontSize).toBe(20);
  expect(box?.lineHeight).toBeCloseTo(presentationLineHeight(), 5);
  expect(box?.runs?.find((run) => run.paragraphBreak)?.fontSize).toBe(14);
  expect(box?.runs?.find((run) => run.text === "looking after")?.font).toBe("SuiteLeaf Willow");
  expect(box?.runs?.find((run) => run.text.startsWith("http"))?.font).toBe("SuiteLeaf Pine");
});

it("paints a run outer shadow down and to the right, not as a second copy of the letters", async () => {
  expect(
    outerShadow(
      `<a:effectLst><a:outerShdw dist="12700" dir="0"><a:srgbClr val="FF0000"/></a:outerShdw></a:effectLst>`,
      {},
    ),
  ).toEqual({ x: 1, y: 0, blur: 0, color: "#FF0000" });
  expect(
    outerShadow(
      `<a:effectLst><a:outerShdw dist="12700" dir="5400000" blurRad="25400"><a:srgbClr val="000000"/></a:outerShdw></a:effectLst>`,
      {},
    ),
  ).toEqual({ x: 0, y: 1, blur: 2, color: "#000000" });
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="3200"><a:effectLst><a:outerShdw blurRad="38100" dist="38100" dir="2700000" algn="tl"><a:srgbClr val="000000"><a:alpha val="43137"/></a:srgbClr></a:outerShdw></a:effectLst></a:rPr><a:t>Projects</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const run = parsed.content.slides[parsed.content.slideOrder[0]].elements[0]?.runs?.[0];
  expect(run?.text).toBe("Projects");
  expect(run?.shadow).toEqual({ x: 2.12, y: 2.12, blur: 3, color: "rgba(0, 0, 0, 0.431)" });
});

it("paints a run gradient through the glyphs and a downward reflection under the paragraph", async () => {
  expect(
    textReflection(
      `<a:effectLst><a:reflection blurRad="6350" stA="55000" endA="300" endPos="45500" dir="5400000" sy="-100000" algn="bl"/></a:effectLst>`,
    ),
  ).toEqual({ startAlpha: 0.55, endAlpha: 0.003, endPos: 0.455 });
  expect(
    textReflection(`<a:effectLst><a:reflection sy="100000" stA="50000" endPos="40000"/></a:effectLst>`),
  ).toBeUndefined();
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="6000"><a:ln w="12700"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:ln><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="D0B0E8"/></a:gs><a:gs pos="100000"><a:srgbClr val="5B2C83"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill><a:effectLst><a:reflection stA="55000" endA="300" endPos="45500" sy="-100000"/></a:effectLst></a:rPr><a:t>Structure</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const run = parsed.content.slides[parsed.content.slideOrder[0]].elements[0]?.runs?.[0];
  expect(run?.text).toBe("Structure");
  expect(run?.gradient).toContain("linear-gradient(");
  expect(run?.gradient).toContain("#D0B0E8");
  expect(run?.gradient).toContain("#5B2C83");
  expect(run?.reflection).toEqual({ startAlpha: 0.55, endAlpha: 0.003, endPos: 0.455 });
  expect(run?.stroke).toBe("#112233");
});

it("keeps the earlier solid fill when a list style only adds a glow", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:defaultTextStyle><a:lvl1pPr><a:defRPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr><a:effectLst><a:glow rad="76200"><a:srgbClr val="FFFFFF"><a:alpha val="40000"/></a:srgbClr></a:glow></a:effectLst></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr/><a:t>Thank you</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  expect(box?.color?.toLowerCase()).toBe("#112233");
  expect(box?.runs?.[0]?.color?.toLowerCase()).toBe("#112233");
});

it("uses a list style solid fill when the same defRPr also glows", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="800000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr><a:solidFill><a:srgbClr val="010101"/></a:solidFill><a:effectLst><a:glow rad="76200"><a:srgbClr val="FFFFFF"/></a:glow></a:effectLst></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr/><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  expect(box?.color?.toLowerCase()).toBe("#010101");
});

it("keeps the list level colour and size when a paragraph only sets the number kind", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:buClr><a:srgbClr val="00A6D6"/></a:buClr><a:buSzPts val="2800"/><a:buFont typeface="Arial"/><a:buChar char="•"/></a:lvl1pPr></a:lstStyle>
      <a:p><a:pPr marL="508000" indent="-457200"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:rPr sz="2000"/><a:t>Prepare</a:t></a:r><a:r><a:rPr sz="2000"><a:solidFill><a:srgbClr val="00A6D6"/></a:solidFill></a:rPr><a:t> more</a:t></a:r></a:p>
    </p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const list = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  expect(list?.content).toBe("1. Prepare more");
  expect(list?.runs?.[0]).toMatchObject({
    text: "1. ",
    color: "#00A6D6",
    fontSize: 28,
    font: "SuiteLeaf Aspen",
  });
  expect(list?.runs?.[1]?.text).toBe("Prepare");
  expect(list?.runs?.[1]?.color).toBeUndefined();
  expect(list?.runs?.[2]).toMatchObject({ text: " more", color: "#00A6D6" });
});

it("restarts automatic numbering after an unnumbered paragraph", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/>
      <a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>One</a:t></a:r></a:p>
      <a:p><a:pPr><a:buNone/></a:pPr></a:p>
      <a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>Two</a:t></a:r></a:p>
      <a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>Three</a:t></a:r></a:p>
    </p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const list = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  expect(list?.content).toBe("1. One\n\n1. Two\n2. Three");
});

it("clips a shape picture fill to its custom geometry", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const zip = new JSZip();
  zip.file("ppt/media/image1.png", png);
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="6" name="Photo"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="514350"/></a:xfrm><a:custGeom><a:pathLst><a:path w="100" h="50"><a:moveTo><a:pt x="0" y="50"/></a:moveTo><a:cubicBezTo><a:pt x="0" y="0"/><a:pt x="40" y="0"/><a:pt x="100" y="25"/></a:cubicBezTo><a:lnTo><a:pt x="0" y="50"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom><a:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:spPr></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const photo = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (el) => el.type === "image",
  );
  expect(photo?.clipPath).toBe("M 0 54 C 0 0 38.4 0 96 27 L 0 54 Z");
});

it("draws a StarSymbol square bullet larger than the Unicode small square", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:pPr><a:buFont typeface="StarSymbol"/><a:buChar char="▪"/></a:pPr><a:r><a:rPr sz="6400"/><a:t>Welcome</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
  const bullet = box?.runs?.find((run) => run.text.startsWith("▪"));
  expect(bullet?.fontSize).toBeCloseTo(64 * 1.85, 2);
  expect(bullet?.color).toBe("#000000");
});

it("resolves automatic-number theme faces and keeps the words' emphasis", async () => {
 const zip=new JSZip();
 zip.file("ppt/theme/theme1.xml", '<a:theme><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>');
 zip.file("ppt/slides/slide1.xml", '<p:sld><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:pPr><a:buFont typeface="+mj-lt"/><a:buAutoNum type="alphaLcParenR"/></a:pPr><a:r><a:rPr sz="1800" b="1" i="1"/><a:t>Item</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
 zip.file("ppt/slides/_rels/slide1.xml.rels", '<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>');
 zip.file("ppt/slideLayouts/slideLayout1.xml", '<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>');
 zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", '<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>');
 zip.file("ppt/slideMasters/slideMaster1.xml", '<p:sldMaster/>');
 zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", '<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>');
 const parsed=await parsePowerPoint(await zip.generateAsync({type:"uint8array"}));const marker=parsed.content.slides[parsed.content.slideOrder[0]].elements.find(e=>e.type==="text")?.runs?.[0];
 expect(marker).toMatchObject({text:"a) ",bold:true,italic:true,font:"SuiteLeaf Durian"});
});

it("inherits text color for symbol markers when buClrTx replaces an ancestor bullet fill", async()=>{
 const zip=new JSZip();zip.file("ppt/slides/slide1.xml", '<p:sld><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:buClr><a:srgbClr val="FF0000"/></a:buClr><a:buFont typeface="Wingdings"/><a:buChar char="q"/></a:lvl1pPr></a:lstStyle><a:p><a:pPr><a:buClrTx/></a:pPr><a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:rPr><a:t>Blue</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
 const d=await parsePowerPoint(await zip.generateAsync({type:"uint8array"}));const e=d.content.slides[d.content.slideOrder[0]].elements.find(x=>x.type==="text");expect(e?.runs?.[0].color).toBe("#0000FF");
});

it("sizes all-script paragraphs at 2/3 unless closed by an unshifted endParaRPr", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree>
      <p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr><a:normAutofit fontScale="90000"/></a:bodyPr>
          <a:p><a:r><a:rPr sz="9600" baseline="30000"/><a:t>Title</a:t></a:r><a:endParaRPr sz="9600" baseline="30000"/></a:p>
        </p:txBody></p:sp>
      <p:sp><p:spPr><a:xfrm><a:off x="0" y="1000000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/>
          <a:p><a:r><a:rPr sz="6000" baseline="30000"/><a:t>Authors</a:t></a:r><a:endParaRPr sz="4400"/></a:p>
        </p:txBody></p:sp>
    </p:spTree></p:cSld></p:sld>`,
  );
  const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const els = parsed.content.slides[parsed.content.slideOrder[0]].elements;
  expect(els[0]?.fontSize).toBe(58);
  expect(els[0]?.runs?.[0]?.scriptStrut).toBe(58);
  expect(els[1]?.fontSize).toBe(60);
  expect(els[1]?.runs?.[0]?.scriptStrut).toBe(60);
});
