import JSZip from "jszip";
import type { Slide, SlideElement } from "./index";
import { officeFont } from "./office-fonts";
import { readingOrderMarker } from "./pptx-reading-order";
import { gradientFillXml } from "./pptx-shape-paint";
import { presentationSingleSpacing } from "./pptx-line-spacing";

type Cell = NonNullable<SlideElement["cellMarks"]>[number][number];
const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const emu = (pixels: number) => Math.round(pixels * 9525);
const pt = (points: number) => Math.round(points * 12700);
const rgb = (color: string) => color.replace(/^#/, "").toUpperCase();
function fill(color: string | undefined) {
  if (!color || color === "transparent") return "<a:noFill/>";
  return (
    gradientFillXml(color) ||
    `<a:solidFill><a:srgbClr val="${rgb(color)}"/></a:solidFill>`
  );
}

function textBody(text: string, cell: Cell, element: SlideElement): string {
  const font = cell.font || element.fontFamily || "Arial";
  const size = cell.fontSize || element.fontSize || 14;
  const color = cell.color || element.color || "#000000";
  const runs = cell.runs?.length ? cell.runs : [{ text }];
  const paragraphs: string[] = [];
  let current = "";
  let paragraph = runs[0];
  const flush = () => {
    const align = { left: "l", center: "ctr", right: "r", justify: "just" }[
      cell.align || "left"
    ];
    const pitch = paragraph?.paraLinePt
      ? `<a:lnSpc><a:spcPts val="${Math.round(paragraph.paraLinePt * 100)}"/></a:lnSpc>`
      : paragraph?.paraLine
        ? `<a:lnSpc><a:spcPct val="${Math.round((paragraph.paraLine / presentationSingleSpacing) * 100000)}"/></a:lnSpc>`
        : "";
    const before = paragraph?.spaceBefore
      ? `<a:spcBef><a:spcPts val="${Math.round(paragraph.spaceBefore * 75)}"/></a:spcBef>`
      : "";
    const margin = paragraph?.paraMargin || 0;
    const hang = paragraph?.paraHang || 0;
    const geometry = ` marL="${emu(margin + hang)}" indent="${emu(paragraph?.paraFirst ?? -hang)}"`;
    const tabs = paragraph?.paraTabs?.length
      ? `<a:tabLst>${paragraph.paraTabs.map((tab) => `<a:tab pos="${pt(tab.pos)}" algn="${tab.align}"/>`).join("")}</a:tabLst>`
      : "";
    const defaultTab = paragraph?.paraTab
      ? ` defTabSz="${pt(paragraph.paraTab)}"`
      : "";
    paragraphs.push(
      `<a:p><a:pPr algn="${align}"${geometry}${defaultTab}>${pitch}${before}${tabs}<a:defRPr sz="${Math.round(size * 100)}"/></a:pPr>${current}<a:endParaRPr lang="en-US" sz="${Math.round(size * 100)}"/></a:p>`,
    );
    current = "";
  };
  for (const run of runs) {
    if (run.paragraphBreak) {
      flush();
      paragraph = run;
      continue;
    }
    const pieces = run.text.split("\n");
    pieces.forEach((piece, index) => {
      if (index) flush();
      const attributes = `sz="${Math.round((run.fontSize || size) * 100)}" b="${(run.bold ?? cell.bold) ? 1 : 0}" i="${cell.italic ? 1 : 0}"${run.baseline != null ? ` baseline="${Math.round(run.baseline * 1000)}"` : ""}`;
      current += `<a:r><a:rPr ${attributes}>${fill(run.color || color)}<a:latin typeface="${escape(officeFont(run.font || font))}"/></a:rPr><a:t>${escape(piece)}</a:t></a:r>`;
    });
  }
  flush();
  return `<a:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.join("")}</a:txBody>`;
}

function properties(cell: Cell, element: SlideElement) {
  const attributes = [
    `marT="${pt(cell.padTop ?? 3.6)}"`,
    `marR="${pt(cell.padRight ?? 7.2)}"`,
    `marB="${pt(cell.padBottom ?? 3.6)}"`,
    `marL="${pt(cell.padLeft ?? 7.2)}"`,
    `anchor="${{ top: "t", middle: "ctr", bottom: "b" }[cell.valign || "top"]}"`,
    `vert="${{ up: "vert270", down: "vert", upright: "wordArtVert" }[cell.textFlow!] || "horz"}"`,
  ];
  const borders = (["Left", "Right", "Top", "Bottom"] as const)
    .map((side) => {
      const rule = cell[`border${side}`];
      const name = { Left: "L", Right: "R", Top: "T", Bottom: "B" }[side];
      const paint = rule?.color || cell.border;
      return `<a:ln${name} w="${pt(rule?.width ?? 1)}">${fill(paint)}<a:prstDash val="solid"/></a:ln${name}>`;
    })
    .join("");
  return `<a:tcPr ${attributes.join(" ")}>${borders}${fill(cell.fill || element.fill)}</a:tcPr>`;
}

/** Emit the model grid directly: table libraries grow rows and discard merged continuations. */
export function tableXml(element: SlideElement): string {
  const rows = element.rows || [];
  const columns =
    element.colWidths?.length ||
    Math.max(
      1,
      ...rows.map((row, r) =>
        row.reduce(
          (sum, _, c) => sum + (element.cellMarks?.[r]?.[c]?.colSpan || 1),
          0,
        ),
      ),
    );
  const widths = element.colWidths || Array(columns).fill(1 / columns);
  // DrawingML row sizes are minima. Re-exporting our measured row heights as
  // new minima would apply Office's wrapping/growth a second time.
  const original = element.officeRowHeights;
  const unchanged =
    original &&
    rows.length === original.minimums.length &&
    element.rowHeights?.length === original.layout.length &&
    element.rowHeights.every((value, i) => value === original.layout[i]);
  const heights = unchanged
    ? original.minimums
    : element.rowHeights || rows.map(() => 1 / rows.length);
  type Owner = {
    row: number;
    col: number;
    width: number;
    height: number;
    cell: Cell;
    text: string;
  };
  const grid: (Owner | undefined)[][] = rows.map(() => Array(columns));
  rows.forEach((row, r) => {
    let c = 0;
    row.forEach((text, index) => {
      while (c < columns && grid[r][c]) c++;
      if (c >= columns) return;
      const cell = element.cellMarks?.[r]?.[index] || {};
      const width = Math.min(cell.colSpan || 1, columns - c);
      const height = Math.min(cell.rowSpan || 1, rows.length - r);
      const owner = { row: r, col: c, width, height, cell, text };
      for (let y = r; y < r + height; y++)
        for (let x = c; x < c + width; x++) grid[y][x] = owner;
      c += width;
    });
  });
  const body = grid
    .map(
      (row, r) =>
        `<a:tr h="${emu(element.height * (heights[r] || 0))}">${row
          .map((value, c) => {
            const owner = value || {
              row: r,
              col: c,
              width: 1,
              height: 1,
              cell: {},
              text: "",
            };
            const first = owner.row === r && owner.col === c;
            const attrs = [
              owner.width > 1 && owner.col === c
                ? `gridSpan="${owner.width}"`
                : "",
              owner.height > 1 && owner.row === r
                ? `rowSpan="${owner.height}"`
                : "",
              owner.col < c ? 'hMerge="1"' : "",
              owner.row < r ? 'vMerge="1"' : "",
            ]
              .filter(Boolean)
              .join(" ");
            return `<a:tc${attrs ? " " + attrs : ""}>${textBody(first ? owner.text : "", first ? owner.cell : {}, element)}${properties(owner.cell, element)}</a:tc>`;
          })
          .join("")}</a:tr>`,
    )
    .join("");
  return `<a:tbl><a:tblPr rtl="${element.rtl ? 1 : 0}"/><a:tblGrid>${widths.map((width) => `<a:gridCol w="${emu(element.width * width)}"/>`).join("")}</a:tblGrid>${body}</a:tbl>`;
}

/** Replace a named placeholder with an editable, fixed-size DrawingML table. */
export async function stampTables(
  bytes: Uint8Array,
  slides: Slide[],
): Promise<Uint8Array> {
  if (
    !slides.some((slide) =>
      slide.elements.some((el) => el.type === "table" && el.rows?.length),
    )
  )
    return bytes;
  const zip = await JSZip.loadAsync(bytes);
  for (let i = 0; i < slides.length; i++) {
    const path = `ppt/slides/slide${i + 1}.xml`;
    const part = zip.file(path);
    if (!part) continue;
    zip.file(
      path,
      (await part.async("string")).replace(
        /<p:sp\b[\s\S]*?<\/p:sp>/g,
        (shape) => {
          const element = slides[i].elements.find(
            (el) =>
              el.type === "table" &&
              shape.includes(`name="${readingOrderMarker(el.id)}"`),
          );
          if (!element?.rows?.length) return shape;
          const nv =
            /<p:cNvPr\b[^>]*(?:\/>|>[\s\S]*?<\/p:cNvPr>)/.exec(shape)?.[0] ||
            "";
          return `<p:graphicFrame><p:nvGraphicFramePr>${nv}<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm${element.rotation ? ` rot="${Math.round(element.rotation * 60000)}"` : ""}><a:off x="${emu(element.x)}" y="${emu(element.y)}"/><a:ext cx="${emu(element.width)}" cy="${emu(element.height)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">${tableXml(element)}</a:graphicData></a:graphic></p:graphicFrame>`;
        },
      ),
    );
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
