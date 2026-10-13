import { columnName } from "./index";

/**
 * SuiteLeaf groups are the detail rows and columns. The label stays to the
 * left and the total stays above, so exported outlines use summaryRight="0"
 * and summaryBelow="0". Excel's own default puts the summary after the
 * detail; import honors whichever side outlinePr names.
 * A second outline level is flattened into the one group SuiteLeaf stores.
 */

type Attrs = Record<string, string>;
type Span = { start: number; end: number; collapsed: number[] };
type Mark = { level: number; hidden: boolean; collapsed: boolean };
type ColRange = { min: number; max: number; attrs: Attrs };

export type OutlineColumnGroup = {
  id: string;
  startColumn: number;
  endColumn: number;
  collapsed: number[];
};
export type OutlineRowGroup = {
  id: string;
  startRow: number;
  endRow: number;
  collapsed: number[];
};
export type WorksheetOutline = {
  columnGroups: OutlineColumnGroup[];
  rowGroups: OutlineRowGroup[];
  /** True when the file used an outline level deeper than 1. */
  nested: boolean;
};

const flag = (value: string | undefined) => value === "1" || value === "true";

function parseAttrs(source: string): Attrs {
  const attrs: Attrs = {};
  for (const match of source.matchAll(/([\w:.-]+)="([^"]*)"/g))
    attrs[match[1]!] = match[2]!;
  return attrs;
}

function emitAttrs(attrs: Attrs): string {
  return Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");
}

function sameAttrs(a: Attrs, b: Attrs): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

function storedSpans(
  raw: unknown,
  startKey: "startColumn" | "startRow",
  endKey: "endColumn" | "endRow",
): Span[] {
  if (!Array.isArray(raw)) return [];
  const spans: Span[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const start = record[startKey];
    const end = record[endKey];
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    if ((start as number) < 0 || (end as number) < (start as number)) continue;
    const collapsed = Array.isArray(record.collapsed)
      ? [
          ...new Set(
            record.collapsed.filter(
              (index): index is number =>
                Number.isInteger(index) &&
                (index as number) >= (start as number) &&
                (index as number) <= (end as number),
            ),
          ),
        ].sort((a, b) => a - b)
      : [];
    spans.push({ start: start as number, end: end as number, collapsed });
  }
  return spans.sort((a, b) => a.start - b.start);
}

function groupsOf(custom: unknown): { columns: Span[]; rows: Span[] } {
  const record =
    custom && typeof custom === "object"
      ? (custom as Record<string, unknown>)
      : {};
  return {
    columns: storedSpans(record.suiteleafColumnGroups, "startColumn", "endColumn"),
    rows: storedSpans(record.suiteleafRowGroups, "startRow", "endRow"),
  };
}

function isFull(span: Span): boolean {
  const hidden = new Set(span.collapsed);
  for (let index = span.start; index <= span.end; index++)
    if (!hidden.has(index)) return false;
  return true;
}

function covered(spans: Span[], index: number): boolean {
  return spans.some((span) => index >= span.start && index <= span.end);
}

function loadCols(xml: string): ColRange[] {
  const block = xml.match(/<(?:\w+:)?cols\b[^>]*>[\s\S]*?<\/(?:\w+:)?cols>/);
  if (!block) return [];
  const ranges: ColRange[] = [];
  for (const tag of block[0].matchAll(
    /<(?:\w+:)?col\b([^>]*?)(?:\/>|>[\s\S]*?<\/(?:\w+:)?col>)/g,
  )) {
    const attrs = parseAttrs(tag[1]!);
    const min = Number(attrs.min);
    const max = Number(attrs.max ?? attrs.min);
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) continue;
    delete attrs.min;
    delete attrs.max;
    ranges.push({ min, max, attrs });
  }
  return ranges;
}

/** Split a covering range so one 1-based column can take its own attributes. */
function carve(ranges: ColRange[], number: number): ColRange {
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    if (number < range.min || number > range.max) continue;
    if (range.min === number && range.max === number) return range;
    const pieces: ColRange[] = [];
    if (range.min < number)
      pieces.push({
        min: range.min,
        max: number - 1,
        attrs: { ...range.attrs },
      });
    const single = { min: number, max: number, attrs: { ...range.attrs } };
    pieces.push(single);
    if (range.max > number)
      pieces.push({
        min: number + 1,
        max: range.max,
        attrs: { ...range.attrs },
      });
    ranges.splice(i, 1, ...pieces);
    return single;
  }
  const created = { min: number, max: number, attrs: {} };
  ranges.push(created);
  return created;
}

function mergeRanges(ranges: ColRange[]): ColRange[] {
  const sorted = [...ranges].sort((a, b) => a.min - b.min || a.max - b.max);
  const merged: ColRange[] = [];
  for (const range of sorted) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.max + 1 === range.min &&
      sameAttrs(prev.attrs, range.attrs)
    )
      prev.max = range.max;
    else merged.push({ min: range.min, max: range.max, attrs: { ...range.attrs } });
  }
  return merged;
}

function writeCols(xml: string, ranges: ColRange[]): string {
  const cols = `<cols>${mergeRanges(ranges)
    .map((range) => {
      const rest = emitAttrs(range.attrs);
      return `<col min="${range.min}" max="${range.max}"${rest ? ` ${rest}` : ""}/>`;
    })
    .join("")}</cols>`;
  if (/<(?:\w+:)?cols\b[^>]*>[\s\S]*?<\/(?:\w+:)?cols>/.test(xml))
    return xml.replace(/<(?:\w+:)?cols\b[^>]*>[\s\S]*?<\/(?:\w+:)?cols>/, cols);
  if (/<(?:\w+:)?cols\b[^>]*\/>/.test(xml))
    return xml.replace(/<(?:\w+:)?cols\b[^>]*\/>/, cols);
  return xml.replace(/<(?:\w+:)?sheetData\b/, (match) => `${cols}${match}`);
}

function patchColumns(xml: string, columns: Span[]): string {
  if (!columns.length) return xml;
  const ranges = loadCols(xml);
  for (const span of columns) {
    const hidden = new Set(span.collapsed);
    for (let index = span.start; index <= span.end; index++) {
      const column = carve(ranges, index + 1);
      column.attrs.outlineLevel = "1";
      if (hidden.has(index) && !flag(column.attrs.hidden))
        column.attrs.hidden = "1";
    }
    const summary = span.start - 1;
    if (isFull(span) && summary >= 0 && !covered(columns, summary)) {
      const column = carve(ranges, summary + 1);
      column.attrs.collapsed = "1";
    }
  }
  return writeCols(xml, ranges);
}

function insertRow(xml: string, rowNumber: number, attrs: Attrs): string {
  const tag = `<row ${emitAttrs({ r: String(rowNumber), ...attrs })}/>`;
  if (xml.includes("<sheetData/>") && !xml.includes("</sheetData>"))
    return xml.replace("<sheetData/>", `<sheetData>${tag}</sheetData>`);
  const re = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>)/g;
  let insertAt = xml.indexOf("</sheetData>");
  if (insertAt < 0) return xml;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const existing = Number(parseAttrs(match[1]!).r);
    if (existing > rowNumber) {
      insertAt = match.index;
      break;
    }
  }
  return xml.slice(0, insertAt) + tag + xml.slice(insertAt);
}

function patchRows(xml: string, rows: Span[]): string {
  if (!rows.length) return xml;
  const patches = new Map<number, Attrs>();
  const touch = (rowNumber: number) => {
    let patch = patches.get(rowNumber);
    if (!patch) patches.set(rowNumber, (patch = {}));
    return patch;
  };
  for (const span of rows) {
    const hidden = new Set(span.collapsed);
    for (let index = span.start; index <= span.end; index++) {
      const patch = touch(index + 1);
      patch.outlineLevel = "1";
      if (hidden.has(index)) patch.hidden = "1";
    }
    const summary = span.start - 1;
    if (isFull(span) && summary >= 0 && !covered(rows, summary))
      touch(summary + 1).collapsed = "1";
  }
  const seen = new Set<number>();
  let next = xml.replace(
    /<(?:\w+:)?row\b([^>]*?)(\/>|>)/g,
    (full, body: string, end: string) => {
      const attrs = parseAttrs(body);
      const rowNumber = Number(attrs.r);
      const patch = patches.get(rowNumber);
      if (!patch) return full;
      seen.add(rowNumber);
      if (patch.outlineLevel) attrs.outlineLevel = patch.outlineLevel;
      if (patch.hidden && !flag(attrs.hidden)) attrs.hidden = "1";
      if (patch.collapsed) attrs.collapsed = "1";
      const prefix = /^(<(?:\w+:)?row)\b/.exec(full)?.[1] ?? "<row";
      return `${prefix} ${emitAttrs(attrs)}${end}`;
    },
  );
  for (const [rowNumber, patch] of [...patches.entries()].sort((a, b) => b[0] - a[0])) {
    if (seen.has(rowNumber)) continue;
    const attrs: Attrs = {};
    if (patch.outlineLevel) attrs.outlineLevel = patch.outlineLevel;
    if (patch.hidden) attrs.hidden = "1";
    if (patch.collapsed) attrs.collapsed = "1";
    next = insertRow(next, rowNumber, attrs);
  }
  return next;
}

function ensureOutlinePr(xml: string): string {
  const outline = '<outlinePr summaryBelow="0" summaryRight="0"/>';
  if (/<(?:\w+:)?outlinePr\b/.test(xml))
    return xml.replace(/<(?:\w+:)?outlinePr\b[^>]*\/?>/, outline);
  if (/<(?:\w+:)?sheetPr\b[^>]*\/>/.test(xml))
    return xml.replace(
      /<(?:\w+:)?sheetPr\b([^>]*)\/>/,
      `<sheetPr$1>${outline}</sheetPr>`,
    );
  if (/<(?:\w+:)?sheetPr\b[^>]*>/.test(xml))
    return xml.replace(/<(?:\w+:)?sheetPr\b[^>]*>/, `$&${outline}`);
  return xml.replace(
    /(<worksheet\b[^>]*>)/,
    `$1<sheetPr>${outline}</sheetPr>`,
  );
}

function ensureFormatLevels(xml: string, rows: boolean, columns: boolean): string {
  const match = xml.match(/<(?:\w+:)?sheetFormatPr\b([^>]*)\/>/);
  const attrs = match ? parseAttrs(match[1]!) : {};
  if (rows) attrs.outlineLevelRow = "1";
  if (columns) attrs.outlineLevelCol = "1";
  const tag = `<sheetFormatPr ${emitAttrs(attrs)}/>`;
  if (match) return xml.replace(match[0], tag);
  return xml.replace(/<(?:\w+:)?(?:cols|sheetData)\b/, (found) => `${tag}${found}`);
}

/** Write SuiteLeaf row and column groups as an Excel outline. No groups leaves the sheet untouched. */
export function applyWorksheetOutline(xml: string, custom: unknown): string {
  const { columns, rows } = groupsOf(custom);
  if (!columns.length && !rows.length) return xml;
  let next = patchColumns(xml, columns);
  next = patchRows(next, rows);
  next = ensureOutlinePr(next);
  next = ensureFormatLevels(next, rows.length > 0, columns.length > 0);
  return next;
}

function summaryBefore(xml: string, axis: "summaryRight" | "summaryBelow"): boolean {
  const tag = xml.match(/<(?:\w+:)?outlinePr\b([^>]*)\/?>/);
  if (!tag) return false;
  const value = parseAttrs(tag[1]!)[axis];
  if (value === undefined) return false;
  return value === "0" || value === "false";
}

function marksFrom(
  xml: string,
  pattern: RegExp,
  indexOf: (attrs: Attrs) => number | null,
): Map<number, Mark> {
  const marks = new Map<number, Mark>();
  for (const tag of xml.matchAll(pattern)) {
    const attrs = parseAttrs(tag[1] ?? "");
    const level = Number(attrs.outlineLevel) || 0;
    const hidden = flag(attrs.hidden);
    const collapsed = flag(attrs.collapsed);
    if (!level && !hidden && !collapsed) continue;
    const index = indexOf(attrs);
    if (index === null || index < 0) continue;
    const previous = marks.get(index);
    marks.set(index, {
      level: Math.max(previous?.level ?? 0, level),
      hidden: hidden || !!previous?.hidden,
      collapsed: collapsed || !!previous?.collapsed,
    });
  }
  return marks;
}

function columnMarks(xml: string): Map<number, Mark> {
  const marks = new Map<number, Mark>();
  const block = xml.match(/<(?:\w+:)?cols\b[^>]*>[\s\S]*?<\/(?:\w+:)?cols>/)?.[0] ?? "";
  for (const tag of block.matchAll(/<(?:\w+:)?col\b([^>]*?)(?:\/>|>)/g)) {
    const attrs = parseAttrs(tag[1]!);
    const min = Number(attrs.min);
    const max = Number(attrs.max ?? attrs.min);
    const level = Number(attrs.outlineLevel) || 0;
    const hidden = flag(attrs.hidden);
    const collapsed = flag(attrs.collapsed);
    if (!Number.isInteger(min) || !Number.isInteger(max) || (!level && !hidden && !collapsed))
      continue;
    for (let number = Math.max(1, min); number <= Math.min(16384, max); number++) {
      const index = number - 1;
      const previous = marks.get(index);
      marks.set(index, {
        level: Math.max(previous?.level ?? 0, level),
        hidden: hidden || !!previous?.hidden,
        collapsed: collapsed || !!previous?.collapsed,
      });
    }
  }
  return marks;
}

function spansFrom(marks: Map<number, Mark>, before: boolean): Array<Span & { maxLevel: number }> {
  const members = [...marks.entries()]
    .filter(([, mark]) => mark.level > 0)
    .sort((a, b) => a[0] - b[0]);
  const spans: Array<Span & { maxLevel: number }> = [];
  let index = 0;
  while (index < members.length) {
    const start = members[index]![0];
    let end = start;
    let maxLevel = members[index]![1].level;
    const hidden: number[] = [];
    if (members[index]![1].hidden) hidden.push(start);
    while (index + 1 < members.length && members[index + 1]![0] === end + 1) {
      index += 1;
      end = members[index]![0];
      maxLevel = Math.max(maxLevel, members[index]![1].level);
      if (members[index]![1].hidden) hidden.push(end);
    }
    const summary = before ? start - 1 : end + 1;
    const whole =
      marks.get(summary)?.collapsed === true || hidden.length === end - start + 1;
    const collapsed = whole
      ? Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
      : hidden;
    spans.push({ start, end, collapsed, maxLevel });
    index += 1;
  }
  return spans;
}

/** Read an Excel outline into SuiteLeaf row and column groups. Hidden columns that are not outlined are ignored. */
export function readWorksheetOutline(xml: string): WorksheetOutline {
  const columnSpans = spansFrom(columnMarks(xml), summaryBefore(xml, "summaryRight"));
  const rowSpans = spansFrom(
    marksFrom(xml, /<(?:\w+:)?row\b([^>]*?)(?:\/>|>)/g, (attrs) => {
      const row = Number(attrs.r);
      return Number.isInteger(row) ? row - 1 : null;
    }),
    summaryBefore(xml, "summaryBelow"),
  );
  return {
    columnGroups: columnSpans.map((span) => ({
      id: `cols-${columnName(span.start)}-${columnName(span.end)}`,
      startColumn: span.start,
      endColumn: span.end,
      collapsed: span.collapsed,
    })),
    rowGroups: rowSpans.map((span) => ({
      id: `rows-${span.start + 1}-${span.end + 1}`,
      startRow: span.start,
      endRow: span.end,
      collapsed: span.collapsed,
    })),
    nested: [...columnSpans, ...rowSpans].some((span) => span.maxLevel > 1),
  };
}
