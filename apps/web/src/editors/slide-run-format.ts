import type { SlideElement, TextRun } from "@suiteleaf/core";
import { hasTextRuns, mergeRuns, normalizeColor, plainText, runsOf } from "./slide-runs";

/**
 * Per-word styles live on runs. The box itself stays on the theme: a bold or
 * coloured word does not set themeOverride, so the other words still pick up
 * the next theme's font and colour. A run colour is the exception.
 */

type Mark = "bold" | "italic" | "underline";

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
