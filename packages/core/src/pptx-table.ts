/** One edge of a cell. Width is in points; PowerPoint's hairline is 1. */
export type TableRule = { color: string; width?: number };

/** Cell formatting imported from a DrawingML table, aligned with `rows`. */
export type TableCellStyle = {
  bold?: boolean;
  italic?: boolean;
  fill?: string;
  color?: string;
  fontSize?: number;
  align?: "left" | "center" | "right" | "justify";
  colSpan?: number;
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
  /** Paragraph left edge and hanging indent, in slide pixels. One entry per line. */
  lines?: { margin?: number; hang?: number }[];
};

export type BuiltTableCell = TableCellStyle & { boldSet?: boolean };

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

function cellFillXml(cellXml: string): string | undefined {
  const tcPr =
    /<a:tcPr\b[\s\S]*?<\/a:tcPr>|<a:tcPr\b[^>]*\/>/.exec(cellXml)?.[0] ?? "";
  const stripped = tcPr.replace(
    /<a:(lnL|lnR|lnT|lnB|tcBdr)\b[\s\S]*?<\/a:\1>/g,
    "",
  );
  return /<a:solidFill\b[\s\S]*?<\/a:solidFill>/.exec(stripped)?.[0];
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
  }[],
  paint: Paint,
): BuiltTableCell {
  const mark: BuiltTableCell = {};
  const bold = runBold(cellXml);
  mark.boldSet = bold.set;
  if (bold.bold || paragraphs.some((paragraph) => paragraph.bold))
    mark.bold = true;
  if (paragraphs.some((paragraph) => paragraph.italic)) mark.italic = true;
  const fillXml = cellFillXml(cellXml);
  const fill = fillXml ? paint(fillXml) : undefined;
  if (fill) mark.fill = fill;
  // An empty paragraph still inherits the default text style. The words live
  // in a later paragraph, and that is the colour and size PowerPoint draws.
  const written = paragraphs.filter((paragraph) => paragraph.text?.trim());
  const ranked = written.length ? written : paragraphs;
  const first =
    ranked.find((paragraph) => paragraph.color || paragraph.size) ??
    ranked[0];
  const sized = ranked.find((paragraph) => paragraph.size && paragraph.size > 0);
  if (first?.color) mark.color = first.color;
  if (sized?.size) mark.fontSize = sized.size;
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
  if (top && top !== "none") mark.borderTop = top;
  if (right && right !== "none") mark.borderRight = right;
  if (bottom && bottom !== "none") mark.borderBottom = bottom;
  if (left && left !== "none") mark.borderLeft = left;
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
  if (!wanted) {
    const def = /<a:tblStyleLst\b[^>]*\bdef="([^"]+)"/.exec(stylesXml)?.[1];
    return def ? tableStyleById(stylesXml, def) : undefined;
  }
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

function stylePart(xml: string, paint: Paint): StylePart {
  const tx = /<a:tcTxStyle\b([^>]*)(?:\/>|>([\s\S]*?)<\/a:tcTxStyle>)/.exec(xml);
  const color = tx?.[2] ? paint(tx[2]) : undefined;
  const bold = tx ? /\bb="(?:on|1)"/.test(tx[1]) : false;
  const tc = block(xml, "tcStyle").replace(
    /<a:tcBdr\b[\s\S]*?<\/a:tcBdr>/g,
    "",
  );
  const fillXml = /<a:solidFill\b[\s\S]*?<\/a:solidFill>/.exec(tc)?.[0];
  const fill = fillXml ? paint(fillXml) : undefined;
  return {
    ...(bold ? { bold: true } : {}),
    ...(color ? { color } : {}),
    ...(fill ? { fill } : {}),
  };
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

export function builtinTableStyle(id: string): string | undefined {
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
  const fill = cell.fill || styled?.fill;
  const color = cell.color || styled?.color;
  if (fill) mark.fill = fill;
  if (color) mark.color = color;
  if (cell.fontSize) mark.fontSize = cell.fontSize;
  if (cell.align) mark.align = cell.align;
  if (cell.colSpan && cell.colSpan > 1) mark.colSpan = cell.colSpan;
  const edges = { ...styleEdges };
  for (const key of ["borderTop", "borderRight", "borderBottom", "borderLeft"] as const) {
    if (cell[key]) edges[key] = cell[key];
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
  return mark;
}

/** Per-line list inset when a cell's paragraphs do not share one hanging marker. */
export function tableLineLayout(
  paragraphs: { listMargin?: number; hang?: number }[],
): { margin?: number; hang?: number }[] | undefined {
  if (!paragraphs.some((paragraph) => paragraph.listMargin || paragraph.hang))
    return;
  return paragraphs.map((paragraph) => ({
    ...(paragraph.listMargin ? { margin: paragraph.listMargin } : {}),
    ...(paragraph.hang ? { hang: paragraph.hang } : {}),
  }));
}

export function tableFractions(widths: number[]): number[] | undefined {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (!(total > 0) || widths.length < 2) return undefined;
  return widths.map((width) => width / total);
}

export function cellMarkUsed(mark: TableCellStyle): boolean {
  return Object.keys(mark).length > 0;
}
