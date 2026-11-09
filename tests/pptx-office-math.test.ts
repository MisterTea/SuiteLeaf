import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { exportPptx } from "../packages/core/src/pptx-export";
import { createFile, type SlideFile } from "../packages/core/src";
import { officeMathRuns } from "../packages/core/src/pptx-math";
import { officeMathLatex } from "../packages/core/src/slide-latex";
import { runsToHtml } from "../apps/web/src/editors/slide-runs";

it("exports a standalone LaTeX slide equation as native math", async () => {
  const file = createFile("slide", "Equations") as SlideFile;
  file.content.slides[file.content.slideOrder[0]].elements.push({
    id: "equation", type: "text", math: true, fontSize: 24, color: "#336699",
    x: 10, y: 20, width: 400, height: 100, content: "$$\\frac{a}{b}$$",
  });
  const reopened = await parsePowerPoint(await exportPptx(file));
  const equation = reopened.content.slides[reopened.content.slideOrder[0]].elements
    .flatMap((element) => element.runs ?? []).find((run) => run.fraction);
  expect(equation?.fraction).toMatchObject({ num: [{ text: "a" }], den: [{ text: "b" }] });
  expect(equation?.officeMath?.xml).toContain('val="336699"');
});

it("reads a subscript and a stacked fraction from DrawingML math", () => {
  const runs = officeMathRuns(`<a14:m><m:oMath>
    <m:sSub><m:e><m:r><a:rPr sz="7200" b="1" i="1"><a:solidFill><a:srgbClr val="7030A0"/></a:solidFill><a:latin typeface="Cambria Math"/></a:rPr><m:t>P</m:t></m:r></m:e>
    <m:sub><m:r><a:rPr sz="7200" i="1"><a:solidFill><a:srgbClr val="7030A0"/></a:solidFill></a:rPr><m:t>B</m:t></m:r></m:sub></m:sSub>
    <m:f><m:num><m:sSub><m:e><m:r><a:rPr sz="4000"><a:solidFill><a:srgbClr val="7030A0"/></a:solidFill></a:rPr><m:t>N</m:t></m:r></m:e>
      <m:sub><m:r><m:t>Bound</m:t></m:r></m:sub></m:sSub></m:num>
      <m:den><m:r><m:t>D</m:t></m:r></m:den></m:f>
    <m:acc><m:accPr><m:chr m:val="&#x0305;"/></m:accPr><m:e><m:r><m:t>v</m:t></m:r></m:e></m:acc>
    <m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><a:rPr sz="2000"/><m:t>2</m:t></m:r></m:sup></m:sSup>
  </m:oMath></a14:m>`);
  expect(runs.map((run) => run.text)).toEqual(["P", "B", "NBound/D", "v\u0305", "x", "2"]);
  expect(runs[0]).toMatchObject({
    bold: true,
    italic: true,
    fontSize: 72,
    color: "#7030A0",
    font: "SuiteLeaf Magnolia",
  });
  expect(runs[1]).toMatchObject({ fontSize: 46.8, baseline: -25, italic: true });
  expect(runs[5]).toMatchObject({ text: "2", fontSize: 13, baseline: 30 });
  expect(runs[2].fraction).toEqual({
    num: [{ text: "N" }, { text: "Bound", script: "sub" }],
    den: [{ text: "D" }],
  });
  const html = runsToHtml([runs[2]]);
  expect(html).toContain("<mfrac>");
  expect(html).toContain("<msub>");
  expect(html).toContain(">B</mi>");
  expect(html).toContain("data-slide-math");
});

it("keeps a grouped fraction and the exponent outside its parentheses", () => {
  const runs = officeMathRuns(`<m:oMath><m:sSup><m:e><m:d>
      <m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr>
      <m:e><m:f><m:num><m:sSup><m:e><m:r><m:t>s</m:t></m:r></m:e><m:sup><m:r><m:t>+</m:t></m:r></m:sup></m:sSup></m:num>
        <m:den><m:r><m:t>K</m:t></m:r></m:den></m:f></m:e>
    </m:d></m:e><m:sup><m:sSup><m:e><m:r><m:t>n</m:t></m:r></m:e><m:sup><m:r><m:t>+</m:t></m:r></m:sup></m:sSup></m:sup>
  </m:sSup></m:oMath>`);
  expect(runs.map((run) => run.text)).toEqual(["(", "s+/K", ")", "n", "+"]);
  expect(runs[1].fraction).toEqual({
    num: [{ text: "s" }, { text: "+", script: "sup" }],
    den: [{ text: "K" }],
  });
  expect(runs[3]).toMatchObject({ text: "n", baseline: 30 });
  expect(runs[4]).toMatchObject({ text: "+", baseline: 30 });
  const nested = officeMathRuns(`<m:oMath><m:d><m:dPr><m:ctrlPr/></m:dPr><m:e><m:d>
      <m:dPr><m:begChr m:val="〈"/><m:endChr m:val="〉"/></m:dPr>
      <m:e><m:r><m:t>a</m:t></m:r></m:e></m:d></m:e></m:d></m:oMath>`);
  expect(nested.map((run) => run.text)).toEqual(["(", "〈", "a", "〉", ")"]);
});

it("reads math inside oMathPara when a property tag shares the name", () => {
  const runs = officeMathRuns(
    `<a14:m><m:oMathPara><m:oMathParaPr><m:jc m:val="centerGroup"/></m:oMathParaPr><m:oMath><m:sSup><m:e><m:r><m:t>K</m:t></m:r></m:e><m:sup><m:r><m:t>+</m:t></m:r></m:sup></m:sSup></m:oMath></m:oMathPara></a14:m>`,
  );
  expect(runs.map((run) => run.text)).toEqual(["K", "+"]);
  expect(runs[1].baseline).toBe(30);
});

it("keeps a radical in front of the expression under it", () => {
  const runs = officeMathRuns(`<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>
    <m:e><m:r><m:t>ab</m:t></m:r></m:e></m:rad></m:oMath>`);
  expect(runs.map((run) => run.text)).toEqual(["√ab"]);
});

it("round trips native Office math until its runs are edited", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="eq"/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="800000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p>
        <a14:m><m:oMath><m:sSub><m:e><m:r><a:rPr sz="2000"/><m:t>P</m:t></m:r></m:e><m:sub><m:r><a:rPr sz="2000"/><m:t>B</m:t></m:r></m:sub></m:sSub></m:oMath></a14:m>
        <a:r><a:rPr sz="2000"/><a:t>=</a:t></a:r>
      </a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = file.content.slides[file.content.slideOrder[0]].elements.find((el) =>
    el.content?.includes("P"),
  );
  expect(box?.content).toBe("PB=");
  const exportedXml = async () => {
    const exported = await JSZip.loadAsync(await exportPptx(file));
    return exported.file("ppt/slides/slide1.xml")!.async("string");
  };
  expect(await exportedXml()).toContain("<m:sSub>");
  const equationRun = box!.runs!.find((run) => run.officeMath)!;
  equationRun.text = "Q";
  expect(await exportedXml()).not.toContain("<m:sSub>");
  equationRun.text = "P";
  expect(officeMathLatex(equationRun.officeMath!.xml)).toBe("{P}_{B}");
  expect(box?.runs?.map((run) => [run.text, run.baseline])).toEqual([
    ["P", undefined],
    ["B", -25],
    ["=", undefined],
  ]);
  box!.runs!.splice(box!.runs!.indexOf(equationRun), equationRun.officeMath!.count, {
    text: "\\frac{x^2}{\\sqrt{y}}",
    math: true,
    latex: "\\frac{x^2}{\\sqrt{y}}",
  });
  const editedXml = await exportedXml();
  expect(editedXml).toContain("<m:f>");
  expect(editedXml).toContain("<m:sSup>");
  expect(editedXml).toContain("<m:rad>");
  expect(editedXml).not.toContain("<m:sSub>");
});

it.each([['centerGroup', 'center'], ['center', 'center'], ['left', 'left'], ['right', 'right'], ['unknown', 'left']])("honors pure equation justification %s", async (value, align) => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="eq"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="800000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a14:m><m:oMathPara><m:oMathParaPr><m:jc m:val="${value}"/></m:oMathParaPr><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></m:oMathPara></a14:m></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const box = file.content.slides[file.content.slideOrder[0]].elements.find(el => el.content === "x");
  expect(box?.align).toBe(align);
});

it("paints the math table and not the plain fallback copy", async () => {
  const table = (label: string) =>
    `<p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="400000"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="2000000"/></a:tblGrid><a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1400"/><a:t>${label}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><mc:AlternateContent><mc:Choice Requires="a14">${table("Kept")}</mc:Choice><mc:Fallback>${table("Dropped")}</mc:Fallback></mc:AlternateContent></p:spTree></p:cSld></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const slide = file.content.slides[file.content.slideOrder[0]];
  const tables = slide.elements.filter((element) => element.type === "table");
  expect(tables).toHaveLength(1);
  expect(tables[0].rows?.[0]?.[0]).toBe("Kept");
});

it("keeps a fallback table when the choice is not one", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><mc:AlternateContent><mc:Choice Requires="p14"><p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:nvPr/></p:nvSpPr></p:sp></mc:Choice><mc:Fallback><p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="400000"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="2000000"/></a:tblGrid><a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1400"/><a:t>Older</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></mc:Fallback></mc:AlternateContent></p:spTree></p:cSld></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const slide = file.content.slides[file.content.slideOrder[0]];
  const tables = slide.elements.filter((element) => element.type === "table");
  expect(tables).toHaveLength(1);
  expect(tables[0].rows?.[0]?.[0]).toBe("Older");
});

it("stacks a limit under its operator", () => {
  const runs = officeMathRuns(`<m:oMath><m:limLow>
    <m:e><m:r><m:t>max</m:t></m:r></m:e>
    <m:lim><m:r><m:t>a</m:t></m:r></m:lim>
  </m:limLow></m:oMath>`);
  expect(runs).toHaveLength(1);
  expect(runs[0].text).toBe("maxa");
  expect(runs[0].fraction).toEqual({
    num: [{ text: "max" }],
    den: [{ text: "a" }],
    bar: false,
  });
  const html = runsToHtml(runs);
  expect(html).not.toContain("border-top");
  expect(html).not.toContain("inline-flex");
  expect(html).toContain("<munder>");
  expect(html).toContain("max");
  expect(html).toContain(">a</mi>");
});

it("paints a combining circumflex the math face does not draw", () => {
  const html = runsToHtml([{ text: "\u{1D445}\u0302", font: "SuiteLeaf Magnolia" }]);
  expect(html).toContain("\u02C6");
  expect(html).toContain("position:absolute");
});
