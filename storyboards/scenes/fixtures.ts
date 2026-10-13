// Starting files for storyboards, shared by the original recordings and
// their AI versions so both begin from exactly the same documents.
import type { Page } from "@playwright/test";
import JSZip from "jszip";
import { crc32, deflateSync } from "node:zlib";
import { createFile, serializeFile } from "../../packages/core/src";
import { beat } from "./harness";

type Value = string | number;
type Native = any;

/** A small landscape picture (sky, sun, and garden rows) as a PNG. */
export function gardenPicture(width = 360, height = 200) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      let rgb = [135, 196, 235];
      if ((x - 290) ** 2 + (y - 45) ** 2 < 24 ** 2) rgb = [252, 202, 70];
      if (y > 120 + Math.sin(x / 40) * 8) rgb = [86, 150, 70];
      if (y > 140 && (y - 140) % 18 < 6) rgb = [120, 84, 52];
      raw.set(rgb, y * (width * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}


/** Waits for the spreadsheet editor to finish starting. */
export async function ready(page: Page) {
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await beat(page, 700);
}

/** Opens a workbook the person already keeps, through Open / import. */
export async function openWorkbook(page: Page, title: string, rows: Value[][], widths: number[] = []) {
  const file = createFile("sheet", title);
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.cellData = Object.fromEntries(
    rows.map((row, r) => [
      r,
      Object.fromEntries(
        row.flatMap((v, c) =>
          v === "" ? [] : [[c, typeof v === "number" ? { v, t: 2 } : { v, t: 1 }]],
        ),
      ),
    ]),
  );
  if (widths.length)
    (sheet as Native).columnData = Object.fromEntries(widths.map((w, i) => [i, { w }]));
  await page.locator("input[type=file]").setInputFiles({
    name: `${title}.slsheet`,
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await ready(page);
}


const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const sheetNs =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A small Excel workbook like an accountant might send: styled header, currency, formulas, a frozen row, and a summary tab. */
export async function bakeryWorkbook() {
  const z = new JSZip();
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const type = "application/vnd.openxmlformats-officedocument.spreadsheetml";
  z.file(
    "[Content_Types].xml",
    `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${type}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${type}.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="${type}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${type}.styles+xml"/></Types>`,
  );
  z.file(
    "_rels/.rels",
    `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  z.file(
    "xl/workbook.xml",
    `${xml}<workbook ${sheetNs}><sheets><sheet name="Q3 sales" sheetId="1" r:id="rId1"/><sheet name="Summary" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  );
  z.file(
    "xl/_rels/workbook.xml.rels",
    `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
  );
  z.file(
    "xl/styles.xml",
    `${xml}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFCE4D6"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs></styleSheet>`,
  );
  const items: [string, number, number][] = [
    ["Sourdough loaf", 412, 7.5],
    ["Croissant", 958, 3.25],
    ["Cinnamon roll", 377, 4],
    ["Baguette", 645, 3.75],
  ];
  const text = (ref: string, value: string, style = 0) =>
    `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t>${value}</t></is></c>`;
  const units = items.reduce((t, [, u]) => t + u, 0);
  const revenue = items.reduce((t, [, u, p]) => t + u * p, 0);
  const rows =
    `<row r="1">${["Product", "Units sold", "Unit price", "Revenue"].map((h, i) => text(`${"ABCD"[i]}1`, h, 1)).join("")}</row>` +
    items
      .map(
        ([name, u, p], i) =>
          `<row r="${i + 2}">${text(`A${i + 2}`, name)}<c r="B${i + 2}"><v>${u}</v></c><c r="C${i + 2}" s="2"><v>${p}</v></c><c r="D${i + 2}" s="2"><f>B${i + 2}*C${i + 2}</f><v>${u * p}</v></c></row>`,
      )
      .join("") +
    `<row r="6">${text("A6", "Total", 1)}<c r="B6" s="1"><f>SUM(B2:B5)</f><v>${units}</v></c><c r="C6" s="1"/><c r="D6" s="3"><f>SUM(D2:D5)</f><v>${revenue}</v></c></row>`;
  z.file(
    "xl/worksheets/sheet1.xml",
    `${xml}<worksheet ${sheetNs}><dimension ref="A1:D6"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="4" width="14" customWidth="1"/></cols><sheetData>${rows}</sheetData></worksheet>`,
  );
  z.file(
    "xl/worksheets/sheet2.xml",
    `${xml}<worksheet ${sheetNs}><dimension ref="A1:B2"/><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/></cols><sheetData><row r="1">${text("A1", "Q3 revenue", 1)}<c r="B1" s="3"><f>'Q3 sales'!D6</f><v>${revenue}</v></c></row><row r="2">${text("A2", "Average per product")}<c r="B2" s="2"><f>AVERAGE('Q3 sales'!D2:D5)</f><v>${revenue / 4}</v></c></row></sheetData></worksheet>`,
  );
  return z.generateAsync({ type: "uint8array" });
}


/** A small finished deck, as a downloaded SuiteLeaf presentation file. */
export function gardenDeck() {
  const now = new Date().toISOString();
  const text = (content: string, y: number, extra: object = {}) => ({
    id: crypto.randomUUID(),
    type: "text",
    x: 80,
    y,
    width: 800,
    height: 70,
    content,
    fontSize: 34,
    bold: true,
    color: "#0f172a",
    ...extra,
  });
  const body = (content: string) =>
    text(content, 150, {
      height: 320,
      fontSize: 22,
      bold: false,
      color: "#334155",
    });
  const slides = [
    {
      title: "Spring Garden Kickoff",
      layout: "title",
      background: { color: "#e2ece9" },
      elements: [
        text("Spring Garden Kickoff", 170, { fontSize: 44, align: "center" }),
        text("Community Garden · Saturday 10 am", 280, {
          fontSize: 22,
          bold: false,
          align: "center",
          color: "#475569",
        }),
      ],
    },
    {
      title: "This season's plan",
      layout: "title-body",
      elements: [
        text("This season's plan", 50),
        body("• Tomatoes and basil in the sunny beds\n• New compost bins by the shed\n• Watering rota on the noticeboard"),
      ],
    },
    {
      title: "How you can help",
      layout: "title-body",
      elements: [
        text("How you can help", 50),
        body("• Saturday work parties, 9–11 am\n• Seedling swap in May\n• Sign up at the shed door"),
      ],
    },
    {
      title: "Questions?",
      layout: "section",
      background: { color: "#1e293b" },
      elements: [
        text("Questions?", 200, {
          height: 120,
          fontSize: 46,
          align: "center",
          color: "#f8fafc",
        }),
      ],
    },
  ].map((s) => ({ id: crypto.randomUUID(), notes: "", ...s }));
  const id = crypto.randomUUID();
  return JSON.stringify({
    format: "suiteleaf",
    version: 1,
    id,
    title: "Spring Garden Kickoff",
    createdAt: now,
    updatedAt: now,
    kind: "slide",
    content: {
      id,
      width: 960,
      height: 540,
      slideOrder: slides.map((s) => s.id),
      slides: Object.fromEntries(slides.map((s) => [s.id, s])),
    },
  });
}

