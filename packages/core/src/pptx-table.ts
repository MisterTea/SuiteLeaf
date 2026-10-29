/** Cell formatting imported from a DrawingML table, aligned with `rows`. */
export type TableCellStyle = {
  bold?: boolean;
  italic?: boolean;
  fill?: string;
  color?: string;
  fontSize?: number;
  align?: "left" | "center" | "right" | "justify";
  colSpan?: number;
  /** Interior border colour from the table style. */
  border?: string;
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
  const first =
    paragraphs.find((paragraph) => paragraph.color || paragraph.size) ??
    paragraphs[0];
  if (first?.color) mark.color = first.color;
  if (first?.size && first.size > 0) mark.fontSize = first.size;
  if (first?.align && first.align !== "left") mark.align = first.align;
  const span = Number(/gridSpan="(\d+)"/.exec(cellXml)?.[1] ?? 1);
  if (span > 1) mark.colSpan = span;
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

/** Lay the table style under explicit cell properties. */
export function mergeTableCell(
  cell: BuiltTableCell,
  styled: StylePart | undefined,
  border: string | undefined,
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
  if (border) mark.border = border;
  return mark;
}

export function tableFractions(widths: number[]): number[] | undefined {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (!(total > 0) || widths.length < 2) return undefined;
  return widths.map((width) => width / total);
}

export function cellMarkUsed(mark: TableCellStyle): boolean {
  return Object.keys(mark).length > 0;
}
