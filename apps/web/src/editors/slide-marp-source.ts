import { Marp } from "@marp-team/marp-core";
import { createFile, type Presentation, type SlideFile } from "@suiteleaf/core";
import { marpToDeck } from "./slide-marp";

/** First line and the line after the last, counted from 0. */
export type LineRange = [number, number];

export type MarpComment = { lines: LineRange; text: string; directive: boolean };

export type MarpSlideSource = {
  /** The `---` line that starts this slide. The first slide has none. */
  rule: number | null;
  lines: LineRange;
  comments: MarpComment[];
  /** HTML blocks that open and close every tag they use, so they can be moved or deleted whole. */
  html: LineRange[];
};

export type MarpSourceMap = {
  lines: string[];
  front: LineRange | null;
  slides: MarpSlideSource[];
};

export type StyledText = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
};

type Wrap = { tag: string; underline: boolean; color?: string };

const VOID_TAGS = new Set(["br", "img", "hr", "wbr", "input", "source"]);

/** What an inline HTML tag does to the words inside it, or a closing tag's name. */
function readTag(html: string): { close: string } | { open: Wrap } | null {
  const close = /^<\/([a-z][\w-]*)\s*>$/i.exec(html);
  if (close) return { close: close[1].toLowerCase() };
  const open = /^<([a-z][\w-]*)\b([^>]*?)(\/?)>$/i.exec(html);
  if (!open || open[3] || VOID_TAGS.has(open[1].toLowerCase())) return null;
  const tag = open[1].toLowerCase();
  const attrs = open[2];
  const style = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  const css = style?.[1] ?? style?.[2] ?? "";
  const underline =
    tag === "u" || tag === "ins" || /text-decoration(?:-line)?\s*:[^;]*\bunderline\b/i.test(css);
  const color =
    /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(css)?.[1]?.trim() ??
    (tag === "font" ? /\bcolor\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] : undefined);
  return { open: { tag, underline, ...(color ? { color } : {}) } };
}

const INLINE_STYLE = new Set(["color", "text-decoration", "text-decoration-line"]);

/** Whether the sync can write this tag itself: <u>, <ins>, <br>, <font color>, or a span that only sets color or underline. */
function knownTag(tag: string) {
  if (/^<\/?(u|ins|br|span|font)\s*\/?>$/i.test(tag)) return true;
  if (/^<font\s+color\s*=\s*["']?[^"'\s>]+["']?\s*>$/i.test(tag)) return true;
  const span = /^<span\s+style\s*=\s*(?:"([^"]*)"|'([^']*)')\s*>$/i.exec(tag);
  if (!span) return false;
  return (span[1] ?? span[2] ?? "")
    .split(";")
    .map((rule) => rule.split(":")[0]?.trim().toLowerCase())
    .filter(Boolean)
    .every((name) => INLINE_STYLE.has(name));
}

/** Inline HTML the sync cannot write, which must survive any rewrite of its line. */
export function unknownTags(text: string): string[] {
  return [...text.matchAll(/(?<!\\)<\/?[a-zA-Z][\w-]*(?=[\s/>])[^>]*>/g)]
    .map((match) => match[0].replace(/\s+/g, " "))
    .filter((tag) => !knownTag(tag))
    .sort();
}

/** A paragraph written entirely as HTML the editor cannot write, such as an inline SVG. */
export function isHtmlOnly(segment: string): boolean {
  const text = segment.trim();
  return /^<[a-zA-Z]/.test(text) && />$/.test(text) && unknownTags(text).length > 0;
}

/** A color written as #rgb, #rrggbb, or rgb(), as #rrggbb. Names stay as written. */
export function colorKey(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const value = color.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value);
  if (rgb)
    return `#${rgb
      .slice(1, 4)
      .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0"))
      .join("")}`;
  return value;
}

/** One line a box shows: a heading, paragraph, list item, or quote. */
export type MarpUnit = {
  kind: "heading" | "paragraph" | "item" | "quote";
  lines: LineRange;
  /** What comes before the words on the first line, such as `## ` or `  1. `. */
  prefix: string;
  runs: StyledText[];
};

type Token = {
  type: string;
  tag: string;
  nesting: number;
  level: number;
  map: LineRange | null;
  content: string;
  markup: string;
  hidden: boolean;
  children: Token[] | null;
  meta: { marpitCommentParsed?: string } | null;
};

type Parser = { parse(source: string, env: object): Token[] };

let parser: Parser | null = null;
function markdown(): Parser {
  if (!parser) parser = new Marp({ html: true, math: "katex" }).markdown as unknown as Parser;
  return parser;
}

const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function normalizeMarp(markdown: string): string {
  return markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

let cached: { source: string; map: MarpSourceMap } | null = null;

/** Where each slide, comment, and the front matter sit in the markdown, split the way MARP splits it. */
export function mapMarpSource(source: string): MarpSourceMap {
  if (cached?.source === source) return cached.map;
  const tokens = markdown().parse(source, {});
  const lines = source.split("\n");
  let front: LineRange | null = null;
  const opens: LineRange[] = [];
  const slides: MarpSlideSource[] = [];
  let current: MarpSlideSource | null = null;
  let level = -1;
  for (const token of tokens) {
    if (token.type === "html_block" && current && token.map) {
      if (!tagProblem(token.content.split("\n"), 0, ALL_TAGS))
        current.html.push(trimBlankLines(lines, [token.map[0], token.map[1]]));
      continue;
    }
    if (token.type === "marpit_slide_open") {
      current = { rule: null, lines: [0, 0], comments: [], html: [] };
      slides.push(current);
      opens.push(token.map ?? [0, 1]);
      level = token.level + 1;
      continue;
    }
    if (token.type === "marpit_slide_close") {
      current = null;
      continue;
    }
    if (!current || token.level !== level || !token.map) continue;
    if (token.type === "front_matter") front = [token.map[0], token.map[1]];
    else if (token.type === "marpit_comment")
      current.comments.push({
        lines: [token.map[0], token.map[1]],
        text: token.content.trim(),
        directive: token.meta?.marpitCommentParsed === "directive",
      });
  }
  slides.forEach((slide, i) => {
    const at = opens[i][0];
    if (i > 0 && RULE.test(lines[at] ?? "")) slide.rule = at;
  });
  slides.forEach((slide, i) => {
    const start =
      i === 0 ? (front ? front[1] : 0) : slide.rule !== null ? slide.rule + 1 : opens[i][0];
    const next = slides[i + 1];
    const end = next ? (next.rule ?? opens[i + 1][0]) : lines.length;
    slide.lines = [start, Math.max(start, end)];
  });
  const map = { lines, front, slides };
  cached = { source, map };
  return map;
}

function withoutCode(line: string) {
  return line.replace(/`[^`]*`/g, "");
}

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
/** HTML lets these close themselves, so a missing end tag is not a mistake. */
const OPTIONAL_END = new Set(["p", "li", "dt", "dd", "tr", "td", "th", "thead", "tbody", "tfoot", "option", "colgroup", "rt", "rp"]);
/** Containers whose missing end tag swallows the rest of the slide. */
const BLOCK_TAGS = new Set([
  "article",
  "aside",
  "audio",
  "blockquote",
  "canvas",
  "details",
  "div",
  "figure",
  "figcaption",
  "footer",
  "header",
  "main",
  "nav",
  "section",
  "summary",
  "svg",
  "table",
  "video",
]);
const ALL_TAGS = null;
const TAG = /(?<!\\)<(\/?)([a-zA-Z][\w-]*)(?=[\s/>])[^>]*?(\/?)>/g;

/**
 * The first HTML tag in these lines that is never closed, or closed without
 * being opened. Code and comments are skipped. `names` limits which tags count.
 */
export function tagProblem(lines: string[], first: number, names: Set<string> | null): string | null {
  const open: { name: string; line: number }[] = [];
  let fence: string | null = null;
  let comment = false;
  for (let i = 0; i < lines.length; i++) {
    const fenceMark = FENCE.exec(lines[i])?.[1];
    if (fence) {
      if (fenceMark && fenceMark[0] === fence[0] && fenceMark.length >= fence.length) fence = null;
      continue;
    }
    if (fenceMark && !comment) {
      fence = fenceMark;
      continue;
    }
    let text = withoutCode(lines[i]);
    if (comment) {
      const end = text.indexOf("-->");
      if (end < 0) continue;
      comment = false;
      text = text.slice(end + 3);
    }
    text = text.replace(/<!--[\s\S]*?-->/g, "");
    const start = text.indexOf("<!--");
    if (start >= 0) {
      comment = true;
      text = text.slice(0, start);
    }
    for (const match of text.matchAll(TAG)) {
      const name = match[2].toLowerCase();
      if (match[3] || VOID_ELEMENTS.has(name) || OPTIONAL_END.has(name)) continue;
      if (names && !names.has(name)) continue;
      if (!match[1]) {
        open.push({ name, line: first + i });
        continue;
      }
      const at = open.map((tag) => tag.name).lastIndexOf(name);
      if (at < 0) return `The </${name}> on line ${first + i + 1} has no opening <${name}>.`;
      if (at < open.length - 1) {
        const inner = open[open.length - 1];
        return `The <${inner.name}> on line ${inner.line + 1} is never closed.`;
      }
      open.pop();
    }
  }
  const left = open[open.length - 1];
  return left ? `The <${left.name}> on line ${left.line + 1} is never closed.` : null;
}

const EMPTY_DECK: Presentation = (() => {
  const file = createFile("slide", "Check") as SlideFile;
  return { ...file.content, slideOrder: [], slides: {} };
})();

let checked: { source: string; problem: string | null } | null = null;

/** Why this markdown cannot become a presentation, or null when it can. */
export function marpProblem(markdown: string): string | null {
  const source = normalizeMarp(markdown);
  if (checked?.source === source) return checked.problem;
  const problem = findProblem(source);
  checked = { source, problem };
  return problem;
}

function findProblem(source: string): string | null {
  const lines = source.split("\n");
  let fence: { mark: string; line: number } | null = null;
  let comment: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      const close = FENCE.exec(line);
      if (
        close &&
        close[1][0] === fence.mark[0] &&
        close[1].length >= fence.mark.length &&
        !line.slice(close.index + close[0].length).trim()
      )
        fence = null;
      continue;
    }
    let rest = withoutCode(line);
    if (comment !== null) {
      const end = rest.indexOf("-->");
      if (end < 0) continue;
      comment = null;
      rest = rest.slice(end + 3);
    }
    if (comment === null) {
      const open = FENCE.exec(line);
      if (open) {
        fence = { mark: open[1], line: i };
        continue;
      }
      const unclosed = rest.replace(/<!--[\s\S]*?-->/g, "").indexOf("<!--");
      if (unclosed >= 0) comment = i;
    }
  }
  if (fence)
    return `The code block that starts on line ${fence.line + 1} is never closed with ${fence.mark}.`;
  if (comment !== null)
    return `The comment that starts on line ${comment + 1} is never closed with -->.`;
  const parsed = marpToDeck(source, EMPTY_DECK, { marp: true });
  if ("error" in parsed) return parsed.error;
  let map: MarpSourceMap;
  try {
    map = mapMarpSource(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  for (const slide of map.slides) {
    const problem = tagProblem(map.lines.slice(slide.lines[0], slide.lines[1]), slide.lines[0], BLOCK_TAGS);
    if (problem) return problem;
  }
  return null;
}

function inlineRuns(children: Token[]): StyledText[] {
  const runs: StyledText[] = [];
  let bold = 0;
  let italic = 0;
  const wraps: Wrap[] = [];
  const push = (text: string) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    const underline = wraps.some((wrap) => wrap.underline);
    const color = colorKey([...wraps].reverse().find((wrap) => wrap.color)?.color);
    const style = { bold: bold > 0, italic: italic > 0, underline, color };
    if (
      last &&
      !!last.bold === style.bold &&
      !!last.italic === style.italic &&
      !!last.underline === underline &&
      last.color === color
    ) {
      last.text += text;
      return;
    }
    runs.push({
      text,
      ...(style.bold ? { bold: true } : {}),
      ...(style.italic ? { italic: true } : {}),
      ...(underline ? { underline: true } : {}),
      ...(color ? { color } : {}),
    });
  };
  for (const child of children) {
    switch (child.type) {
      case "strong_open":
        bold++;
        break;
      case "strong_close":
        bold--;
        break;
      case "em_open":
        italic++;
        break;
      case "em_close":
        italic--;
        break;
      case "text":
      case "code_inline":
        push(child.content);
        break;
      case "softbreak":
        push(" ");
        break;
      case "hardbreak":
        push("\n");
        break;
      case "html_inline": {
        if (/^<br\s*\/?>$/i.test(child.content)) {
          push("\n");
          break;
        }
        const tag = readTag(child.content);
        if (tag && "open" in tag) wraps.push(tag.open);
        else if (tag) {
          const at = wraps.map((wrap) => wrap.tag).lastIndexOf(tag.close);
          if (at >= 0) wraps.splice(at, 1);
        }
        break;
      }
      case "marp_math_inline":
        push(`$${child.content}$`);
        break;
      default:
        break;
    }
  }
  return runs;
}

function joinRuns(into: StyledText[], more: StyledText[]) {
  if (into.length && more.length) into.push({ text: " " });
  into.push(...more);
}

/**
 * The lines a run of markdown shows, in order. A list item does not include
 * the items nested under it; those are units of their own.
 */
export function markdownUnits(segment: string): MarpUnit[] {
  const lines = segment.split("\n");
  const units: MarpUnit[] = [];
  const items: MarpUnit[] = [];
  let quote: MarpUnit | null = null;
  let quoteDepth = 0;
  let pending: MarpUnit | null = null;
  for (const token of markdown().parse(segment, {})) {
    if (token.type === "blockquote_open") {
      quoteDepth++;
      if (quoteDepth === 1 && !items.length && token.map) {
        const prefix = /^\s*(?:>\s?)+/.exec(lines[token.map[0]] ?? "")?.[0] ?? "> ";
        quote = { kind: "quote", lines: [token.map[0], token.map[1]], prefix, runs: [] };
        units.push(quote);
      }
      continue;
    }
    if (token.type === "blockquote_close") {
      quoteDepth--;
      if (quoteDepth === 0) quote = null;
      continue;
    }
    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      const parent = items[items.length - 1];
      if (parent && token.map && parent.lines[1] > token.map[0]) parent.lines[1] = token.map[0];
      continue;
    }
    if (token.type === "list_item_open" && token.map && !quote) {
      const prefix =
        /^\s*(?:[-*+]|\d+[.)])(?:[ \t]+|$)/.exec(lines[token.map[0]] ?? "")?.[0] ?? "- ";
      const unit: MarpUnit = { kind: "item", lines: [token.map[0], token.map[1]], prefix, runs: [] };
      items.push(unit);
      units.push(unit);
      continue;
    }
    if (token.type === "list_item_close" && !quote) {
      items.pop();
      continue;
    }
    if (token.type === "heading_open" && token.map && !quote && !items.length) {
      const level = Number(token.tag.slice(1)) || 1;
      const atx = /^\s*#{1,6}(?:[ \t]+|$)/.exec(lines[token.map[0]] ?? "")?.[0];
      pending = {
        kind: "heading",
        lines: [token.map[0], token.map[1]],
        prefix: atx ?? `${"#".repeat(level)} `,
        runs: [],
      };
      units.push(pending);
      continue;
    }
    if (token.type === "paragraph_open" && token.map && !quote && !items.length) {
      pending = { kind: "paragraph", lines: [token.map[0], token.map[1]], prefix: "", runs: [] };
      units.push(pending);
      continue;
    }
    if (token.type !== "inline" || !token.children) continue;
    const runs = inlineRuns(token.children);
    const owner = quote ?? items[items.length - 1] ?? pending;
    if (owner) joinRuns(owner.runs, runs);
    pending = null;
  }
  for (const unit of units) unit.lines = trimBlankLines(lines, unit.lines);
  return units;
}

/** A range without the blank lines markdown-it counts after a list item or quote. */
export function trimBlankLines(lines: string[], range: LineRange): LineRange {
  let end = range[1];
  while (end > range[0] + 1 && !lines[end - 1]?.trim()) end--;
  return [range[0], end];
}

/** Text with list markers and indents taken off each line and spaces collapsed, for comparing. */
export function comparableText(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:[•◦▪\-*+]|\d+[.)])\s+/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

/** The text a run of markdown shows, as the boxes on the slide show it. */
export function markdownText(segment: string): string {
  return comparableText(
    markdownUnits(segment)
      .map((unit) => unit.runs.map((run) => run.text).join(""))
      .join("\n"),
  );
}
