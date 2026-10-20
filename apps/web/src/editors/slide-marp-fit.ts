import type { Presentation, Slide, SlideElement, TextRun } from "@suiteleaf/core";
import { Marp } from "@marp-team/marp-core";
import beamUtCss from "./themes/beam_ut.css?raw";
import { newSlide } from "./slide-layouts";
import { mergeConsecutiveText } from "./slide-marp";

const LOGO_KEY = "beam-ut-logo";
/** Bump when measured boxes should be placed again on decks saved with an older fit. */
export const MARP_FIT_REVISION = 3;
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

function dataUriToBlob(uri: string): Blob | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const data = match[3] ?? "";
  if (match[2]) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(data)], { type: mime });
}

function blobMarkdown(markdown: string, assets: Record<string, string>) {
  const urls = new Map<string, string>();
  let next = markdown;
  const paths = Object.keys(assets).sort((a, b) => b.length - a.length);
  for (const path of paths) {
    const blob = dataUriToBlob(assets[path]);
    if (!blob) continue;
    const url = URL.createObjectURL(blob);
    urls.set(url, path);
    next = next.split(path).join(url);
  }
  return {
    markdown: next,
    urls,
    revoke() {
      for (const url of urls.keys()) URL.revokeObjectURL(url);
    },
  };
}

function pushRun(runs: TextRun[], text: string, bold: boolean, italic: boolean) {
  if (!text) return;
  const prev = runs[runs.length - 1];
  if (prev && !!prev.bold === bold && !!prev.italic === italic) {
    prev.text += text;
    return;
  }
  const run: TextRun = { text };
  if (bold) run.bold = true;
  if (italic) run.italic = true;
  runs.push(run);
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
      pushRun(runs, text, !!style && weight(style) >= 600, style?.fontStyle === "italic");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const child = node as HTMLElement;
    if (child.tagName === "BR") {
      pushRun(runs, "\n", false, false);
      return;
    }
    if (child.classList.contains("katex")) {
      const tex = child.querySelector("annotation")?.textContent?.trim();
      if (tex) pushRun(runs, `$${tex}$`, false, false);
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
} {
  const content = runs.map((run) => run.text).join("");
  const styled = runs.filter((run) => run.text.trim());
  const bold = styled.length > 0 && styled.every((run) => run.bold);
  const italic = styled.length > 0 && styled.every((run) => run.italic);
  const uniform = styled.every((run) => !!run.bold === bold && !!run.italic === italic);
  if (uniform) {
    return {
      content,
      ...(bold ? { bold: true as const } : {}),
      ...(italic ? { italic: true as const } : {}),
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

  const addImage = (img: HTMLImageElement) => {
    const frame = box(img);
    if (frame.width < 2 || frame.height < 2) {
      frame.width = Math.max(frame.width, 240);
      frame.height = Math.max(frame.height, 140);
    }
    const raw = img.getAttribute("src") || img.src;
    const path = urls.get(raw) ?? [...urls.entries()].find(([url]) => raw.endsWith(url) || url.endsWith(raw))?.[1];
    if (!path) return;
    placed.content.push({
      id: crypto.randomUUID(),
      type: "image",
      ...frame,
      src: path,
      alt: img.alt && !/^(width|height):/.test(img.alt) ? img.alt : "Image",
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
      // The marker sits about one em left of the item, outside its box.
      frame.x = Math.max(0, round(frame.x - fontSize));
      frame.width = round(frame.width + fontSize);
      const marker: TextRun = { text: ordered ? `${index + 1}. ` : "• " };
      const styled = collapse([marker, ...runsIn(item)]);
      styled.content = tidyLines(styled.content, false);
      const linePx = parseFloat(style.lineHeight);
      const lineHeight = Number.isFinite(linePx) ? round(linePx / (parseFloat(style.fontSize) || fontSize)) : undefined;
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
        ...(lineHeight ? { lineHeight } : {}),
        ...(styled.bold ? { bold: true } : {}),
        ...(styled.italic ? { italic: true } : {}),
        ...(styled.runs ? { runs: styled.runs } : {}),
      });
      for (const nested of item.querySelectorAll(":scope > ul, :scope > ol"))
        addList(nested as HTMLElement);
    });
  };

  const addBlock = (el: HTMLElement) => {
    if (el.tagName === "UL" || el.tagName === "OL") {
      addList(el);
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
    const text: SlideElement = {
      id: crypto.randomUUID(),
      type: "text",
      ...frame,
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

  const walk = (node: Element) => {
    const tag = node.tagName;
    if (tag === "IMG") {
      addImage(node as HTMLImageElement);
      return;
    }
    if (tag === "SCRIPT" || tag === "STYLE") return;
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
      if (rows.length && frame.width > 2) {
        placed.content.push({
          id: crypto.randomUUID(),
          type: "table",
          ...frame,
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
  walk(section);

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
export async function fitMarpDeck(deck: Presentation): Promise<Presentation | null> {
  if (typeof document === "undefined" || !deck.marpSource?.trim()) return null;
  const rendered = blobMarkdown(deck.marpSource, deck.marpAssets ?? {});
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;left:0;top:0;width:1280px;height:720px;opacity:0;pointer-events:none;border:0;z-index:-1";
  try {
    const marp = new Marp({ html: true, math: "katex" });
    marp.themeSet.add(beamUtCss);
    const { html, css } = marp.render(rendered.markdown);
    const scripts = [...html.matchAll(/<script[\s\S]*?<\/script>/gi)]
      .map((match) => match[0])
      .filter((script) => script.includes("marp-auto-scaling"));
    const body = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    const docHtml = `<!DOCTYPE html><html><head>${scripts.join("")}<style>
      html,body{margin:0;background:#fff}
      svg[data-marpit-svg]{width:1280px;height:720px;display:block}
      ${css}
    </style></head><body>${body}</body></html>`;
    document.body.appendChild(iframe);
    iframe.srcdoc = docHtml;
    const loaded = await new Promise<Document | null>((resolve) => {
      const deadline = window.setTimeout(() => resolve(iframe.contentDocument), 8000);
      iframe.onload = () => {
        window.clearTimeout(deadline);
        resolve(iframe.contentDocument);
      };
    });
    const view = loaded ?? iframe.contentDocument;
    if (!view?.querySelector("section")) return null;
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
    // `pre` cannot be a customized built-in here, so MARP rewrites it to <marp-pre>
    // once the element exists. The scaling script runs in the head, before these do.
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
    const width = deck.width || 960;
    const height = deck.height || 540;
    const sections = [...view.querySelectorAll("section")];
    if (!sections.length) return null;
    const slides: Record<string, Slide> = { ...deck.slides };
    const order = [...deck.slideOrder];
    sections.forEach((section, index) => {
      const placed = measureSection(section as HTMLElement, rendered.urls, width, height, { used: false });
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
        elements,
        background: { color: "#ffffff" },
      };
    });
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
