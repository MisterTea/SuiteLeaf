import JSZip from "jszip";
import { expect, it } from "vitest";
import { createFile, type SlideFile } from "../packages/core/src";
import { exportPptx } from "../packages/core/src/pptx-export";
import {
  exportParagraphs,
  stampTextParagraphs,
} from "../packages/core/src/pptx-text-paragraphs";

it("keeps all/small caps as editable run features across soft breaks", async () => {
  const file = createFile("slide", "Caps") as SlideFile;
  file.content.slides[file.content.slideOrder[0]].elements = [{
    id: "caps", type: "text", x: 0, y: 0, width: 400, height: 200,
    runs: [{ text: "Mixed\ncase", caps: "all" }, { text: " plain" }, { text: " small", caps: "small" }],
  }];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml.match(/cap="all"/g)).toHaveLength(2);
  expect(xml.match(/cap="small"/g)).toHaveLength(1);
  expect(xml).toContain("<a:t>Mixed</a:t>");
  expect(xml).toContain("<a:t>case</a:t>");
  const plain = xml.match(/<a:r><a:rPr[^>]*>[\s\S]*?<a:t> plain<\/a:t><\/a:r>/)?.[0];
  expect(plain).toBeDefined();
});

it("exports authored point font sizes and keeps text box geometry", async () => {
  const file = createFile("slide", "Units") as SlideFile;
  file.content.slides[file.content.slideOrder[0]].elements = [
    {
      id: "text",
      type: "text",
      x: 96,
      y: 48,
      width: 400,
      height: 100,
      fontSize: 32,
      content: "Title",
      inset: 8,
      padLeft: 12,
      padRight: 20,
      padBottom: 16,
      valign: "middle",
    },
  ];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('sz="3200"');
  expect(xml).toContain('x="914400" y="457200"');
  expect(xml).toContain('lIns="114300"');
  expect(xml).toContain('rIns="190500"');
  expect(xml).toContain('tIns="76200"');
  expect(xml).toContain('bIns="152400"');
  expect(xml).toContain('anchor="ctr"');
});

it("keeps per-paragraph alignment, exact pitch, percentage spacing, and folded leading gaps", async () => {
  const file = createFile("slide", "Paragraphs") as SlideFile;
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    {
      id: "paragraphs",
      type: "text",
      x: 0,
      y: 0,
      width: 400,
      height: 200,
      lineHeight: 1.2,
      align: "left",
      runs: [
        { text: "First" },
        {
          text: "\n",
          paragraphBreak: true,
          paraLinePt: 24,
          spaceBefore: 8,
          paraAlign: "right",
        },
        { text: "Second" },
        {
          text: "\n",
          paragraphBreak: true,
          paraLine: 1.8,
          paraDistributed: true,
        },
        { text: "Third" },
      ],
    },
  ];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('<a:spcPct val="100000"/>');
  expect(xml).toContain('<a:lnSpc><a:spcPts val="2400"/>');
  expect(xml).toContain('<a:spcBef><a:spcPts val="600"/>');
  expect(xml).toContain('algn="r"');
  expect(xml).toContain('<a:spcPct val="150000"/>');
  expect(xml).toContain('algn="dist"');
  expect(xml.match(/<a:pPr/g)).toHaveLength(3);
});

it("leaves unmatched shapes untouched and handles missing slides and unstyled paragraphs", async () => {
  const file = createFile("slide", "Fallback") as SlideFile;
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    {
      id: "plain",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      content: "Fallback",
    },
  ];
  expect(exportParagraphs(slide.elements[0])).toEqual([[{ text: "Fallback" }]]);
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld><p:sp><p:cNvPr name="plain"/><p:txBody><a:p><a:r/></a:p><a:p><a:r/></a:p></p:txBody></p:sp><p:sp><p:cNvPr name="unknown"/></p:sp></p:sld>',
  );
  const bytes = await stampTextParagraphs(
    await zip.generateAsync({ type: "uint8array" }),
    [slide, slide],
  );
  const xml = await JSZip.loadAsync(bytes).then((z) =>
    z.file("ppt/slides/slide1.xml")!.async("string"),
  );
  expect(xml.match(/<a:pPr/g)).toHaveLength(2);
  expect(xml).toContain('<p:cNvPr name="unknown"/>');
});

it("writes native hanging bullets, nested margins, highlight, and hyperlinks without duplicating marker text", async () => {
  const file = createFile("slide", "Bullets") as SlideFile;
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    {
      id: "list",
      type: "text",
      x: 0,
      y: 0,
      width: 400,
      height: 200,
      bullet: true,
      sourceShapeId: "4",
      runs: [
        {
          text: "• ",
          font: "Arial",
          fontSize: 16,
          color: "#112233",
          paraMargin: 20,
          paraHang: 10,
          paraFirst: 2,
          paraTab: 72,
          paraTabs: [{ pos: 36, align: "l" }],
        },
        {
          text: "Linked",
          highlight: "#cccccc",
          href: "https://example.org",
          tracking: 1,
          strike: true,
        },
      ],
    },
  ];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('marL="285750" indent="19050"');
  expect(xml).toContain('<a:buChar char="•"/>');
  expect(xml).toContain('<a:buFont typeface="Arial"/>');
  expect(xml).toContain('<a:buSzPts val="1600"/>');
  expect(xml).toContain('defTabSz="914400"');
  expect(xml).toContain('<a:tab pos="457200" algn="l"/>');
  expect(xml).not.toContain("<a:t>• </a:t>");
  expect(xml).toContain('<a:highlight><a:srgbClr val="CCCCCC"/></a:highlight>');
  expect(xml).toContain("<a:hlinkClick");
  expect(
    await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string"),
  ).toContain('Target="https://example.org"');
  slide.elements[0].runs = undefined;
  slide.elements[0].content = "Authored bullet";
  const authored = await JSZip.loadAsync(await exportPptx(file));
  expect(
    await authored.file("ppt/slides/slide1.xml")!.async("string"),
  ).toContain('<a:buChar char="•"/>');
});

it("keeps soft line breaks inside their paragraph and emits only one list marker", async () => {
  const file = createFile("slide", "Soft lines") as SlideFile;
  file.content.slides[file.content.slideOrder[0]].elements = [
    {
      id: "soft",
      type: "text",
      x: 0,
      y: 0,
      width: 400,
      height: 200,
      bullet: true,
      runs: [
        { text: "• " },
        { text: "First line" },
        { text: "\n", fontSize: 24 },
        { text: "Continuation\nMore" },
        { text: "\n", paragraphBreak: true, spaceBefore: 10 },
        { text: "• " },
        { text: "Next paragraph" },
      ],
    },
  ];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml.match(/<a:p>/g)).toHaveLength(2);
  expect(xml.match(/<a:br>/g)).toHaveLength(2);
  expect(xml).toContain('<a:br><a:rPr sz="2400">');
  expect(xml.match(/<a:buChar char="•"\/>/g)).toHaveLength(2);
  expect(xml).toContain('<a:spcBef><a:spcPts val="750"/>');
});

it("exports symbol-font list codes as native bullets without a text advance", async () => {
  const file = createFile("slide", "Symbol bullet") as SlideFile;
  file.content.slides[file.content.slideOrder[0]].elements = [
    {
      id: "symbols",
      type: "text",
      x: 0,
      y: 0,
      width: 400,
      height: 200,
      bullet: true,
      fontSize: 24,
      fontFamily: "PT Sans",
      runs: [
        { text: "§ ", font: "SuiteLeaf Sprig" },
        { text: "Nested", fontSize: 20 },
      ],
    },
  ];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('<a:buFont typeface="Wingdings"/>');
  expect(xml).toContain('<a:buChar char="§"/>');
  expect(xml).not.toContain("<a:t>§ </a:t>");
  expect(xml).not.toContain("<a:t></a:t>");
});

it("retains text-body edge spacing so first paragraph gaps are applied", async () => {
  const file = createFile("slide", "Edge spacing") as SlideFile;
  file.content.slides[file.content.slideOrder[0]].elements = [
    {
      id: "edge",
      type: "text",
      x: 0,
      y: 0,
      width: 400,
      height: 200,
      paragraphEdgeSpacing: true,
      runs: [{ text: "First", spaceBefore: 24 }],
    },
  ];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('spcFirstLastPara="1"');
  expect(xml).toContain('<a:spcBef><a:spcPts val="1800"/></a:spcBef>');
  const { parsePowerPoint } = await import("../packages/core/src/pptx");
  const imported = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const element = imported.content.slides[imported.content.slideOrder[0]].elements
    .find(item => item.type === "text" && item.content === "First");
  expect(element?.paragraphEdgeSpacing).toBe(true);
  const roundtrip = await JSZip.loadAsync(await exportPptx(imported));
  expect(await roundtrip.file("ppt/slides/slide1.xml")!.async("string"))
    .toContain('<a:spcBef><a:spcPts val="1800"/></a:spcBef>');
});

it("preserves authored superscript and subscript baselines with their point sizes", async () => {
  const file = createFile("slide", "Script") as SlideFile;
  file.content.slides[file.content.slideOrder[0]].elements = [
    {
      id: "script",
      type: "text",
      x: 0,
      y: 0,
      width: 400,
      height: 200,
      runs: [
        { text: "Body" },
        { text: "2", fontSize: 10.67, baseline: 30 },
        { text: "n", fontSize: 12, baseline: -25 },
      ],
    },
  ];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toMatch(/<a:rPr[^>]*sz="1067"[^>]*baseline="30000"/);
  expect(xml).toMatch(/<a:rPr[^>]*sz="1200"[^>]*baseline="-25000"/);
});
