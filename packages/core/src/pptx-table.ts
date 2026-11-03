import { officeSingleSpacing } from "./office-fonts";
import { mediumStyle2, mediumTableStyle } from "./pptx-table-styles";

/** A run kept when one cell mixes a symbol font, a subscript, or more than one colour. */
export type TableCellRun = {
  text: string;
  color?: string;
  font?: string;
  fontSize?: number;
  baseline?: number;
  bold?: boolean;
  paragraphBreak?: boolean;
  paraMargin?: number;
  paraHang?: number;
  paraFirst?: number;
  paraTab?: number;
  paraTabs?: { pos: number; align: "l" | "ctr" | "r" | "dec" }[];
  /** Stacked Office math. `text` stays the linear reading. */
  fraction?: {
    num: { text: string; script?: "sub" | "sup" }[];
    den: { text: string; script?: "sub" | "sup" }[];
  };
};

/** One edge of a cell. Width is in points; PowerPoint's hairline is 1. */
export type TableRule = { color: string; width?: number };

/** Cell formatting imported from a DrawingML table, aligned with `rows`. */
export type TableCellStyle = {
  bold?: boolean;
  italic?: boolean;
  fill?: string;
  color?: string;
  /** Latin face for the cell. The table's theme font is wider when the cell names another. */
  font?: string;
  fontSize?: number;
  align?: "left" | "center" | "right" | "justify";
  colSpan?: number;
  /** DrawingML rowSpan. Continuation rows omit the covered cells. */
  rowSpan?: number;
  /** Interior border colour from the table style, painted on every side. */
  border?: string;
  borderTop?: TableRule;
  borderRight?: TableRule;
  borderBottom?: TableRule;
  borderLeft?: TableRule;
  /** Cell margins in points. PowerPoint's row height assumes these, not the editor's padding. */
  padTop?: number;
  padRight?: number;
  padBottom?: number;
  padLeft?: number;
  valign?: "top" | "middle" | "bottom";
  /** Paragraph left edge, hanging indent, and first-line indent, in slide pixels. */
  lines?: {
    margin?: number;
    hang?: number;
    first?: number;
    tabs?: { pos: number; align: "l" | "ctr" | "r" | "dec" }[];
  }[];
  /** Default tab interval, in points. */
  tabSize?: number;
  /** Per-run face, colour, and baseline when the cell is not one style. */
  runs?: TableCellRun[];
};

export type BuiltTableCell = TableCellStyle & {
  boldSet?: boolean;
  /** `tcPr` `a:noFill` hides the table-style fill. */
  noFill?: boolean;
  /** An explicit `a:noFill` line hides that table-style edge. */
  clearTop?: boolean;
  clearRight?: boolean;
  clearBottom?: boolean;
  clearLeft?: boolean;
};

type Paint = (xml: string) => string | undefined;

type StylePart = { fill?: string; color?: string; bold?: boolean };

export type TableStyleFlags = {
  firstRow: boolean;
  lastRow: boolean;
  firstCol: boolean;
  lastCol: boolean;
  bandRow: boolean;
  bandCol: boolean;
};

const emptyFlags: TableStyleFlags = {
  firstRow: false,
  lastRow: false,
  firstCol: false,
  lastCol: false,
  bandRow: false,
  bandCol: false,
};

function attrsOf(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z0-9]+)="([^"]*)"/g))
    attrs[match[1]] = match[2];
  return attrs;
}

function on(tag: string, name: string) {
  const value = attrsOf(tag)[name];
  return value === "1" || value === "true";
}

/** A merged continuation cell is owned by the cell above or to the left. */
export function tableCellContinues(cellXml: string): boolean {
  return /\b(?:hMerge|vMerge)="1"/.test(cellXml);
}

function tableRows(tblXml: string) {
  return [...tblXml.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map((match) =>
    [...match[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((cell) => {
      const xml = cell[0];
      const open = /^<a:tc\b[^>]*>/.exec(xml)?.[0] ?? xml;
      return {
        hMerge: /\bhMerge="1"/.test(xml),
        vMerge: /\bvMerge="1"/.test(xml),
        gridSpan: Math.max(1, Number(/\bgridSpan="(\d+)"/.exec(open)?.[1] ?? 1)),
        rowSpanAttr: Number(/\browSpan="(\d+)"/.exec(open)?.[1] ?? 0),
      };
    }),
  );
}

function cellAtColumn(
  row: ReturnType<typeof tableRows>[number],
  column: number,
) {
  let col = 0;
  for (const cell of row) {
    if (column >= col && column < col + cell.gridSpan) return cell;
    col += cell.gridSpan;
  }
}

/**
 * Row span of each anchor cell, in reading order.
 * Continuation cells (`hMerge` / `vMerge`) are omitted, matching the imported grid.
 * An explicit `rowSpan` wins. Otherwise the following `vMerge` cells are counted.
 */
export function anchorRowSpans(tblXml: string): number[] {
  const rows = tableRows(tblXml);
  const spans: number[] = [];
  rows.forEach((row, r) => {
    let col = 0;
    for (const cell of row) {
      if (!cell.hMerge && !cell.vMerge) {
        let span = cell.rowSpanAttr > 1 ? cell.rowSpanAttr : 1;
        if (!(cell.rowSpanAttr > 1)) {
          for (let look = r + 1; look < rows.length; look++) {
            const below = cellAtColumn(rows[look], col);
            if (!below?.vMerge) break;
            span += 1;
          }
        }
        spans.push(span);
      }
      col += cell.gridSpan;
    }
  });
  return spans;
}

/** Colour written on a run, not the inherited paragraph default. */
export function explicitRunColor(cellXml: string, paint: Paint): string | undefined {
  const body = /<a:txBody\b[\s\S]*?<\/a:txBody>/.exec(cellXml)?.[0] ?? "";
  for (const run of body.matchAll(/<a:rPr\b[^>]*>([\s\S]*?)<\/a:rPr>/g)) {
    const color = paint(run[1]);
    if (color && color !== "transparent") return color;
  }
}

/**
 * Runs for a cell that mixes faces, baselines, or colours.
 * A uniform cell keeps the single mark colour and the joined string.
 */
export function tableCellRuns(
  paragraphs: {
    text?: string;
    runs?: TableCellRun[];
    listMargin?: number;
    hang?: number;
    firstIndent?: number;
    tabInterval?: number;
    tabs?: { pos: number; align: "l" | "ctr" | "r" | "dec" }[];
  }[],
): TableCellRun[] | undefined {
  const geom = (paragraph: (typeof paragraphs)[number]): Partial<TableCellRun> => ({
    ...(paragraph.listMargin ? { paraMargin: paragraph.listMargin } : {}),
    ...(paragraph.hang ? { paraHang: paragraph.hang } : {}),
    ...(paragraph.firstIndent ? { paraFirst: paragraph.firstIndent } : {}),
    ...(paragraph.tabInterval ? { paraTab: paragraph.tabInterval } : {}),
    ...(paragraph.tabs?.length ? { paraTabs: paragraph.tabs } : {}),
  });
  const runs: TableCellRun[] = [];
  paragraphs.forEach((paragraph, index) => {
    if (index) runs.push({ text: "\n", paragraphBreak: true, ...geom(paragraph) });
    paragraph.runs?.forEach((run, runIndex) => {
      if (!run.text) return;
      runs.push(index === 0 && runIndex === 0 ? { ...run, ...geom(paragraph) } : run);
    });
  });
  const colors = new Set(runs.map((run) => run.color).filter(Boolean));
  const mixed =
    runs.some((run) => run.font || run.baseline || run.fraction) || colors.size > 1;
  // A hard break inside a paragraph is not the next paragraph. Keep the runs
  // so a tab or a first-line indent stays on its own paragraph.
  const geometric = paragraphs.some(
    (paragraph) =>
      (paragraph.firstIndent || 0) > 0 ||
      (paragraph.tabs?.length || 0) > 0 ||
      (paragraph.tabInterval || 0) > 0 ||
      (paragraph.text || "").includes("\t"),
  );
  if (!mixed && !geometric) return;
  return runs.map((run) => ({
    text: run.text,
    ...(run.color ? { color: run.color } : {}),
    ...(run.font ? { font: run.font } : {}),
    ...(run.fontSize ? { fontSize: run.fontSize } : {}),
    ...(run.baseline ? { baseline: run.baseline } : {}),
    ...(run.bold ? { bold: true } : {}),
    ...(run.paragraphBreak ? { paragraphBreak: true } : {}),
    ...(run.paraMargin ? { paraMargin: run.paraMargin } : {}),
    ...(run.paraHang ? { paraHang: run.paraHang } : {}),
    ...(run.paraFirst ? { paraFirst: run.paraFirst } : {}),
    ...(run.paraTab ? { paraTab: run.paraTab } : {}),
    ...(run.paraTabs?.length ? { paraTabs: run.paraTabs } : {}),
    ...(run.fraction ? { fraction: run.fraction } : {}),
  }));
}

function cellProperties(cellXml: string): string {
  return (
    /<a:tcPr\b[\s\S]*?<\/a:tcPr>|<a:tcPr\b[^>]*\/>/.exec(cellXml)?.[0] ?? ""
  );
}

/** Line elements are not the cell fill. A remaining `a:noFill` clears the style. */
function cellFillBody(cellXml: string): string {
  return cellProperties(cellXml).replace(
    /<a:(lnL|lnR|lnT|lnB|lnTlToBr|lnBlToTr|tcBdr)\b[\s\S]*?<\/a:\1>/g,
    "",
  );
}

function cellFillXml(cellXml: string): string | undefined {
  return /<a:solidFill\b[\s\S]*?<\/a:solidFill>/.exec(cellFillBody(cellXml))?.[0];
}

function cellFillCleared(cellXml: string): boolean {
  return /<a:noFill\b/.test(cellFillBody(cellXml));
}

function runBold(cellXml: string): { set: boolean; bold: boolean } {
  let set = false;
  let bold = false;
  for (const match of cellXml.matchAll(/<a:rPr\b([^>]*)/g)) {
    const value = /(?:^|\s)b="([^"]*)"/.exec(match[1])?.[1];
    if (value === "1" || value === "true") {
      set = true;
      bold = true;
    } else if (value === "0" || value === "false") set = true;
  }
  return { set, bold };
}

/** Explicit run and cell properties. Table-style fills are applied afterwards. */
export function explicitTableCell(
  cellXml: string,
  paragraphs: {
    text?: string;
    bold?: boolean;
    italic?: boolean;
    size?: number;
    align?: "left" | "center" | "right" | "justify";
    color?: string;
    font?: string;
    runs?: TableCellRun[];
    listMargin?: number;
    hang?: number;
    firstIndent?: number;
    tabInterval?: number;
    tabs?: { pos: number; align: "l" | "ctr" | "r" | "dec" }[];
  }[],
  paint: Paint,
): BuiltTableCell {
  const mark: BuiltTableCell = {};
  const bold = runBold(cellXml);
  mark.boldSet = bold.set;
  if (bold.bold || paragraphs.some((paragraph) => paragraph.bold))
    mark.bold = true;
  if (paragraphs.some((paragraph) => paragraph.italic)) mark.italic = true;
  if (cellFillCleared(cellXml)) mark.noFill = true;
  else {
    const fillXml = cellFillXml(cellXml);
    const fill = fillXml ? paint(fillXml) : undefined;
    if (fill) mark.fill = fill;
  }
  // An empty paragraph still inherits the default text style. The words live
  // in a later paragraph, and that is the colour and size PowerPoint draws.
  const written = paragraphs.filter((paragraph) => paragraph.text?.trim());
  const ranked = written.length ? written : paragraphs;
  const first =
    ranked.find((paragraph) => paragraph.color || paragraph.size) ??
    ranked[0];
  const sized = ranked.find((paragraph) => paragraph.size && paragraph.size > 0);
  // The paragraph colour is the inherited default. An explicit run fill is the
  // only colour that should cover the table style (white header text, red cells).
  const explicit = explicitRunColor(cellXml, paint);
  if (explicit) mark.color = explicit;
  // PowerPoint draws an unsized table run at 18pt. The presentation
  // default text style is for shapes and is not this size.
  if (sized?.size) mark.fontSize = sized.size;
  else mark.fontSize = 18;
  const faced = ranked.find((paragraph) => paragraph.font);
  if (faced?.font) mark.font = faced.font;
  const runs = tableCellRuns(paragraphs);
  if (runs) mark.runs = runs;
  const tabbed = paragraphs.find((paragraph) => paragraph.tabInterval);
  if (tabbed?.tabInterval) mark.tabSize = tabbed.tabInterval;
  if (first?.align && first.align !== "left") mark.align = first.align;
  const span = Number(/gridSpan="(\d+)"/.exec(cellXml)?.[1] ?? 1);
  if (span > 1) mark.colSpan = span;
  const tcPr =
    /<a:tcPr\b[^>]*>/.exec(cellXml)?.[0] ?? "";
  const tcAttrs = attrsOf(tcPr);
  const margin = (name: string) => {
    const raw = tcAttrs[name];
    if (raw == null || raw === "") return;
    const points = Number(raw) / 12700;
    return points >= 0 && points <= 200 ? points : undefined;
  };
  // Omitted cell margins are PowerPoint's 0.1in sides and 0.05in top and bottom.
  const padTop = margin("marT") ?? 45720 / 12700;
  const padRight = margin("marR") ?? 91440 / 12700;
  const padBottom = margin("marB") ?? 45720 / 12700;
  const padLeft = margin("marL") ?? 91440 / 12700;
  mark.padTop = padTop;
  mark.padRight = padRight;
  mark.padBottom = padBottom;
  mark.padLeft = padLeft;
  if (tcAttrs.anchor === "ctr") mark.valign = "middle";
  else if (tcAttrs.anchor === "b") mark.valign = "bottom";
  else mark.valign = "top";
  const rule = (tag: "lnT" | "lnR" | "lnB" | "lnL") =>
    edgeRule(
      new RegExp(`<a:${tag}\\b[\\s\\S]*?<\\/a:${tag}>`).exec(cellXml)?.[0] ?? "",
      paint,
    );
  const top = rule("lnT");
  const right = rule("lnR");
  const bottom = rule("lnB");
  const left = rule("lnL");
  const edge = (
    value: TableRule | "none" | undefined,
    border: "borderTop" | "borderRight" | "borderBottom" | "borderLeft",
    clear: "clearTop" | "clearRight" | "clearBottom" | "clearLeft",
  ) => {
    if (value === "none") mark[clear] = true;
    else if (value) mark[border] = value;
  };
  edge(top, "borderTop", "clearTop");
  edge(right, "borderRight", "clearRight");
  edge(bottom, "borderBottom", "clearBottom");
  edge(left, "borderLeft", "clearLeft");
  return mark;
}

export function tableStyleFlags(tblPr: string): TableStyleFlags {
  const tag = /<a:tblPr\b[^>]*>/.exec(tblPr)?.[0] ?? tblPr;
  if (!tag) return emptyFlags;
  return {
    firstRow: on(tag, "firstRow"),
    lastRow: on(tag, "lastRow"),
    firstCol: on(tag, "firstCol"),
    lastCol: on(tag, "lastCol"),
    bandRow: on(tag, "bandRow"),
    bandCol: on(tag, "bandCol"),
  };
}

export function tableStyleById(
  stylesXml: string,
  id: string,
): string | undefined {
  const wanted = id.replace(/[{}]/g, "").toLowerCase();
  // A missing id is a plain grid. tblStyleLst def is the style the editor
  // assigns to a new table; PowerPoint does not paint it unless the table
  // names that id.
  if (!wanted) return undefined;
  for (const match of stylesXml.matchAll(
    /<a:tblStyle\b([^>]*)>[\s\S]*?<\/a:tblStyle>/g,
  )) {
    const styleId = /styleId="([^"]*)"/.exec(match[1])?.[1] ?? "";
    if (styleId.replace(/[{}]/g, "").toLowerCase() === wanted) return match[0];
  }
  return undefined;
}

function block(xml: string, tag: string): string {
  return (
    new RegExp(`<a:${tag}\\b[\\s\\S]*?<\\/a:${tag}>`).exec(xml)?.[0] ?? ""
  );
}

/** A style fill of alpha 0 is empty. Painting it would lay white over the table. */
function opaqueStyleFill(color: string | undefined): string | undefined {
  if (!color) return;
  if (/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)$/.test(color)) return;
  return color;
}

function stylePart(xml: string, paint: Paint): StylePart {
  const tx = /<a:tcTxStyle\b([^>]*)(?:\/>|>([\s\S]*?)<\/a:tcTxStyle>)/.exec(xml);
  // fontRef carries a placeholder colour for the face. The scheme colour
  // beside it is the text colour; the placeholder must not win.
  const txBody = tx?.[2]?.replace(/<a:fontRef\b[\s\S]*?<\/a:fontRef>/g, "") ?? "";
  const color = txBody ? paint(txBody) : undefined;
  const bold = tx ? /\bb="(?:on|1)"/.test(tx[1]) : false;
  const tc = block(xml, "tcStyle").replace(
    /<a:tcBdr\b[\s\S]*?<\/a:tcBdr>/g,
    "",
  );
  const fillXml = /<a:solidFill\b[\s\S]*?<\/a:solidFill>/.exec(tc)?.[0];
  const fill = opaqueStyleFill(fillXml ? paint(fillXml) : undefined);
  return {
    ...(bold ? { bold: true } : {}),
    ...(color ? { color } : {}),
    ...(fill ? { fill } : {}),
  };
}

/**
 * Fill stored on tblPr, behind the cells. An explicit noFill hides the style
 * background. Anything else leaves the style free to paint its own tblBg.
 */
export function tablePropertyFillXml(tblXml: string): string {
  const inner = /<a:tblPr\b[^>]*>([\s\S]*?)<\/a:tblPr>/.exec(tblXml)?.[1];
  if (inner == null) return "";
  const body = inner
    .replace(/<a:effectLst\b[\s\S]*?<\/a:effectLst>/g, "")
    .replace(/<a:effectDag\b[\s\S]*?<\/a:effectDag>/g, "");
  const fill =
    /<a:(solidFill|gradFill|pattFill)\b[\s\S]*?<\/a:\1>/.exec(body)?.[0];
  if (fill) return fill;
  if (/<a:noFill\b/.test(body)) return "none";
  return "";
}

/** White (or other) interior rules from the whole-table style. */
export function tableStyleBorder(
  styleXml: string,
  paint: Paint,
): string | undefined {
  const inside =
    /<a:insideH\b[\s\S]*?<\/a:insideH>/.exec(block(styleXml, "wholeTbl"))?.[0] ??
    "";
  if (!inside || /<a:noFill\b/.test(inside)) return undefined;
  const fill = /<a:solidFill\b[\s\S]*?<\/a:solidFill>/.exec(inside)?.[0];
  return fill ? paint(fill) : undefined;
}

function bandIndex(
  index: number,
  count: number,
  skipFirst: boolean,
  skipLast: boolean,
): number | undefined {
  const start = skipFirst ? 1 : 0;
  const end = count - (skipLast ? 1 : 0);
  if (index < start || index >= end) return undefined;
  return index - start;
}

/** Style fill, colour, and bold for one cell. Later parts override earlier ones. */
export function tableStyleAt(
  styleXml: string,
  flags: TableStyleFlags,
  row: number,
  col: number,
  rowCount: number,
  colCount: number,
  paint: Paint,
): StylePart {
  const parts: StylePart[] = [stylePart(block(styleXml, "wholeTbl"), paint)];
  const bandRow = flags.bandRow
    ? bandIndex(row, rowCount, flags.firstRow, flags.lastRow)
    : undefined;
  if (bandRow != null)
    parts.push(
      stylePart(block(styleXml, bandRow % 2 === 0 ? "band1H" : "band2H"), paint),
    );
  const bandCol = flags.bandCol
    ? bandIndex(col, colCount, flags.firstCol, flags.lastCol)
    : undefined;
  if (bandCol != null)
    parts.push(
      stylePart(block(styleXml, bandCol % 2 === 0 ? "band1V" : "band2V"), paint),
    );
  if (flags.firstCol && col === 0)
    parts.push(stylePart(block(styleXml, "firstCol"), paint));
  if (flags.lastCol && col === colCount - 1)
    parts.push(stylePart(block(styleXml, "lastCol"), paint));
  if (flags.firstRow && row === 0)
    parts.push(stylePart(block(styleXml, "firstRow"), paint));
  if (flags.lastRow && row === rowCount - 1)
    parts.push(stylePart(block(styleXml, "lastRow"), paint));
  return parts.reduce<StylePart>(
    (acc, part) => ({ ...acc, ...part }),
    {},
  );
}

type EdgeRules = {
  borderTop?: TableRule;
  borderRight?: TableRule;
  borderBottom?: TableRule;
  borderLeft?: TableRule;
};

function edgeRule(fragment: string, paint: Paint): TableRule | "none" | undefined {
  if (!fragment) return;
  if (/<a:noFill\b/.test(fragment)) return "none";
  const width = Number(/\bw="(\d+)"/.exec(fragment)?.[1] ?? 12700) / 12700;
  const fill = /<a:solidFill\b[\s\S]*?<\/a:solidFill>/.exec(fragment)?.[0];
  const color = fill ? paint(fill) : undefined;
  if (!color || !(width > 0)) return;
  return { color, width };
}

function edgeFragment(container: string, edge: string): string {
  return (
    new RegExp(`<a:${edge}\\b[\\s\\S]*?<\\/a:${edge}>`).exec(container)?.[0] ?? ""
  );
}

function applyEdge(
  rules: EdgeRules,
  key: keyof EdgeRules,
  fragment: string,
  paint: Paint,
) {
  const rule = edgeRule(fragment, paint);
  if (rule === "none") delete rules[key];
  else if (rule) rules[key] = rule;
}

/**
 * Borders that belong to this cell from the table style.
 * `insideH` is the line under a row; a later part such as the header replaces it.
 * An empty result means the style did not name an edge.
 */
export function tableStyleEdges(
  styleXml: string,
  flags: TableStyleFlags,
  row: number,
  col: number,
  rowCount: number,
  colCount: number,
  paint: Paint,
): EdgeRules | undefined {
  const rules: EdgeRules = {};
  const bordersOf = (part: string) =>
    /<a:tcBdr\b[\s\S]*?<\/a:tcBdr>/.exec(block(styleXml, part))?.[0] ?? "";
  const whole = bordersOf("wholeTbl");
  if (row === 0) applyEdge(rules, "borderTop", edgeFragment(whole, "top"), paint);
  if (row === rowCount - 1)
    applyEdge(rules, "borderBottom", edgeFragment(whole, "bottom"), paint);
  if (col === 0) applyEdge(rules, "borderLeft", edgeFragment(whole, "left"), paint);
  if (col === colCount - 1)
    applyEdge(rules, "borderRight", edgeFragment(whole, "right"), paint);
  if (row < rowCount - 1)
    applyEdge(rules, "borderBottom", edgeFragment(whole, "insideH"), paint);
  if (col < colCount - 1)
    applyEdge(rules, "borderRight", edgeFragment(whole, "insideV"), paint);
  const overlay = (part: string) => {
    const box = bordersOf(part);
    if (!box) return;
    applyEdge(rules, "borderTop", edgeFragment(box, "top"), paint);
    applyEdge(rules, "borderRight", edgeFragment(box, "right"), paint);
    applyEdge(rules, "borderBottom", edgeFragment(box, "bottom"), paint);
    applyEdge(rules, "borderLeft", edgeFragment(box, "left"), paint);
  };
  const bandRow = flags.bandRow
    ? bandIndex(row, rowCount, flags.firstRow, flags.lastRow)
    : undefined;
  if (bandRow != null) overlay(bandRow % 2 === 0 ? "band1H" : "band2H");
  const bandCol = flags.bandCol
    ? bandIndex(col, colCount, flags.firstCol, flags.lastCol)
    : undefined;
  if (bandCol != null) overlay(bandCol % 2 === 0 ? "band1V" : "band2V");
  if (flags.firstCol && col === 0) overlay("firstCol");
  if (flags.lastCol && col === colCount - 1) overlay("lastCol");
  if (flags.firstRow && row === 0) overlay("firstRow");
  if (flags.lastRow && row === rowCount - 1) overlay("lastRow");
  return rules.borderTop || rules.borderRight || rules.borderBottom || rules.borderLeft
    ? rules
    : undefined;
}

/**
 * Built-in PowerPoint table styles are not written into the package.
 * Light Style 1 (and its accent colours) is the open row-band style.
 */
const lightStyle1Color: Record<string, string> = {
  "9d7b26c5-4107-4fec-aedc-1716b250a1ef": "tx1",
  "3b4b98b0-60ac-42c2-afa5-b58cd77fa1e5": "accent1",
  "0e3fde45-af77-4b5c-9715-49d594bdf05e": "accent2",
  "c083e6e3-fa7d-4d7b-a595-ef9225afea82": "accent3",
  "d27102a9-8310-4765-a935-a1911b00ca55": "accent4",
  "5fd0f851-ec5a-4d38-b0ad-8093ec10f338": "accent5",
  "68d230f3-cf80-4859-8ce7-a43ee81993b5": "accent6",
};

/** Black hairline grid used when a table does not name a style. */
export function plainTableGrid(): string {
  const edge = (name: string) =>
    `<a:${name}><a:ln w="12700" cmpd="sng"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></a:${name}>`;
  return `<a:tblStyle styleId="" styleName="Table Grid"><a:wholeTbl><a:tcStyle><a:tcBdr>${edge("left")}${edge("right")}${edge("top")}${edge("bottom")}${edge("insideH")}${edge("insideV")}</a:tcBdr></a:tcStyle></a:wholeTbl></a:tblStyle>`;
}

export function builtinTableStyle(id: string): string | undefined {
  const medium = mediumTableStyle(id) ?? mediumStyle2(id);
  if (medium) return medium;
  const color = lightStyle1Color[id.replace(/[{}]/g, "").toLowerCase()];
  if (!color) return;
  const line = (edge: string) =>
    `<a:${edge}><a:ln w="12700" cmpd="sng"><a:solidFill><a:schemeClr val="${color}"/></a:solidFill></a:ln></a:${edge}>`;
  const none = (edge: string) => `<a:${edge}><a:ln><a:noFill/></a:ln></a:${edge}>`;
  return `<a:tblStyle styleId="${id}" styleName="Light Style 1">
    <a:wholeTbl><a:tcTxStyle><a:schemeClr val="tx1"/></a:tcTxStyle>
      <a:tcStyle><a:tcBdr>${none("left")}${none("right")}${line("top")}${line("bottom")}${none("insideH")}${none("insideV")}</a:tcBdr>
      <a:fill><a:noFill/></a:fill></a:tcStyle></a:wholeTbl>
    <a:band1H><a:tcStyle><a:fill><a:solidFill><a:schemeClr val="${color}"><a:alpha val="20000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:band1H>
    <a:band2H><a:tcStyle><a:tcBdr/></a:tcStyle></a:band2H>
    <a:band1V><a:tcStyle><a:fill><a:solidFill><a:schemeClr val="${color}"><a:alpha val="20000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:band1V>
    <a:firstCol><a:tcTxStyle b="on"><a:schemeClr val="tx1"/></a:tcTxStyle><a:tcStyle><a:tcBdr/></a:tcStyle></a:firstCol>
    <a:lastCol><a:tcTxStyle b="on"/><a:tcStyle><a:tcBdr/></a:tcStyle></a:lastCol>
    <a:firstRow><a:tcTxStyle b="on"><a:schemeClr val="${color}"/></a:tcTxStyle>
      <a:tcStyle><a:tcBdr>${line("bottom")}</a:tcBdr><a:fill><a:noFill/></a:fill></a:tcStyle></a:firstRow>
    <a:lastRow><a:tcTxStyle b="on"/><a:tcStyle><a:tcBdr>${line("top")}</a:tcBdr><a:fill><a:noFill/></a:fill></a:tcStyle></a:lastRow>
  </a:tblStyle>`;
}

/** Lay the table style under explicit cell properties. */
export function mergeTableCell(
  cell: BuiltTableCell,
  styled: StylePart | undefined,
  border: string | undefined,
  styleEdges?: EdgeRules,
): TableCellStyle {
  const mark: TableCellStyle = {};
  if (cell.boldSet ? cell.bold : cell.bold || styled?.bold) mark.bold = true;
  if (cell.italic) mark.italic = true;
  const fill = cell.noFill ? undefined : cell.fill || styled?.fill;
  const color = cell.color || styled?.color;
  if (fill) mark.fill = fill;
  if (color) mark.color = color;
  if (cell.fontSize) mark.fontSize = cell.fontSize;
  if (cell.font) mark.font = cell.font;
  if (cell.align) mark.align = cell.align;
  if (cell.colSpan && cell.colSpan > 1) mark.colSpan = cell.colSpan;
  if (cell.rowSpan && cell.rowSpan > 1) mark.rowSpan = cell.rowSpan;
  const edges = { ...styleEdges };
  const cleared = {
    borderTop: cell.clearTop,
    borderRight: cell.clearRight,
    borderBottom: cell.clearBottom,
    borderLeft: cell.clearLeft,
  };
  for (const key of ["borderTop", "borderRight", "borderBottom", "borderLeft"] as const) {
    if (cleared[key]) delete edges[key];
    else if (cell[key]) edges[key] = cell[key];
  }
  if (edges.borderTop) mark.borderTop = edges.borderTop;
  if (edges.borderRight) mark.borderRight = edges.borderRight;
  if (edges.borderBottom) mark.borderBottom = edges.borderBottom;
  if (edges.borderLeft) mark.borderLeft = edges.borderLeft;
  const edged = mark.borderTop || mark.borderRight || mark.borderBottom || mark.borderLeft;
  if (border && !edged) mark.border = border;
  if (cell.padTop != null) mark.padTop = cell.padTop;
  if (cell.padRight != null) mark.padRight = cell.padRight;
  if (cell.padBottom != null) mark.padBottom = cell.padBottom;
  if (cell.padLeft != null) mark.padLeft = cell.padLeft;
  if (cell.valign) mark.valign = cell.valign;
  if (cell.lines?.length) mark.lines = cell.lines;
  if (cell.tabSize) mark.tabSize = cell.tabSize;
  if (cell.runs?.length) mark.runs = cell.runs;
  return mark;
}

/** Per-line list inset when a cell's paragraphs do not share one hanging marker. */
export function tableLineLayout(
  paragraphs: {
    listMargin?: number;
    hang?: number;
    firstIndent?: number;
    tabs?: { pos: number; align: "l" | "ctr" | "r" | "dec" }[];
  }[],
): {
  margin?: number;
  hang?: number;
  first?: number;
  tabs?: { pos: number; align: "l" | "ctr" | "r" | "dec" }[];
}[] | undefined {
  if (
    !paragraphs.some(
      (paragraph) =>
        paragraph.listMargin || paragraph.hang || paragraph.firstIndent || paragraph.tabs?.length,
    )
  )
    return;
  return paragraphs.map((paragraph) => ({
    ...(paragraph.listMargin ? { margin: paragraph.listMargin } : {}),
    ...(paragraph.hang ? { hang: paragraph.hang } : {}),
    ...(paragraph.firstIndent ? { first: paragraph.firstIndent } : {}),
    ...(paragraph.tabs?.length ? { tabs: paragraph.tabs } : {}),
  }));
}

/**
 * Google Slides writes a 3,000,000 EMU frame and keeps the real size on the
 * grid. PowerPoint draws that grid. A frame taller than its rows is leftover
 * space, not a stretch target: painting the rows into it covers the text
 * below. A frame that matches its grid, or a shorter resized frame, stays put.
 */
export function tableFrameBox(
  frame: { width: number; height: number },
  frameCx: number,
  frameCy: number,
  gridW: number,
  gridH: number,
  metrics: { width: number; height: number; emuWidth: number; emuHeight: number },
): { width: number; height: number; emuHeight: number } {
  const placeholder =
    frameCx === 3000000 &&
    frameCy === 3000000 &&
    gridW > 0 &&
    gridH > 0 &&
    (gridW !== frameCx || gridH !== frameCy);
  if (placeholder) {
    return {
      width: (gridW / metrics.emuWidth) * metrics.width,
      height: (gridH / metrics.emuHeight) * metrics.height,
      emuHeight: gridH,
    };
  }
  const rowsAreShorter = gridH > 0 && frameCy > gridH;
  return {
    width: frame.width,
    height: rowsAreShorter
      ? (gridH / metrics.emuHeight) * metrics.height
      : frame.height,
    emuHeight: rowsAreShorter ? gridH : frameCy > 0 ? frameCy : gridH || 1,
  };
}

/**
 * A stored row height is kept. Height 0 is unset, not a collapsed row, unless
 * the explicit rows already fill the frame. Those unset rows share whatever
 * frame height is left so the grid stays inside the graphic frame. The
 * 3,000,000 EMU placeholder is not a real frame, so it does not donate space.
 */
export function distributeUnsetTableRows(
  rowEmu: number[],
  frameCy: number,
  frameCx = 0,
): number[] {
  if (frameCx === 3000000 && frameCy === 3000000) return rowEmu;
  const unset = rowEmu.filter((height) => !(height > 0)).length;
  if (unset === 0) return rowEmu;
  const set = rowEmu.reduce((sum, height) => sum + (height > 0 ? height : 0), 0);
  const leftover = frameCy - set;
  if (!(leftover > 0)) return rowEmu;
  const share = leftover / unset;
  return rowEmu.map((height) => (height > 0 ? height : share));
}

/**
 * A resized table keeps its old row heights while the frame is the size
 * PowerPoint paints. Scale those rows into an on-slide frame that is only
 * modestly taller. A frame more than half again as tall is leftover space:
 * stretching it would cover the shapes underneath. The 3,000,000 EMU
 * placeholder is not a real frame.
 */
export function scaleRowsIntoFrame(
  rowEmu: number[],
  frameCy: number,
  frameTop: number,
  frameCx: number,
  slideEmuHeight: number,
): number[] {
  if (frameCx === 3000000 && frameCy === 3000000) return rowEmu;
  const sum = rowEmu.reduce((total, height) => total + height, 0);
  if (!(sum > 0) || !(frameCy > sum) || frameCy > sum * 1.5) return rowEmu;
  if (frameTop < -1 || frameTop + frameCy > slideEmuHeight + 1) return rowEmu;
  const scale = frameCy / sum;
  return rowEmu.map((height) => height * scale);
}

/** Arial Narrow lays out as SuiteLeaf Pine, which is narrower than Willow. */
function narrowTableFace(font: string | undefined): boolean {
  const name = font?.trim().toLowerCase();
  return name === "suiteleaf pine" || name === "arial narrow";
}

/**
 * Advance, in em, of SuiteLeaf Pine (regular). Bold uses the same 1.06 scale
 * as Willow. These are the face's own advances, so a narrow cell does not
 * wrap a line early and grow the row.
 */
function pineEm(ch: string): number {
  if (ch === " ") return 0.228;
  if ("ijl".includes(ch)) return 0.182;
  if ("ftr".includes(ch)) return 0.243;
  if (".,:;!'`|".includes(ch)) return 0.223;
  if (ch === "m" || ch === "w") return 0.637;
  if (ch === "%") return 0.729;
  if ("MW@".includes(ch)) return 0.763;
  if (ch >= "0" && ch <= "9") return 0.456;
  if (ch >= "A" && ch <= "Z") return 0.555;
  return 0.401;
}

/** Advance, in em, of SuiteLeaf Willow. Narrow averages wrap a line too late and clip it. */
function glyphEm(ch: string, face?: string): number {
  if (narrowTableFace(face)) return pineEm(ch);
  if (ch === " ") return 0.226;
  if ("ijl".includes(ch)) return 0.23;
  if ("ftr".includes(ch)) return 0.33;
  if (".,:;!'`|".includes(ch)) return 0.25;
  if (ch === "m" || ch === "w") return 0.76;
  if (ch === "%") return 0.715;
  if ("MW@".includes(ch)) return 0.87;
  if (ch >= "0" && ch <= "9") return 0.507;
  if (ch >= "A" && ch <= "Z") return 0.58;
  return 0.5;
}

function wrapLines(
  text: string,
  widthPt: number,
  font: number,
  bold: boolean,
  face?: string,
): number {
  const scale = bold ? 1.06 : 1;
  const space = glyphEm(" ", face) * font * scale;
  const widthOf = (word: string) => {
    let width = 0;
    for (const ch of word) width += glyphEm(ch, face) * font * scale;
    return width;
  };
  let count = 0;
  for (const para of text.split("\n")) {
    if (!para) {
      count += 1;
      continue;
    }
    let line = 0;
    let lines = 1;
    for (const word of para.split(" ")) {
      if (!word) continue;
      const wordWidth = widthOf(word);
      if (wordWidth > widthPt) {
        if (line > 0) {
          lines += 1;
          line = 0;
        }
        for (const ch of word) {
          const advance = glyphEm(ch) * font * scale;
          if (line > 0 && line + advance > widthPt) {
            lines += 1;
            line = advance;
          } else line += advance;
        }
        continue;
      }
      const gap = line > 0 ? space : 0;
      if (line > 0 && line + gap + wordWidth > widthPt) {
        lines += 1;
        line = wordWidth;
      } else line += gap + wordWidth;
    }
    count += lines;
  }
  return Math.max(count, 1);
}

type RowMeasure = {
  fontSize?: number;
  font?: string;
  bold?: boolean;
  padTop?: number;
  padRight?: number;
  padBottom?: number;
  padLeft?: number;
  colSpan?: number;
  /** Subscript runs are narrower than the concatenated cell text. */
  runs?: { text?: string; baseline?: number; fontSize?: number }[];
};

/** Width of a cell's runs, in points. A newline means the cell is not one line. */
function runLineWidth(mark: RowMeasure, font: number): number | undefined {
  if (!mark.runs?.length) return;
  const scale = mark.bold ? 1.06 : 1;
  let width = 0;
  for (const run of mark.runs) {
    const size = (run.fontSize && run.fontSize > 0 ? run.fontSize : font) * (run.baseline ? 0.65 : 1);
    const faceScale = run.baseline ? 1 : scale;
    for (const ch of run.text || "") {
      if (ch === "\n") return;
      width += glyphEm(ch, mark.font) * size * faceScale;
    }
  }
  return width;
}

/**
 * Several empty paragraphs are line boxes. One empty paragraph is just an
 * empty cell, and it does not make the row taller.
 */
function blankParagraphLines(text: string): number {
  if (text.trim()) return 0;
  const lines = text.split("\n").length;
  return lines >= 2 ? lines : 0;
}

/** Wrapped height of one row, in EMUs. An empty row needs nothing. */
export function tableTextRowEmu(
  rows: string[][],
  marks: RowMeasure[][],
  colEmu: number[],
): number[] {
  const pt = 12700;
  return rows.map((row, r) => {
    let col = 0;
    let need = 0;
    row.forEach((text, c) => {
      const mark = marks[r]?.[c];
      const span = mark?.colSpan && mark.colSpan > 0 ? mark.colSpan : 1;
      const width = colEmu.slice(col, col + span).reduce((sum, cell) => sum + cell, 0);
      col += span;
      // Fixture grids use token widths. A real cell is at least a tenth of an inch.
      if (!(width > 100_000)) return;
      const blanks = blankParagraphLines(text);
      // A trailing empty paragraph is the end mark of the cell. It does not
      // add a line, and it must not stretch a row PowerPoint left equal.
      const body = text.replace(/\n+$/, "");
      if (!body.trim() && !blanks) return;
      const sized = mark?.fontSize && mark.fontSize > 0 ? mark.fontSize : 0;
      // Wrapped words keep the 14pt measure when the cell names no size.
      // Unsized empty paragraphs are the 18pt body default. Both sit on the
      // Windows line grid, which is what a stored one-line row is tall enough for.
      const font = sized || (blanks ? 18 : 14);
      const padLeft = (mark?.padLeft ?? 7.2) * pt;
      const padRight = (mark?.padRight ?? 7.2) * pt;
      const padTop = mark?.padTop ?? 3.6;
      const padBottom = mark?.padBottom ?? 3.6;
      const grid = officeSingleSpacing(mark?.font || "Calibri");
      if (!body.trim() && blanks) {
        const height = (padTop + padBottom + blanks * font * grid) * pt;
        if (height > need) need = height;
        return;
      }
      const inner = Math.max(font, (width - padLeft - padRight) / pt);
      const oneLine = runLineWidth(mark ?? {}, font);
      // Willow's advances run a little wide. A line that is only slightly
      // over the cell still fits in PowerPoint, and wrapping it doubles the row.
      const lines =
        oneLine != null && oneLine <= inner * 1.08 && !body.includes("\n")
          ? 1
          : wrapLines(body, inner, font, !!mark?.bold, mark?.font);
      const height = (padTop + padBottom + lines * font * grid) * pt;
      if (height > need) need = height;
    });
    return need;
  });
}

/**
 * A stored row that clips its wrapped text grows to that text.
 * Rows that already fit stay on the stored grid, so a taller frame is not a
 * stretch target. Growth that would pass the graphic frame is scaled back
 * into it. The 3,000,000 EMU placeholder is not a real frame.
 */
export function growClippedTableRows(
  rowEmu: number[],
  neededEmu: number[],
  frameCy = 0,
  frameCx = 0,
): number[] {
  const grown = rowEmu.map((height, index) => {
    const need = neededEmu[index] ?? 0;
    if (!(height > 0) || !(need > height * 1.25)) return height;
    return need;
  });
  const grew = grown.some((height, index) => height > (rowEmu[index] ?? 0));
  const sum = grown.reduce((total, height) => total + height, 0);
  if (
    !grew ||
    (frameCx === 3000000 && frameCy === 3000000) ||
    !(frameCy > 0) ||
    !(sum > frameCy)
  )
    return grown;
  const scale = frameCy / sum;
  return grown.map((height) => height * scale);
}

export function tableFractions(widths: number[]): number[] | undefined {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (!(total > 0) || widths.length < 2) return undefined;
  return widths.map((width) => width / total);
}

export function cellMarkUsed(mark: TableCellStyle): boolean {
  return Object.keys(mark).length > 0;
}
