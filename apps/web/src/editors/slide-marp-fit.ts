import type { Presentation, Slide, SlideElement, TextRun } from "@suiteleaf/core";
import beamUtCss from "./themes/beam_ut.css?raw";
import { newSlide } from "./slide-layouts";
import { keepElementIds, mergeConsecutiveText } from "./slide-marp";
import { marpEngine, SOURCE_LINES } from "./slide-marp-engine";
import { holdAssetUrl, marpDocument, releaseAssetUrl } from "./slide-marp-render";
import { prepareMarpDocument } from "./slide-marp-runtime";
import { isHtmlOnly, mapMarpSource, type LineRange } from "./slide-marp-source";

const LOGO_KEY = "beam-ut-logo";
/** Bump when measured boxes should be placed again on decks saved with an older fit. */
export const MARP_FIT_REVISION = 5;
const SOURCE = `[${SOURCE_LINES}]`;
const BLOCKS = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "P",
  "UL",
  "OL",
  "PRE",
  "BLOCKQUOTE",
]);

const round = (n: number) => Math.round(n * 100) / 100;

function weight(style: CSSStyleDeclaration) {
  const value = style.fontWeight;
  if (value === "bold") return 700;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 400;
}

function hexColor(color: string): string | undefined {
  if (!color || color === "transparent") return undefined;
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(color);
  if (!match) return color;
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (alpha < 0.4) return undefined;
  const channel = (part: string) =>
    Math.max(0, Math.min(255, Math.round(Number(part))))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(match[1])}${channel(match[2])}${channel(match[3])}`;
}

/** The markdown with each asset path replaced by a held object URL, and the way back. */
function blobMarkdown(markdown: string, assets: Record<string, string>) {
  const urls = new Map<string, string>();
  const held: string[] = [];
  let next = markdown;
  const paths = Object.keys(assets).sort((a, b) => b.length - a.length);
  for (const path of paths) {
    if (!next.includes(path)) continue;
    const url = holdAssetUrl(assets[path]);
    held.push(assets[path]);
    urls.set(url, path);
    next = next.split(path).join(url);
  }
  return {
    markdown: next,
    urls,
    revoke() {
      for (const uri of held) releaseAssetUrl(uri);
    },
  };
}

type RunStyle = { bold?: boolean; italic?: boolean; underline?: boolean; color?: string };

function pushRun(runs: TextRun[], text: string, style: RunStyle = {}) {
  if (!text) return;
  const prev = runs[runs.length - 1];
  if (
    prev &&
    !!prev.bold === !!style.bold &&
    !!prev.italic === !!style.italic &&
    !!prev.underline === !!style.underline &&
    prev.color === style.color
  ) {
    prev.text += text;
    return;
  }
  const run: TextRun = { text };
  if (style.bold) run.bold = true;
  if (style.italic) run.italic = true;
  if (style.underline) run.underline = true;
  if (style.color) run.color = style.color;
  runs.push(run);
}

/** Underline and color written in the slide's HTML. A theme's link styling is not markup. */
function markedStyle(node: Node, root: HTMLElement): { underline?: boolean; color?: string } {
  let underline = false;
  let color: string | undefined;
  for (let at = node.parentElement; at && at !== root; at = at.parentElement) {
    const decoration = `${at.style?.textDecorationLine ?? ""} ${at.style?.textDecoration ?? ""}`;
    if (at.tagName === "U" || at.tagName === "INS" || decoration.includes("underline")) underline = true;
    if (!color) {
      const written = at.style?.color || (at.tagName === "FONT" ? at.getAttribute("color") : "");
      if (written) color = hexColor(getComputedStyle(at).color);
    }
  }
  return { ...(underline ? { underline } : {}), ...(color ? { color } : {}) };
}

function tidyLines(content: string, pre: boolean) {
  if (pre) return content.replace(/^\n+|\n+$/g, "");
  return content
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function runsIn(el: HTMLElement): TextRun[] {
  const pre = isPre(el) || !!el.closest("pre, marp-pre");
  const runs: TextRun[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      const style = parent ? getComputedStyle(parent) : null;
      let text = node.textContent ?? "";
      if (!pre) {
        text = text.replace(/\s+/g, " ");
        if (text === " " && (runs.length === 0 || runs[runs.length - 1]?.text.endsWith("\n"))) return;
      }
      pushRun(runs, text, {
        bold: !!style && weight(style) >= 600,
        italic: style?.fontStyle === "italic",
        ...markedStyle(node, el),
      });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const child = node as HTMLElement;
    if (child.tagName === "BR") {
      pushRun(runs, "\n");
      return;
    }
    if (child.classList.contains("katex")) {
      const tex = child.querySelector("annotation")?.textContent?.trim();
      if (tex) pushRun(runs, `$${tex}$`);
      return;
    }
    if (child.tagName === "IMG" || child.tagName === "UL" || child.tagName === "OL") return;
    for (const nested of child.childNodes) walk(nested);
  };
  walk(el);
  return runs;
}

function collapse(runs: TextRun[]): {
  content: string;
  runs?: TextRun[];
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
} {
  const content = runs.map((run) => run.text).join("");
  const styled = runs.filter((run) => run.text.trim());
  const bold = styled.length > 0 && styled.every((run) => run.bold);
  const italic = styled.length > 0 && styled.every((run) => run.italic);
  const underline = styled.length > 0 && styled.every((run) => run.underline);
  const uniform = styled.every(
    (run) =>
      !!run.bold === bold && !!run.italic === italic && !!run.underline === underline && !run.color,
  );
  if (uniform) {
    return {
      content,
      ...(bold ? { bold: true as const } : {}),
      ...(italic ? { italic: true as const } : {}),
      ...(underline ? { underline: true as const } : {}),
    };
  }
  return { content, runs };
}

function mathSource(el: HTMLElement): string | null {
  if (!el.querySelector(".katex")) return null;
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.textContent?.trim() && !node.parentElement?.closest(".katex")) return null;
    node = walker.nextNode();
  }
  const tex = [...el.querySelectorAll("annotation")].map((item) => item.textContent?.trim() ?? "").filter(Boolean);
  if (!tex.length) return null;
  return tex.map((item) => `$$\n${item}\n$$`).join("\n\n");
}

function plainEnough(el: HTMLElement) {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("img, .katex").forEach((child) => child.remove());
  return !!copy.textContent?.replace(/\s/g, "");
}

function scalingSvg(host: Element) {
  const nested = host.shadowRoot?.querySelector("marp-auto-scaling");
  return nested?.shadowRoot?.querySelector("svg") ?? host.shadowRoot?.querySelector("svg") ?? null;
}

/** MARP shrinks code and display math that would overflow the slide. The SVG viewBox is the unscaled size. */
function fittedScale(el: HTMLElement): number {
  const hosts = [el, ...el.querySelectorAll("pre, span, marp-pre")];
  let scale = 1;
  for (const host of hosts) {
    const svg = scalingSvg(host);
    const box = svg?.querySelector("foreignObject");
    if (!svg || !box) continue;
    const unscaledWidth = parseFloat(box.getAttribute("width") || "");
    const unscaledHeight = parseFloat(box.getAttribute("height") || "");
    const visual = svg.getBoundingClientRect();
    if (unscaledWidth > 0 && visual.width > 0) scale = Math.min(scale, visual.width / unscaledWidth);
    if (unscaledHeight > 0 && visual.height > 0) scale = Math.min(scale, visual.height / unscaledHeight);
  }
  return scale > 0 ? scale : 1;
}

function isPre(el: Element) {
  return el.tagName === "PRE" || el.tagName === "MARP-PRE";
}

function readLines(el: Element | null): [number, number] | undefined {
  const match = /^(\d+),(\d+)$/.exec(el?.getAttribute(SOURCE_LINES) ?? "");
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

/** The markdown lines a block was written on. A list item stops where its nested list starts. */
function sourceLines(el: Element): [number, number] | undefined {
  const holder = el.matches(SOURCE)
    ? el
    : isPre(el)
      ? el.querySelector(SOURCE)
      : el.tagName === "IMG"
        ? el.closest(SOURCE)
        : null;
  const lines = readLines(holder);
  if (!lines || el.tagName !== "LI") return lines;
  const nested = readLines(el.querySelector(`:scope > ul${SOURCE}, :scope > ol${SOURCE}`));
  return nested && nested[0] > lines[0] ? [lines[0], Math.min(lines[1], nested[0])] : lines;
}

type Placed = {
  chrome: SlideElement[];
  content: SlideElement[];
  logo?: SlideElement;
};

function measureSection(
  section: HTMLElement,
  urls: Map<string, string>,
  deckWidth: number,
  deckHeight: number,
  heading: { used: boolean },
  html: LineRange[],
  source: string[],
): Placed {
  const origin = section.getBoundingClientRect();
  const scaleX = origin.width ? deckWidth / origin.width : 1;
  const scaleY = origin.height ? deckHeight / origin.height : 1;
  const placed: Placed = { chrome: [], content: [] };
  const box = (el: Element) => {
    const rect = el.getBoundingClientRect();
    return {
      x: round((rect.left - origin.left) * scaleX),
      y: round((rect.top - origin.top) * scaleY),
      width: round(rect.width * scaleX),
      height: round(rect.height * scaleY),
    };
  };
  /** How wide `text` is in the item's own font, in slide units. */
  const markerWidth = (item: HTMLElement, text: string) => {
    const probe = item.ownerDocument.createElement("span");
    probe.textContent = text;
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font-weight:inherit";
    item.appendChild(probe);
    const width = probe.getBoundingClientRect().width * scaleX;
    probe.remove();
    return width;
  };

  const addImage = (img: HTMLImageElement) => {
    const frame = box(img);
    if (frame.width < 2 || frame.height < 2) {
      frame.width = Math.max(frame.width, 240);
      frame.height = Math.max(frame.height, 140);
    }
    const raw = img.getAttribute("src") || img.src;
    const path = urls.get(raw) ?? [...urls.entries()].find(([url]) => raw.endsWith(url) || url.endsWith(raw))?.[1];
    if (!path) return;
    const lines = sourceLines(img);
    placed.content.push({
      id: crypto.randomUUID(),
      type: "image",
      ...frame,
      src: path,
      alt: img.alt && !/^(width|height):/.test(img.alt) ? img.alt : "Image",
      ...(lines ? { marpLines: lines } : {}),
    });
  };

  const addList = (list: HTMLElement) => {
    const ordered = list.tagName === "OL";
    const items = [...list.children].filter((child) => child.tagName === "LI") as HTMLElement[];
    items.forEach((item, index) => {
      for (const img of item.querySelectorAll("img")) {
        if (img.closest("li") === item) addImage(img);
      }
      const frame = box(item);
      if (frame.width < 2 || frame.height < 2) {
        for (const nested of item.querySelectorAll(":scope > ul, :scope > ol"))
          addList(nested as HTMLElement);
        return;
      }
      const style = getComputedStyle(item);
      const fontSize = parseFloat(style.fontSize) * scaleX * fittedScale(item) || 20;
      const marker: TextRun = { text: ordered ? `${index + 1}. ` : "• " };
      // The marker hangs outside the item, ending where its words begin.
      const measured = round(markerWidth(item, marker.text));
      const hang = measured > 0 && measured <= frame.x ? measured : 0;
      const shift = hang || fontSize;
      frame.x = Math.max(0, round(frame.x - shift));
      frame.width = round(frame.width + shift);
      const styled = collapse([marker, ...runsIn(item)]);
      styled.content = tidyLines(styled.content, false);
      const linePx = parseFloat(style.lineHeight);
      const lineHeight = Number.isFinite(linePx) ? round(linePx / (parseFloat(style.fontSize) || fontSize)) : undefined;
      const lines = sourceLines(item);
      placed.content.push({
        id: crypto.randomUUID(),
        type: "text",
        ...frame,
        content: styled.content,
        fontSize: round(fontSize),
        fontFamily: style.fontFamily,
        color: hexColor(style.color) ?? "#141414",
        align: "left",
        themeOverride: true,
        ...(lines ? { marpLines: lines } : {}),
        ...(lineHeight ? { lineHeight } : {}),
        ...(hang ? { hang } : {}),
        ...(styled.bold ? { bold: true } : {}),
        ...(styled.italic ? { italic: true } : {}),
        ...(styled.underline ? { underline: true } : {}),
        ...(styled.runs ? { runs: styled.runs } : {}),
      });
      for (const nested of item.querySelectorAll(":scope > ul, :scope > ol"))
        addList(nested as HTMLElement);
    });
  };

  const addHtml = (frames: ReturnType<typeof box>[], lines: [number, number]) => {
    const x = Math.min(...frames.map((f) => f.x));
    const y = Math.min(...frames.map((f) => f.y));
    placed.content.push({
      id: crypto.randomUUID(),
      type: "shape",
      shapeType: "rect",
      marpHtml: true,
      marpLines: lines,
      x,
      y,
      width: round(Math.max(...frames.map((f) => f.x + f.width)) - x),
      height: round(Math.max(...frames.map((f) => f.y + f.height)) - y),
    });
  };

  const addBlock = (el: HTMLElement) => {
    if (el.tagName === "UL" || el.tagName === "OL") {
      addList(el);
      return;
    }
    const own = el.tagName === "P" ? sourceLines(el) : undefined;
    if (own && isHtmlOnly(source.slice(own[0], own[1]).join("\n"))) {
      const frame = box(el);
      if (frame.width >= 2 && frame.height >= 2) addHtml([frame], own);
      return;
    }
    for (const img of el.querySelectorAll("img")) addImage(img);
    const tex = mathSource(el);
    if (!tex && !plainEnough(el)) return;
    const frame = box(el);
    if (frame.width < 2 || frame.height < 2) return;
    const style = getComputedStyle(el);
    const borderBox = { ...frame };
    // Text sits in the content box. A title pill's border and padding are part of
    // the orange shape, so leaving them in the text box puts the words too high.
    const edge = (side: string, scale: number) => {
      const border = parseFloat(style.getPropertyValue(`border-${side}-width`));
      const pad = parseFloat(style.getPropertyValue(`padding-${side}`));
      return (
        ((Number.isFinite(border) ? border : 0) + (Number.isFinite(pad) ? pad : 0)) * scale
      );
    };
    const top = edge("top", scaleY);
    const right = edge("right", scaleX);
    const bottom = edge("bottom", scaleY);
    const left = edge("left", scaleX);
    if (top || right || bottom || left) {
      frame.x = round(frame.x + left);
      frame.y = round(frame.y + top);
      frame.width = round(Math.max(8, frame.width - left - right));
      frame.height = round(Math.max(8, frame.height - top - bottom));
    }
    const katex = el.querySelector(".katex") as HTMLElement | null;
    const fontSource = katex ?? el;
    const fontStyle = fontSource === el ? style : getComputedStyle(fontSource);
    const shrink = fittedScale(el);
    const fontSize = parseFloat(fontStyle.fontSize) * scaleX * shrink;
    const linePx = parseFloat(fontStyle.lineHeight);
    const lineHeight =
      Number.isFinite(linePx) && fontSize
        ? round(linePx / (parseFloat(fontStyle.fontSize) || fontSize))
        : undefined;
    const indent = parseFloat(style.textIndent);
    const radius = parseFloat(style.borderTopLeftRadius) * scaleX;
    const fill = hexColor(style.backgroundColor);
    const color = hexColor(style.color) ?? "#141414";
    const align =
      style.textAlign === "center" || style.textAlign === "right" || style.textAlign === "justify"
        ? style.textAlign
        : "left";
    const styled = collapse(runsIn(el));
    if (!tex) styled.content = tidyLines(styled.content, isPre(el));
    const lines = sourceLines(el);
    const text: SlideElement = {
      id: crypto.randomUUID(),
      type: "text",
      ...frame,
      ...(lines ? { marpLines: lines } : {}),
      content: tex ?? styled.content,
      fontSize: round(fontSize) || 20,
      fontFamily: style.fontFamily,
      color,
      align,
      themeOverride: true,
      ...(lineHeight ? { lineHeight } : {}),
      ...(indent > 0.5 ? { padLeft: round(indent * scaleX) } : {}),
      ...(isPre(el)
        ? {
            preformatted: true,
            codeLanguage: [...(el.querySelector("code")?.classList ?? [])]
              .find((name) => name.startsWith("language-"))
              ?.slice("language-".length),
          }
        : {}),
      ...(el.tagName === "BLOCKQUOTE" && style.fontStyle === "italic" ? { italic: true } : {}),
      ...(tex ? { math: true } : {}),
      ...(!tex && styled.bold ? { bold: true } : {}),
      ...(!tex && styled.italic ? { italic: true } : {}),
      ...(!tex && styled.underline ? { underline: true } : {}),
      ...(!tex && styled.runs ? { runs: styled.runs } : {}),
    };
    if (/^H[1-6]$/.test(el.tagName) && !heading.used) {
      text.placeholder = "Click to add title";
      heading.used = true;
    }
    const borderWidth = parseFloat(style.borderTopWidth);
    const borderColor = hexColor(style.borderTopColor);
    if ((radius > 2 && fill) || (isPre(el) && fill)) {
      placed.chrome.push({
        id: crypto.randomUUID(),
        type: "shape",
        ...borderBox,
        shapeType: radius > 2 ? "roundRect" : "rect",
        ...(radius > 2 ? { radius: round(radius) } : {}),
        fill,
        ...(borderWidth > 0.5 && borderColor
          ? { stroke: borderColor, strokeWidth: round(borderWidth * scaleX) }
          : {}),
        themeOverride: true,
      });
    } else if (fill) text.fill = fill;
    if (el.tagName === "BLOCKQUOTE") {
      const quoteWidth = parseFloat(style.borderLeftWidth);
      const quoteColor = hexColor(style.borderLeftColor);
      if (quoteWidth > 0.5 && quoteColor) {
        placed.chrome.push({
          id: crypto.randomUUID(),
          type: "shape",
          x: borderBox.x,
          y: borderBox.y,
          width: round(Math.max(2, quoteWidth * scaleX)),
          height: borderBox.height,
          shapeType: "rect",
          fill: quoteColor,
          themeOverride: true,
        });
      }
    }
    placed.content.push(text);
  };

  const traced = [...section.querySelectorAll(SOURCE)];
  const rawHtml: { node: Element; after: number; before: number }[] = [];
  const isRawHtml = (node: Element) => {
    if (node.matches(SOURCE) || node.querySelector(SOURCE)) return false;
    // MARP's header and footer directives, not authored HTML.
    if (node === section.firstElementChild && node.tagName === "HEADER") return false;
    if (node === section.lastElementChild && node.tagName === "FOOTER") return false;
    const rect = node.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2;
  };
  const between = (node: Element) => {
    let after = 0;
    let before = Number.POSITIVE_INFINITY;
    for (const other of traced) {
      if (other.contains(node)) continue;
      const lines = readLines(other)!;
      const order = node.compareDocumentPosition(other);
      if (order & Node.DOCUMENT_POSITION_PRECEDING) after = Math.max(after, lines[1]);
      else if (order & Node.DOCUMENT_POSITION_FOLLOWING) before = Math.min(before, lines[0]);
    }
    return { node, after, before };
  };

  const walk = (node: Element) => {
    const tag = node.tagName;
    if (tag === "SCRIPT" || tag === "STYLE") return;
    if (isRawHtml(node)) {
      rawHtml.push(between(node));
      return;
    }
    if (tag === "IMG") {
      addImage(node as HTMLImageElement);
      return;
    }
    const wrapsMarkdown = !node.matches(SOURCE) && !isPre(node) && !!node.querySelector(SOURCE);
    if (wrapsMarkdown) {
      for (const child of node.children) walk(child);
      return;
    }
    if (
      BLOCKS.has(tag) ||
      isPre(node) ||
      (tag === "DIV" && node.querySelector(":scope > .katex, :scope > .katex-display"))
    ) {
      addBlock(node as HTMLElement);
      return;
    }
    if (tag === "TABLE") {
      const frame = box(node);
      const cellText = (cell: HTMLElement) => {
        let out = "";
        const visit = (item: Node) => {
          if (item.nodeType === Node.TEXT_NODE) out += item.textContent ?? "";
          else if (item.nodeType === Node.ELEMENT_NODE) {
            const child = item as HTMLElement;
            if (child.tagName === "CODE") out += `\`${child.textContent ?? ""}\``;
            else child.childNodes.forEach(visit);
          }
        };
        visit(cell);
        return out.replace(/\s+/g, " ").trim();
      };
      const rows = [...node.querySelectorAll("tr")].map((row) =>
        [...row.children].map((cell) => cellText(cell as HTMLElement)),
      );
      const fontSize = parseFloat(getComputedStyle(node).fontSize) * scaleX;
      const header = !!node.querySelector("th");
      const lines = sourceLines(node);
      if (rows.length && frame.width > 2) {
        placed.content.push({
          id: crypto.randomUUID(),
          type: "table",
          ...frame,
          ...(lines ? { marpLines: lines } : {}),
          rows,
          ...(Number.isFinite(fontSize) ? { fontSize: round(fontSize) } : {}),
          ...(header
            ? {
                cellMarks: rows.map((row, index) =>
                  row.map(() => (index === 0 ? { bold: true } : {})),
                ),
              }
            : {}),
        });
      }
      return;
    }
    for (const child of node.children) walk(child);
  };
  for (const child of section.children) walk(child);

  // Raw HTML has no source lines of its own. It belongs to the self-contained
  // HTML blocks written between the markdown blocks drawn before and after it.
  const groups = new Map<string, typeof rawHtml>();
  for (const item of rawHtml) {
    const key = `${item.after}:${item.before}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const items of groups.values()) {
    const { after, before } = items[0];
    const blocks = html.filter((range) => range[0] >= after && range[1] <= before);
    if (!blocks.length) continue;
    const pairs =
      blocks.length === items.length
        ? items.map((item, i) => ({ nodes: [item.node], lines: blocks[i] }))
        : [
            {
              nodes: items.map((item) => item.node),
              lines: [blocks[0][0], blocks[blocks.length - 1][1]] as [number, number],
            },
          ];
    for (const pair of pairs) addHtml(pair.nodes.map(box), pair.lines);
  }

  if (section.dataset.theme === "beam_ut") {
    const footer = round((22 / 540) * deckHeight);
    const half = round(deckWidth / 2);
    placed.chrome.unshift(
      {
        id: crypto.randomUUID(),
        type: "shape",
        x: 0,
        y: round(deckHeight - footer),
        width: half,
        height: footer,
        shapeType: "rect",
        fill: "#333F48",
        themeOverride: true,
      },
      {
        id: crypto.randomUUID(),
        type: "shape",
        x: half,
        y: round(deckHeight - footer),
        width: round(deckWidth - half),
        height: footer,
        shapeType: "rect",
        fill: "#BF5700",
        themeOverride: true,
      },
    );
    const before = getComputedStyle(section, "::before");
    const logoWidth = parseFloat(before.width);
    const logoHeight = parseFloat(before.height);
    if (before.display !== "none" && before.content !== "none" && logoWidth > 1 && logoHeight > 1) {
      const right = parseFloat(before.right);
      const top = parseFloat(before.top);
      placed.logo = {
        id: crypto.randomUUID(),
        type: "image",
        x: round(deckWidth - (Number.isFinite(right) ? right * scaleX : 0) - logoWidth * scaleX),
        y: round((Number.isFinite(top) ? top : 0) * scaleY),
        width: round(logoWidth * scaleX),
        height: round(logoHeight * scaleY),
        src: LOGO_KEY,
        alt: "The University of Texas at Austin",
      };
    }
  }
  placed.content = mergeConsecutiveText(placed.content);
  return placed;
}

/**
 * Place editable text boxes, pictures, and the theme's bars where MARP paints
 * them. The markdown stays the source for a later import; the boxes are what
 * the editor shows.
 */
/**
 * Let a waiting keystroke run before the next piece of work, and break up long
 * stretches, so laying out a deck never holds up typing for long.
 */
async function giveWay(turn: { started: number }) {
  const scheduling = (navigator as { scheduling?: { isInputPending?: () => boolean } }).scheduling;
  if (!scheduling?.isInputPending?.() && performance.now() - turn.started < 8) return;
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  await (scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)));
  turn.started = performance.now();
}

/**
 * Lay the deck out from MARP's rendering. It works in short turns, and returns
 * null without finishing once `stale` says newer markdown has made it pointless.
 */
export async function fitMarpDeck(
  deck: Presentation,
  { stale = () => false }: { stale?: () => boolean } = {},
): Promise<Presentation | null> {
  if (typeof document === "undefined" || !deck.marpSource?.trim()) return null;
  const rendered = blobMarkdown(deck.marpSource, deck.marpAssets ?? {});
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
  iframe.style.cssText =
    "position:fixed;left:0;top:0;width:1280px;height:720px;opacity:0;pointer-events:none;border:0;z-index:-1";
  try {
    const { html, css } = marpEngine({ sourceLines: true }).render(rendered.markdown);
    const parsed = new DOMParser().parseFromString(html, "text/html");
    document.body.appendChild(iframe);
    iframe.srcdoc = marpDocument({
      html,
      css: `html,body{background:#fff}\n${css}`,
      source: deck.marpSource,
      width: 1280,
      height: 720,
      scripts: [...parsed.querySelectorAll("script")],
      themedCharts: /chart-defaults\.js|CDLChart/.test(html),
    });
    const loaded = await new Promise<Document | null>((resolve) => {
      const deadline = window.setTimeout(() => resolve(iframe.contentDocument), 8000);
      iframe.onload = () => {
        window.clearTimeout(deadline);
        resolve(iframe.contentDocument);
      };
    });
    const view = loaded ?? iframe.contentDocument;
    if (stale() || !view?.querySelector("section")) return null;
    await prepareMarpDocument(view).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
    });
    iframe.style.height = `${Math.max(720, view.body.scrollHeight)}px`;
    await Promise.all(
      [...view.images].map(
        (img) =>
          img.complete
            ? undefined
            : new Promise<void>((resolve) => {
                const timer = window.setTimeout(resolve, 3000);
                img.onload = () => {
                  window.clearTimeout(timer);
                  resolve();
                };
                img.onerror = () => {
                  window.clearTimeout(timer);
                  resolve();
                };
              }),
      ),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // A `pre` that was not upgraded to MARP's customized built-in is rewritten
    // to <marp-pre>, which MARP scales the same way.
    for (const pre of [...view.querySelectorAll('pre[is="marp-pre"]')]) {
      if (pre.shadowRoot) continue;
      pre.outerHTML = pre.outerHTML.replace(/^<pre/i, "<marp-pre").replace(/<\/pre>$/i, "</marp-pre>");
    }
    const scaling = [...view.querySelectorAll<HTMLElement>("[data-auto-scaling]")];
    const settle = performance.now() + (scaling.length ? 1500 : 0);
    while (performance.now() < settle) {
      const ready = scaling.every((host) => {
        const svg = scalingSvg(host);
        const box = svg?.querySelector("foreignObject");
        if (!svg || !box || !(parseFloat(box.getAttribute("height") || "") > 0)) return false;
        const cap = parseFloat(getComputedStyle(svg).maxHeight);
        return !Number.isFinite(cap) || cap <= 0 || svg.getBoundingClientRect().height <= cap + 2;
      });
      if (ready) break;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (stale()) return null;
    const width = deck.width || 960;
    const height = deck.height || 540;
    const sections = [...view.querySelectorAll("section")];
    if (!sections.length) return null;
    const map = mapMarpSource(deck.marpSource);
    const slides: Record<string, Slide> = { ...deck.slides };
    const order = [...deck.slideOrder];
    const turn = { started: performance.now() };
    for (const [index, section] of sections.entries()) {
      await giveWay(turn);
      if (stale()) return null;
      const placed = measureSection(
        section as HTMLElement,
        rendered.urls,
        width,
        height,
        { used: false },
        map.slides[index]?.html ?? [],
        map.lines,
      );
      const elements = [
        ...placed.chrome,
        ...placed.content,
        ...(placed.logo ? [placed.logo] : []),
      ];
      const id = order[index] ?? crypto.randomUUID();
      if (!order[index]) order.push(id);
      const previous = slides[id] ?? { ...newSlide("blank"), id };
      slides[id] = {
        ...previous,
        id,
        elements: keepElementIds(previous.elements, elements),
        background: {
          color: hexColor(getComputedStyle(section).backgroundColor) ?? "#ffffff",
          ...(previous.background?.pinned ? { pinned: true } : {}),
        },
      };
    }
    const logo = /--ut-logo-data-uri:\s*url\('([^']+)'\)/.exec(beamUtCss)?.[1];
    const assets = { ...(deck.marpAssets ?? {}) };
    if (logo) assets[LOGO_KEY] = logo;
    return {
      ...deck,
      slideOrder: order.slice(0, sections.length),
      slides,
      marpAssets: Object.keys(assets).length ? assets : undefined,
      marpFit: MARP_FIT_REVISION,
    };
  } finally {
    rendered.revoke();
    iframe.remove();
  }
}
