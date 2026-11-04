import { mediumStyle2, mediumTableStyle } from "./pptx-table-styles";
import type { TableRule } from "./pptx-table";

export type Paint = (xml: string) => string | undefined;

export type StylePart = { fill?: string; color?: string; bold?: boolean };

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

export function attrsOf(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z0-9]+)="([^"]*)"/g))
    attrs[match[1]] = match[2];
  return attrs;
}

function on(tag: string, name: string) {
  const value = attrsOf(tag)[name];
  return value === "1" || value === "true";
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

export type EdgeRules = {
  borderTop?: TableRule;
  borderRight?: TableRule;
  borderBottom?: TableRule;
  borderLeft?: TableRule;
};

export function edgeRule(fragment: string, paint: Paint): TableRule | "none" | undefined {
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
