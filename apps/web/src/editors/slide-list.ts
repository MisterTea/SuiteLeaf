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
  if (/^\s*\d+\.\s$/.test(line)) return null;
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
