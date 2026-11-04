import { slideThemeSchema, type SlideTheme } from "@suiteleaf/core";
import type { Layout } from "./slide-layouts";
import { DECK_THEMES } from "./slide-theme";

export type MarpFailure = { error: string };

const CLASS_LAYOUT: Record<string, Layout> = {
  title: "title",
  lead: "title",
  "title-body": "title-body",
  section: "section",
  "two-column": "two-column",
  blank: "blank",
};

export const THEME_FIELDS = [
  "id",
  "name",
  "background",
  "headingColor",
  "bodyColor",
  "accent",
  "headingFont",
  "bodyFont",
] as const;

export type SlotSpec = { text: string; bullet: boolean };
type Piece =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };
export type ThemeInput =
  | { kind: "absent" }
  | { kind: "name"; name: string }
  | { kind: "object"; fields: Record<string, string> };
export type ParsedSlide = {
  layout: Layout;
  slots: SlotSpec[];
  notes: string;
  hidden?: boolean;
  pinnedColor?: string;
  /** Objects on this slide are placed by hand, so the markdown does not list them. */
  freeform?: boolean;
  images?: { alt: string; src: string }[];
};

function unquote(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return trimmed;
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

function parseThemeBlock(raw: string): {
  theme: ThemeInput;
  paginate?: boolean;
  error?: string;
} {
  const lines = raw.split("\n");
  let theme: ThemeInput = { kind: "absent" };
  let paginate: boolean | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!match)
      return { theme, error: `The header line "${line.trim()}" could not be read.` };
    if (match[1] === "paginate") paginate = unquote(match[2]) === "true";
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
  return { theme, paginate };
}

export function parseFront(markdown: string): {
  body: string;
  theme: ThemeInput;
  paginate?: boolean;
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
  return { body: rest, theme: parsed.theme, paginate: parsed.paginate };
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

export function resolveTheme(
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

const MARP_DIRECTIVES = new Set([
  "author",
  "backgroundcolor",
  "backgroundimage",
  "backgroundposition",
  "backgroundrepeat",
  "backgroundsize",
  "class",
  "color",
  "description",
  "footer",
  "header",
  "headingdivider",
  "hidden",
  "image",
  "keywords",
  "lang",
  "marp",
  "math",
  "paginate",
  "size",
  "style",
  "theme",
  "title",
  "transition",
  "url",
]);

/** A comment MARP reads as settings rather than speaker notes. */
export function isMarpDirective(text: string): boolean {
  const lines = text.split("\n").filter((line) => line.trim());
  return (
    lines.length > 0 &&
    lines.every((line) => {
      const key = /^\s*_?([A-Za-z]+)\s*:/.exec(line)?.[1];
      return !!key && MARP_DIRECTIVES.has(key.toLowerCase());
    })
  );
}

function readDirectives(directives: string[]): {
  layout?: Layout;
  pinned?: string;
  freeform?: boolean;
  hidden?: boolean;
  error?: string;
} {
  let layout: Layout | undefined;
  let pinned: string | undefined;
  let freeform = false;
  let hidden = false;
  for (const directive of directives.flatMap((text) => text.split("\n"))) {
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
      // Theme classes such as body-clearance are not layouts. The fitter still
      // applies them from the original markdown.
      if (known) layout = known;
    } else if (name === "backgroundcolor") {
      const color = parseColor(value);
      if (!color)
        return {
          error: `Background color "${value}" must be a #rgb or #rrggbb code.`,
        };
      pinned = color;
    } else if (name === "freeform") freeform = true;
    else if (name === "hidden") {
      if (value !== "true" && value !== "false") return { error: "Hidden must be true or false." };
      hidden = value === "true";
    }
  }
  return { layout, pinned, freeform, hidden };
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

export function parseChunk(
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
    if (text.startsWith("_") || isMarpDirective(text)) directives.push(text);
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
  body = body.replace(
    /<div\b[^>]*display:\s*grid[^>]*>\s*([\s\S]*)<\/div>/i,
    (_full, inner: string) => inner,
  );
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
      hidden: read.hidden,
      pinnedColor: read.pinned,
      freeform: read.freeform,
      images,
    },
    warnings,
  };
}
