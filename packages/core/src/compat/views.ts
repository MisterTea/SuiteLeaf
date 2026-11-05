/**
 * Read what a stage shows. `modelView` reads a SuiteLeaf file. `packageView`
 * reads an Office package the way another application would see it. A field
 * left undefined was not measured, which is different from an empty result.
 */
import { createHash } from "node:crypto";
import JSZip from "jszip";
import type { JsonNode, SheetFile, SlideFile, SuiteFile } from "../index";
import { LIST_TYPES, numberLabel, numberedParagraphs } from "../word-lists";
import type { CompatFormat, View } from "./types";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function norm(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dataUrlHash(src: unknown): string | null {
  if (typeof src !== "string") return null;
  const match = /^data:[^;,]+;base64,(.*)$/s.exec(src);
  if (!match) return null;
  return sha(Uint8Array.from(Buffer.from(match[1]!, "base64")));
}

function suggestionKind(node: JsonNode): string | undefined {
  const mark = (node.marks ?? []).find((m) => m.type === "suggestion");
  return mark ? String(mark.attrs?.kind ?? "") : undefined;
}

function docView(content: JsonNode): View {
  const blocks: string[] = [];
  const revisions: string[] = [];
  const images: string[] = [];
  const cells: string[] = [];
  let tables = 0;
  const inline = (node: JsonNode): string => {
    if (node.type === "hardBreak") return "\n";
    if (node.type === "text") {
      const kind = suggestionKind(node);
      if (kind) revisions.push(node.text ?? "");
      return kind === "delete" ? "" : (node.text ?? "");
    }
    return (node.content ?? []).map(inline).join("");
  };
  const walk = (node: JsonNode) => {
    if (node.type === "table") tables += 1;
    if (node.type === "tableCell" || node.type === "tableHeader") cells.push((node.content ?? []).map(inline).join("\n"));
    if (node.type === "image" || node.type === "inlineImage") {
      const hash = dataUrlHash(node.attrs?.src);
      if (hash) images.push(hash);
    }
    if (node.type === "paragraph" || node.type === "heading") {
      blocks.push(inline(node));
      for (const child of node.content ?? []) if (child.type !== "text") walk(child);
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(content);
  const numbered: string[] = [];
  const formats = Object.fromEntries(Object.entries(LIST_TYPES).map(([format, type]) => [type, format]));
  const number = (node: JsonNode) => {
    if (node.type === "orderedList") {
      const start = Number(node.attrs?.start) > 0 ? Number(node.attrs?.start) : 1;
      const format = formats[String(node.attrs?.type ?? "")] ?? "decimal";
      (node.content ?? []).forEach((item, index) => {
        numbered.push(`${numberLabel(start + index, format)} ${inline(item.content?.[0] ?? item)}`);
      });
    }
    for (const child of node.content ?? []) number(child);
  };
  number(content);
  const threads = (content.attrs?.commentThreads ?? []) as { messages?: { text?: string }[] }[];
  const settings = (content.attrs?.pageSettings ?? {}) as Record<string, unknown>;
  const breaks = (content.content ?? []).filter((node) => node.type === "sectionBreak");
  const plain = (node: JsonNode): string => (node.text ?? "") + (node.content ?? []).map(plain).join(" ");
  const headers = [
    ...["header", "footer", "firstHeader", "firstFooter", "evenHeader", "evenFooter"].map((key) => settings[key]),
    ...breaks.flatMap((node) => [node.attrs?.header, node.attrs?.footer]),
  ].filter((value): value is string => typeof value === "string" && value !== "");
  return {
    headers,
    footnotes: (content.content ?? []).filter((node) => node.type === "note").map(plain),
    sections: breaks.length + 1,
    numbered: numbered.join("\n"),
    cells,
    text: blocks.join("\n"),
    revisions,
    comments: threads.flatMap((thread) => (thread.messages ?? []).map((m) => m.text ?? "")),
    tables,
    images,
  };
}

type Workbook = {
  sheetOrder: string[];
  sheets: Record<string, { name?: string; cellData?: Record<string, Record<string, { v?: unknown; f?: string } | null>> }>;
  resources?: { name: string; data: string }[];
};

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Strings anywhere inside a resource's JSON, such as note text or a thread's data stream. */
function resourceStrings(data: string): string[] {
  const out: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  try {
    visit(JSON.parse(data));
  } catch {
    return [];
  }
  return out;
}

function sheetView(file: SheetFile): View {
  const book = file.content.workbook as unknown as Workbook;
  const texts: string[] = [];
  const formulas: NonNullable<View["formulas"]> = {};
  for (const id of book.sheetOrder) {
    const sheet = book.sheets[id];
    const name = sheet?.name ?? id;
    for (const [r, row] of Object.entries(sheet?.cellData ?? {})) {
      for (const [c, cell] of Object.entries(row ?? {})) {
        if (!cell) continue;
        if (typeof cell.v === "string") texts.push(cell.v);
        if (cell.f) formulas[`${name}!${columnName(Number(c))}${Number(r) + 1}`] = { formula: cell.f, value: cell.v };
      }
    }
  }
  const comments = (book.resources ?? [])
    .filter((r) => r.name === "SHEET_NOTE_PLUGIN" || r.name === "SHEET_UNIVER_THREAD_COMMENT_PLUGIN")
    .flatMap((r) => resourceStrings(r.data));
  const images = ((file.content as { images?: { src?: string }[] }).images ?? []).flatMap((image) => {
    const hash = dataUrlHash(image.src);
    return hash ? [hash] : [];
  });
  return { text: texts.join("\n"), formulas, comments, images };
}

function slideView(file: SlideFile): View {
  const deck = file.content;
  const texts: string[] = [];
  const notes: string[] = [];
  const comments: string[] = [];
  const images: string[] = [];
  const cells: string[] = [];
  let tables = 0;
  for (const id of deck.slideOrder) {
    const slide = deck.slides[id];
    if (!slide) continue;
    if (slide.notes) notes.push(slide.notes);
    for (const comment of slide.comments ?? []) comments.push(String((comment as { text?: string }).text ?? ""));
    for (const el of slide.elements) {
      if (el.type === "table") {
        tables += 1;
        for (const row of el.rows ?? []) {
          texts.push(row.join("\n"));
          cells.push(...row);
        }
      }
      if (el.type === "image") {
        const hash = dataUrlHash(el.src);
        if (hash) images.push(hash);
      }
      if (el.content) texts.push(el.content);
    }
  }
  return { text: texts.join("\n"), notes: notes.join("\n"), comments, cells, tables, images, pages: deck.slideOrder.length };
}

/** What SuiteLeaf holds. Fonts are not read here: a default font is often not stored on the run. */
export function modelView(file: SuiteFile): View {
  if (file.kind === "doc") return docView(file.content);
  if (file.kind === "sheet") return sheetView(file as SheetFile);
  if (file.kind === "slide") return slideView(file as SlideFile);
  return {};
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function xmlText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return ENTITIES[code] ?? whole;
  });
}

function tagTexts(xml: string, tag: string): string[] {
  const out: string[] = [];
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g");
  for (const match of xml.matchAll(pattern)) out.push(xmlText(match[1]!));
  return out;
}

function attrValues(xml: string, pattern: RegExp): string[] {
  return [...xml.matchAll(pattern)].map((m) => xmlText(m[1]!));
}

async function texts(zip: JSZip, pattern: RegExp): Promise<[string, string][]> {
  const names = Object.keys(zip.files)
    .filter((name) => pattern.test(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return Promise.all(names.map(async (name) => [name, await zip.file(name)!.async("string")] as [string, string]));
}

async function mediaHashes(zip: JSZip, folder: string): Promise<string[]> {
  const names = Object.keys(zip.files).filter((name) => name.startsWith(folder) && !zip.files[name]!.dir);
  return Promise.all(names.map(async (name) => sha(await zip.file(name)!.async("uint8array"))));
}

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

async function docxPackage(zip: JSZip): Promise<View> {
  const body = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const paragraphs = body.split(/<\/w:p>/).map((part) => tagTexts(part, "w:t").join(""));
  const revisions = [...body.matchAll(/<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g)].map((m) => tagTexts(m[1]!, "w:t").join(""));
  const commentXml = (await zip.file("word/comments.xml")?.async("string")) ?? "";
  const fontXml = [body, (await zip.file("word/styles.xml")?.async("string")) ?? ""].join("");
  const furniture = await texts(zip, /^word\/(header|footer)\d*\.xml$/);
  const footnoteXml = (await zip.file("word/footnotes.xml")?.async("string")) ?? "";
  return {
    headers: furniture.map(([, xml]) => tagTexts(xml, "w:t").join("")),
    footnotes: footnoteXml.split(/<\/w:footnote>/).map((part) => tagTexts(part, "w:t").join("")).filter(Boolean),
    sections: (body.match(/<w:sectPr\b/g) ?? []).length,
    cells: [...body.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((m) => tagTexts(m[1]!, "w:t").join("")),
    numbered: numberedParagraphs(
      body,
      (await zip.file("word/numbering.xml")?.async("string")) ?? "",
      (await zip.file("word/styles.xml")?.async("string")) ?? "",
    )
      .filter((p) => p.label)
      .map((p) => `${p.label} ${p.text}`)
      .join("\n"),
    text: paragraphs.join("\n"),
    revisions,
    comments: commentXml.split(/<\/w:comment>/).map((part) => tagTexts(part, "w:t").join("")).filter(Boolean),
    tables: (body.match(/<w:tbl>/g) ?? []).length,
    fonts: unique(attrValues(fontXml, /w:ascii="([^"]*)"/g)),
    images: await mediaHashes(zip, "word/media/"),
  };
}

async function xlsxPackage(zip: JSZip): Promise<View> {
  const workbook = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const shared = ((await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "")
    .split(/<\/si>/)
    .map((item) => tagTexts(item, "t").join(""));
  const target = new Map(
    [...rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]),
  );
  const strings: string[] = [];
  const formulas: NonNullable<View["formulas"]> = {};
  for (const sheet of workbook.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g)) {
    const path = (target.get(sheet[2]!) ?? "").replace(/^\/?(xl\/)?/, "xl/");
    const xml = (await zip.file(path)?.async("string")) ?? "";
    for (const cell of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1]!;
      const inner = cell[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const raw = tagTexts(inner, "v")[0];
      if (type === "s" && raw !== undefined) strings.push(shared[Number(raw)] ?? "");
      if (type === "str" && raw !== undefined && !/<f[\s>]/.test(inner)) strings.push(raw);
      if (type === "inlineStr") strings.push(tagTexts(inner, "t").join(""));
      const formula = tagTexts(inner, "f")[0];
      if (ref && formula !== undefined) {
        formulas[`${xmlText(sheet[1]!)}!${ref}`] = { formula, value: raw === undefined ? undefined : Number(raw) };
      }
    }
  }
  const commentParts = await texts(zip, /^xl\/(comments\d*|threadedComments\/[^/]+)\.xml$/);
  const styles = (await zip.file("xl/styles.xml")?.async("string")) ?? "";
  return {
    text: strings.join("\n"),
    formulas,
    comments: commentParts.flatMap(([, xml]) => [...tagTexts(xml, "t"), ...tagTexts(xml, "text")]),
    fonts: unique(attrValues(styles, /<name\s+val="([^"]*)"/g)),
    images: await mediaHashes(zip, "xl/media/"),
  };
}

async function pptxPackage(zip: JSZip): Promise<View> {
  const slides = await texts(zip, /^ppt\/slides\/slide\d+\.xml$/);
  const notes = await texts(zip, /^ppt\/notesSlides\/notesSlide\d+\.xml$/);
  const comments = await texts(zip, /^ppt\/comments\/[^/]+\.xml$/);
  const all = slides.map(([, xml]) => xml).join("");
  return {
    text: slides.map(([, xml]) => xml.split(/<\/a:p>/).map((p) => tagTexts(p, "a:t").join("")).join("\n")).join("\n"),
    notes: notes.map(([, xml]) => tagTexts(xml, "a:t").join(" ")).join("\n"),
    comments: comments.flatMap(([, xml]) => [...tagTexts(xml, "p:text"), ...tagTexts(xml, "a:t")]),
    tables: (all.match(/<a:tbl>/g) ?? []).length,
    cells: [...all.matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)].map((m) => tagTexts(m[1]!, "a:t").join("")),
    fonts: unique(attrValues(all, /<a:latin\b[^>]*\btypeface="([^"]*)"/g)),
    images: await mediaHashes(zip, "ppt/media/"),
    pages: slides.length,
  };
}

/** What another application reads from an Office package. */
export async function packageView(bytes: Uint8Array, format: CompatFormat): Promise<View> {
  const zip = await JSZip.loadAsync(bytes);
  if (format === "docx") return docxPackage(zip);
  if (format === "xlsx") return xlsxPackage(zip);
  return pptxPackage(zip);
}
