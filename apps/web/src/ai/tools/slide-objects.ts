import { Type } from "@earendil-works/pi-ai";
import type { SlideElement, TextRun } from "@suiteleaf/core";
import { fillColors } from "../../editors/slide-layouts";
import { THEME_FONTS, handStyle, normalizeHex } from "../../editors/slide-theme";
import { hasTextRuns, plainText, runsOf } from "../../editors/slide-runs";
import { formatRange } from "../../editors/slide-run-format";
import { ToolError, tool, type SuiteTool } from "../host";
import { requestFile } from "../file-request";
import type { SlidesAgentContext } from "./slides";
import { type Deck, titleOf, whereOn } from "./slide-describe";
import { findSlide, asWhich, stringArgs, canvas, pickColor, slideUpdater } from "./slide-targets";

function foldText(value: string) {
  return value
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/center/g, "centre")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']+|["']+$/g, "");
}

/** One word the model named, ignoring a boolean, a colour, or a whole sentence. */
function singleWord(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/^(?:only|the word|word)\s+/i, "")
    .trim();
  if (!text || /\s/.test(text)) return undefined;
  if (/^(true|false|yes|no|null|accent|green|bold|italic)$/i.test(text)) return undefined;
  if (/^#?[0-9a-fA-F]{6}$/.test(text)) return undefined;
  return text.replace(/center$/i, "centre");
}

const flagOn = (value: unknown) => value === true || (typeof value === "string" && /^(true|yes)$/i.test(value.trim()));

function wordRanges(text: string, word: string): Array<[number, number]> {
  const wanted = word.toLowerCase().replace(/center/g, "centre");
  if (!wanted) return [];
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?/g)) {
    const token = match[0].toLowerCase().replace(/center/g, "centre");
    if (token === wanted && match.index !== undefined) ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

type WordPatch = { word: string; bold?: boolean; italic?: boolean; color?: string };

/** Style words inside a box. Other words keep the theme, and the box is not a theme override. */
function paintWordStyles(el: SlideElement, patches: WordPatch[]): { element: SlideElement; summary: string } {
  let runs: TextRun[] = el.runs?.length ? runsOf(el) : [{ text: el.content ?? "" }];
  const missing: string[] = [];
  const notes: string[] = [];
  for (const patch of patches) {
    const ranges = wordRanges(plainText(runs), patch.word);
    if (!ranges.length) {
      missing.push(patch.word);
      continue;
    }
    const style: Partial<Pick<TextRun, "bold" | "italic" | "color">> = {};
    const bits: string[] = [];
    if (patch.bold) {
      style.bold = true;
      bits.push("bold");
    }
    if (patch.italic) {
      style.italic = true;
      bits.push("italic");
    }
    if (patch.color) {
      style.color = patch.color;
      bits.push(patch.color);
    }
    if (!bits.length) continue;
    for (const [start, end] of ranges.reverse()) runs = formatRange(runs, start, end, style);
    notes.push(`only "${patch.word}" is ${bits.join(" and ")}`);
  }
  if (missing.length)
    throw new ToolError(
      `That text box does not contain ${missing.map((word) => `"${word}"`).join(", ")}. It says "${el.content ?? ""}". Pass one word from that box to format_words.`,
    );
  if (!notes.length) throw new ToolError('Name a word for bold, italic, or accent. Example: bold "fair", accent "community", italic "centre".');
  const element: SlideElement = {
    ...el,
    content: plainText(runs),
    runs: hasTextRuns({ runs }) ? runs : undefined,
    bold: false,
    italic: false,
    underline: false,
  };
  delete element.themeOverride;
  return { element, summary: notes.join("; ") };
}

function findTextBox(boxes: SlideElement[], text: string | undefined, words: string[]) {
  const wanted = text ? foldText(text) : "";
  const holds = (el: SlideElement, word: string) => wordRanges(el.content ?? "", word).length > 0;
  const hasAll = (el: SlideElement) => words.every((word) => holds(el, word));
  if (wanted) {
    const exact = boxes.find((el) => foldText(el.content ?? "") === wanted);
    if (exact) return exact;
    const contains = boxes.find((el) => foldText(el.content ?? "").includes(wanted) && hasAll(el));
    if (contains) return contains;
    const loose = boxes.find((el) => foldText(el.content ?? "").includes(wanted));
    if (loose) return loose;
  }
  return boxes.find(hasAll);
}

/** Arguments for format_words: each style is the one word, even when the model sends true or a list. */
function wordStyleArgs(args: Record<string, unknown>) {
  const picked: { bold?: string; italic?: string; accent?: string } = {};
  const bold = singleWord(args.bold ?? args.bold_word ?? args.boldWord);
  const italic = singleWord(args.italic ?? args.italic_word ?? args.italicWord);
  const accent = singleWord(
    args.accent ?? args.accent_word ?? args.accentWord ?? args.color_word ?? args.colour_word ?? args.color ?? args.colour,
  );
  if (bold) picked.bold = bold;
  if (italic) picked.italic = italic;
  if (accent) picked.accent = accent;
  const word = singleWord(args.word);
  if (word) {
    if (flagOn(args.bold) && !picked.bold) picked.bold = word;
    if (flagOn(args.italic) && !picked.italic) picked.italic = word;
    const colorRaw = args.color ?? args.colour ?? args.accent;
    if ((flagOn(colorRaw) || (typeof colorRaw === "string" && /accent|green|#/i.test(colorRaw))) && !picked.accent) picked.accent = word;
  }
  const list = args.words ?? args.styles ?? args.changes ?? args.formatting;
  const takeList = (value: unknown) => {
    if (typeof value === "string") {
      for (const part of value.split(/[,;]|\band\b/i)) {
        const target = part
          .trim()
          .split(/\s+/)
          .map((piece) => singleWord(piece))
          .find(Boolean);
        if (!target) continue;
        const blob = part.toLowerCase();
        if (/\bbold\b/.test(blob)) picked.bold = target;
        if (/\bitalic\b/.test(blob)) picked.italic = target;
        if (/\baccent\b|\bgreen\b|\bcolou?r\b/.test(blob)) picked.accent = target;
      }
      return;
    }
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (typeof item === "string") {
        takeList(item);
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const named = singleWord(rec.word ?? rec.text);
      if (!named) continue;
      if (flagOn(rec.bold) || rec.style === "bold") picked.bold = named;
      if (flagOn(rec.italic) || rec.style === "italic") picked.italic = named;
      if (flagOn(rec.accent) || rec.color !== undefined || rec.colour !== undefined || rec.style === "accent" || rec.style === "color")
        picked.accent = named;
    }
  };
  takeList(list);
  const textRaw = args.text ?? args.box ?? args.content;
  let text = typeof textRaw === "string" ? textRaw.trim().replace(/^["']+|["']+$/g, "") : undefined;
  if (text && !picked.bold && !picked.italic && !picked.accent) takeList(text);
  if (text && singleWord(text) && [picked.bold, picked.italic, picked.accent].includes(singleWord(text))) text = undefined;
  const next: Record<string, unknown> = {};
  if (args.slide !== undefined && args.slide !== "") next.slide = String(args.slide);
  if (text) next.text = text;
  if (picked.bold) next.bold = picked.bold;
  if (picked.italic) next.italic = picked.italic;
  if (picked.accent) next.accent = picked.accent;
  return next;
}

/** A font the model named, and italic when the same words asked for it. */
function canonicalFont(value: string): { font?: string; italic?: boolean } {
  const lower = value.toLowerCase();
  const italic = /\bitalic\b/.test(lower) ? true : undefined;
  const cleaned = lower
    .replace(/\b(italic|bold|regular|normal|oblique)\b/g, " ")
    .replace(/[,;].*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return { italic };
  const known = THEME_FONTS.find(
    (font) => cleaned === font.toLowerCase() || cleaned.includes(font.toLowerCase()) || font.toLowerCase().includes(cleaned),
  );
  if (known) return { font: known, italic };
  if (cleaned.length >= 2 && cleaned.length < 40) return { font: value.trim(), italic };
  throw new ToolError(`"${value}" is not a font. Use Georgia, Montserrat, Source Sans, Arial, or Trebuchet MS.`);
}

/** Where a named position puts a box of this size on the 960×540 slide. */
function place(position: string | undefined, w: number, h: number, deck: Deck) {
  const W = deck.width || 960,
    H = deck.height || 540,
    m = 40;
  const x = { left: m, center: (W - w) / 2, right: W - w - m };
  const y = { top: m, middle: (H - h) / 2, bottom: H - h - m };
  const [v, hz] = (() => {
    const p = (position ?? "center").toLowerCase();
    if (p === "center" || p === "middle") return ["middle", "center"];
    const vert = p.includes("top") ? "top" : p.includes("bottom") ? "bottom" : "middle";
    const horiz = p.includes("left") ? "left" : p.includes("right") ? "right" : "center";
    return [vert, horiz];
  })();
  return { x: Math.round(x[hz as keyof typeof x]), y: Math.round(y[v as keyof typeof y]) };
}

export function slideObjectTools(ctx: SlidesAgentContext): SuiteTool[] {
  const update = slideUpdater(ctx);
  return [
    tool({
      name: "add_shape",
      label: "Add shape",
      description:
        `Add a shape (rectangle, rounded rectangle, circle/ellipse) to a slide. position: top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right. Optional fill: a color name such as yellow, blue, red or light green, or #rrggbb. Optional size in pixels (the slide is 960×540); a circle is always round.`,
      parameters: Type.Object({
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
        shape: Type.String({ enum: ["rectangle", "rounded rectangle", "circle", "ellipse"] }),
        position: Type.Optional(Type.String()),
        fill: Type.Optional(Type.String()),
        width: Type.Optional(Type.Number()),
        height: Type.Optional(Type.Number()),
      }),
      prepare: stringArgs,
      target: ({ shape }) =>
        document.querySelector(`[aria-label="${shape === "circle" || shape === "ellipse" ? "Circle" : "Rectangle"}"]`),
      async execute({ slide, shape, position, fill, width, height }) {
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const paint = pickColor(fill ?? "#e2e8f0", fillColors, "Fill");
        ctx.select(id, null);
        const round = shape === "circle" || shape === "ellipse";
        const w = Math.round(width ?? (shape === "circle" ? height : undefined) ?? (round ? 160 : 220)),
          h = shape === "circle" ? w : Math.round(height ?? (round ? 160 : 140));
        const { x, y } = place(position, w, h, ctx.deck());
        const el: SlideElement = {
          id: crypto.randomUUID(),
          type: "shape",
          x,
          y,
          width: w,
          height: h,
          shapeType: round ? "ellipse" : shape === "rectangle" ? "rect" : "roundRect",
          fill: paint.color,
          stroke: "#94a3b8",
          strokeWidth: 2,
        };
        const deck = update(id, (s) => ({ ...s, elements: [...s.elements, el] }));
        ctx.select(id, el.id);
        return `Added a ${paint.name} ${shape}, ${w}×${h}, at the ${whereOn(el)} of slide ${index + 1} "${titleOf(deck.slides[id])}".${paint.color === "transparent" ? " It has no fill, so only its outline shows." : ""} It is selected; copy_element can copy it.`;
      },
    }),
    tool({
      name: "add_text_box",
      label: "Text box",
      description:
        "Add a new text box (it does not replace the slide's title) with text, at a position (top-left … bottom-right, center). bold makes the words bold. align is left, center, or right (center means the text is center-aligned).",
      parameters: Type.Object({
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
        text: Type.String(),
        position: Type.Optional(Type.String()),
        size: Type.Optional(Type.Number({ description: "Font size in points." })),
        bold: Type.Optional(Type.Boolean()),
        align: Type.Optional(Type.String({ description: "left, center, or right." })),
      }),
      prepare: stringArgs,
      target: () => document.querySelector('[aria-label="Text box"]') ?? canvas(),
      execute({ slide, text, position, size, bold, align }) {
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const alignment = align === "center" || align === "right" || align === "left" ? align : "left";
        const { x, y } = place(position, 400, 80, ctx.deck());
        const el: SlideElement = {
          id: crypto.randomUUID(),
          type: "text",
          x,
          y,
          width: 400,
          height: 80,
          content: text,
          fontSize: size ?? 22,
          fontFamily: "Arial",
          color: "#1e293b",
          bold: bold || undefined,
          align: alignment,
        };
        update(id, (s) => ({ ...s, elements: [...s.elements, el] }));
        ctx.select(id, el.id);
        const style = [bold ? "bold" : "", alignment === "center" ? "centered" : alignment === "right" ? "right-aligned" : ""].filter(Boolean).join(" and ");
        return `Added a text box "${text}" to slide ${index + 1} "${titleOf(ctx.deck().slides[id])}"${style ? `, ${style}` : ""}.`;
      },
    }),
    tool({
      name: "format_text_box",
      label: "Format text box",
      description:
        "Change every word in a text box that is already on a slide. `text` is the box's text, so the title is left alone when you name a different box. font is a typeface (Georgia, Montserrat, Source Sans, Arial, Trebuchet MS) and marks that box as overriding the theme, so a later theme change leaves its font alone. italic makes every word italic. bold and align (left, center, or right) change every word. This does not add a box. To style one word inside the box (only that word bold, italic, or the accent colour) and leave the other words in the theme style, use format_words. format_words does not mark the box as overriding the theme.",
      parameters: Type.Object({
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
        text: Type.Optional(Type.String({ description: "Words in the box to format." })),
        font: Type.Optional(Type.String({ description: "Typeface, such as Georgia. Marks the box as overriding the theme." })),
        italic: Type.Optional(Type.Boolean({ description: "True makes the words italic." })),
        bold: Type.Optional(Type.Boolean()),
        align: Type.Optional(Type.String({ description: "left, center, or right." })),
      }),
      prepare(args) {
        const next = stringArgs(args);
        if (next.font === undefined) {
          const alias = next.fontFamily ?? next.font_family ?? next.typeface;
          if (typeof alias === "string") next.font = alias;
        }
        if (typeof next.font === "string" && /\bitalic\b/i.test(next.font) && next.italic === undefined) next.italic = true;
        if (next.text === undefined && typeof next.content === "string") next.text = next.content;
        delete next.fontFamily;
        delete next.font_family;
        delete next.typeface;
        delete next.content;
        return next;
      },
      target: () => canvas(),
      execute({ slide, text, font, italic, bold, align }) {
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const alignment = align === "center" || align === "right" || align === "left" ? align : undefined;
        const fontChoice = font !== undefined ? canonicalFont(String(font)) : undefined;
        const italicOn = italic ?? fontChoice?.italic;
        if (bold === undefined && alignment === undefined && !fontChoice?.font && italicOn === undefined)
          throw new ToolError("Say what to change: font (Georgia, Montserrat, Source Sans, Arial, or Trebuchet MS), italic, bold, or align left, center, or right. To style one word, use format_words.");
        let label = "";
        let boxId = "";
        let wordStyled = "";
        update(id, (s) => {
          const boxes = s.elements.filter((e) => e.type === "text");
          const fold = (value: string) =>
            value
              .toLowerCase()
              .replace(/[‘’ʼ]/g, "'")
              .replace(/[“”]/g, '"')
              .replace(/center/g, "centre")
              .replace(/\s+/g, " ")
              .trim()
              .replace(/^["']+|["']+$/g, "");
          const wanted = text ? fold(text) : "";
          const found = wanted ? boxes.find((e) => fold(e.content ?? "").includes(wanted)) : undefined;
          const box = found ?? (text ? undefined : (boxes.find((e) => e.id === ctx.selectedElementId) ?? boxes.at(-1)));
          if (!box) throw new ToolError(text ? `No text box on slide ${index + 1} contains "${text}".` : "No text box is selected.");
          label = box.content ?? "";
          boxId = box.id;
          const single = text?.trim().replace(/^["']+|["']+$/g, "") ?? "";
          const oneWord = !!single && !/\s/.test(single);
          if (oneWord && fold(box.content ?? "") !== fold(single) && !fontChoice?.font && !alignment && (bold === true || italicOn === true)) {
            const patches: WordPatch[] = [];
            if (bold === true) patches.push({ word: single, bold: true });
            if (italicOn === true) patches.push({ word: single, italic: true });
            const painted = paintWordStyles(box, patches);
            label = painted.element.content ?? "";
            wordStyled = painted.summary;
            return { ...s, elements: s.elements.map((e) => (e.id === box.id ? painted.element : e)) };
          }
          const patch: Partial<SlideElement> = {};
          if (bold !== undefined) patch.bold = bold;
          if (alignment) patch.align = alignment;
          if (fontChoice?.font) Object.assign(patch, handStyle({ fontFamily: fontChoice.font }));
          if (italicOn !== undefined) patch.italic = italicOn;
          if (fontChoice?.font || italicOn !== undefined) patch.runs = undefined;
          return { ...s, elements: s.elements.map((e) => (e.id === box.id ? { ...e, ...patch } : e)) };
        });
        ctx.select(id, boxId);
        if (wordStyled)
          return `In "${label}" on slide ${index + 1}, ${wordStyled}. The other words stay in the theme style. This text box does not override the theme.`;
        const style = [
          italicOn === true ? "italic" : italicOn === false ? "not italic" : "",
          fontChoice?.font ?? "",
          bold === true ? "bold" : bold === false ? "not bold" : "",
          alignment === "center" ? "centered" : alignment ?? "",
        ].filter(Boolean).join(" ");
        const override = fontChoice?.font ? " It overrides the theme, so a later theme change leaves this box alone." : "";
        const everyWord =
          (bold === true || italicOn === true) && label.trim().split(/\s+/).length > 1 && !fontChoice?.font
            ? " That changed every word in the box. To change one word only, call format_words with bold, italic, or accent set to that word. The other words stay in the theme style, and the box is not marked as overriding the theme."
            : "";
        return `The text box "${label}" on slide ${index + 1} is now ${style}.${override}${everyWord}`;
      },
    }),
    tool({
      name: "format_words",
      label: "Format words",
      description:
        "Style one or more words inside a text box. The other words stay in the theme style, and the box is not marked as overriding the theme. Call it once. text is the box, such as Spring fair for the community centre. bold is the single word to make bold, such as fair. italic is the single word to make italic, such as centre. accent is the single word to colour with the theme accent (the accent green), such as community. Do not pass true: pass the word. Do not use format_text_box for one word, because that styles every word in the box.",
      parameters: Type.Object({
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
        text: Type.Optional(Type.String({ description: "The text box that contains the words, copied from the slide." })),
        bold: Type.Optional(Type.String({ description: "The one word to make bold. Other words stay as they are." })),
        italic: Type.Optional(Type.String({ description: "The one word to make italic. Other words stay as they are." })),
        accent: Type.Optional(Type.String({ description: "The one word to colour with the theme accent. On Meadow that is the accent green." })),
      }),
      prepare: wordStyleArgs,
      target: () => canvas(),
      execute({ slide, text, bold, italic, accent }) {
        const deck = ctx.deck();
        const { id, index } = findSlide(deck, asWhich(slide), ctx.activeSlideId);
        const patches: WordPatch[] = [];
        if (bold) patches.push({ word: bold, bold: true });
        if (italic) patches.push({ word: italic, italic: true });
        if (accent) {
          const color = deck.theme?.accent;
          if (!color) throw new ToolError("This deck has no theme accent, so there is no accent green to use.");
          patches.push({ word: accent, color: normalizeHex(color) ?? color });
        }
        if (!patches.length)
          throw new ToolError('Pass the word itself. bold is the word to make bold, italic the word to italicise, and accent the word to colour with the theme accent.');
        let label = "";
        let boxId = "";
        let summary = "";
        update(id, (s) => {
          const boxes = s.elements.filter((e) => e.type === "text");
          const box = findTextBox(boxes, text, patches.map((patch) => patch.word));
          if (!box)
            throw new ToolError(
              text
                ? `No text box on slide ${index + 1} contains "${text}".`
                : `No text box on slide ${index + 1} contains ${patches.map((patch) => `"${patch.word}"`).join(", ")}.`,
            );
          const painted = paintWordStyles(box, patches);
          label = painted.element.content ?? "";
          boxId = box.id;
          summary = painted.summary;
          return { ...s, elements: s.elements.map((e) => (e.id === box.id ? painted.element : e)) };
        });
        ctx.select(id, boxId);
        return `In "${label}" on slide ${index + 1}, ${summary}. The other words stay in the theme style. This text box does not override the theme.`;
      },
    }),
    tool({
      name: "insert_image",
      label: "Insert image",
      description: "Ask the user to choose a picture and put it on a slide at a position.",
      parameters: Type.Object({ slide: Type.Optional(Type.Number()), position: Type.Optional(Type.String()) }),
      target: () => document.querySelector('[aria-label="Insert image"]'),
      async execute({ slide, position }) {
        const file = await requestFile("Choose a picture for the slide", "image/png,image/jpeg,image/gif,image/webp");
        if (!file) return "The user did not choose a picture.";
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        const src = await ctx.readImage(file);
        const { x, y } = place(position, 360, 240, ctx.deck());
        const el: SlideElement = { id: crypto.randomUUID(), type: "image", x, y, width: 360, height: 240, src, alt: file.name };
        update(id, (s) => ({ ...s, elements: [...s.elements, el] }));
        ctx.select(id, el.id);
        return `Put "${file.name}" on slide ${index + 1}.`;
      },
    }),
    tool({
      name: "insert_table",
      label: "Insert table",
      description: "Put a table on a slide. `cells` is a list of rows, each a list of cell texts; the first row is the header.",
      parameters: Type.Object({ slide: Type.Optional(Type.Number()), cells: Type.Array(Type.Array(Type.String())) }),
      target: () => canvas(),
      execute({ slide, cells }) {
        if (!cells.length) throw new ToolError("Give at least one row.");
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        const width = 800,
          height = Math.min(360, 40 * cells.length);
        const { x, y } = place("bottom", width, height, ctx.deck());
        const el: SlideElement = { id: crypto.randomUUID(), type: "table", x, y: Math.max(140, y), width, height, rows: cells };
        update(id, (s) => ({ ...s, elements: [...s.elements, el] }));
        ctx.select(id, el.id);
        return `Added a ${cells.length}-row table to slide ${index + 1}.`;
      },
    }),
  ];
}
