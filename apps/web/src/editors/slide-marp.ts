import {
  createFile,
  slideThemeSchema,
  type Presentation,
  type Slide,
  type SlideElement,
  type SlideFile,
  type SlideTheme,
} from "@suiteleaf/core";
import { applyLayout, newSlide, type Layout } from "./slide-layouts";
import {
  DECK_THEMES,
  applyDeckTheme,
  layoutWithTheme,
  paintSlide,
  slideFromTheme,
} from "./slide-theme";

export type MarpSuccess = { deck: Presentation; warnings: string[] };
export type MarpFailure = { error: string };

const SLOT_COUNT: Record<Layout, number> = {
  title: 2,
  "title-body": 2,
  "two-column": 3,
  section: 1,
  blank: 0,
};

const CLASS_LAYOUT: Record<string, Layout> = {
  title: "title",
  lead: "title",
  "title-body": "title-body",
  section: "section",
  "two-column": "two-column",
  blank: "blank",
};

const THEME_FIELDS = [
  "id",
  "name",
  "background",
  "headingColor",
  "bodyColor",
  "accent",
  "headingFont",
  "bodyFont",
] as const;

type SlotSpec = { text: string; bullet: boolean };
type Piece =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };
type ThemeInput =
  | { kind: "absent" }
  | { kind: "name"; name: string }
  | { kind: "object"; fields: Record<string, string> };
type ParsedSlide = {
  layout: Layout;
  slots: SlotSpec[];
  notes: string;
  pinnedColor?: string;
  /** Objects on this slide are placed by hand, so the markdown does not list them. */
  freeform?: boolean;
  images?: { alt: string; src: string }[];
};

/** A slide markdown can round-trip without leaving shapes or free text behind. */
export function slideIsMarpClean(slide: Slide): boolean {
  if (!slide.layout) return false;
  return slide.elements.every(
    (el) => el.type === "text" && el.placeholder !== undefined,
  );
}

/** What the markdown pane says about a slide it cannot fully describe. */
export function marpSlideNotice(slide: Slide): string | null {
  if (slideIsMarpClean(slide)) return null;
  const hasSlots = slide.elements.some(
    (el) => el.type === "text" && el.placeholder !== undefined,
  );
  return hasSlots
    ? "Markdown is editing this slide's text and keeping its other objects."
    : "This slide's objects stay where they were placed. Markdown does not list them.";
}

/** A new presentation whose slides are a single column or two columns. */
export function createMarpFile(title = "Untitled presentation"): SlideFile {
  const file = createFile("slide", title) as SlideFile;
  const id = file.content.slideOrder[0];
  const slide = newSlide("title-body");
  slide.id = id;
  file.content.marp = true;
  file.content.slides = { [id]: slide };
  return file;
}

/** The layout title stays put. Other text and pictures can be reordered around it. */
export function isMarpTitle(el: SlideElement): boolean {
  if (el.type !== "text") return false;
  const placeholder = (el.placeholder ?? "").toLowerCase();
  return placeholder.includes("title") && !placeholder.includes("subtitle");
}

function byReadingOrder(a: SlideElement, b: SlideElement) {
  if (a.y !== b.y) return a.y - b.y;
  return a.x - b.x;
}

function inRightColumn(el: SlideElement, width: number) {
  return el.x + el.width / 2 > width / 2;
}

/** Content under the title, left column then right column, top to bottom. */
export function marpColumns(
  slide: Slide,
  width = 960,
): [SlideElement[], SlideElement[]] {
  const items = slide.elements.filter((el) => !isMarpTitle(el));
  if (slide.layout !== "two-column") return [items.sort(byReadingOrder), []];
  return [
    items.filter((el) => !inRightColumn(el, width)).sort(byReadingOrder),
    items.filter((el) => inRightColumn(el, width)).sort(byReadingOrder),
  ];
}

const MARP_MARGIN = 48;
const MARP_GAP = 12;
const MARP_TITLE_TOP = 36;
const MARP_CONTENT_TOP = 130;

function stacked(items: SlideElement[], x: number, columnWidth: number) {
  let y = MARP_CONTENT_TOP;
  return items.map((el) => {
    const height =
      el.type === "image"
        ? Math.max(64, el.height)
        : Math.max(72, Math.min(el.height || 120, 280));
    const next = { ...el, x, y, width: columnWidth, height };
    y += height + MARP_GAP;
    return next;
  });
}

/** Snap every item into the column flow. Array order within a column is the reading order. */
export function reflowMarp(slide: Slide, width = 960, _height = 540): Slide {
  const title = slide.elements.find(isMarpTitle);
  const items = slide.elements.filter((el) => !isMarpTitle(el));
  const two = slide.layout === "two-column";
  const left = two ? items.filter((el) => !inRightColumn(el, width)) : items;
  const right = two ? items.filter((el) => inRightColumn(el, width)) : [];
  const inner = Math.max(120, width - MARP_MARGIN * 2);
  const columnWidth = two ? Math.round((inner - MARP_GAP) / 2) : inner;
  const elements = [
    ...(title
      ? [
          {
            ...title,
            x: MARP_MARGIN,
            y: MARP_TITLE_TOP,
            width: inner,
            height: Math.max(64, Math.min(title.height || 70, 100)),
          },
        ]
      : []),
    ...stacked(left, MARP_MARGIN, columnWidth),
    ...stacked(right, MARP_MARGIN + columnWidth + MARP_GAP, columnWidth),
  ];
  return { ...slide, elements };
}

/**
 * Move one item to the column and position under the pointer.
 * Returns null when the title was grabbed or the order did not change.
 */
export function reorderMarpItem(
  slide: Slide,
  elementId: string,
  point: { x: number; y: number },
  width = 960,
  height = 540,
): Slide | null {
  const dragged = slide.elements.find((el) => el.id === elementId);
  if (!dragged || isMarpTitle(dragged)) return null;
  const [left, right] = marpColumns(slide, width);
  const two = slide.layout === "two-column";
  const targetRight = two && point.x >= width / 2;
  const parked = { ...dragged, x: targetRight ? width : 0 };
  const leftRest = left.filter((el) => el.id !== elementId);
  const rightRest = right.filter((el) => el.id !== elementId);
  const column = targetRight ? rightRest : leftRest;
  let index = column.length;
  for (let i = 0; i < column.length; i++) {
    if (point.y < column[i].y + column[i].height / 2) {
      index = i;
      break;
    }
  }
  const nextLeft = targetRight
    ? leftRest
    : [...column.slice(0, index), parked, ...column.slice(index)];
  const nextRight = targetRight
    ? [...column.slice(0, index), parked, ...column.slice(index)]
    : rightRest;
  const same =
    left.map((el) => el.id).join() === nextLeft.map((el) => el.id).join() &&
    right.map((el) => el.id).join() === nextRight.map((el) => el.id).join();
  if (same) return null;
  const title = slide.elements.find(isMarpTitle);
  return reflowMarp(
    {
      ...slide,
      elements: [...(title ? [title] : []), ...nextLeft, ...nextRight],
    },
    width,
    height,
  );
}

function hasColumnContent(el: SlideElement) {
  if (el.type === "image") return !!el.src;
  if (el.type === "text") return !!el.content?.trim();
  return true;
}

/**
 * Single column to two columns leaves every item on the left and adds an empty
 * box on the right. Two columns to one column appends the right-hand items
 * after the left-hand ones.
 */
export function switchMarpLayout(
  slide: Slide,
  layout: "title-body" | "two-column",
  width = 960,
  height = 540,
): Slide {
  if (slide.layout === layout) return slide;
  const title = slide.elements.find(isMarpTitle);
  const [left, right] = marpColumns(slide, width);
  if (layout === "two-column") {
    const empty: SlideElement = {
      id: crypto.randomUUID(),
      type: "text",
      x: width,
      y: MARP_CONTENT_TOP,
      width: 200,
      height: 80,
      content: "",
      placeholder: "Click to add text",
      fontSize: 18,
      align: "left",
    };
    return reflowMarp(
      {
        ...slide,
        layout,
        elements: [
          ...(title ? [title] : []),
          ...left.map((el) => ({ ...el, x: 0 })),
          empty,
        ],
      },
      width,
      height,
    );
  }
  return reflowMarp(
    {
      ...slide,
      layout: "title-body",
      elements: [
        ...(title ? [title] : []),
        ...[...left, ...right.filter(hasColumnContent)].map((el) => ({ ...el, x: 0 })),
      ],
    },
    width,
    height,
  );
}

/** Append a column's text to the other column and clear the one it left. */
export function moveToOtherColumn(slide: Slide, elementId: string): Slide | null {
  if (slide.layout !== "two-column") return null;
  const slots = placeholders(slide);
  const index = slots.findIndex((el) => el.id === elementId);
  if (index < 1 || index > 2 || slots.length < 3) return null;
  const from = slots[index];
  const to = slots[index === 1 ? 2 : 1];
  if (!from.content?.trim()) return slide;
  const content = [to.content?.trim(), from.content.trim()].filter(Boolean).join("\n");
  return {
    ...slide,
    elements: slide.elements.map((el) => {
      if (el.id === to.id) return { ...el, content, bullet: to.bullet || from.bullet };
      if (el.id === from.id) {
        const next = { ...el, content: "" };
        delete next.bullet;
        return next;
      }
      return el;
    }),
  };
}

function layoutOf(slide: Slide): Layout {
  return slide.layout && slide.layout in SLOT_COUNT ? slide.layout : "title-body";
}

function placeholders(slide: Slide): SlideElement[] {
  return slide.elements.filter(
    (el) => el.type === "text" && el.placeholder !== undefined,
  );
}

function sameTheme(a?: SlideTheme, b?: SlideTheme) {
  if (!a || !b) return !a && !b;
  return THEME_FIELDS.every((key) => a[key] === b[key]);
}

function contentSlots(slide: Slide): SlideElement[] {
  const placeholders = slide.elements.filter(
    (el) => el.type === "text" && el.placeholder !== undefined,
  );
  if (placeholders.length) return placeholders;
  return slide.elements.filter((el) => el.type === "text");
}

function quote(value: string) {
  if (/^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unquote(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return trimmed;
}

function writeBody(text: string) {
  return text
    .replace(/^\n+|\n+$/g, "")
    .split("\n")
    .map((line) => {
      const bullet = /^•\s+(.*)$/.exec(line);
      return bullet ? `- ${bullet[1]}` : line;
    })
    .join("\n");
}

function writeSlide(slide: Slide): string {
  const layout = layoutOf(slide);
  const count = SLOT_COUNT[layout];
  const placed = placeholders(slide);
  const slots = placed.slice(0, count).map((el) => el.content ?? "");
  while (slots.length < count) slots.push("");

  const lines = [`<!-- _class: ${layout} -->`];
  if (!slideIsMarpClean(slide)) lines.push("<!-- _freeform -->");
  if (slide.background?.pinned && slide.background.color)
    lines.push(`<!-- _backgroundColor: ${slide.background.color} -->`);

  const title = placed.length ? (slots[0] ?? "").replace(/\s*\n\s*/g, " ").trim() : "";
  if (title) lines.push("", `# ${title}`);

  if (layout === "two-column") {
    for (const [label, text] of [
      ["left", slots[1] ?? ""],
      ["right", slots[2] ?? ""],
    ] as const) {
      const body = writeBody(text);
      if (body) lines.push("", `:::${label}`, body, ":::");
    }
  } else if (placed.length && layout !== "blank" && layout !== "section") {
    const body = writeBody(slots[1] ?? "");
    if (body) lines.push("", body);
  }

  const notes = slide.notes?.replace(/^\n+|\n+$/g, "").replace(/-->/g, "-- >") ?? "";
  if (notes) lines.push("", `<!--\n${notes}\n-->`);
  return lines.join("\n");
}

function writeMarpItem(el: SlideElement) {
  if (el.type === "image" && el.src) {
    const alt = (el.alt ?? "").replace(/[\[\]]/g, "");
    return `![${alt}](${el.src})`;
  }
  if (el.type !== "text") return "";
  return writeBody(el.content ?? "");
}

/** MARP markdown: one column, or two columns written as divs. No coordinates. */
function writeMarpSlide(slide: Slide, width = 960): string {
  const title = (slide.elements.find(isMarpTitle)?.content ?? "")
    .replace(/\s*\n\s*/g, " ")
    .trim();
  const [left, right] = marpColumns(slide, width);
  const lines: string[] = [];
  if (title) lines.push(`# ${title}`);
  const blocks = (items: SlideElement[]) =>
    items.map(writeMarpItem).filter(Boolean).join("\n\n");
  if (slide.layout === "two-column") {
    for (const text of [blocks(left), blocks(right)]) {
      lines.push("", "<div>", "", text, "", "</div>");
    }
  } else {
    const body = blocks(left);
    if (body) lines.push("", body);
  }
  const notes = slide.notes?.replace(/^\n+|\n+$/g, "").replace(/-->/g, "-- >") ?? "";
  if (notes) lines.push("", `<!--\n${notes}\n-->`);
  return lines.join("\n");
}

function themeLines(theme?: SlideTheme): string[] {
  const lines = ["marp: true"];
  if (!theme) return lines;
  const builtin = DECK_THEMES.find((item) => sameTheme(item, theme));
  if (builtin) {
    lines.push(`theme: ${builtin.id}`);
    return lines;
  }
  lines.push("theme:");
  for (const key of THEME_FIELDS) lines.push(`  ${key}: ${quote(theme[key])}`);
  return lines;
}

/** The deck as MARP markdown. Coordinates and fonts stay on the slide. */
export function deckToMarp(deck: Presentation): string {
  const head = ["---", ...themeLines(deck.theme), "---"];
  const slides = deck.slideOrder
    .map((id) => deck.slides[id])
    .filter((slide): slide is Slide => !!slide)
    .map((slide) =>
      deck.marp ? writeMarpSlide(slide, deck.width || 960) : writeSlide(slide),
    );
  if (!slides.length) return `${head.join("\n")}\n`;
  return `${head.join("\n")}\n\n${slides.join("\n\n---\n\n")}\n`;
}

function looksLikeFrontMatter(block: string) {
  let sawKey = false;
  for (const line of block.split("\n")) {
    if (!line.trim()) continue;
    if (/^\s*[A-Za-z][\w-]*\s*:/.test(line)) {
      sawKey = true;
      continue;
    }
    return false;
  }
  return sawKey;
}

function parseThemeBlock(raw: string): { theme: ThemeInput; error?: string } {
  const lines = raw.split("\n");
  let theme: ThemeInput = { kind: "absent" };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!match)
      return { theme, error: `The header line "${line.trim()}" could not be read.` };
    if (match[1] !== "theme") continue;
    if (match[2].trim()) {
      theme = { kind: "name", name: unquote(match[2]) };
      continue;
    }
    const fields: Record<string, string> = {};
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
      i++;
      const field = /^\s+([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(lines[i]);
      if (!field)
        return {
          theme,
          error: `The theme line "${lines[i].trim()}" could not be read.`,
        };
      fields[field[1]] = unquote(field[2]);
    }
    if (!Object.keys(fields).length)
      return { theme, error: "The theme in the header is empty." };
    theme = { kind: "object", fields };
  }
  return { theme };
}

function parseFront(markdown: string): {
  body: string;
  theme: ThemeInput;
  error?: string;
} {
  const text = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---")) return { body: text, theme: { kind: "absent" } };
  const end = text.indexOf("\n---", 3);
  if (end < 0) {
    const after = text.slice(3).replace(/^\n/, "");
    if (looksLikeFrontMatter(after))
      return {
        body: "",
        theme: { kind: "absent" },
        error: "The block at the top is missing its closing ---.",
      };
    return { body: text, theme: { kind: "absent" } };
  }
  const raw = text.slice(3, end).replace(/^\n/, "");
  if (!looksLikeFrontMatter(raw)) return { body: text, theme: { kind: "absent" } };
  let rest = text.slice(end + 4);
  if (rest.startsWith("\n")) rest = rest.slice(1);
  const parsed = parseThemeBlock(raw);
  if (parsed.error) return { body: rest, theme: { kind: "absent" }, error: parsed.error };
  return { body: rest, theme: parsed.theme };
}

function slug(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return base || "theme";
}

function resolveTheme(
  input: ThemeInput,
  current?: SlideTheme,
): { theme?: SlideTheme; warnings: string[]; error?: string } {
  if (input.kind === "absent") return { theme: current, warnings: [] };
  if (input.kind === "name") {
    const key = input.name.trim().toLowerCase();
    const found = DECK_THEMES.find(
      (theme) => theme.id.toLowerCase() === key || theme.name.toLowerCase() === key,
    );
    if (!found)
      return {
        theme: current,
        warnings: [
          `No theme named "${input.name}". The current theme was left as it is.`,
        ],
      };
    return { theme: found, warnings: [] };
  }
  const required = THEME_FIELDS.filter((key) => key !== "id");
  const missing = required.filter((key) => !input.fields[key]?.trim());
  if (missing.length)
    return {
      warnings: [],
      error: `The theme in the header needs ${missing.join(", ")}.`,
    };
  const parsed = slideThemeSchema.safeParse({
    id: (input.fields.id?.trim() || slug(input.fields.name)).slice(0, 80),
    name: input.fields.name.trim(),
    background: input.fields.background.trim(),
    headingColor: input.fields.headingColor.trim(),
    bodyColor: input.fields.bodyColor.trim(),
    accent: input.fields.accent.trim(),
    headingFont: input.fields.headingFont.trim(),
    bodyFont: input.fields.bodyFont.trim(),
  });
  if (!parsed.success)
    return { warnings: [], error: "The theme in the header could not be saved." };
  return { theme: parsed.data, warnings: [] };
}

function parseColor(value: string) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  const full = hex.length === 3 ? [...hex].map((ch) => ch + ch).join("") : hex;
  return `#${full.toLowerCase()}`;
}

function readDirectives(directives: string[]): {
  layout?: Layout;
  pinned?: string;
  freeform?: boolean;
  error?: string;
} {
  let layout: Layout | undefined;
  let pinned: string | undefined;
  let freeform = false;
  for (const directive of directives) {
    if (directive.trim() === "_freeform") {
      freeform = true;
      continue;
    }
    const match = /^_([A-Za-z0-9]+)\s*:\s*([\s\S]*)$/.exec(directive.trim());
    if (!match) continue;
    const name = match[1].toLowerCase();
    const value = match[2].trim();
    if (name === "class") {
      const known = value
        .split(/\s+/)
        .map((token) => CLASS_LAYOUT[token.toLowerCase()])
        .find((item): item is Layout => !!item);
      if (!known) return { error: `Unknown layout "${value}".` };
      layout = known;
    } else if (name === "backgroundcolor") {
      const color = parseColor(value);
      if (!color)
        return {
          error: `Background color "${value}" must be a #rgb or #rrggbb code.`,
        };
      pinned = color;
    } else if (name === "freeform") freeform = true;
  }
  return { layout, pinned, freeform };
}

function piecesFrom(lines: string[]): Piece[] {
  const pieces: Piece[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    pieces.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    pieces.push({ kind: "list", items: list });
    list = null;
  };
  for (const line of lines) {
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = /^\s*[-*•▪◦]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      list = list ?? [];
      list.push(bullet[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return pieces;
}

function piecesToText(pieces: Piece[]): SlotSpec {
  if (!pieces.length) return { text: "", bullet: false };
  return {
    bullet: pieces.some((piece) => piece.kind === "list"),
    text: pieces
      .map((piece) =>
        piece.kind === "list"
          ? piece.items.map((item) => `• ${item}`).join("\n")
          : piece.text,
      )
      .join("\n\n"),
  };
}

function mergeText(first: SlotSpec, second: SlotSpec): SlotSpec {
  return {
    text: [first.text, second.text].filter(Boolean).join("\n\n"),
    bullet: first.bullet || second.bullet,
  };
}

function slotsFor(
  layout: Layout,
  title: string,
  pieces: Piece[],
  left: Piece[],
  right: Piece[],
  hadFence: boolean,
): SlotSpec[] {
  const heading = { text: title, bullet: false };
  const rest = piecesToText(pieces);
  if (layout === "blank") return [];
  if (layout === "section") return [heading];
  if (layout === "two-column") {
    return [
      heading,
      hadFence ? mergeText(rest, piecesToText(left)) : rest,
      hadFence ? piecesToText(right) : { text: "", bullet: false },
    ];
  }
  return [heading, rest];
}

function parseChunk(
  chunk: string,
  slideNumber: number,
  emptyDocument: boolean,
): { slide: ParsedSlide; warnings: string[] } | MarpFailure {
  if (emptyDocument)
    return {
      slide: {
        layout: "title",
        slots: [
          { text: "", bullet: false },
          { text: "", bullet: false },
        ],
        notes: "",
      },
      warnings: [],
    };

  const directives: string[] = [];
  const noteBlocks: string[] = [];
  const withoutComments = chunk.replace(/<!--([\s\S]*?)-->/g, (_full, inner: string) => {
    const text = String(inner).replace(/^\n|\n$/g, "").trim();
    if (!text) return "";
    if (text.startsWith("_")) directives.push(text);
    else noteBlocks.push(text);
    return "";
  });
  const read = readDirectives(directives);
  if (read.error) return { error: `Slide ${slideNumber}: ${read.error}` };

  const warnings: string[] = [];
  let body = withoutComments;
  const images: { alt: string; src: string }[] = [];
  body = body.replace(/!\[([^\]]*)\]\(([^)\n]*)\)/g, (_full, alt: string, src: string) => {
    const token = `@@image${images.length}@@`;
    images.push({ alt, src });
    return `\n\n${token}\n\n`;
  });
  if (images.length)
    warnings.push(`Slide ${slideNumber}: an image in the markdown was left out.`);
  const divs: string[] = [];
  body = body.replace(/<div\b[^>]*>\s*([\s\S]*?)\s*<\/div>/gi, (_full, inner: string) => {
    divs.push(String(inner).trim());
    return "";
  });

  const main: string[] = [];
  const columns = { left: [] as string[], right: [] as string[] };
  let fence: "left" | "right" | null = null;
  let hadFence = false;
  const hadDivs = divs.length >= 2;
  if (hadDivs) {
    columns.left = divs[0].split("\n");
    columns.right = divs[1].split("\n");
  }
  for (const line of body.split("\n")) {
    const open = /^:::\s*(left|right)\s*$/i.exec(line.trim());
    if (!fence && open) {
      fence = open[1].toLowerCase() as "left" | "right";
      hadFence = true;
      continue;
    }
    if (fence && /^:::\s*$/.test(line.trim())) {
      fence = null;
      continue;
    }
    (fence ? columns[fence] : main).push(line);
  }

  let title: string | null = null;
  const restLines: string[] = [];
  for (const line of main) {
    if (title === null) {
      const heading = /^#\s+(.+)$/.exec(line.trim());
      if (heading) {
        title = heading[1].trim();
        continue;
      }
    }
    restLines.push(line);
  }
  const pieces = piecesFrom(restLines);
  const left = piecesFrom(columns.left);
  const right = piecesFrom(columns.right);
  const hasText =
    title !== null ||
    pieces.length > 0 ||
    left.length > 0 ||
    right.length > 0 ||
    hadDivs;

  let layout = read.layout;
  if (!layout) {
    const oneParagraph =
      !hadFence && !hadDivs && pieces.length === 1 && pieces[0].kind === "paragraph";
    const headingOnly = title !== null && pieces.length === 0 && !hadFence && !hadDivs;
    layout = hadFence || hadDivs
      ? "two-column"
      : title !== null && (oneParagraph || headingOnly)
        ? "title"
        : "title-body";
  }
  if (hadDivs) layout = "two-column";
  if (!read.freeform && layout === "blank" && hasText) layout = "title-body";
  if (!read.freeform && layout === "section" && (pieces.length > 0 || hadFence || hadDivs))
    layout = "title-body";

  return {
    slide: {
      layout,
      slots: slotsFor(layout, title ?? "", pieces, left, right, hadFence || hadDivs),
      notes: noteBlocks.at(-1) ?? "",
      pinnedColor: read.pinned,
      freeform: read.freeform,
      images,
    },
    warnings,
  };
}

function assignSlots(slide: Slide, specs: SlotSpec[]): Slide {
  const slots = contentSlots(slide);
  const elements = slide.elements.map((el) => {
    const index = slots.indexOf(el);
    if (index < 0) return el;
    const spec = specs[index] ?? { text: "", bullet: false };
    const next: SlideElement = { ...el, content: spec.text };
    delete next.runs;
    if (spec.bullet) next.bullet = true;
    else delete next.bullet;
    return next;
  });
  if (specs.length > slots.length && slots.length) {
    const last = slots[slots.length - 1];
    const extra = specs
      .slice(slots.length)
      .map((spec) => spec.text)
      .filter(Boolean);
    if (extra.length) {
      return {
        ...slide,
        elements: elements.map((el) =>
          el.id === last.id
            ? { ...el, content: [el.content, ...extra].filter(Boolean).join("\n") }
            : el,
        ),
      };
    }
  }
  return { ...slide, elements };
}

function withBackground(
  slide: Slide,
  pinned: string | undefined,
  previous: Slide | undefined,
  theme?: SlideTheme,
): Slide {
  if (pinned)
    return {
      ...slide,
      background: { ...slide.background, color: pinned, pinned: true },
    };
  if (!previous?.background?.pinned && !slide.background?.pinned) return slide;
  const background = { ...slide.background };
  delete background.pinned;
  if (theme) background.color = theme.background;
  return { ...slide, background };
}

function assignPlaceholders(slide: Slide, specs: SlotSpec[]): Slide {
  const slots = placeholders(slide);
  if (!slots.length) return slide;
  const elements = slide.elements.map((el) => {
    const index = slots.indexOf(el);
    if (index < 0 || index >= specs.length) return el;
    const spec = specs[index];
    const next: SlideElement = { ...el, content: spec.text };
    delete next.runs;
    if (spec.bullet) next.bullet = true;
    else delete next.bullet;
    return next;
  });
  return { ...slide, elements };
}

function buildSlide(
  parsed: ParsedSlide,
  previous: Slide | undefined,
  theme?: SlideTheme,
): Slide {
  if (parsed.freeform && previous && layoutOf(previous) === parsed.layout) {
    const painted = withBackground(
      assignPlaceholders(previous, parsed.slots),
      parsed.pinnedColor,
      previous,
      theme,
    );
    return {
      ...painted,
      id: previous.id,
      layout: previous.layout ?? parsed.layout,
      notes: parsed.notes,
      comments: previous.comments,
      transition: previous.transition,
    };
  }
  const count = SLOT_COUNT[parsed.layout];
  let base: Slide;
  if (!previous) {
    base = theme ? slideFromTheme(parsed.layout, theme) : newSlide(parsed.layout);
  } else if (
    previous.layout !== parsed.layout ||
    contentSlots(previous).length !== count
  ) {
    const cleared =
      parsed.layout === "blank"
        ? {
            ...previous,
            elements: previous.elements.map((el) =>
              el.type === "text" && el.placeholder !== undefined
                ? { ...el, content: "" }
                : el,
            ),
          }
        : previous;
    base = theme
      ? layoutWithTheme(cleared, parsed.layout, theme)
      : applyLayout(cleared, parsed.layout);
  } else {
    base = previous;
  }
  const filled = parsed.layout === "blank" ? base : assignSlots(base, parsed.slots);
  const painted = withBackground(filled, parsed.pinnedColor, previous, theme);
  return {
    ...painted,
    id: previous?.id ?? painted.id,
    layout: parsed.layout,
    notes: parsed.notes,
    comments: previous?.comments,
    transition: previous?.transition,
  };
}

/** A MARP deck only has a single column or two columns. */
function marpColumn(slide: ParsedSlide): ParsedSlide {
  if (slide.layout === "two-column" || slide.layout === "title-body") return slide;
  const title = slide.slots[0] ?? { text: "", bullet: false };
  const rest = slide.slots.slice(1);
  return {
    ...slide,
    layout: "title-body",
    slots: [
      { text: title.text, bullet: false },
      {
        text: rest.map((slot) => slot.text).filter(Boolean).join("\n\n"),
        bullet: rest.some((slot) => slot.bullet),
      },
    ],
  };
}

function withoutImageTokens(slide: Slide): Slide {
  return {
    ...slide,
    elements: slide.elements.map((el) =>
      el.type === "text" && el.content?.includes("@@image")
        ? {
            ...el,
            content: el.content
              .replace(/@@image\d+@@/g, "")
              .replace(/\n{3,}/g, "\n\n")
              .trim(),
          }
        : el,
    ),
  };
}

/** A blank line, or a picture, starts another item in the column. */
function expandMarpBlocks(
  slide: Slide,
  images: { alt: string; src: string }[],
): Slide {
  const title = slide.elements.find(isMarpTitle);
  const rest = slide.elements.filter((el) => !isMarpTitle(el));
  const elements: SlideElement[] = title ? [title] : [];
  for (const el of rest) {
    if (el.type !== "text") {
      elements.push(el);
      continue;
    }
    const parts = (el.content ?? "")
      .split(/\n\n/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) {
      elements.push(el);
      continue;
    }
    parts.forEach((part, index) => {
      const token = /^@@image(\d+)@@$/.exec(part);
      const id = index === 0 ? el.id : crypto.randomUUID();
      if (token) {
        const image = images[Number(token[1])];
        if (!image) return;
        elements.push({
          id,
          type: "image",
          x: el.x,
          y: el.y + index,
          width: el.width,
          height: 120,
          src: image.src,
          alt: image.alt,
        });
        return;
      }
      elements.push(
        index === 0
          ? { ...el, content: part }
          : { ...el, id, content: part, y: el.y + index },
      );
    });
  }
  return reflowMarp({ ...slide, elements });
}

/**
 * Read MARP markdown onto the deck. Slide i keeps the id, comments, and
 * transition of the slide already at that position.
 */
export function marpToDeck(
  markdown: string,
  deck: Presentation,
  options?: { marp?: boolean },
): MarpSuccess | MarpFailure {
  const front = parseFront(markdown);
  if (front.error) return { error: front.error };
  const resolved = resolveTheme(front.theme, deck.theme);
  if (resolved.error) return { error: resolved.error };

  const empty = !front.body.trim();
  const chunks = empty
    ? [""]
    : front.body.split(/^---\s*$/m).map((part) => part.replace(/^\n+|\n+$/g, ""));
  const asMarp = options?.marp ?? deck.marp ?? false;
  const warnings = [...resolved.warnings];
  const built: Slide[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const parsed = parseChunk(chunks[i], i + 1, empty);
    if ("error" in parsed) return parsed;
    warnings.push(
      ...(asMarp
        ? parsed.warnings.filter((warning) => !warning.includes("left out"))
        : parsed.warnings),
    );
    const slide = asMarp ? marpColumn(parsed.slide) : parsed.slide;
    let builtSlide = buildSlide(slide, deck.slides[deck.slideOrder[i]], resolved.theme);
    if (asMarp)
      builtSlide = expandMarpBlocks(builtSlide, parsed.slide.images ?? []);
    else if (parsed.slide.images?.length)
      builtSlide = withoutImageTokens(builtSlide);
    built.push(builtSlide);
  }

  const slideOrder = built.map((slide) => slide.id);
  let next: Presentation = {
    ...deck,
    marp: asMarp ? true : deck.marp,
    theme: resolved.theme,
    slideOrder,
    slides: Object.fromEntries(built.map((slide) => [slide.id, slide])),
  };
  if (resolved.theme && !sameTheme(deck.theme, resolved.theme))
    next = applyDeckTheme(next, resolved.theme);
  else if (resolved.theme) {
    const known = new Set(deck.slideOrder);
    next = {
      ...next,
      slides: Object.fromEntries(
        slideOrder.map((id) => [
          id,
          known.has(id) ? next.slides[id] : paintSlide(next.slides[id], resolved.theme!),
        ]),
      ),
    };
  }
  return { deck: next, warnings };
}
