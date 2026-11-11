import type { SlideElement, TextRun } from "@suiteleaf/core";
import { plainText, runsOf } from "./slide-runs";

/** Indent whole paragraphs, including the paragraph at a collapsed caret. */
export function indentSlideText(
  element: SlideElement,
  direction: -1 | 1,
  selection?: { start: number; end: number } | null,
): Partial<SlideElement> {
  const source = runsOf(element);
  if (!source.length) return { padLeft: Math.max(0, (element.padLeft ?? 0) + direction * 24) };
  // Plain text uses newlines for paragraphs. Imported runs distinguish hard
  // paragraph breaks from soft line breaks and must retain that distinction.
  const structured = source.some((run) =>
    run.paragraphBreak || run.paraMargin !== undefined || run.paraHang !== undefined ||
    run.paraFirst !== undefined || run.paraAlign !== undefined,
  );
  const runs = structured ? source : source.flatMap((run) =>
    run.text.split("\n").flatMap((text, index): TextRun[] => [
      ...(index ? [{ ...run, text: "\n", paragraphBreak: true }] : []),
      ...(text ? [{ ...run, text }] : []),
    ]),
  );
  const groups: { start: number; end: number; runs: TextRun[] }[] = [];
  let offset = 0;
  for (const run of runs) {
    if (!groups.length || (run.paragraphBreak && run.text === "\n"))
      groups.push({ start: offset + (groups.length ? 1 : 0), end: offset, runs: [] });
    const group = groups[groups.length - 1];
    group.runs.push(run);
    offset += run.text.length;
    group.end = offset;
  }
  const start = Math.max(0, Math.min(selection?.start ?? 0, offset));
  const end = Math.max(start, Math.min(selection?.end ?? offset, offset));
  const next = groups.flatMap((group, index) => {
    const selected = start === end
      ? start >= group.start && (start <= group.end || index === groups.length - 1)
      : start < group.end && end > group.start;
    if (!selected) return group.runs;
    const margin = Math.min(20000, Math.max(0, (group.runs[0].paraMargin ?? 0) + direction * 24));
    return group.runs.map((run) => ({ ...run, paraMargin: margin }));
  });
  return { runs: next, content: plainText(next) };
}
