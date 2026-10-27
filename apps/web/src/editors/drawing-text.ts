/** Line-aware text edits shared by the Mermaid and Graphviz source helpers. */

export function lineOf(text: string, offset: number) {
  let line = 0;
  for (let i = text.indexOf("\n"); i >= 0 && i < offset; i = text.indexOf("\n", i + 1)) line++;
  return line;
}

export function lineRange(text: string, line: number) {
  let start = 0;
  for (let i = 0; i < line; i++) {
    const next = text.indexOf("\n", start);
    if (next < 0) return { start: text.length, end: text.length };
    start = next + 1;
  }
  const newline = text.indexOf("\n", start);
  return { start, end: newline < 0 ? text.length : newline };
}

/** A range widened to whole lines when nothing else shares them. */
export function wholeLines(text: string, start: number, end: number) {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const newline = text.indexOf("\n", end);
  const lineEnd = newline < 0 ? text.length : newline + 1;
  if (text.slice(lineStart, start).trim() || text.slice(end, lineEnd).trim()) return { start, end };
  return { start: lineStart, end: lineEnd };
}

/** Remove ranges, widest-first so earlier offsets stay right. */
export function removeRanges(text: string, ranges: { start: number; end: number }[]) {
  const widened = ranges.map((r) => wholeLines(text, r.start, r.end)).sort((a, b) => b.start - a.start);
  let next = text;
  let floor = Infinity;
  for (const range of widened) {
    const end = Math.min(range.end, floor);
    if (end <= range.start) continue;
    next = next.slice(0, range.start) + next.slice(end);
    floor = range.start;
  }
  return next;
}

/** Put a line of text just before `at`, which closes a block, at the block's indentation. */
export function insertLineBefore(text: string, at: number, indent: string, line: string) {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  if (!text.slice(lineStart, at).trim()) return text.slice(0, lineStart) + `${indent}${line}\n` + text.slice(lineStart);
  return `${text.slice(0, at)}\n${indent}${line}\n${text.slice(at)}`;
}

/** Add a line at the end, keeping a single final newline. */
export function appendLine(text: string, line: string) {
  const body = text.replace(/\s+$/, "");
  return `${body}${body ? "\n" : ""}${line}\n`;
}

/** The leading whitespace of the line holding `offset`. */
export function indentAt(text: string, offset: number) {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))![0];
}

/** A fresh name, `prefix1`, `prefix2`, …, not already taken. */
export function freshName(prefix: string, taken: Set<string>) {
  for (let n = 1; ; n++) if (!taken.has(`${prefix}${n}`)) return `${prefix}${n}`;
}
