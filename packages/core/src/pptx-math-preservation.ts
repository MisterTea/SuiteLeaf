import { XMLValidator } from "fast-xml-parser";
import type { TextRun } from "./slide-schema";
import { latexOfficeMath } from "./slide-latex";

export function officeMathSignature(runs: TextRun[]): string {
  return JSON.stringify(runs.map((run) => [
    run.text, run.font, run.fontSize, run.bold, run.italic,
    run.color, run.baseline, run.fraction, run.underline, run.strike, run.tracking,
  ]));
}

/** Restore original equations while their editable preview runs still match. */
export function restoreOfficeMath(paragraph: string, runs: TextRun[], fontSize?: number, color?: string): string {
  if (!runs.some((run) => run.officeMath || run.latex)) return paragraph;
  const emitted = [...paragraph.matchAll(/<a:r>[\s\S]*?<\/a:r>/g)];
  if (emitted.length !== runs.length) return paragraph;
  for (let index = runs.length - 1; index >= 0; index--) {
    const math = runs[index].officeMath;
    const latex = runs[index].latex;
    if (latex) {
      try {
        const match = emitted[index];
        const start = match.index!;
        paragraph = paragraph.slice(0, start) + latexOfficeMath(latex, runs[index].fontSize ?? fontSize, runs[index].color ?? color) + paragraph.slice(start + match[0].length);
      } catch { /* Keep the editable text fallback for invalid saved LaTeX. */ }
      continue;
    }
    if (!math || index + math.count > runs.length) continue;
    if (officeMathSignature(runs.slice(index, index + math.count)) !== math.signature) continue;
    const start = emitted[index].index!;
    const last = emitted[index + math.count - 1];
    const end = last.index! + last[0].length;
    if (/<a:br\b/.test(paragraph.slice(start, end))) continue;
    if (!/^<a14:m(?:\s[^>]*)?>[\s\S]*<\/a14:m>$/.test(math.xml) ||
        /<\!|<\?|\br:(?:embed|link|id)=/.test(math.xml) ||
        XMLValidator.validate(math.xml) !== true) continue;
    const xml = math.xml.replace(/^<a14:m\b[^>]*>/,
      '<a14:m xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">');
    paragraph = paragraph.slice(0, start) + xml + paragraph.slice(end);
  }
  return paragraph;
}
