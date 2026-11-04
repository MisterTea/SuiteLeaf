import {
  fontKerning,
  kernFeature,
  officeSingleSpacing,
  paintFontFamily,
  tabAdvance,
  type TabStop,
  type TextRun,
} from "@suiteleaf/core";

export function plainText(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join("");
}

export function cleanRun(run: TextRun): TextRun {
  const next: TextRun = { text: run.text };
  if (run.bold) next.bold = true;
  if (run.italic) next.italic = true;
  if (run.underline) next.underline = true;
  if (run.strike) next.strike = true;
  if (run.color) next.color = run.color;
  if (run.highlight) next.highlight = run.highlight;
  if (run.stroke) next.stroke = run.stroke;
  if (run.strokeWidth) next.strokeWidth = run.strokeWidth;
  if (run.shadow) next.shadow = run.shadow;
  if (run.gradient) next.gradient = run.gradient;
  if (run.reflection) next.reflection = run.reflection;
  if (run.fontSize) next.fontSize = run.fontSize;
  if (run.caps) next.caps = run.caps;
  if (run.baseline) next.baseline = run.baseline;
  if (run.scriptScale) next.scriptScale = true;
  if (run.font) next.font = run.font;
  if (run.paragraphBreak) next.paragraphBreak = true;
  if (run.paraMargin) next.paraMargin = run.paraMargin;
  if (run.paraHang) next.paraHang = run.paraHang;
  if (run.paraFirst) next.paraFirst = run.paraFirst;
  if (run.paraTab) next.paraTab = run.paraTab;
  if (run.paraTabs?.length) next.paraTabs = run.paraTabs;
  if (run.spaceBefore) next.spaceBefore = run.spaceBefore;
  if (run.paraAlign) next.paraAlign = run.paraAlign;
  if (run.paraLine) next.paraLine = run.paraLine;
  if (run.unbroken) next.unbroken = true;
  if (run.tracking) next.tracking = run.tracking;
  if (run.fraction) next.fraction = run.fraction;
  if (run.bulletSrc) next.bulletSrc = run.bulletSrc;
  if (run.href) next.href = run.href;
  return next;
}

function sameStyle(a: TextRun, b: TextRun): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.strike === !!b.strike &&
    (a.color ?? "") === (b.color ?? "") &&
    (a.highlight ?? "") === (b.highlight ?? "") &&
    (a.stroke ?? "") === (b.stroke ?? "") &&
    (a.strokeWidth ?? 0) === (b.strokeWidth ?? 0) &&
    (a.shadow?.x ?? 0) === (b.shadow?.x ?? 0) &&
    (a.shadow?.y ?? 0) === (b.shadow?.y ?? 0) &&
    (a.shadow?.blur ?? 0) === (b.shadow?.blur ?? 0) &&
    (a.shadow?.color ?? "") === (b.shadow?.color ?? "") &&
    (a.gradient ?? "") === (b.gradient ?? "") &&
    (a.reflection?.startAlpha ?? -1) === (b.reflection?.startAlpha ?? -1) &&
    (a.reflection?.endAlpha ?? -1) === (b.reflection?.endAlpha ?? -1) &&
    (a.reflection?.endPos ?? -1) === (b.reflection?.endPos ?? -1) &&
    a.fontSize === b.fontSize &&
    a.caps === b.caps &&
    a.baseline === b.baseline &&
    !!a.scriptScale === !!b.scriptScale &&
    (a.font ?? "") === (b.font ?? "") &&
    (a.paraMargin ?? 0) === (b.paraMargin ?? 0) &&
    (a.paraHang ?? 0) === (b.paraHang ?? 0) &&
    (a.spaceBefore ?? 0) === (b.spaceBefore ?? 0) &&
    (a.paraAlign ?? "") === (b.paraAlign ?? "") &&
    (a.paraLine ?? 0) === (b.paraLine ?? 0) &&
    !!a.unbroken === !!b.unbroken &&
    (a.tracking ?? 0) === (b.tracking ?? 0) &&
    !a.paragraphBreak &&
    !b.paragraphBreak &&
    !a.fraction &&
    !b.fraction &&
    (a.bulletSrc ?? "") === (b.bulletSrc ?? "") &&
    (a.href ?? "") === (b.href ?? "")
  );
}

/** Keep each run's style when a slice is replaced. Text inserted at a run's edge takes the style before it. */
export function replaceRunRange(
  runs: readonly TextRun[],
  from: number,
  to: number,
  replacement: string,
): TextRun[] {
  const next: TextRun[] = [];
  let cursor = 0;
  let inserted = false;
  for (const run of runs) {
    const start = cursor;
    const end = cursor + run.text.length;
    cursor = end;
    if (from === to ? inserted || start > from || end < from : end <= from || start >= to) {
      next.push(run);
      continue;
    }
    const before = run.text.slice(0, Math.max(0, from - start));
    const after = run.text.slice(Math.max(0, to - start));
    if (before) next.push({ ...run, text: before });
    if (!inserted) {
      next.push({ ...run, text: replacement });
      inserted = true;
    }
    if (after) next.push({ ...run, text: after });
  }
  return mergeRuns(next);
}

export function mergeRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const cleaned = cleanRun(run);
    const prev = out[out.length - 1];
    // A hard break is its own run. Joining it with the next word would drop the line.
    if (
      prev &&
      sameStyle(prev, cleaned) &&
      !prev.text.includes("\n") &&
      !cleaned.text.includes("\n")
    )
      prev.text += cleaned.text;
    else out.push({ ...cleaned });
  }
  return out;
}

/** Runs that actually differ from the box. An empty list means "use the box style". */
export function runsOf(el: {
  content?: string;
  runs?: TextRun[];
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}): TextRun[] {
  if (el.runs?.length) return mergeRuns(el.runs);
  const run: TextRun = { text: el.content ?? "" };
  if (el.bold) run.bold = true;
  if (el.italic) run.italic = true;
  if (el.underline) run.underline = true;
  return run.text ? [run] : [];
}

export function hasTextRuns(el: { runs?: TextRun[] }): boolean {
  return !!el.runs?.some(
    (run) =>
      run.bold ||
      run.italic ||
      run.underline ||
      run.strike ||
      run.color ||
      run.highlight ||
      run.stroke ||
      run.strokeWidth ||
      run.shadow ||
      run.fontSize ||
      run.caps ||
      run.baseline ||
      run.paragraphBreak ||
      run.href ||
      run.paraMargin ||
      run.paraHang ||
      run.spaceBefore ||
      run.paraAlign ||
      run.paraLine ||
      run.unbroken ||
      run.fraction ||
      run.font ||
      run.bulletSrc,
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const HEX = /^#[0-9a-f]{6}$/i;

export function normalizeColor(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (HEX.test(trimmed)) return trimmed;
  const rgb = trimmed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!rgb) return undefined;
  const channel = (part: string) =>
    Math.max(0, Math.min(255, Number(part)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`;
}

/**
 * A newline followed by more text is one break. A block with `min-height`
 * would add a second line, which drops the next paragraph down the box.
 * A trailing break still has to occupy a line, or bottom-aligned text sits
 * one line too low.
 */
function lineBreakHtml(run: TextRun, trailing: boolean): string {
  const data: string[] = [];
  const rules: string[] = [];
  if (run.fontSize) {
    rules.push(`font-size:calc(${run.fontSize} * var(--slide-pt, 1) * 1px)`);
    data.push(`data-font-size="${run.fontSize}"`);
  }
  if (run.paragraphBreak) data.push('data-paragraph-break="1"');
  if (trailing) rules.unshift("display:block", "min-height:1lh");
  const attrs = data.length ? ` ${data.join(" ")}` : "";
  const style = rules.length ? ` style="${rules.join(";")}"` : "";
  return trailing
    ? `<span${attrs} style="${rules.join(";")}"></span>`
    : `<span${attrs}${style}><br></span>`;
}

type LineBox = { runs: TextRun[]; font?: number };

/** Hard breaks in one paragraph. A break's size counts toward the line it ends. */
function lineBoxes(paragraph: readonly TextRun[]): LineBox[] {
  const lines: LineBox[] = [{ runs: [] }];
  for (const run of paragraph) {
    const line = lines[lines.length - 1];
    if (run.text !== "\n") {
      line.runs.push(run);
      // A symbol bullet is drawn larger than the words. Its size is the glyph,
      // not the line, or the extra leading pushes the last item off the slide.
      if (run.fontSize && !isSymbolBullet(run))
        line.font = Math.max(line.font ?? 0, run.fontSize);
      continue;
    }
    if (run.fontSize) line.font = Math.max(line.font ?? 0, run.fontSize);
    lines.push({ runs: [] });
  }
  return lines;
}

function mixedLineSizes(lines: readonly LineBox[]) {
  const sizes = new Set(lines.map((line) => line.font).filter((size) => size));
  return sizes.size > 1;
}

/**
 * A list marker is one glyph plus a space. The hanging indent is the gutter:
 * words start at the paragraph margin, not after the glyph's own width.
 * Wingdings' space is a full em, so that space is kept for editing but draws
 * at zero width inside the slot.
 */
function isBulletMarker(run: TextRun): boolean {
  return /^\S{1,8} $/.test(run.text);
}

function isSymbolBullet(run: TextRun): boolean {
  return isBulletMarker(run) && (!!run.font || !!run.bulletSrc);
}

function pictureBulletHtml(run: TextRun): string | undefined {
  const src = run.bulletSrc;
  if (!src || !/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/.test(src))
    return;
  const size = run.fontSize && run.fontSize > 0 ? run.fontSize : 12;
  return `<img alt="" src="${src}" style="height:calc(${size} * var(--slide-pt, 1) * 1px);width:auto;vertical-align:-0.15em"/>`;
}

/** A list marker at the start of a longer run, such as MARP's `• words`. */
function takeMarker(run: TextRun): { marker: TextRun; rest: TextRun } | null {
  const match = /^([•●○◦▪▸►‣*-]|\d{1,3}[.)]) ([\s\S]*)$/.exec(run.text);
  if (!match) return null;
  return {
    marker: { ...run, text: `${match[1]} ` },
    rest: { ...run, text: match[2] },
  };
}

function bulletSlotHtml(
  run: TextRun,
  kern: number | undefined,
  slot: number,
  fixed = false,
): string {
  const picture = pictureBulletHtml(run);
  // The slot is an inline block, so it would inherit the paragraph's negative
  // text-indent and paint the marker one gutter further left than the words.
  // A fixed marker sits in the gutter. A contenteditable host does not paint
  // the part of the first line that a negative text-indent pulls into the padding.
  const fixedAttr = fixed ? ' contenteditable="false" class="slide-bullet-slot slide-bullet-fixed"' : ' class="slide-bullet-slot"';
  // Float the marker into the gutter. A negative text-indent is not painted
  // while the box is being edited, so the first bullet would disappear.
  const fixedStyle = fixed
    ? `display:inline-block;width:0;transform:translateX(${slidePx(-slot)});text-indent:0;line-height:inherit`
    : `display:inline-block;min-width:${slidePx(slot)};vertical-align:baseline;text-indent:0`;
  if (picture) {
    return `<span${fixedAttr} data-bullet-src="${run.bulletSrc}" style="${fixedStyle};line-height:0">${picture}<span style="font-size:0;line-height:0">${escapeHtml(run.text)}</span></span>`;
  }
  let glyph = runSpan({ ...run, text: run.text.slice(0, -1) }, kern);
  // The marker glyph is drawn without its trailing space, so it is no longer
  // recognized as a bullet. A zero line box keeps a larger square off the strut.
  glyph = glyph.includes('style="')
    ? glyph.replace('style="', 'style="line-height:0;')
    : glyph.replace("<span", '<span style="line-height:0"');
  let space = runSpan({ ...run, text: " " }, kern);
  space = space.includes('style="')
    ? space.replace(/style="([^"]*)"/, 'style="$1;font-size:0;line-height:0"')
    : space.replace("<span", '<span style="font-size:0;line-height:0"');
  return `<span${fixedAttr} style="${fixedStyle}">${glyph}${space}</span>`;
}

function htmlForRuns(
  runs: readonly TextRun[],
  kern: number | undefined,
  slot: number,
  hanging = false,
): string {
  let source = runs;
  if (slot > 0 && runs[0] && !isBulletMarker(runs[0])) {
    const split = takeMarker(runs[0]);
    if (split) source = [split.marker, split.rest, ...runs.slice(1)];
  }
  let placed = false;
  return source
    .map((run) => {
      const painted = {
        ...run,
        paraMargin: undefined,
        paraHang: undefined,
        spaceBefore: undefined,
        paraAlign: undefined,
      };
      if (!placed && slot > 0 && isBulletMarker(painted)) {
        placed = true;
        // A paragraph hang already pulls the first line back with text-indent.
        // Floating the marker as well paints it on top of the words, or clips it.
        // A box-level hang (MARP) has no paragraph indent, so the marker sits in the gutter.
        const fixed = !hanging && !runs.some((item) => item.paraHang);
        return bulletSlotHtml(painted, kern, slot, fixed);
      }
      return runSpan(painted, kern);
    })
    .join("");
}

function lineBoxHtml(
  line: LineBox,
  kern: number | undefined,
  slot: number,
  hanging = false,
  lineFactor?: number,
): string {
  const rules = ["display:block", "margin:0"];
  const data = ['data-slide-line="1"'];
  if (line.font) {
    rules.push(`font-size:calc(${line.font} * var(--slide-pt, 1) * 1px)`);
    data.push(`data-font-size="${line.font}"`);
    if (lineFactor) rules.push(`line-height:${lineHeightCss(line.font, lineFactor)}`);
  }
  const inner = htmlForRuns(line.runs, kern, slot, hanging);
  if (!inner) rules.push("min-height:1lh");
  return `<span ${data.join(" ")} style="${rules.join(";")}">${inner}</span>`;
}

type TabMetrics = {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  /** Unitless line-height of the box, used when a paragraph does not set its own. */
  lineHeight?: number;
};

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Width in points. The canvas font size is the point size, matching `calc(pt * --slide-pt)`. */
function textWidthPt(text: string, run: TextRun, metrics?: TabMetrics): number {
  const size = run.fontSize || metrics?.fontSize || 18;
  const bold = run.bold ?? metrics?.bold ?? false;
  const italic = run.italic ?? metrics?.italic ?? false;
  const family = (run.font || metrics?.fontFamily || "Calibri").replace(/["'\\]/g, "");
  if (!text) return 0;
  if (typeof document !== "undefined" && measureCtx === undefined)
    measureCtx = document.createElement("canvas").getContext("2d");
  if (measureCtx) {
    measureCtx.font = `${italic ? "italic " : ""}${bold ? "700 " : ""}${size}px ${family}`;
    const width = measureCtx.measureText(text).width;
    if (width > 0) return width;
  }
  return text.length * size * 0.5;
}

function tabSpacer(points: number): string {
  const width = Math.round(points * 100) / 100;
  if (!(width > 0)) return "";
  return `<span style="display:inline-block;width:calc(${width} * var(--slide-pt, 1) * 1px)"></span>`;
}

/** One visual line, split into text and tab pieces. */
function tabPieces(paragraph: readonly TextRun[]): { run: TextRun; text: string; tab: boolean }[][] {
  const lines: { run: TextRun; text: string; tab: boolean }[][] = [[]];
  for (const run of paragraph) {
    for (const bit of run.text.split(/(\t|\n)/)) {
      if (bit === "\n") {
        lines.push([]);
        continue;
      }
      if (!bit) continue;
      lines[lines.length - 1].push(
        bit === "\t" ? { run, text: "", tab: true } : { run, text: bit, tab: false },
      );
    }
  }
  return lines;
}

function tabbedParagraphHtml(
  paragraph: readonly TextRun[],
  kern: number | undefined,
  metrics: TabMetrics | undefined,
  mark?: TextRun,
): string {
  const head = paragraph.find((run) => run.paraTab || run.paraTabs?.length) ?? paragraph[0];
  const interval = mark?.paraTab || head?.paraTab || 72;
  const stored: readonly TabStop[] = mark?.paraTabs ?? head?.paraTabs ?? [];
  // The first line starts at the hanging indent, left of the paragraph margin.
  // PowerPoint's leading tab lands on that margin, before the default stops.
  const hang = mark?.paraHang || head?.paraHang || 0;
  // Default stops are measured from the text box's left inset, the same edge
  // as the paragraph margin. The line itself starts at the bullet.
  const origin = mark?.paraMargin || head?.paraMargin || 0;
  return tabPieces(paragraph)
    .map((pieces, lineIndex) => {
      const stops: readonly TabStop[] =
        lineIndex === 0 && hang > 0 ? [{ pos: origin + hang, align: "l" }, ...stored] : stored;
      // Continuation lines begin at the text margin, to the right of the
      // bullet gutter. Default tab stops remain relative to the box inset.
      let x = origin + (lineIndex > 0 ? hang : 0);
      let html = "";
      pieces.forEach((piece, index) => {
        // Tabs anywhere in the paragraph must not change its bullet gutter.
        // The plain-text path splits a combined marker/words run into a slot;
        // do the same before measuring tab positions here.
        const split = index === 0 && hang > 0 && lineIndex === 0 && !piece.tab
          ? takeMarker({ ...piece.run, text: piece.text }) : null;
        if (split) {
          html += bulletSlotHtml(split.marker, kern, hang);
          html += runSpan(split.rest, kern);
          x = origin + hang + textWidthPt(split.rest.text, split.rest, metrics);
          return;
        }
        // The marker sits in the gutter. Its symbol-font space is a full em,
        // so measuring that space pushes the next tab onto the following stop.
        if (index === 0 && hang > 0 && isSymbolBullet(piece.run)) {
          html += runSpan({ ...piece.run, text: piece.text }, kern);
          x = Math.max(x, origin + hang);
          return;
        }
        if (piece.tab) {
          let following = "";
          for (let next = index + 1; next < pieces.length; next++) {
            if (pieces[next].tab) break;
            following += pieces[next].text;
          }
          const gap = tabAdvance(x, following, stops, interval, (text) =>
            textWidthPt(text, piece.run, metrics),
          );
          html += tabSpacer(gap);
          x += gap;
          return;
        }
        html += runSpan({ ...piece.run, text: piece.text }, kern);
        x += textWidthPt(piece.text, piece.run, metrics);
      });
      return html;
    })
    .join("<br>");
}

function renderParagraphInner(
  paragraph: readonly TextRun[],
  kern: number | undefined,
  slot: number,
  metrics?: TabMetrics,
  hanging = false,
  mark?: TextRun,
): string {
  if (paragraph.some((run) => run.text.includes("\t")))
    return tabbedParagraphHtml(paragraph, kern, metrics, mark);
  const lines = lineBoxes(paragraph);
  // The box strut is the first run. A smaller line after a hard break would
  // otherwise stay as tall as the title and clip the lines below it.
  if (lines.length > 1 && mixedLineSizes(lines))
    return lines
      .map((line, index) => lineBoxHtml(line, kern, index === 0 ? slot : 0, hanging, mark?.paraLine || metrics?.lineHeight))
      .join("");
  let lastContent = -1;
  for (let i = 0; i < paragraph.length; i++) {
    if (paragraph[i].text !== "\n") lastContent = i;
  }
  return paragraph
    .map((run, index) => {
      if (run.text === "\n") return lineBreakHtml(run, index > lastContent);
      // DrawingML hangs ordinary spaces at a hard line end. CSS `pre`
      // includes them in centered/right alignment; keep them in the DOM for
      // editing while excluding their width from the painted line.
      const atLineEnd = index === paragraph.length - 1 || paragraph[index + 1].text === "\n";
      const tail = atLineEnd ? / +$/.exec(run.text)?.[0] : undefined;
      if (tail) {
        const visible = { ...run, text: run.text.slice(0, -tail.length) };
        return htmlForRuns([visible], kern, index === 0 ? slot : 0, hanging) +
          `<span data-slide-hanging-space="1" style="display:inline-block;width:0;overflow:hidden;font-size:0;line-height:0">${tail}</span>`;
      }
      return htmlForRuns([run], kern, index === 0 ? slot : 0, hanging);
    })
    .join("");
}

function runSpan(run: TextRun, kern?: number): string {
      const styles: string[] = [];
      const data: string[] = [];
      if (run.bold) {
        styles.push("font-weight:700");
        data.push('data-bold="1"');
      }
      if (run.italic) {
        styles.push("font-style:italic");
        data.push('data-italic="1"');
      }
      const decoration = [run.underline ? "underline" : "", run.strike ? "line-through" : ""]
        .filter(Boolean)
        .join(" ");
      if (decoration) {
        styles.push(`text-decoration:${decoration}`);
        if (run.underline) data.push('data-underline="1"');
        if (run.strike) data.push('data-strike="1"');
      }
      const color =
        run.color === "transparent" ? "transparent" : run.color ? normalizeColor(run.color) : undefined;
      if (color && !run.gradient) {
        styles.push(`color:${color}`);
        data.push(`data-color="${color}"`);
      }
      const highlight = run.highlight ? normalizeColor(run.highlight) : undefined;
      if (highlight) {
        styles.push(`background-color:${highlight}`);
        data.push(`data-highlight="${highlight}"`);
      }
      const stroke = run.stroke ? normalizeColor(run.stroke) : undefined;
      if (stroke && run.strokeWidth) {
        styles.push(
          `-webkit-text-stroke:calc(${run.strokeWidth} * var(--slide-pt, 1) * 1px) ${stroke}`,
          "paint-order:stroke fill",
          run.gradient ? "-webkit-text-fill-color:transparent" : "-webkit-text-fill-color:currentColor",
        );
        data.push(`data-stroke="${stroke}"`, `data-stroke-width="${run.strokeWidth}"`);
      }
      if (run.shadow) {
        const shift = (value: number) => `calc(${value} * var(--slide-pt, 1) * 1px)`;
        styles.push(
          `text-shadow:${shift(run.shadow.x)} ${shift(run.shadow.y)} ${shift(run.shadow.blur)} ${run.shadow.color}`,
        );
        data.push('data-shadow="1"');
      }
      if (run.gradient) {
        styles.push(
          `background-image:${run.gradient}`,
          "background-clip:text",
          "-webkit-background-clip:text",
          "color:transparent",
          "-webkit-text-fill-color:transparent",
        );
        data.push('data-gradient="1"');
      }
      if (run.fontSize) {
        styles.push(`font-size:calc(${run.fontSize} * var(--slide-pt, 1) * 1px)`);
        if (kern) styles.push(`font-kerning:${fontKerning(kern, run.fontSize)}`, `font-feature-settings:${kernFeature(kern, run.fontSize)}`);
        data.push(`data-font-size="${run.fontSize}"`);
      }
      if (run.caps === "all") styles.push("text-transform:uppercase");
      // The app turns font synthesis off. Small caps still have to be drawn.
      if (run.caps === "small")
        styles.push("font-variant-caps:small-caps", "font-synthesis:small-caps");
      if (run.baseline) {
        // PowerPoint's baseline shift does not grow the line box. Vertical
        // alignment does: the shifted box is part of the line, so a subscript
        // pushes every following line down. A relative offset paints the
        // glyph above or below the baseline and leaves the line height alone.
        styles.push(
          "position:relative",
          `top:${-run.baseline / 100}em`,
          "line-height:0",
        );
        data.push(`data-baseline="${run.baseline}"`);
        if (run.scriptScale) data.push('data-script-scale="1"');
      }
      if (run.tracking) {
        styles.push(`letter-spacing:calc(${run.tracking} * var(--slide-pt, 1) * 1px)`);
        data.push(`data-tracking="${run.tracking}"`);
      }
      if (run.bulletSrc && pictureBulletHtml(run))
        data.push(`data-bullet-src="${run.bulletSrc}"`);
      if (run.font) {
        const family = run.font.replace(/["'\\<>]/g, "");
        // Single quotes: the style attribute is already double-quoted.
        styles.push(`font-family:${paintFontFamily(family)}`);
        data.push(`data-font="${family}"`);
      }
      // The glyph may be taller than the words. A zero line box keeps that
      // height from spreading the paragraph.
      if (isSymbolBullet(run) && !run.bulletSrc) styles.push("line-height:0");
      if (run.paragraphBreak) data.push('data-paragraph-break="1"');
      const href =
        run.href && /^(https?:|mailto:)/i.test(run.href) && !/[\s<>"]/.test(run.href)
          ? run.href
          : "";
      if (href) data.push(`data-href="${escapeHtml(href)}"`);
      const style = styles.length ? ` style="${styles.join(";")}"` : "";
      const attrs = data.length ? ` ${data.join(" ")}` : "";
      // latinLnBrk="0" keeps a short hyphenated word together. A word joiner
      // is missing from the PDF face and paints as a gap, so the token is a
      // nowrap span instead. A URL or other long token still breaks at the hyphen.
      if (run.fraction) {
        return `<span${attrs}${style}>${fractionHtml(run)}</span>`;
      }
      const picture = pictureBulletHtml(run);
      const body = picture
        ? `${picture}<span style="font-size:0;line-height:0">${escapeHtml(run.text)}</span>`
        : run.unbroken
          ? glueShortHyphenHtml(run.text)
          : paintRunText(run.text);
      // The outer em is the inherited size, so the baseline percent stays put
      // while the glyphs shrink to PowerPoint's script size.
      const painted = run.scriptScale ? `<span style="font-size:0.65em">${body}</span>` : body;
      const span = `<span${attrs}${style}>${painted}</span>`;
      return href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${span}</a>`
        : span;
}

/** A combining accent the math face does not draw, painted above its base. */
function paintRunText(text: string): string {
  if (!/[\u0300-\u036f]/.test(text)) return escapeHtml(text);
  const chars = Array.from(text);
  let html = "";
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].codePointAt(0) ?? 0;
    if (code >= 0x0300 && code <= 0x036f) {
      html += escapeHtml(chars[i]);
      continue;
    }
    const marks: string[] = [];
    let j = i + 1;
    while (j < chars.length) {
      const next = chars[j].codePointAt(0) ?? 0;
      if (next < 0x0300 || next > 0x036f) break;
      marks.push(next === 0x0302 ? "\u02C6" : chars[j]);
      j += 1;
    }
    if (!marks.length) {
      html += escapeHtml(chars[i]);
      continue;
    }
    html += `<span style="position:relative;display:inline-block">${escapeHtml(chars[i])}<span style="position:absolute;left:0;width:100%;top:-1.15em;text-align:center;font-size:0.72em;line-height:1">${escapeHtml(marks.join(""))}</span></span>`;
    i = j - 1;
  }
  return html;
}

/** Stacked Office math. Subscripts inside the fraction are smaller than the line. */
function fractionHtml(run: TextRun): string {
  const fraction = run.fraction;
  if (!fraction) return escapeHtml(run.text);
  const piece = (part: { text: string; script?: "sub" | "sup" }) => {
    const shift =
      part.script === "sub"
        ? "font-size:0.65em;vertical-align:-0.25em"
        : part.script === "sup"
          ? "font-size:0.65em;vertical-align:0.4em"
          : "";
    const style = shift ? ` style="${shift}"` : "";
    return `<span${style}>${escapeHtml(part.text)}</span>`;
  };
  const line = (parts: { text: string; script?: "sub" | "sup" }[]) =>
    parts.map(piece).join("") || "&#8203;";
  // An inline limit stays on the baseline. Stacking it lifts the operator
  // into the word before it.
  if (fraction.bar === false) {
    return `<span style="white-space:nowrap">${line(fraction.num)}<span style="font-size:0.65em;vertical-align:-0.25em">${line(fraction.den)}</span></span>`;
  }
  const rule = "border-top:0.06em solid currentColor;";
  return `<span style="display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;line-height:1;margin:0 0.06em"><span>${line(fraction.num)}</span><span style="${rule}">${line(fraction.den)}</span></span>`;
}

/** A short hyphenated word stays one unit. A long token or a path can still break. */
export function glueShortHyphenHtml(text: string): string {
  return text
    .split(/(\s+)/)
    .map((part) => {
      if (!part || /^\s+$/.test(part)) return escapeHtml(part);
      if (
        part.includes("-") &&
        part.length <= 32 &&
        !part.includes("/") &&
        !part.includes("\\")
      ) {
        return `<span style="white-space:nowrap">${escapeHtml(part)}</span>`;
      }
      return escapeHtml(part);
    })
    .join("");
}

/** The paragraph strut follows the words. A leading symbol bullet is only a marker. */
function strutMark(mark: TextRun | undefined, paragraph: readonly TextRun[]): TextRun | undefined {
  // A paragraph break carries size/spacing but no font. In a mixed-family
  // box the inherited family can have a different baseline, enlarging every
  // line beyond its requested pitch. Use the paragraph's words for the strut.
  if (mark && !mark.font) {
    const font = paragraph.find((run) => run.text.trim() && !isSymbolBullet(run))?.font;
    if (font) mark = { ...mark, font };
  }
  if (!mark || !isSymbolBullet(mark)) return mark;
  let size = 0;
  for (const run of paragraph) {
    if (!run.text || run.text === "\n" || run.baseline || isSymbolBullet(run) || !run.fontSize) continue;
    if (run.fontSize > size) size = run.fontSize;
  }
  if (size) return { ...mark, fontSize: size };
  const next = { ...mark };
  delete next.fontSize;
  return next;
}

/** Slide units track the canvas. `--slide-pt` also shrinks point sizes, which these lengths already did at import. */
function slidePx(value: number): string {
  return `calc(${value}px * var(--canvas-fit, 1))`;
}

/** PowerPoint advances by the exact line height, so lines alternate 19 and 20px for a 19.33px pitch. */
function lineHeightCss(fontSize: number, factor: number): string {
  return `calc(${fontSize} * var(--slide-pt, 1) * ${factor} * 1px)`;
}

/**
 * CSS takes half of a tight line's missing height from above the glyphs and
 * half from below. PowerPoint keeps the descent at the bottom of the line box
 * and takes it all from above, so the words paint higher. The next paragraph
 * still starts where this one's box ends. Extra spacing above 100% is split
 * evenly in both.
 */
function leadingShift(fontSize: number, factor: number, metrics?: TabMetrics): string | undefined {
  const single = officeSingleSpacing(metrics?.fontFamily);
  if (!(single > 0) || factor > single - 0.005) return;
  return `calc((${lineHeightCss(fontSize, factor)} - ${fontSize} * var(--slide-pt, 1) * ${single} * 1px) / 2)`;
}

function paragraphStyle(run: TextRun | undefined, empty = false, metrics?: TabMetrics): string {
  if (!run) return "display:block;margin:0";
  const rules = ["display:block", "margin:0"];
  if (run.font) rules.push(`font-family:${paintFontFamily(run.font)}`);
  // Wrapped lines start at the margin plus the hang. A negative indent pulls
  // the first line back. `hanging` is dropped by the print engine, which left
  // every continuation flush with the bullet.
  const hang = run.paraHang || 0;
  const margin = run.paraMargin || 0;
  if (hang || margin) rules.push(`padding-left:${slidePx(margin + hang)}`);
  if (run.paraFirst) rules.push(`text-indent:${slidePx(run.paraFirst)}`);
  else if (hang) rules.push(`text-indent:${slidePx(-hang)}`);
  if (run.spaceBefore) rules.push(`margin-top:${slidePx(run.spaceBefore)}`);
  if (run.paraAlign) rules.push(`text-align:${run.paraAlign}`);
  const lineFactor = run.paraLine || metrics?.lineHeight;
  if (run.fontSize && lineFactor)
    rules.push(`line-height:${lineHeightCss(run.fontSize, lineFactor)}`);
  else if (run.paraLine) rules.push(`line-height:${run.paraLine}`);
  // A paragraph without its own size uses the box's size and line height.
  const strutSize = run.fontSize || metrics?.fontSize;
  const shift = strutSize && lineFactor ? leadingShift(strutSize, lineFactor, metrics) : undefined;
  if (shift) rules.push("position:relative", `top:${shift}`);
  if (run.fontSize)
    rules.push(`font-size:calc(${run.fontSize} * var(--slide-pt, 1) * 1px)`);
  // An empty block has no line box, so a blank paragraph would vanish.
  // `1lh` does not resolve while line-height is a rounded length, which
  // drops the blank line and pulls the next paragraph up.
  if (empty && run.fontSize && lineFactor)
    rules.push(`min-height:${lineHeightCss(run.fontSize, lineFactor)}`);
  else if (empty) rules.push("min-height:1lh");
  return rules.join(";");
}

/** A downward DrawingML reflection under the whole paragraph, fading as stored. */
function reflectionCss(reflection: NonNullable<TextRun["reflection"]>): string {
  const start = Math.round(reflection.startAlpha * 1000) / 1000;
  const end = Math.round(reflection.endAlpha * 1000) / 1000;
  const pos = Math.round(reflection.endPos * 1000) / 10;
  return `-webkit-box-reflect:below 0 linear-gradient(to bottom, rgba(0,0,0,${start}), rgba(0,0,0,${end}) ${pos}%, rgba(0,0,0,0) ${pos}%)`;
}

function paragraphAttrs(run: TextRun | undefined): string {
  if (!run) return "";
  const data = ["data-slide-para=\"1\""];
  if (run.paraMargin) data.push(`data-para-margin="${run.paraMargin}"`);
  if (run.paraHang) data.push(`data-para-hang="${run.paraHang}"`);
  if (run.paraFirst) data.push(`data-para-first="${run.paraFirst}"`);
  if (run.paraTab) data.push(`data-para-tab="${run.paraTab}"`);
  if (run.spaceBefore) data.push(`data-space-before="${run.spaceBefore}"`);
  if (run.paraAlign) data.push(`data-para-align="${run.paraAlign}"`);
  if (run.paraLine) data.push(`data-para-line="${run.paraLine}"`);
  return ` ${data.join(" ")}`;
}

/**
 * Each paragraph is its own block. A break between paragraphs is the gap
 * between those blocks, not an extra empty line inside the first one.
 */
export function runsToHtml(
  runs: readonly TextRun[],
  kern?: number,
  hang?: number,
  metrics?: TabMetrics,
): string {
  const paragraphs: TextRun[][] = [];
  const marks: TextRun[] = [];
  for (const run of runs) {
    if (run.paragraphBreak && run.text === "\n") {
      paragraphs.push([]);
      marks.push(run);
      continue;
    }
    if (!paragraphs.length) {
      paragraphs.push([]);
      marks.push(run);
    }
    paragraphs[paragraphs.length - 1].push(run);
  }
  return paragraphs
    .map((paragraph, index) => {
      const mark = marks[index];
      const slot = mark?.paraHang || hang || 0;
      const hanging = !!(mark?.paraHang || paragraph.some((run) => run.paraHang));
      const inner = renderParagraphInner(paragraph, kern, slot, metrics, hanging, mark);
      const strut = strutMark(mark, paragraph);
      const reflection = paragraph.find((run) => run.reflection)?.reflection;
      // A blank paragraph is one line. min-height on an empty block collapses
      // with the next margin, so the following text sits a line too high.
      const body = inner.length === 0 ? "<br>" : inner;
      const style = `${paragraphStyle(strut, false, metrics)}${reflection ? `;${reflectionCss(reflection)}` : ""}`;
      const reflectAttr = reflection ? ` data-reflection="1"` : "";
      return `<span class="slide-para" data-para-index="${index}"${paragraphAttrs(mark)}${reflectAttr} style="${style}">${body}</span>`;
    })
    .join("");
}

/** HTML for a text box, including per-word runs. The wrapper carries the box style. */
export function textInnerHtml(el: {
  content?: string;
  runs?: TextRun[];
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  kern?: number;
  hang?: number;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
}): string {
  if (!hasTextRuns(el)) return escapeHtml(el.content ?? "");
  return runsToHtml(runsOf(el), el.kern, el.hang, {
    fontFamily: el.fontFamily,
    fontSize: el.fontSize,
    bold: el.bold,
    italic: el.italic,
    lineHeight: el.lineHeight,
  });
}
