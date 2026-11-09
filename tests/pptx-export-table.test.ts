import { expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, type SlideFile } from "../packages/core/src";
import { exportPptx } from "../packages/core/src/pptx-export";
import { tableXml, stampTables } from "../packages/core/src/pptx-export-table";
import { officeGradientFill } from "../packages/core/src/pptx-fill-preservation";
import {
  gradientFillXml,
  stampShapePaint,
} from "../packages/core/src/pptx-shape-paint";
import { layoutListRuns } from "../packages/core/src/pptx-lists";
import { tableCellRuns } from "../packages/core/src/pptx-table";

it("keeps fixed table grids, native merges, cell paint and mixed font runs editable", async () => {
  const file = createFile("slide", "Table") as SlideFile;
  const table = {
    id: "grid",
    type: "table" as const,
    x: 96,
    y: 48,
    width: 400,
    height: 100,
    rows: [["Heading"], ["Left", "Right"]],
    colWidths: [0.25, 0.75],
    rowHeights: [0.3, 0.7],
    cellMarks: [
      [
        {
          colSpan: 2,
          bold: true,
          fill: "#ff0000",
          runs: [
            { text: "Plain ", bold: false },
            { text: "bold", bold: true },
          ],
        },
      ],
      [
        {
          fill: "#ffffff",
          border: "#123456",
          align: "right" as const,
          padLeft: 0,
          textFlow: "up" as const,
          rowSpan: 1,
        },
        {
          italic: true,
          align: "center" as const,
          valign: "middle" as const,
          borderTop: { color: "#abcdef", width: 2 },
          runs: [
            {
              text: "Small",
              font: "Arial",
              fontSize: 10,
              color: "#0000ff",
              baseline: 20,
            },
            { text: "\nnext" },
            { text: "", paragraphBreak: true },
            { text: "Last" },
          ],
        },
      ],
    ],
  };
  file.content.slides[file.content.slideOrder[0]].elements = [table];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('<a:gridCol w="952500"/>');
  expect(xml).toContain('<a:tr h="285750">');
  expect(xml).toContain('gridSpan="2"');
  expect(xml).toContain('hMerge="1"');
  expect(xml).toContain('vert="vert270"');
  expect(xml).toContain('marL="0"');
  expect(xml).toContain('<a:lnT w="25400">');
  expect(xml).toContain('val="ABCDEF"');
  expect(xml).toContain('sz="1400" b="0"');
  expect(xml).toContain('sz="1400" b="1"');
  expect(xml).toContain('baseline="20000"');
  expect(xml).toContain('anchor="ctr"');
  expect(xml).not.toContain("autoFit");
});

it("serializes row-spanning continuation cells without stealing later cells", () => {
  const xml = tableXml({
    id: "merge",
    type: "table",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    rows: [["Merged", "A"], ["B"], []],
    colWidths: [0.4, 0.6],
    cellMarks: [[{ rowSpan: 2 }, {}], [{}]],
    rtl: true,
  });
  expect(xml).toContain('rowSpan="2"');
  expect(xml).toContain('vMerge="1"');
  expect(xml).toContain('<a:tblPr rtl="1"/>');
  expect(xml).toContain(">B</a:t>");
  expect(
    tableXml({ id: "empty", type: "table", x: 0, y: 0, width: 1, height: 1 }),
  ).toContain("<a:tblGrid>");
});

it("round trips mixed table paragraph pitches and leading gaps", () => {
  const runs = tableCellRuns([
    {
      text: "First",
      lineHeight: 1.07,
      runs: [{ text: "First", font: "Arial" }],
    },
    {
      text: "Second",
      lineHeightPt: 18,
      spaceBefore: 8,
      listMargin: 36,
      hang: 12,
      tabInterval: 72,
      tabs: [{ pos: 36, align: "r" }],
      runs: [{ text: "Second" }],
    },
  ]);
  const xml = tableXml({
    id: "pitch",
    type: "table",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    rows: [["First\nSecond"]],
    cellMarks: [[{ runs }]],
  });
  expect(xml).toContain('<a:spcPct val="107000"/>');
  expect(xml).toContain('<a:spcPts val="1800"/>');
  expect(xml).toContain('<a:spcBef><a:spcPts val="600"/>');
  expect(xml).toContain('marL="457200" indent="-114300"');
  expect(xml).toContain('defTabSz="914400"');
  expect(xml).toContain('<a:tab pos="457200" algn="r"/>');
});

it("handles sparse tables and missing slide parts without changing unrelated drawings", async () => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", '<p:sp><p:cNvPr name="Other"/></p:sp>');
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const element = {
    id: "table",
    type: "table" as const,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rows: [["Cell"]],
    rotation: 30,
  };
  const result = await stampTables(bytes, [
    { id: "a", elements: [element] },
    { id: "b", elements: [element] },
  ]);
  expect(
    await (
      await JSZip.loadAsync(result)
    )
      .file("ppt/slides/slide1.xml")!
      .async("string"),
  ).toContain("Other");
  expect(await stampTables(bytes, [])).toBe(bytes);
  expect(
    tableXml({ ...element, rows: [["A", "overflow"]], colWidths: [1] }),
  ).not.toContain("overflow");
});

it("retains native gradient transforms and releases them after editing the fill", async () => {
  const theme =
    '<a:clrScheme><a:accent1><a:srgbClr val="123456"/></a:accent1></a:clrScheme><a:fillStyleLst><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="accent1"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill></a:fillStyleLst>';
  const shape =
    '<p:sp><p:spPr/><p:style><a:fillRef idx="1"><a:srgbClr val="E73037"/></a:fillRef></p:style></p:sp>';
  const css = "linear-gradient(180deg, #ffffff 0%, #000000 100%)";
  const native = officeGradientFill(theme, shape, css)!;
  expect(native.xml).toContain('<a:srgbClr val="E73037"><a:tint val="50000"/>');
  expect(native.xml).toContain('<a:srgbClr val="123456">');
  expect(native.xml).not.toContain("schemeClr");
  expect(officeGradientFill(undefined, shape, undefined)).toBeUndefined();
  expect(officeGradientFill(undefined, shape, css)).toBeUndefined();
  expect(
    officeGradientFill(
      "",
      "<p:spPr><a:gradFill><a:gsLst/></a:gradFill></p:spPr>",
      css,
    )?.xml,
  ).toContain("gsLst");
  const file = createFile("slide", "Gradient") as SlideFile;
  const el = {
    id: "gradient",
    type: "shape" as const,
    shapeType: "rect" as const,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    fill: css,
    officeFill: native,
  };
  file.content.slides[file.content.slideOrder[0]].elements = [el];
  let zip = await JSZip.loadAsync(await exportPptx(file));
  expect(await zip.file("ppt/slides/slide1.xml")!.async("string")).toContain(
    '<a:tint val="50000"/>',
  );
  el.fill = "linear-gradient(0deg, #ff0000 0%, #00ff00 100%)";
  zip = await JSZip.loadAsync(await exportPptx(file));
  expect(
    await zip.file("ppt/slides/slide1.xml")!.async("string"),
  ).not.toContain("<a:tint");
  expect(gradientFillXml("#ff0000")).toBeUndefined();
  expect(gradientFillXml("linear-gradient(90deg, #ff0000 0%)")).toBeUndefined();
  expect(
    gradientFillXml(
      "linear-gradient(-90deg, rgba(255, 0, 0, 0.5) 0%, rgb(0, 255, 0) 100%)",
    ),
  ).toContain('<a:alpha val="50000"/>');
  expect(await stampShapePaint(new Uint8Array(), [])).toEqual(new Uint8Array());
});

it("represents one leading blank paragraph with one separator and keeps its metrics", async () => {
  const laid = layoutListRuns([
    { text: "", size: 12, runs: [] },
    { text: "Body", runs: [{ text: "Body", fontSize: 18 }] },
  ]);
  expect(laid.runs.filter((r) => r.paragraphBreak)).toHaveLength(1);
  const file = createFile("slide", "Blank") as SlideFile;
  file.content.slides[file.content.slideOrder[0]].elements = [
    {
      id: "blank",
      type: "text",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      fontSize: 24,
      runs: laid.runs,
    },
  ];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml.match(/<a:p>/g) || []).toHaveLength(2);
  expect(xml).toMatch(/<a:endParaRPr[^>]*sz="1200"/);
});

it("keeps an explicitly populated unpositioned page field at the Office origin", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:fld type="slidenum"><a:rPr sz="1800"/><a:t>1</a:t></a:fld></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  );
  const { parsePowerPoint } = await import("../packages/core/src/pptx");
  const file = await parsePowerPoint(
    await zip.generateAsync({ type: "uint8array" }),
  );
  const field = file.content.slides[file.content.slideOrder[0]].elements.find(
    (el) => el.content === "1",
  )!;
  expect(field.x).toBe(0);
  expect(field.y).toBe(0);
  expect(field.inset).toBe(0);
  expect(field.padLeft).toBe(0);
});

it("exports editable signed source picture crop percentages without changing the picture frame", async () => {
  const file = createFile("slide", "Crops") as SlideFile;
  file.content.slides[file.content.slideOrder[0]].elements = [
    {
      id: "crop",
      type: "image",
      x: 20,
      y: 30,
      width: 200,
      height: 100,
      cropLeft: 4,
      cropTop: -8.5,
      cropRight: 12.25,
      cropBottom: 19.467,
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
    },
  ];
  const zip = await JSZip.loadAsync(await exportPptx(file));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain('<a:srcRect l="4000" t="-8500" r="12250" b="19467"/>');
  expect(xml).toContain('<a:off x="190500" y="285750"/>');
  expect(xml).toContain('<a:ext cx="1905000" cy="952500"/>');
  const { stampPictureCrops } =
    await import("../packages/core/src/pptx-picture-crops");
  expect(await stampPictureCrops(new Uint8Array(), [])).toEqual(
    new Uint8Array(),
  );
  const sparse = new JSZip();
  sparse.file(
    "ppt/slides/slide1.xml",
    '<p:pic><p:cNvPr name="Other"/></p:pic>',
  );
  const result = await stampPictureCrops(
    await sparse.generateAsync({ type: "uint8array" }),
    [
      file.content.slides[file.content.slideOrder[0]],
      file.content.slides[file.content.slideOrder[0]],
    ],
  );
  expect(
    await (
      await JSZip.loadAsync(result)
    )
      .file("ppt/slides/slide1.xml")!
      .async("string"),
  ).toContain("Other");
});

it("preserves authored row minima without applying measured text growth twice, and releases them on resize", () => {
  const element = {
    id: "minima",
    type: "table" as const,
    x: 0,
    y: 0,
    width: 300,
    height: 100,
    rows: [["Wrapped header"], ["Auto-sized row"]],
    rowHeights: [0.6, 0.4],
    officeRowHeights: { minimums: [0.3, 0], layout: [0.6, 0.4] },
  };
  expect(tableXml(element)).toContain('<a:tr h="285750">');
  expect(tableXml(element)).toContain('<a:tr h="0">');
  element.rowHeights = [0.5, 0.5];
  expect(tableXml(element).match(/<a:tr h="476250">/g)).toHaveLength(2);
});

it("inherits table-style bold for unspecified run weight while preserving explicit regular runs", () => {
  const xml = tableXml({
    id: "weights",
    type: "table",
    x: 0,
    y: 0,
    width: 300,
    height: 100,
    rows: [["Header regular"]],
    cellMarks: [
      [
        {
          bold: true,
          runs: [{ text: "Header" }, { text: " regular", bold: false }],
        },
      ],
    ],
  });
  expect(xml).toMatch(/b="1"[^>]*>[\s\S]*?>Header<\/a:t>/);
  expect(xml).toMatch(/b="0"[^>]*>[\s\S]*?> regular<\/a:t>/);
});
