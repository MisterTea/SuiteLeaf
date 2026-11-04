import {
  createFile,
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
import { isMarpTitle, marpColumns, placeholders, reflowMarp } from "./slide-marp-columns";
import {
  THEME_FIELDS,
  parseChunk,
  parseFront,
  resolveTheme,
  type MarpFailure,
  type ParsedSlide,
  type SlotSpec,
} from "./slide-marp-parse";

export {
  isMarpChrome,
  isMarpTitle,
  keepElementIds,
  marpColumns,
  mergeConsecutiveText,
  moveToOtherColumn,
  reflowMarp,
  reorderFittedMarpItem,
  reorderMarpItem,
  switchMarpLayout,
} from "./slide-marp-columns";
export { isMarpDirective, type MarpFailure } from "./slide-marp-parse";

export type MarpSuccess = { deck: Presentation; warnings: string[] };

const SLOT_COUNT: Record<Layout, number> = {
  title: 2,
  "title-body": 2,
  "two-column": 3,
  section: 1,
  blank: 0,
};

/** A slide markdown can round-trip without leaving shapes or free text behind. */
export function slideIsMarpClean(slide: Slide): boolean {
  if (!slide.layout) return false;
  return slide.elements.every(
    (el) => el.type === "text" && el.placeholder !== undefined,
  );
}

/** A new presentation whose slides are a single column or two columns. */
export function createMarpFile(title = "Untitled presentation"): SlideFile {
  const file = createFile("slide", title) as SlideFile;
  const id = file.content.slideOrder[0];
  const slide = newSlide("title-body");
  slide.id = id;
  file.content.marp = true;
  file.content.slides = { [id]: slide };
  const heading = title.replace(/\s+/g, " ").trim() || "Untitled presentation";
  const source = `---\nmarp: true\n---\n\n# ${heading}\n`;
  const parsed = marpToDeck(source, file.content, { marp: true });
  if (!("error" in parsed)) file.content = parsed.deck;
  file.content.marpSource = source;
  file.content.marpFit = false;
  return file;
}

function layoutOf(slide: Slide): Layout {
  return slide.layout && slide.layout in SLOT_COUNT ? slide.layout : "title-body";
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
  if (slide.hidden) lines.push("<!-- _hidden: true -->");
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
  if (slide.hidden) lines.push("<!-- _hidden: true -->");
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

/** The `theme:` lines of the front matter: a built-in name, or the colors and fonts. */
export function themeFrontLines(theme?: SlideTheme): string[] {
  if (!theme) return [];
  const builtin = DECK_THEMES.find((item) => sameTheme(item, theme));
  if (builtin) return [`theme: ${builtin.id}`];
  return ["theme:", ...THEME_FIELDS.map((key) => `  ${key}: ${quote(theme[key])}`)];
}

function themeLines(theme?: SlideTheme): string[] {
  return ["marp: true", ...themeFrontLines(theme)];
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
      hidden: parsed.hidden ? true : undefined,
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
    hidden: parsed.hidden ? true : undefined,
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
    ...(asMarp ? { slideNumbers: front.paginate === true ? true : undefined } : {}),
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