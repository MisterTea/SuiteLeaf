import type { TextRun } from "@suiteleaf/core";


/** A change to the text of a slide box, in the coordinates of the text before the change. */
export interface ListEdit {
  text: string;
  caret: number;
  from: number;
  to: number;
  replacement: string;
  /** The box is a bullet list. Numbered lines keep their own markers. */
  bullet?: boolean;
}

function lineBounds(text: string, caret: number) {
  const start = text.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const next = text.indexOf("\n", caret);
  const end = next === -1 ? text.length : next;
  return { start, end, line: text.slice(start, end) };
}

function edit(
  text: string,
  from: number,
  to: number,
  replacement: string,
  caret: number,
  bullet?: boolean,
): ListEdit {
  return {
    text: text.slice(0, from) + replacement + text.slice(to),
    caret,
    from,
    to,
    replacement,
    bullet,
  };
}

/**
 * The Docs shortcut: a line that is only "- " (or "* " or "+ ") becomes a
 * bullet, and a line that is only "1. " becomes the first numbered item.
 * Numbered markers stay in the text. The bullet marker becomes "• ".
 */
export function listShortcut(text: string, caret: number): ListEdit | null {
  const { start, end, line } = lineBounds(text, caret);
  if (caret !== end) return null;
  const bullet = /^(\s*)[-*+]\s$/.exec(line);
  if (bullet) {
    const replacement = `${bullet[1]}• `;
    return edit(text, start, end, replacement, start + replacement.length, true);
  }
  return null;
}

/** Enter in a bullet or numbered line continues the list. An empty item leaves the list. */
export function continueList(text: string, caret: number): ListEdit | null {
  const { start, end, line } = lineBounds(text, caret);
  const bullet = /^(\s*)• (.*)$/.exec(line);
  const numbered = /^(\s*)(\d+)\. (.*)$/.exec(line);
  if (bullet) {
    const marker = `${bullet[1]}• `;
    if (caret < start + marker.length) return null;
    if (bullet[2] === "" && caret === end)
      return edit(text, start, end, "", start);
    const insert = `\n${marker}`;
    return edit(text, caret, caret, insert, caret + insert.length);
  }
  if (numbered) {
    const marker = `${numbered[1]}${numbered[2]}. `;
    if (caret < start + marker.length) return null;
    if (numbered[3] === "" && caret === end)
      return edit(text, start, end, "", start);
    const insert = `\n${numbered[1]}${Number(numbered[2]) + 1}. `;
    return edit(text, caret, caret, insert, caret + insert.length);
  }
  return null;
}

/** A separate marker can have its own font and paint. Use the words' color. */
function listParagraphPaint(paragraph: TextRun[]) {
  const content = paragraph.filter(run => !run.paragraphBreak && run.text.trim());
  const marker = content.length > 1 && content[0].text.trim().length === 1
    ? content[0]
    : undefined;
  const words = marker ? content.slice(1) : content;
  const colors = new Set(words.filter(run => !run.href).map(run => run.color?.toLowerCase()).filter(Boolean));
  return { marker, color: colors.size === 1 ? [...colors][0] : undefined };
}

/** Older PowerPoint slides can spell a level's style on each run. */
export function effectiveListColors(runs: TextRun[]) {
  const levels = new Map<number, Set<string>>();
  const declared = new Map<number, string>();
  let paragraph: TextRun[] = [];
  const collect = () => {
    const mark = paragraph[0];
    const depth = mark?.listDepth;
    // A retained two-tone theme already distinguishes level styles from overrides.
    if (new Set(mark?.listColors?.filter(Boolean)).size > 1) {
      mark.listColors?.forEach((color, level) => {
        if (color) declared.set(level, color);
      });
      return;
    }
    const { color } = listParagraphPaint(paragraph);
    if (depth === undefined || !color) return;
    const colors = levels.get(depth) ?? new Set<string>();
    colors.add(color);
    levels.set(depth, colors);
  };
  for (const run of runs) {
    if (run.paragraphBreak) {
      collect();
      paragraph = [];
    }
    paragraph.push(run);
  }
  collect();
  for (const [level, color] of declared) levels.set(level, new Set([color]));
  return levels;
}

/** Existing saved decks can infer level sizes from consistently authored body text. */
export function effectiveListFontSizes(runs: TextRun[]): (number | null)[] {
  const declared: (number | null)[] = Array(9).fill(null);
  const levels = new Map<number, Set<number>>();
  const templateSizes = new Set<number>();
  let paragraph: TextRun[] = [];
  const collect = () => {
    const mark = paragraph[0];
    if (mark?.listDepth === undefined) return;
    const styleSizes = mark.listFontSizes?.filter((size): size is number => !!size) ?? [];
    if (styleSizes.length > 1 && new Set(styleSizes).size === 1)
      templateSizes.add(styleSizes[0]);
    mark.listFontSizes?.forEach((size, depth) => { if (size) declared[depth] = size; });
    const { marker } = listParagraphPaint(paragraph);
    const sizes = new Set(paragraph.filter(run => run !== marker && run.text.trim() && !run.paragraphBreak && !run.baseline && !run.math && !run.fraction && run.fontSize).map(run => run.fontSize!));
    if (sizes.size !== 1) return;
    const observed = levels.get(mark.listDepth) ?? new Set<number>();
    observed.add([...sizes][0]);
    levels.set(mark.listDepth, observed);
  };
  for (const run of runs) {
    if (run.paragraphBreak) { collect(); paragraph = []; }
    paragraph.push(run);
  }
  collect();
  for (const [depth, sizes] of levels) if (sizes.size === 1) declared[depth] = [...sizes][0];
  // Legacy decks retain uniform presentation defaults alongside directly styled
  // paragraphs. An unused level must inherit the established body size rather
  // than revert to that unrelated template size when the user indents it.
  for (let depth = 1; depth < declared.length; depth++) {
    if (!levels.has(depth) && declared[depth] != null && templateSizes.has(declared[depth]!))
      declared[depth] = declared[depth - 1] ?? declared[depth];
  }
  return declared;
}

/** Preserve special-size words; marker glyphs keep their authored ratio to the body. */
export function listRunFontSize(run: Partial<TextRun>, previous: number | null | undefined, next: number | null | undefined, marker = false): number | undefined {
  if (!previous || !next || run.baseline || run.math || run.fraction) return run.fontSize;
  if (marker) return (run.fontSize ?? previous) * next / previous;
  return run.fontSize === undefined || run.fontSize === previous ? next : run.fontSize;
}

/** Move every selected list paragraph by one level without changing its text. */
export function changeListDepth(
  runs: TextRun[],
  selection: { start: number; end: number },
  direction: -1 | 1,
): TextRun[] | null {
  const levelColors = effectiveListColors(runs);
  const levelSizes = effectiveListFontSizes(runs);
  let offset = 0;
  let start = 0;
  let found = false;
  const result: TextRun[] = [];
  let paragraph: TextRun[] = [];
  const bullet = /^[•●○◦▪■▸►‣] /u;
  const text = runs.map(run => run.text).join("");
  const legacy = runs.every(run => run.listDepth === undefined && !run.paragraphBreak);
  const flush = () => {
    const mark = paragraph[0];
    if (!mark) return;
    const paragraphText = text.slice(start, offset);
    const selected = selection.start <= offset &&
      (selection.end > start || selection.start === start);
    if (!selected || (mark.listDepth === undefined && !bullet.test(paragraphText))) {
      result.push(...paragraph);
      return;
    }
    found = true;
    const previous = mark.listDepth ?? 0;
    const depth = Math.min(8, Math.max(0, previous + direction));
    if (previous === depth) {
      result.push(...paragraph);
      return;
    }
    const colors = (mark.listColors ?? Array<string | null>(9).fill(null)).map((color, level) => {
      const authored = levelColors.get(level);
      return authored?.size === 1 ? [...authored][0] : color;
    });
    const paint = listParagraphPaint(paragraph);
    const oldColor = colors[previous];
    const color = colors[depth] ?? oldColor;
    result.push(...paragraph.map((run, index) => ({
      ...run,
      ...(listRunFontSize(run, levelSizes[previous], levelSizes[depth], run === paint.marker) ? { fontSize: listRunFontSize(run, levelSizes[previous], levelSizes[depth], run === paint.marker) } : {}),
      ...(color && (run === paint.marker || oldColor && run.color?.toLowerCase() === oldColor.toLowerCase()) ? { color } : {}),
      ...(index === 0 ? {
        listDepth: depth,
        listColors: colors,
        ...(levelSizes.some(Boolean) ? { listFontSizes: levelSizes } : {}),
        paraMargin: Math.max(0, (mark.paraMargin ?? 0) + (depth - previous) * 36),
      } : {}),
    })));
  };
  const append = (run: TextRun) => {
    if (run.paragraphBreak && run.text === "\n") {
      flush();
      paragraph = [];
      start = offset + 1;
    }
    paragraph.push(run);
    offset += run.text.length;
  };
  for (const run of runs) {
    if (!legacy || !run.text.includes("\n")) {
      append(run);
      continue;
    }
    // Older lists can contain plain newlines between bullet items.
    for (const part of run.text.split(/(\n)/u).filter(Boolean)) {
      append({
        ...run,
        text: part,
        ...(part === "\n" && bullet.test(text.slice(offset + 1)) ? { paragraphBreak: true } : {}),
      });
    }
  }
  flush();
  return found ? result : null;
}
