import { fontKerning, type SlideElement, type TextRun } from "@suiteleaf/core";

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
      run.paragraphBreak,
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

/** `kern` is the box's kerning size; a run with its own size is judged on that. */
export function runsToHtml(runs: readonly TextRun[], kern?: number): string {
  return runs
    .map((run) => {
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
        if (kern) styles.push(`font-kerning:${fontKerning(kern, run.fontSize)}`);
        data.push(`data-font-size="${run.fontSize}"`);
      }
      if (run.caps === "all") styles.push("text-transform:uppercase");
      if (run.caps === "small") styles.push("font-variant-caps:small-caps");
      if (run.baseline) {
        styles.push(`vertical-align:${run.baseline / 100}em`);
        data.push(`data-baseline="${run.baseline}"`);
      }
      if (run.font) {
        const family = run.font.replace(/["\\<>]/g, "");
        styles.push(
          `font-family:${/[\s,]/.test(family) ? `"${family}"` : family}`,
        );
        data.push(`data-font="${family}"`);
      }
      if (run.paragraphBreak) data.push('data-paragraph-break="1"');
      const style = styles.length ? ` style="${styles.join(";")}"` : "";
      const attrs = data.length ? ` ${data.join(" ")}` : "";
      return `<span${attrs}${style}>${escapeHtml(run.text)}</span>`;
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
