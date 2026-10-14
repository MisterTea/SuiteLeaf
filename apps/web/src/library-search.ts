import type { JsonNode, SuiteFile } from "@suiteleaf/core";

// Huge imported workbooks would make every keystroke in the search box slow.
const limit = 200_000;
const texts = new WeakMap<SuiteFile, string>();

function collect(file: SuiteFile): string[] {
  const parts: string[] = [];
  if (file.kind === "doc") {
    const walk = (n: JsonNode) => {
      if (n.text) parts.push(n.text);
      else if (n.type === "hardBreak") parts.push(" ");
      n.content?.forEach(walk);
      if (n.content && n.type !== "text") parts.push(" ");
    };
    walk(file.content);
  } else if (file.kind === "sheet") {
    const { workbook } = file.content;
    for (const id of workbook.sheetOrder) {
      const sheet = workbook.sheets[id];
      if (!sheet) continue;
      parts.push(sheet.name, " ");
      for (const row of Object.values(sheet.cellData ?? {}))
        for (const cell of Object.values(row)) {
          const v = cell?.v;
          if (v !== undefined && v !== null && v !== "")
            parts.push(String(v), " ");
        }
    }
  } else if (file.kind === "slide") {
    const { slides, slideOrder } = file.content;
    for (const id of slideOrder) {
      const slide = slides[id];
      if (!slide) continue;
      for (const el of slide.elements) {
        if (el.content) parts.push(el.content, " ");
        el.rows?.forEach((row) => parts.push(row.join(" "), " "));
      }
      if (slide.notes) parts.push(slide.notes, " ");
    }
  } else {
    for (const question of file.content.questions)
      parts.push(question.prompt, " ", ...(question.choices ?? []), " ");
    for (const response of file.content.responses)
      parts.push(...Object.values(response.answers), " ");
  }
  return parts;
}

/** The words inside a file, as one line of text. */
export function fileText(file: SuiteFile): string {
  let text = texts.get(file);
  if (text === undefined) {
    let length = 0;
    const kept: string[] = [];
    for (const part of collect(file)) {
      kept.push(part);
      length += part.length;
      if (length > limit) break;
    }
    text = kept.join("").replace(/\s+/g, " ").trim().slice(0, limit);
    texts.set(file, text);
  }
  return text;
}

/**
 * Whether `file` matches a library search. A match inside the file (rather
 * than its name) comes with a short excerpt around the first hit.
 */
export function searchFile(
  file: SuiteFile,
  query: string,
): { snippet?: string } | null {
  const q = query.trim().toLowerCase();
  if (!q || file.title.toLowerCase().includes(q)) return {};
  const text = fileText(file),
    at = text.toLowerCase().indexOf(q);
  if (at < 0) return null;
  const start = Math.max(0, text.lastIndexOf(" ", Math.max(0, at - 30)) + 1),
    end = Math.min(text.length, at + q.length + 60);
  return {
    snippet: `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`,
  };
}
