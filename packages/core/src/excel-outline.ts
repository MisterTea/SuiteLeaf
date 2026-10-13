import { columnName } from "./index";

/**
 * SuiteLeaf groups are the detail rows and columns. The label stays to the
 * left and the total stays above, so exported outlines use summaryRight="0"
 * and summaryBelow="0". Excel's own default puts the summary after the
 * detail; import honors whichever side outlinePr names.
 * Row and column groups keep every outline level, so a week at level 2
 * stays inside the month or quarter at level 1.
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
  /** True when an outline level was not kept as its own group. */
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

/**
 * A fully collapsed inner group that starts on the same column as a larger
 * open group must not set the shared summary flag. That flag would collapse
 * the outer group on the way back in. Hidden columns already record the
 * inner group.
 */
function markCollapsedSummary(span: Span, spans: Span[]): boolean {
  if (!isFull(span) || span.start <= 0) return false;
  return !spans.some(
    (other) =>
      other.start === span.start && other.end > span.end && !isFull(other),
  );
}

function patchColumns(xml: string, columns: Span[]): string {
  if (!columns.length) return xml;
  const ranges = loadCols(xml);
  const levelAt = new Map<number, number>();
  for (const span of columns)
    for (let index = span.start; index <= span.end; index++)
      levelAt.set(index, (levelAt.get(index) ?? 0) + 1);
  for (const span of columns) {
    const hidden = new Set(span.collapsed);
    for (let index = span.start; index <= span.end; index++) {
      const column = carve(ranges, index + 1);
      column.attrs.outlineLevel = String(levelAt.get(index) ?? 1);
      if (hidden.has(index)) column.attrs.hidden = "1";
    }
    const summary = span.start - 1;
    if (markCollapsedSummary(span, columns)) {
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
  const levelAt = new Map<number, number>();
  for (const span of rows)
    for (let index = span.start; index <= span.end; index++)
      levelAt.set(index, (levelAt.get(index) ?? 0) + 1);
  for (const span of rows) {
    const hidden = new Set(span.collapsed);
    for (let index = span.start; index <= span.end; index++) {
      const patch = touch(index + 1);
      patch.outlineLevel = String(levelAt.get(index) ?? 1);
      if (hidden.has(index)) patch.hidden = "1";
    }
    const summary = span.start - 1;
    if (isFull(span) && summary >= 0) touch(summary + 1).collapsed = "1";
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

function outlineDepth(spans: Span[]): number {
  const events: { at: number; delta: number }[] = [];
  for (const span of spans) {
    events.push({ at: span.start, delta: 1 });
    events.push({ at: span.end + 1, delta: -1 });
  }
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let depth = 0;
  let max = 0;
  for (const event of events) {
    depth += event.delta;
    if (depth > max) max = depth;
  }
  return max;
}

function ensureFormatLevels(xml: string, rowLevel: number, columnLevel: number): string {
  const match = xml.match(/<(?:\w+:)?sheetFormatPr\b([^>]*)\/>/);
  const attrs = match ? parseAttrs(match[1]!) : {};
  if (rowLevel > 0) attrs.outlineLevelRow = String(rowLevel);
  if (columnLevel > 0) attrs.outlineLevelCol = String(columnLevel);
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
  next = ensureFormatLevels(next, outlineDepth(rows), outlineDepth(columns));
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

/** One group per outline level, so a week inside a month or quarter stays its own span. */
function nestedSpans(marks: Map<number, Mark>, before: boolean): Array<Span & { level: number }> {
  let maxLevel = 0;
  for (const mark of marks.values()) if (mark.level > maxLevel) maxLevel = mark.level;
  const spans: Array<Span & { level: number }> = [];
  for (let level = 1; level <= maxLevel; level++) {
    const members = [...marks.entries()]
      .filter(([, mark]) => mark.level >= level)
      .sort((a, b) => a[0] - b[0]);
    let index = 0;
    while (index < members.length) {
      const start = members[index]![0];
      let end = start;
      while (index + 1 < members.length && members[index + 1]![0] === end + 1) {
        index += 1;
        end = members[index]![0];
      }
      spans.push({
        start,
        end,
        collapsed: collapsedAtLevel(marks, start, end, level, before),
        level,
      });
      index += 1;
    }
  }
  return spans.sort((a, b) => a.start - b.start || b.end - a.end || a.level - b.level);
}

function collapsedAtLevel(
  marks: Map<number, Mark>,
  start: number,
  end: number,
  level: number,
  before: boolean,
): number[] {
  const summary = before ? start - 1 : end + 1;
  const exactHidden: number[] = [];
  let allHidden = true;
  for (let index = start; index <= end; index++) {
    const mark = marks.get(index);
    const hidden = !!mark?.hidden;
    if (!hidden) allHidden = false;
    if (mark && mark.level === level && hidden) exactHidden.push(index);
  }
  if (marks.get(summary)?.collapsed === true || allHidden)
    return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
  return exactHidden;
}

function rowGroupId(start: number, end: number, used: Set<string>): string {
  const base = `rows-${start + 1}-${end + 1}`;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let level = 2;
  while (used.has(`${base}-l${level}`)) level += 1;
  const id = `${base}-l${level}`;
  used.add(id);
  return id;
}

/** True when an outline level is deeper than the groups that contain it. */
function levelsFlattened(marks: Map<number, Mark>, spans: Span[]): boolean {
  for (const [index, mark] of marks) {
    if (mark.level <= 0) continue;
    let depth = 0;
    for (const span of spans) if (index >= span.start && index <= span.end) depth += 1;
    if (depth !== mark.level) return true;
  }
  return false;
}

function columnGroupId(start: number, end: number, used: Set<string>): string {
  const base = `cols-${columnName(start)}-${columnName(end)}`;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let level = 2;
  while (used.has(`${base}-l${level}`)) level += 1;
  const id = `${base}-l${level}`;
  used.add(id);
  return id;
}

/** Read an Excel outline into SuiteLeaf row and column groups. Hidden columns that are not outlined are ignored. */
export function readWorksheetOutline(xml: string): WorksheetOutline {
  const columns = columnMarks(xml);
  const columnSpans = nestedSpans(columns, summaryBefore(xml, "summaryRight"));
  const rowMarks = marksFrom(xml, /<(?:\w+:)?row\b([^>]*?)(?:\/>|>)/g, (attrs) => {
    const row = Number(attrs.r);
    return Number.isInteger(row) ? row - 1 : null;
  });
  const rowSpans = nestedSpans(rowMarks, summaryBefore(xml, "summaryBelow"));
  const usedColumnIds = new Set<string>();
  const usedRowIds = new Set<string>();
  return {
    columnGroups: columnSpans.map((span) => ({
      id: columnGroupId(span.start, span.end, usedColumnIds),
      startColumn: span.start,
      endColumn: span.end,
      collapsed: span.collapsed,
    })),
    rowGroups: rowSpans.map((span) => ({
      id: rowGroupId(span.start, span.end, usedRowIds),
      startRow: span.start,
      endRow: span.end,
      collapsed: span.collapsed,
    })),
    nested: levelsFlattened(columns, columnSpans) || levelsFlattened(rowMarks, rowSpans),
  };
}
