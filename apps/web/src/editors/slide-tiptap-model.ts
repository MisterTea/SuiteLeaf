import type { JSONContent } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { textRunSchema, type TextRun } from "@suiteleaf/core";

export type SlideTextMetrics = {
  kern?: number; hang?: number; fontFamily?: string; fontSize?: number;
  bold?: boolean; italic?: boolean; lineHeight?: number; lineHeightPt?: number;
  align?: "left" | "center" | "right" | "justify"; nowrap?: boolean;
};

const paragraphKeys = ["listDepth", "listColors", "listFontSizes", "paraMargin", "paraHang", "paraFirst", "paraTab", "paraTabs", "spaceBefore", "paraAlign", "paraDistributed", "paraLine", "paraLinePt"] as const;
export function paragraphAttributes(run: TextRun): Partial<TextRun> {
  return Object.fromEntries(paragraphKeys.filter(key => run[key] !== undefined).map(key => [key, run[key]]));
}

export function safeOfficeRun(value: unknown): TextRun {
  const parsed = textRunSchema.safeParse(value);
  return parsed.success ? parsed.data : { text: "" };
}

function inline(run: TextRun): JSONContent[] {
  const { text, bold, italic, underline, strike, ...office } = run;
  if (run.math || run.fraction) return [{ type: "officeInline", attrs: { run } }];
  const marks = [
    ...(Object.keys(office).length ? [{ type: "officeRun", attrs: { office } }] : []),
    ...(["bold", "italic", "underline", "strike"] as const).filter(key => ({ bold, italic, underline, strike })[key]).map(type => ({ type })),
  ];
  return text.split(/(\n)/).filter(Boolean).map(part => part === "\n"
    ? { type: "hardBreak", marks }
    : { type: "text", text: part, marks });
}

/** Markers are model attributes, never editable characters in the list item. */
export function markerLength(runs: readonly TextRun[]): number {
  const text = runs.map(run => run.text).join("");
  const first = runs.find(run => run.text);
  const ordinary = /^(?:[•●○◦▪■▸►‣]|\d+[.)])\s/.exec(text);
  if (ordinary) return ordinary[0].length;
  if (first && (first.listMarker || first.bulletSrc || first.autoNumber)) return /^\S+\s/.exec(text)?.[0].length ?? first.text.length;
  // Office symbol fonts can encode markers as ASCII letters.
  if (first?.font && /^(?:Wingdings|Webdings|Symbol|SuiteLeaf Sprig)/i.test(first.font)) return /^\S+\s/.exec(text)?.[0].length ?? 0;
  return 0;
}

function splitAt(runs: TextRun[], at: number): [TextRun[], TextRun[]] {
  const left: TextRun[] = [], right: TextRun[] = [];
  let offset = 0;
  for (const run of runs) {
    const split = Math.max(0, Math.min(run.text.length, at - offset));
    if (split) left.push({ ...run, text: run.text.slice(0, split) });
    if (split < run.text.length) right.push({ ...run, text: run.text.slice(split) });
    offset += run.text.length;
  }
  return [left, right];
}

/** Keep Office paragraph metadata separate from inline formatting. */
export function slideRunsToDocument(runs: readonly TextRun[]): JSONContent {
  const paragraphs: { runs: TextRun[]; breakRun: TextRun | null }[] = [{ runs: [], breakRun: null }];
  for (const run of runs) {
    if (run.paragraphBreak && run.text === "\n") paragraphs.push({ runs: [], breakRun: run });
    else {
      // Legacy typed lists store their item boundaries as ordinary newlines.
      const parts = run.text.split(/(\n)/);
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] === "\n" && markerLength([{ ...run, text: parts.slice(i + 1).join("") }])) paragraphs.push({ runs: [], breakRun: { text: "\n", paragraphBreak: true } });
        else if (parts[i]) paragraphs.at(-1)!.runs.push({ ...run, text: parts[i] });
      }
    }
  }
  const content: JSONContent[] = [];
  const stack: { depth: number; list: JSONContent; last: JSONContent }[] = [];
  for (const { runs: words, breakRun } of paragraphs) {
    const length = markerLength(words);
    const [marker, body] = splitAt(words, length);
    const stamp = breakRun ?? words[0] ?? { text: "" };
    const office = paragraphAttributes(stamp);
    const p: JSONContent = { type: "paragraph", attrs: { office, breakRun, marker: length ? marker : null }, content: (length ? body : words).flatMap(inline) };
    if (!length) { stack.length = 0; content.push(p); continue; }
    const ordered = /^\d+[.)]\s/.test(marker.map(run => run.text).join(""));
    const type = ordered ? "orderedList" : "bulletList";
    const depth = stamp.listDepth ?? 0;
    while (stack.length && stack.at(-1)!.depth > depth) stack.pop();
    let current = stack.at(-1);
    if (!current || current.depth < depth || current.list.type !== type) {
      const list: JSONContent = { type, attrs: { officeBaseDepth: depth, ...(ordered ? { start: parseInt(marker.map(run => run.text).join(""), 10) } : {}) }, content: [] };
      if (current && current.depth < depth) current.last.content!.push(list);
      else {
        if (current) stack.pop();
        const parent = stack.at(-1);
        (parent ? parent.last.content! : content).push(list);
      }
      current = { depth, list, last: {} };
      stack.push(current);
    }
    const item: JSONContent = { type: "listItem", content: [p] };
    current.list.content!.push(item);
    current.last = item;
  }
  return { type: "doc", content };
}

function runOf(node: ProseNode): TextRun {
  if (node.type.name === "officeInline") return safeOfficeRun(node.attrs.run);
  const office = node.marks.find(mark => mark.type.name === "officeRun")?.attrs.office ?? {};
  return { ...office, text: node.isText ? node.text! : "\n", ...Object.fromEntries(node.marks.filter(mark => ["bold", "italic", "underline", "strike"].includes(mark.type.name)).map(mark => [mark.type.name, true])) };
}

export type SlideParagraph = { node: ProseNode; pos: number; depth: number; list: boolean; start: number; marker: TextRun[]; runs: TextRun[] };

/** One mapping serves persistence, toolbar selections, undo and the live caret. */
export function slideParagraphs(doc: ProseNode): SlideParagraph[] {
  const result: SlideParagraph[] = [];
  let offset = 0;
  const visit = (node: ProseNode, pos: number, depth: number, list: boolean, ordinal: number | null = null) => {
    if (node.type.name === "paragraph") {
      let marker: TextRun[] = list ? node.attrs.marker ?? [{ text: ordinal == null ? "• " : `${ordinal}. ` }] : [];
      if (ordinal != null && /^\d+[.)]\s/.test(marker.map(run => run.text).join(""))) {
        const prefix = marker.map(run => run.text).join("").replace(/^\d+/, String(ordinal));
        const autoNumber = marker[0].autoNumber;
        marker = [{ ...marker[0], text: prefix, ...(autoNumber ? { autoNumber: { ...autoNumber, prefix: prefix.trimEnd(), level: Math.max(0, depth) } } : {}) }];
      }
      const runs: TextRun[] = [];
      node.forEach(child => runs.push(runOf(child)));
      if (result.length) offset++;
      result.push({ node, pos, depth: Math.max(0, depth), list, start: offset, marker, runs });
      offset += [...marker, ...runs].reduce((n, run) => n + run.text.length, 0);
      return;
    }
    const isList = node.type.name === "bulletList" || node.type.name === "orderedList";
    const base = node.type.name === "listItem" ? depth + (node.attrs.officeDepthOffset ?? 0)
      : isList && depth < 0 ? (node.attrs.officeBaseDepth ?? 0) - 1 : depth;
    node.forEach((child, childOffset, index) => visit(child, pos + childOffset + (node.type.name === "doc" ? 0 : 1), base + (isList ? 1 : 0), isList || node.type.name === "listItem" && list,
      node.type.name === "orderedList" ? (node.attrs.start ?? 1) + index : node.type.name === "listItem" && !index ? ordinal : null));
  };
  visit(doc, 0, -1, false);
  return result;
}

export function slideDocumentToRuns(doc: ProseNode): TextRun[] {
  return slideParagraphs(doc).flatMap((p, index) => {
    const office: Partial<TextRun> = { ...p.node.attrs.office };
    // Indentation commands change structure; retain the imported gutter at its base level.
    if (p.list) {
      const original = office.listDepth ?? 0;
      office.paraMargin = Math.max(0, (office.paraMargin ?? 0) + (p.depth - original) * 36) || undefined;
      office.listDepth = p.depth;
    } else {
      delete office.listDepth;
    }
    const words = [...p.marker, ...p.runs];
    if (index) return [{ ...(p.node.attrs.breakRun ?? {}), ...office, text: "\n", paragraphBreak: true }, ...words];
    if (!words.length) return Object.keys(office).length ? [{ ...office, text: "" }] : [];
    return [{ ...words[0], ...office }, ...words.slice(1)];
  });
}

export function authoredOffset(doc: ProseNode, position: number): number {
  const paragraphs = slideParagraphs(doc);
  const p = [...paragraphs].reverse().find(p => position >= p.pos) ?? paragraphs[0];
  if (!p) return 0;
  let value = p.start + p.marker.reduce((n, run) => n + run.text.length, 0);
  let cursor = p.pos + 1;
  p.node.forEach(child => {
    if (position > cursor) value += child.isText ? Math.min(child.nodeSize, position - cursor) : runOf(child).text.length;
    cursor += child.nodeSize;
  });
  return value;
}

export function documentPosition(doc: ProseNode, offset: number): number {
  const paragraphs = slideParagraphs(doc);
  const p = [...paragraphs].reverse().find(p => offset >= p.start) ?? paragraphs[0];
  if (!p) return 0;
  let remaining = Math.max(0, offset - p.start - p.marker.reduce((n, run) => n + run.text.length, 0));
  let pos = p.pos + 1;
  p.node.forEach(child => {
    if (!remaining) return;
    const count = runOf(child).text.length;
    pos += child.isText ? Math.min(remaining, count) : child.nodeSize;
    remaining = Math.max(0, remaining - count);
  });
  return pos;
}
