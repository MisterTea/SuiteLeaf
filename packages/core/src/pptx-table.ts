import {
  attrsOf,
  edgeRule,
  type EdgeRules,
  type Paint,
  type StylePart,
} from "./pptx-table-style-resolve";
import { verticalTextFlow } from "./pptx-layout-inherit";

export {
  builtinTableStyle,
  plainTableGrid,
  tablePropertyFillXml,
  tableStyleAt,
  tableStyleBorder,
  tableStyleById,
  tableStyleEdges,
  tableStyleFlags,
  type TableStyleFlags,
} from "./pptx-table-style-resolve";
export {
  distributeUnsetTableRows,
  growClippedTableRows,
  scaleRowsIntoFrame,
  tableFrameBox,
  tableTextRowEmu,
} from "./pptx-table-rows";

/** A run kept when one cell mixes a symbol font, a subscript, or more than one colour. */
export type TableCellRun = {
  text: string;
  color?: string;
  font?: string;
  fontSize?: number;
  baseline?: number;
  scriptScale?: boolean;
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
  textFlow?: "up" | "down" | "upright";
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
  /** The inherited text colour, under the table style's. */
  baseColor?: string;
};

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
    ...(run.scriptScale ? { scriptScale: true } : {}),
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
  else if (first?.color) mark.baseColor = first.color;
  // PowerPoint draws an unsized table run at 18pt. The presentation
  // default text style is for shapes and is not this size.
  if (sized?.size) mark.fontSize = sized.size;
  else mark.fontSize = 18;
  const faced = ranked.find((paragraph) => paragraph.font);
  if (faced?.font) mark.font = faced.font;
  const runs = tableCellRuns(paragraphs);
  if (runs) mark.runs = explicit ? runs : runs.map(({ color: _inherited, ...run }) => run);
  const tabbed = paragraphs.find((paragraph) => paragraph.tabInterval);
  if (tabbed?.tabInterval) mark.tabSize = tabbed.tabInterval;
  if (first?.align && first.align !== "left") mark.align = first.align;
  const span = Number(/gridSpan="(\d+)"/.exec(cellXml)?.[1] ?? 1);
  if (span > 1) mark.colSpan = span;
  const tcPr =
    /<a:tcPr\b[^>]*>/.exec(cellXml)?.[0] ?? "";
  const tcAttrs = attrsOf(tcPr);
  const flow = verticalTextFlow(tcAttrs.vert);
  if (flow) mark.textFlow = flow;
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
  const color = cell.color || styled?.color || cell.baseColor;
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
  if (cell.textFlow) mark.textFlow = cell.textFlow;
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

export function tableFractions(widths: number[]): number[] | undefined {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (!(total > 0) || widths.length < 2) return undefined;
  return widths.map((width) => width / total);
}

export function cellMarkUsed(mark: TableCellStyle): boolean {
  return Object.keys(mark).length > 0;
}
