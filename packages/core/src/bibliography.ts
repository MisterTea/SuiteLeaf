import { createSource, editorList, type CitationSource } from "./citations";

/** A BibTeX entry this importer did not add. The key is the entry key when one was read. */
export type BibIssue = { key: string; message: string };

const EXTRA = ["editor", "doi", "url", "journal", "volume", "pages", "accessed"] as const;
const SECRET = /password|secret|token|authorization|api[-_]?key|credential/i;

function linkProblem(value: string): boolean {
  if (SECRET.test(value)) return true;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return true;
  } catch {
    // A DOI is not a web address.
  }
  return false;
}

type Entry = { type: string; key: string; fields: Record<string, string> };

/** Write the sources as BibTeX. The entry key is the citation tag. */
export function exportBibtex(sources: CitationSource[]): string {
  return sources
    .map((source) => {
      const lines = [
        `author = {${brace(source.author)}}`,
        `title = {${brace(source.title)}}`,
        `year = {${brace(source.year)}}`,
      ];
      const editors = editorList(source);
      if (editors.length) lines.push(`editor = {${brace(editors.join(" and "))}}`);
      for (const field of EXTRA) {
        if (field === "editor") continue;
        const value = source[field];
        if (value) lines.push(`${field} = {${brace(value)}}`);
      }
      const type = source.kind === "website" ? "online" : source.kind;
      return `@${type}{${source.tag},\n  ${lines.join(",\n  ")}\n}`;
    })
    .join("\n\n");
}

/**
 * Read BibTeX into the citation list. A key that matches an existing tag updates
 * that source and keeps its id. A book or article needs an author, title, and year.
 * Other entry types are reported and left out. Nothing is fetched.
 */
export function importBibtex(
  text: string,
  existing: CitationSource[],
): { sources: CitationSource[]; issues: BibIssue[] } {
  const { parsed, issues } = entries(text);
  return { sources: applyEntries(parsed, existing, issues, true), issues };
}

/** Write the sources as RIS. The ID is the citation tag. Nothing is fetched. */
export function exportRis(sources: CitationSource[]): string {
  return sources
    .map((source) => {
      const lines = [
        `TY  - ${source.kind === "article" ? "JOUR" : source.kind === "website" ? "ELEC" : "BOOK"}`,
        `ID  - ${source.tag}`,
        ...source.author.split(/\s+and\s+/).filter(Boolean).map((author) => `AU  - ${author}`),
        `TI  - ${source.title}`,
        `PY  - ${source.year}`,
      ];
      for (const name of editorList(source)) lines.push(`ED  - ${name}`);
      if (source.journal) lines.push(`JO  - ${source.journal}`);
      if (source.volume) lines.push(`VL  - ${source.volume}`);
      const pages = source.pages?.split("--") ?? [];
      if (pages[0]) lines.push(`SP  - ${pages[0]}`);
      if (pages[1]) lines.push(`EP  - ${pages[1]}`);
      if (source.doi) lines.push(`DO  - ${source.doi}`);
      if (source.url) lines.push(`UR  - ${source.url}`);
      if (source.accessed) lines.push(`DA  - ${source.accessed}`);
      lines.push("ER  - ");
      return lines.join("\n");
    })
    .join("\n");
}

/**
 * Read RIS into the citation list. `JOUR` is an article and `BOOK` is a book.
 * An ID that matches an existing tag updates that source and keeps its id.
 * Other types are named and left out. Nothing is fetched.
 */
export function importRis(
  text: string,
  existing: CitationSource[],
): { sources: CitationSource[]; issues: BibIssue[] } {
  const { parsed, issues } = risEntries(text);
  if (!parsed.length && !issues.length)
    issues.push({ key: "", message: "That file has no RIS entries." });
  return { sources: applyEntries(parsed, existing, issues, false), issues };
}

function applyEntries(
  parsed: Entry[],
  existing: CitationSource[],
  issues: BibIssue[],
  keyRequired: boolean,
): CitationSource[] {
  const sources = existing.map((source) => ({ ...source }));
  for (const entry of parsed) {
    const kind = importedKind(entry);
    if (!kind) {
      issues.push({
        key: entry.key || "entry",
        message: "Only a book or an article can be imported.",
      });
      continue;
    }
    const author = entry.fields.author ?? "";
    const title = entry.fields.title ?? "";
    const year = entry.fields.year ?? "";
    if (!author || !title || !year || (keyRequired && !entry.key)) {
      issues.push({
        key: entry.key || "entry",
        message: "The author, title, and year are required.",
      });
      continue;
    }
    const extra = extras(entry.fields);
    if ((entry.fields.url && linkProblem(entry.fields.url)) || (entry.fields.doi && linkProblem(entry.fields.doi))) {
      issues.push({
        key: entry.key && !SECRET.test(entry.key) ? entry.key : "",
        message: "That source address cannot include a credential.",
      });
    }
    const index = entry.key ? sources.findIndex((source) => source.tag === entry.key) : -1;
    if (index >= 0) {
      const next: CitationSource = {
        ...sources[index],
        kind,
        author,
        title,
        year,
      };
      for (const field of EXTRA) delete next[field];
      delete next.editors;
      sources[index] = { ...next, ...extra };
      continue;
    }
    const created = createSource({ kind, author, title, year }, sources);
    if (entry.key) created.tag = entry.key;
    sources.push({ ...created, ...extra });
  }
  return sources;
}

function risEntries(text: string): { parsed: Entry[]; issues: BibIssue[] } {
  const parsed: Entry[] = [];
  const chunks = text.split(/\r?\n(?=TY\s+-)/);
  for (const chunk of chunks) {
    if (!/^\s*TY\s+-/.test(chunk)) continue;
    const fields = new Map<string, string[]>();
    for (const line of chunk.split(/\r?\n/)) {
      const match = /^([A-Z][A-Z0-9])\s+-\s?(.*)$/.exec(line.trim());
      if (!match || match[1] === "ER") continue;
      const list = fields.get(match[1]) ?? [];
      list.push(match[2].trim());
      fields.set(match[1], list);
    }
    const type = (fields.get("TY")?.[0] ?? "").toUpperCase();
    const kind = type === "BOOK" ? "book" : type === "JOUR" ? "article" : type === "ELEC" || type === "WEB" ? "website" : type;
    const authors = [...(fields.get("AU") ?? []), ...(fields.get("A1") ?? [])];
    const pages = [fields.get("SP")?.[0], fields.get("EP")?.[0]].filter(Boolean).join("--");
    const year = (fields.get("PY")?.[0] ?? fields.get("Y1")?.[0] ?? "").slice(0, 4);
    parsed.push({
      type: kind,
      key: fields.get("ID")?.[0] ?? "",
      fields: {
        author: authors.join(" and "),
        title: fields.get("TI")?.[0] ?? fields.get("T1")?.[0] ?? "",
        year,
        editor: (fields.get("ED") ?? []).join(" and "),
        journal: fields.get("JO")?.[0] ?? fields.get("JF")?.[0] ?? "",
        volume: fields.get("VL")?.[0] ?? "",
        pages,
        doi: fields.get("DO")?.[0] ?? "",
        url: fields.get("UR")?.[0] ?? "",
        accessed: fields.get("DA")?.[0] ?? "",
      },
    });
  }
  return { parsed, issues: [] };
}

function importedKind(entry: Entry): CitationSource["kind"] | null {
  const type = entry.type.toLowerCase();
  if (type === "book" || type === "article" || type === "website") return type;
  if (type === "online" || type === "webpage") return "website";
  if ((type === "misc" || type === "electronic") && entry.fields.url?.trim()) return "website";
  return null;
}

function extras(fields: Record<string, string>): Partial<CitationSource> {
  const extra: Partial<CitationSource> = {};
  for (const field of EXTRA) {
    const value = fields[field]?.trim() ?? "";
    if (!value) continue;
    if ((field === "url" || field === "doi") && (/[\r\n]/.test(value) || linkProblem(value))) continue;
    extra[field] = value;
  }
  if (extra.editor) {
    const names = extra.editor
      .split(/\s+and\s+/)
      .map((name) => name.trim())
      .filter((name) => name && !/[\r\n]/.test(name));
    if (!names.length) delete extra.editor;
    else {
      extra.editor = names[0];
      if (names.length > 1) extra.editors = names;
    }
  }
  return extra;
}

function brace(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}");
}

function entries(text: string): { parsed: Entry[]; issues: BibIssue[] } {
  const parsed: Entry[] = [];
  const issues: BibIssue[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const at = text.indexOf("@", cursor);
    if (at < 0) break;
    const header = /^@([A-Za-z]+)\s*\{/.exec(text.slice(at));
    if (!header) {
      cursor = at + 1;
      continue;
    }
    cursor = at + header[0].length;
    const keyEnd = text.indexOf(",", cursor);
    if (keyEnd < 0) {
      issues.push({ key: "", message: "An entry is missing its key." });
      break;
    }
    const key = text.slice(cursor, keyEnd).trim();
    cursor = keyEnd + 1;
    const fields: Record<string, string> = {};
    let closed = false;
    let broken = false;
    while (cursor < text.length) {
      while (cursor < text.length && /[\s,]/.test(text[cursor])) cursor += 1;
      if (text[cursor] === "}") {
        closed = true;
        cursor += 1;
        break;
      }
      const name = /^([A-Za-z]+)\s*=\s*/.exec(text.slice(cursor));
      if (!name) {
        issues.push({ key, message: "A field could not be read." });
        broken = true;
        break;
      }
      cursor += name[0].length;
      const value = readValue(text, cursor);
      if (!value) {
        issues.push({ key, message: "A field is missing its end." });
        broken = true;
        break;
      }
      fields[name[1].toLowerCase()] = value.value;
      cursor = value.end;
    }
    if (!broken && closed) parsed.push({ type: header[1].toLowerCase(), key, fields });
    else if (!broken && !closed)
      issues.push({ key, message: "An entry is missing its closing brace." });
  }
  return { parsed, issues };
}

function readValue(
  text: string,
  start: number,
): { value: string; end: number } | null {
  const opener = text[start];
  if (opener === "{") return readWrapped(text, start, "{", "}");
  if (opener === '"') return readWrapped(text, start, '"', '"');
  const bare = /^[^,}\s]+/.exec(text.slice(start));
  if (!bare) return null;
  return { value: bare[0], end: start + bare[0].length };
}

function readWrapped(
  text: string,
  start: number,
  open: string,
  close: string,
): { value: string; end: number } | null {
  let depth = 0;
  let value = "";
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\" && index + 1 < text.length) {
      if (depth > 0) value += text[index + 1];
      index += 1;
      continue;
    }
    if (char === close && depth > 0) {
      depth -= 1;
      if (depth === 0) return { value: value.trim(), end: index + 1 };
      value += char;
      continue;
    }
    if (char === open) {
      depth += 1;
      if (depth > 1) value += char;
      continue;
    }
    if (depth > 0) value += char;
  }
  return null;
}
