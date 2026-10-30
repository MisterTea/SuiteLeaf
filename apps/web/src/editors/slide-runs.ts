import { fontKerning, kernFeature, type SlideElement, type TextRun } from "@suiteleaf/core";

/**
 * Per-word styles live on runs. The box itself stays on the theme: a bold or
 * coloured word does not set themeOverride, so the other words still pick up
 * the next theme's font and colour. A run colour is the exception.
 */

type Mark = "bold" | "italic" | "underline";

export function plainText(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join("");
}

export function cleanRun(run: TextRun): TextRun {
  const next: TextRun = { text: run.text };
  if (run.bold) next.bold = true;
  if (run.italic) next.italic = true;
  if (run.underline) next.underline = true;
  if (run.color) next.color = run.color;
  if (run.highlight) next.highlight = run.highlight;
  if (run.fontSize) next.fontSize = run.fontSize;
  if (run.caps) next.caps = run.caps;
  if (run.baseline) next.baseline = run.baseline;
  if (run.font) next.font = run.font;
  if (run.paragraphBreak) next.paragraphBreak = true;
  if (run.paraMargin) next.paraMargin = run.paraMargin;
  if (run.paraHang) next.paraHang = run.paraHang;
  if (run.spaceBefore) next.spaceBefore = run.spaceBefore;
  if (run.paraAlign) next.paraAlign = run.paraAlign;
  if (run.unbroken) next.unbroken = true;
  if (run.tracking) next.tracking = run.tracking;
  return next;
}

function sameStyle(a: TextRun, b: TextRun): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    (a.color ?? "") === (b.color ?? "") &&
    (a.highlight ?? "") === (b.highlight ?? "") &&
    a.fontSize === b.fontSize &&
    a.caps === b.caps &&
    a.baseline === b.baseline &&
    (a.font ?? "") === (b.font ?? "") &&
    (a.paraMargin ?? 0) === (b.paraMargin ?? 0) &&
    (a.paraHang ?? 0) === (b.paraHang ?? 0) &&
    (a.spaceBefore ?? 0) === (b.spaceBefore ?? 0) &&
    (a.paraAlign ?? "") === (b.paraAlign ?? "") &&
    !!a.unbroken === !!b.unbroken &&
    (a.tracking ?? 0) === (b.tracking ?? 0) &&
    !a.paragraphBreak &&
    !b.paragraphBreak
  );
}

/** Keep each run's style when a spelling change replaces a slice of the text. */
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
    if (end <= from || start >= to) {
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
    if (prev && sameStyle(prev, cleaned)) prev.text += cleaned.text;
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
      run.color ||
      run.highlight ||
      run.fontSize ||
      run.caps ||
      run.baseline ||
      run.paragraphBreak ||
      run.paraMargin ||
      run.paraHang ||
      run.spaceBefore ||
      run.paraAlign ||
      run.unbroken,
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
      if (run.underline) {
        styles.push("text-decoration:underline");
        data.push('data-underline="1"');
      }
      const color = run.color ? normalizeColor(run.color) : undefined;
      if (color) {
        styles.push(`color:${color}`);
        data.push(`data-color="${color}"`);
      }
      const highlight = run.highlight ? normalizeColor(run.highlight) : undefined;
      if (highlight) {
        styles.push(`background-color:${highlight}`);
        data.push(`data-highlight="${highlight}"`);
      }
      if (run.fontSize) {
        styles.push(`font-size:calc(${run.fontSize} * var(--slide-pt, 1) * 1px)`);
        if (kern) styles.push(`font-kerning:${fontKerning(kern, run.fontSize)}`, `font-feature-settings:${kernFeature(kern, run.fontSize)}`);
        data.push(`data-font-size="${run.fontSize}"`);
      }
      if (run.caps === "all") styles.push("text-transform:uppercase");
      if (run.caps === "small") styles.push("font-variant-caps:small-caps");
      if (run.baseline) {
        styles.push(`vertical-align:${run.baseline / 100}em`);
        data.push(`data-baseline="${run.baseline}"`);
      }
      if (run.tracking) {
        styles.push(`letter-spacing:calc(${run.tracking} * var(--slide-pt, 1) * 1px)`);
        data.push(`data-tracking="${run.tracking}"`);
      }
      if (run.font) {
        const family = run.font.replace(/["'\\<>]/g, "");
        // Single quotes: the style attribute is already double-quoted.
        styles.push(`font-family:'${family}'`);
        data.push(`data-font="${family}"`);
      }
      if (run.paragraphBreak) data.push('data-paragraph-break="1"');
      const style = styles.length ? ` style="${styles.join(";")}"` : "";
      const attrs = data.length ? ` ${data.join(" ")}` : "";
      // latinLnBrk="0" does not break after a hyphen. A word joiner is zero width.
      const text = run.unbroken ? run.text.replace(/-(?=\S)/g, "-\u2060") : run.text;
      return `<span${attrs}${style}>${escapeHtml(text)}</span>`;
}

function paragraphStyle(run: TextRun | undefined, empty = false): string {
  if (!run) return "display:block;margin:0";
  const rules = ["display:block", "margin:0"];
  if (run.paraMargin) rules.push(`padding-left:${run.paraMargin}px`);
  if (run.paraHang) rules.push(`text-indent:${run.paraHang}px hanging each-line`);
  if (run.spaceBefore) rules.push(`margin-top:${run.spaceBefore}px`);
  if (run.paraAlign) rules.push(`text-align:${run.paraAlign}`);
  // An empty block has no line box, so a blank paragraph would vanish.
  if (empty) rules.push("min-height:1lh");
  return rules.join(";");
}

function paragraphAttrs(run: TextRun | undefined): string {
  if (!run) return "";
  const data = ["data-slide-para=\"1\""];
  if (run.paraMargin) data.push(`data-para-margin="${run.paraMargin}"`);
  if (run.paraHang) data.push(`data-para-hang="${run.paraHang}"`);
  if (run.spaceBefore) data.push(`data-space-before="${run.spaceBefore}"`);
  if (run.paraAlign) data.push(`data-para-align="${run.paraAlign}"`);
  return ` ${data.join(" ")}`;
}

/** `kern` is the box's kerning size; a run with its own size is judged on that. */
export function runsToHtml(runs: readonly TextRun[], kern?: number): string {
  const leveled = runs.some(
    (run) => run.paraMargin || run.paraHang || run.spaceBefore || run.paraAlign,
  );
  if (!leveled) return runs.map((run) => runSpan(run, kern)).join("");
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
      const inner = paragraph
        .map((run) => runSpan({ ...run, paraMargin: undefined, paraHang: undefined, spaceBefore: undefined, paraAlign: undefined }, kern))
        .join("");
      return `<span class="slide-para"${paragraphAttrs(mark)} style="${paragraphStyle(mark, inner.length === 0)}">${inner}</span>`;
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
}): string {
  if (!hasTextRuns(el)) return escapeHtml(el.content ?? "");
  return runsToHtml(runsOf(el), el.kern);
}

export function formatRange(
  runs: readonly TextRun[],
  start: number,
  end: number,
  patch: Partial<Pick<TextRun, Mark | "color">>,
): TextRun[] {
  const text = plainText(runs);
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  if (a === b) return mergeRuns(runs);
  const next: TextRun[] = [];
  let cursor = 0;
  for (const run of runs) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    const cut = (from: number, to: number, extra?: typeof patch) => {
      if (to <= from) return;
      const sliced: TextRun = {
        ...run,
        ...extra,
        text: run.text.slice(from - runStart, to - runStart),
      };
      if (extra && "color" in extra && !extra.color) delete sliced.color;
      next.push(sliced);
    };
    cut(runStart, Math.min(runEnd, a));
    cut(Math.max(runStart, a), Math.min(runEnd, b), patch);
    cut(Math.max(runStart, b), runEnd);
    cursor = runEnd;
  }
  return mergeRuns(next);
}

export function rangeHas(
  runs: readonly TextRun[],
  start: number,
  end: number,
  key: Mark,
): boolean {
  const text = plainText(runs);
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  if (a === b) return false;
  let cursor = 0;
  let saw = false;
  for (const run of runs) {
    const runEnd = cursor + run.text.length;
    const left = Math.max(cursor, a);
    const right = Math.min(runEnd, b);
    if (right > left) {
      saw = true;
      if (!run[key]) return false;
    }
    cursor = runEnd;
  }
  return saw;
}

/** The colour shared by every character in the range, if there is one. */
export function rangeColor(
  runs: readonly TextRun[],
  start: number,
  end: number,
): string | undefined {
  const text = plainText(runs);
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  if (a === b) return undefined;
  let cursor = 0;
  let found: string | undefined;
  for (const run of runs) {
    const runEnd = cursor + run.text.length;
    const left = Math.max(cursor, a);
    const right = Math.min(runEnd, b);
    if (right > left) {
      const color = run.color ?? "";
      if (found === undefined) found = color;
      else if (found !== color) return undefined;
    }
    cursor = runEnd;
  }
  return found || undefined;
}

function stored(
  runs: TextRun[],
): Pick<SlideElement, "content" | "runs" | "bold" | "italic" | "underline"> {
  const content = plainText(runs);
  if (!hasTextRuns({ runs })) {
    return {
      content,
      runs: undefined,
      bold: false,
      italic: false,
      underline: false,
    };
  }
  // Box-level flags would paint every word, including ones the runs left alone.
  return { content, runs, bold: false, italic: false, underline: false };
}

export function styleSelection(
  el: Pick<SlideElement, "content" | "runs" | "bold" | "italic" | "underline">,
  start: number,
  end: number,
  action: { type: Mark } | { type: "color"; color: string },
): Pick<SlideElement, "content" | "runs" | "bold" | "italic" | "underline"> {
  const base = runsOf(el);
  if (!base.length) return stored([]);
  const runs =
    action.type === "color"
      ? formatRange(
          base,
          start,
          end,
          rangeColor(base, start, end) === action.color.toLowerCase()
            ? { color: "" }
            : { color: normalizeColor(action.color) ?? action.color },
        )
      : formatRange(base, start, end, {
          [action.type]: !rangeHas(base, start, end, action.type),
        });
  return stored(runs);
}

function paintRuns(
  runs: readonly TextRun[] | undefined,
  key: Mark,
  on: boolean,
): TextRun[] | undefined {
  if (!runs?.length) return undefined;
  return mergeRuns(
    runs.map((run) => {
      const next = { ...run };
      if (on) next[key] = true;
      else delete next[key];
      return next;
    }),
  );
}

/**
 * Style every word. Bolding the box marks it as overriding the theme, which is
 * the object-level action. A word selection must not call this.
 */
export function styleWholeBox(
  el: Pick<
    SlideElement,
    "content" | "runs" | "bold" | "italic" | "underline" | "themeOverride"
  >,
  key: Mark,
): Partial<SlideElement> {
  const on = hasTextRuns(el)
    ? !el.runs!.every((run) => !run.text || run[key])
    : !el[key];
  const runs = paintRuns(el.runs, key, on);
  const partial: Partial<SlideElement> = { [key]: on };
  if (runs) {
    partial.runs = hasTextRuns({ runs }) ? runs : undefined;
    if (!partial.runs) {
      partial.bold = key === "bold" ? on : false;
      partial.italic = key === "italic" ? on : false;
      partial.underline = key === "underline" ? on : false;
    }
  }
  if (key === "bold" && on) partial.themeOverride = true;
  return partial;
}
