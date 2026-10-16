import JSZip from "jszip";
import * as XLSX from "xlsx";
import { OfficeParser } from "officeparser";
import {
  createFile,
  parseFile,
  type DocFile,
  type JsonNode,
  type SheetFile,
  type SlideFile,
  type SuiteFile,
} from "./index";
import { importOffice, OfficeImportError } from "./office";
import { excelSheetAlias } from "./xlsx-export";
import {
  emptyDigest,
  norm,
  type OfficeDigest,
} from "./roundtrip-digest";

type AstNode = {
  type?: string;
  text?: string;
  children?: AstNode[];
  notes?: AstNode[];
  formatting?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
  };
  metadata?: {
    level?: number;
    listType?: string;
    alignment?: string;
    row?: number;
    col?: number;
    sheetName?: string;
    attachmentName?: string;
    altText?: string;
  };
};

type Ast = {
  content?: AstNode[];
  attachments?: { name?: string; mimeType?: string; data?: string }[];
  warnings?: { message?: string }[];
};

const TEXT_FORMATS = new Set(["odt", "ott", "fodt", "rtf"]);
const SHEET_FORMATS = new Set(["ods", "fods"]);
const SLIDE_FORMATS = new Set(["odp", "fodp"]);

export function foreignKind(format: string): "doc" | "sheet" | "slide" | null {
  if (TEXT_FORMATS.has(format)) return "doc";
  if (SHEET_FORMATS.has(format)) return "sheet";
  if (SLIDE_FORMATS.has(format)) return "slide";
  return null;
}

function marks(node: AstNode): { type: string }[] {
  const formatting = node.formatting;
  const out: { type: string }[] = [];
  if (formatting?.bold) out.push({ type: "bold" });
  if (formatting?.italic) out.push({ type: "italic" });
  if (formatting?.underline) out.push({ type: "underline" });
  return out;
}

function inlineText(node: AstNode): JsonNode[] {
  const children = (node.children ?? []).filter((child) => child.type === "text" || !child.type);
  if (children.length)
    return children.flatMap((child) => {
      const text = child.text ?? "";
      if (!text) return [];
      const nodeMarks = marks(child);
      return [{ type: "text", text, ...(nodeMarks.length ? { marks: nodeMarks } : {}) }];
    });
  const text = node.text ?? "";
  if (!text) return [];
  const nodeMarks = marks(node);
  return [{ type: "text", text, ...(nodeMarks.length ? { marks: nodeMarks } : {}) }];
}

/** Words and pictures from a paragraph, including a picture nested inside it. */
function paragraphPieces(
  node: AstNode,
  attachments: Ast["attachments"],
): { images: JsonNode[]; text: JsonNode[]; notes: JsonNode[] } {
  const images: JsonNode[] = [];
  const text: JsonNode[] = [];
  const notes: JsonNode[] = [];
  const visit = (current: AstNode) => {
    if (current.type === "image") {
      const image = imageNode(current, attachments);
      if (image) images.push(image);
      return;
    }
    const children = current.children ?? [];
    if (!children.length) {
      text.push(...inlineText(current));
      notes.push(...footnoteRuns(current));
      return;
    }
    for (const child of children) {
      if (child.type === "image") {
        const image = imageNode(child, attachments);
        if (image) images.push(image);
      } else if (child.type === "text" || !child.type) {
        text.push(...inlineText(child));
        notes.push(...footnoteRuns(child));
      } else if (child.type !== "list" && child.type !== "table") visit(child);
    }
    notes.push(...footnoteRuns(current));
  };
  visit(node);
  return { images, text, notes };
}

/** Footnote text is kept in a paragraph after the one it annotates. */
function footnoteRuns(node: AstNode): JsonNode[] {
  return (node.notes ?? []).flatMap((note) => {
    const body = nodeText(note).trim();
    return body ? [{ type: "text", text: body }] : [];
  });
}

function textHolder(type: "paragraph" | "heading", text: JsonNode[], level?: number): JsonNode {
  return type === "heading"
    ? { type, attrs: { level }, content: text }
    : { type, content: text };
}

function paragraphBlocks(node: AstNode, attachments: Ast["attachments"]): JsonNode[] {
  const children = node.children ?? [];
  const directText = children.some((child) => child.type === "text" || !child.type);
  const nestedOnly =
    node.type !== "text" &&
    !directText &&
    children.some((child) => child.type === "paragraph" || child.type === "heading");
  if (nestedOnly) return blocks(children, attachments);
  const split = children.some((child) => child.type === "table" || child.type === "list");
  if (!split || node.type === "text") {
    const { images, text, notes } = paragraphPieces(node, attachments);
    const out: JsonNode[] = [...images];
    if (text.length)
      out.push(
        node.type === "heading"
          ? textHolder("heading", text, Math.min(6, Math.max(1, node.metadata?.level || 1)))
          : textHolder("paragraph", text),
      );
    for (const note of notes) out.push(textHolder("paragraph", [note]));
    return out;
  }
  const out: JsonNode[] = [];
  let buffer: AstNode[] = [];
  const flush = () => {
    if (!buffer.length) return;
    out.push(...paragraphBlocks({ ...node, text: "", children: buffer }, attachments));
    buffer = [];
  };
  for (const child of children) {
    if (child.type === "table" || child.type === "list") {
      flush();
      out.push(...blocks([child], attachments));
    } else buffer.push(child);
  }
  flush();
  return out;
}

function blocks(nodes: AstNode[], attachments: Ast["attachments"]): JsonNode[] {
  const out: JsonNode[] = [];
  for (const node of nodes) {
    if (node.type === "heading" || node.type === "paragraph" || node.type === "text") {
      out.push(...paragraphBlocks(node, attachments));
    } else if (node.type === "list") {
      const ordered = node.metadata?.listType === "ordered";
      out.push({
        type: ordered ? "orderedList" : "bulletList",
        content: (node.children ?? []).map((item) => {
          const { images, text, notes } = paragraphPieces(item, attachments);
          const content: JsonNode[] = [...images];
          if (text.length || !images.length) content.push(textHolder("paragraph", text));
          for (const note of notes) content.push(textHolder("paragraph", [note]));
          return { type: "listItem", content };
        }),
      });
    } else if (node.type === "table") {
      out.push({
        type: "table",
        content: (node.children ?? [])
          .filter((row) => row.type === "row" || row.children?.length)
          .map((row) => ({
            type: "tableRow",
            content: (row.children ?? []).map((cell) => {
              const nested = cell.children ?? [];
              const pieces = paragraphPieces(cell, attachments);
              const content = nested.length
                ? blocks(nested, attachments)
                : [
                    textHolder("paragraph", pieces.text),
                    ...pieces.notes.map((note) => textHolder("paragraph", [note])),
                  ];
              if (!content.length) content.push({ type: "paragraph" });
              return { type: "tableCell", content };
            }),
          })),
      });
    } else if (node.type === "image") {
      const image = imageNode(node, attachments);
      if (image) out.push(image);
    } else if (node.children?.length) {
      out.push(...blocks(node.children, attachments));
    }
  }
  return out;
}

function imageNode(node: AstNode, attachments: Ast["attachments"]): JsonNode | null {
  const name = node.metadata?.attachmentName;
  const found = attachments?.find((item) => item.name === name && item.data);
  if (!found?.data || !found.mimeType) return null;
  if (!/^image\/(png|jpeg|gif)$/.test(found.mimeType)) return null;
  if (found.data.length > 5_000_000) return null;
  return {
    type: "image",
    attrs: {
      src: `data:${found.mimeType};base64,${found.data}`,
      alt: node.metadata?.altText || name || "Image",
    },
  };
}

function placedSheetImages(
  source: AstNode,
  sheetId: string,
  attachments: Ast["attachments"],
): NonNullable<SheetFile["content"]["images"]> {
  const images: NonNullable<SheetFile["content"]["images"]> = [];
  const visit = (node: AstNode) => {
    if (node.type === "image") {
      const src = imageNode(node, attachments)?.attrs?.src;
      if (typeof src === "string") {
        images.push({
          id: crypto.randomUUID(),
          sheetId,
          src,
          row: node.metadata?.row ?? 0,
          column: node.metadata?.col ?? 0,
          offsetX: 8,
          offsetY: 8 + images.length * 28,
          width: 120,
          height: 90,
          anchorType: "1",
        });
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(source);
  return images;
}

function hasFormatting(node: AstNode, kind: "bold" | "italic" | "underline"): boolean {
  if (node.formatting?.[kind]) return true;
  return (node.children ?? []).some((child) => hasFormatting(child, kind));
}

function sheetFile(ast: Ast, title: string): SheetFile {
  const file = createFile("sheet", title) as SheetFile;
  const workbook = file.content.workbook;
  const sheets = (ast.content ?? []).filter((node) => node.type === "sheet");
  const tables = sheets.length
    ? sheets
    : (ast.content ?? []).filter((node) => node.type === "table");
  const sources = tables.length ? tables : [{ type: "sheet", children: ast.content, metadata: { sheetName: "Sheet1" } }];
  workbook.sheetOrder = [];
  workbook.sheets = {};
  const images: NonNullable<SheetFile["content"]["images"]> = [];
  sources.forEach((source, index) => {
    const id = crypto.randomUUID();
    const cellData: Record<
      string,
      Record<string, { v?: string | number; f?: string; s?: { bl?: number; it?: number; ul?: { s: number } } }>
    > = {};
    const visit = (node: AstNode) => {
      if (node.type === "cell") {
        const row = node.metadata?.row ?? 0;
        const column = node.metadata?.col ?? 0;
        const text = (node.text ?? "").trim();
        const bold = hasFormatting(node, "bold");
        const italic = hasFormatting(node, "italic");
        const underline = hasFormatting(node, "underline");
        if (!text && !bold && !italic && !underline) return;
        const target: {
          v?: string | number;
          f?: string;
          s?: { bl?: number; it?: number; ul?: { s: number } };
        } = {};
        if (text.startsWith("=")) target.f = text;
        else if (text) {
          const numeric = /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null;
          target.v = numeric ?? text;
        }
        const style: { bl?: number; it?: number; ul?: { s: number } } = {};
        if (bold) style.bl = 1;
        if (italic) style.it = 1;
        if (underline) style.ul = { s: 1 };
        if (style.bl || style.it || style.ul) target.s = style;
        if (target.v !== undefined || target.f || target.s) (cellData[row] ??= {})[column] = target;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(source);
    images.push(...placedSheetImages(source, id, ast.attachments));
    workbook.sheetOrder.push(id);
    workbook.sheets[id] = {
      id,
      name: source.metadata?.sheetName || `Sheet${index + 1}`,
      rowCount: 1000,
      columnCount: 26,
      cellData,
      defaultColumnWidth: 100,
      defaultRowHeight: 24,
    };
  });
  if (images.length) file.content.images = images;
  return file;
}

/** A list on a slide is one bulleted line per item. Nested lists stay in that order. */
function flattenSlideBlocks(nodes: JsonNode[], bullet = false): JsonNode[] {
  const out: JsonNode[] = [];
  for (const block of nodes) {
    if (block.type === "bulletList" || block.type === "orderedList" || block.type === "listItem") {
      out.push(...flattenSlideBlocks(block.content ?? [], true));
      continue;
    }
    if ((block.type === "paragraph" || block.type === "heading") && bullet)
      out.push({ ...block, attrs: { ...block.attrs, bullet: true } });
    else out.push(block);
  }
  return out;
}

function slideFile(ast: Ast, title: string, attachments: Ast["attachments"]): SlideFile {
  const file = createFile("slide", title) as SlideFile;
  const sources = (ast.content ?? []).filter((node) => node.type === "slide");
  const slides = sources.length ? sources : [{ type: "slide", children: ast.content }];
  file.content.slideOrder = [];
  file.content.slides = {};
  slides.forEach((source, index) => {
    const id = crypto.randomUUID();
    const elements = flattenSlideBlocks(blocks(source.children ?? [], attachments))
      .filter((block) => block.type === "paragraph" || block.type === "heading" || block.type === "image" || block.type === "table")
      .map((block, elementIndex) => {
        if (block.type === "image")
          return {
            id: crypto.randomUUID(),
            type: "image" as const,
            x: 60,
            y: 60 + elementIndex * 40,
            width: 320,
            height: 180,
            src: String(block.attrs?.src ?? ""),
            alt: String(block.attrs?.alt ?? "Image"),
          };
        if (block.type === "table") {
          const cellMarks = (block.content ?? []).map((row) =>
            (row.content ?? []).map((cell) => {
              const runs = (cell.content ?? []).flatMap((paragraph) => paragraph.content ?? []);
              const bold = runs.some((run) => run.marks?.some((mark) => mark.type === "bold"));
              const italic = runs.some((run) => run.marks?.some((mark) => mark.type === "italic"));
              const mark: { bold?: boolean; italic?: boolean } = {};
              if (bold) mark.bold = true;
              if (italic) mark.italic = true;
              return mark;
            }),
          );
          const rows = cellMarks.map((row, rowIndex) =>
            row.map((_, column) => {
              const cell = block.content?.[rowIndex]?.content?.[column];
              return (cell?.content ?? [])
                .map((paragraph) => (paragraph.content ?? []).map((run) => run.text ?? "").join(""))
                .join(" ");
            }),
          );
          const hasMarks = cellMarks.some((row) => row.some((cell) => cell.bold || cell.italic));
          return {
            id: crypto.randomUUID(),
            type: "table" as const,
            x: 60,
            y: 60 + elementIndex * 40,
            width: 840,
            height: 200,
            rows,
            ...(hasMarks ? { cellMarks } : {}),
          };
        }
        const text = (block.content ?? []).map((run) => run.text ?? "").join("");
        const marked = (name: string) =>
          (block.content ?? []).some((run) => run.marks?.some((mark) => mark.type === name));
        return {
          id: crypto.randomUUID(),
          type: "text" as const,
          x: 60,
          y: 40 + elementIndex * 48,
          width: 840,
          height: 44,
          content: text,
          fontSize: block.type === "heading" ? 32 : 18,
          bold: marked("bold"),
          ...(marked("italic") ? { italic: true } : {}),
          ...(marked("underline") ? { underline: true } : {}),
          ...(block.attrs?.bullet ? { bullet: true } : {}),
        };
      });
    const notes = (source.notes ?? [])
      .map((note) => norm(nodeText(note)))
      .filter(Boolean)
      .join("\n");
    file.content.slideOrder.push(id);
    file.content.slides[id] = {
      id,
      title: `Slide ${index + 1}`,
      layout: index === 0 ? "title" : "title-body",
      elements: elements.length
        ? elements
        : [
            {
              id: crypto.randomUUID(),
              type: "text",
              x: 60,
              y: 60,
              width: 840,
              height: 80,
              content: source.text || " ",
              fontSize: 18,
            },
          ],
      notes,
    };
  });
  return file;
}

/** Text on a note, including a paragraph stored under the note instead of on it. */
function nodeText(node: AstNode): string {
  const nested = (node.children ?? []).map(nodeText).filter((part) => part.trim());
  if (!nested.length) return node.text ?? "";
  const joined = nested.join(" ");
  const own = node.text ?? "";
  if (!own.trim() || norm(own) === norm(joined) || norm(joined).includes(norm(own))) return joined;
  return `${own} ${joined}`;
}

function readerFromAst(ast: Ast, kind: "doc" | "sheet" | "slide"): OfficeDigest {
  const reader = emptyDigest();
  const visit = (node: AstNode, coveredByCell = false, inNote = false, inTable = false) => {
    const formatting = node.formatting;
    const text = norm(node.text ?? "");
    const formula = kind === "sheet" && node.type === "cell" && text.startsWith("=");
    // A decimal spelling such as 1.00 is the number 1, matching the stored cell.
    // A formula is compared as a formula, not as the text of the cell.
    const compared = formula
      ? ""
      : kind === "sheet" && node.type === "cell" && /^-?\d+(\.\d+)?$/.test(text) && Number.isFinite(Number(text))
        ? String(Number(text))
        : text;
    if (formula) {
      const body = norm(text.replace(/^=/, ""));
      if (body.length >= 2) reader.formulas.push(body);
    }
    const textChildren = (node.children ?? []).some((child) => child.type === "text");
    const splitAround =
      (node.children ?? []).some((child) => child.type === "table" || child.type === "list");
    // A table or list in the middle of a paragraph splits the words around it into the
    // same sentences the importer stores. A short run beside the table is not its own line.
    if ((node.type === "paragraph" || node.type === "heading") && splitAround) {
      if (!inNote && !coveredByCell) {
        let buffer: AstNode[] = [];
        const flush = () => {
          if (!buffer.length) return;
          const { text: parts } = paragraphPieces({ ...node, text: "", children: buffer }, ast.attachments);
          const joined = norm(parts.map((part) => part.text ?? "").join(""));
          if (joined.length >= 2) reader.texts.push(joined);
          buffer = [];
        };
        for (const child of node.children ?? []) {
          if (child.type === "table" || child.type === "list") flush();
          else buffer.push(child);
        }
        flush();
      }
      for (const child of node.children ?? []) {
        const structural = child.type === "table" || child.type === "list";
        visit(child, structural ? false : true, inNote, inTable);
      }
      for (const note of node.notes ?? []) {
        if (!(node.children ?? []).includes(note)) visit(note, true, true, inTable);
      }
      return;
    }
    const combined =
      (node.type === "paragraph" || node.type === "heading") && textChildren && !splitAround
        ? norm(node.text?.trim() ? node.text : nodeText(node))
        : "";
    const nestedParagraphs = (node.children ?? []).some(
      (child) => child.type === "paragraph" || child.type === "heading",
    );
    const cellWithChildren =
      kind === "doc" && node.type === "cell" && (node.children ?? []).length > 0;
    const leaf =
      node.type === "text" ||
      (node.type === "cell" && !cellWithChildren) ||
      ((node.type === "paragraph" || node.type === "heading") && !textChildren && !nestedParagraphs);
    // A cell or paragraph already carries its text; a short run inside it is the same sentence.
    // Speaker notes are compared as notes, not as text on the slide.
    // A slide table cell is one line, so the paragraphs inside it are not separate text.
    const alreadyInParent =
      coveredByCell &&
      (node.type === "text" || node.type === "paragraph" || node.type === "heading");
    if (!inNote && combined.length >= 2 && !alreadyInParent) reader.texts.push(combined);
    if (
      !inNote &&
      !combined &&
      leaf &&
      !cellWithChildren &&
      !alreadyInParent &&
      compared.length >= 2
    )
      reader.texts.push(compared);
    if (!inNote && !(kind === "slide" && inTable) && formatting?.bold && text) reader.bold.push(text);
    if (!inNote && !(kind === "slide" && inTable) && formatting?.italic && text) reader.italic.push(text);
    if (!inNote && !(kind === "slide" && inTable) && formatting?.underline && text) reader.underline.push(text);
    if (
      kind === "slide" &&
      inTable &&
      text &&
      (formatting?.bold || formatting?.italic || formatting?.underline) &&
      !reader.limits.includes("slide.table-format")
    )
      reader.limits.push("slide.table-format");
    if (node.type === "table") reader.tables += 1;
    if (node.type === "image") {
      const found = ast.attachments?.find((item) => item.name === node.metadata?.attachmentName && item.data);
      const chart = /chart/i.test(found?.mimeType ?? "");
      const picture =
        Boolean(found?.mimeType && found.data) &&
        /^image\/(png|jpeg|gif)$/.test(found?.mimeType ?? "") &&
        (found?.data?.length ?? 0) <= 5_000_000;
      if (picture) reader.images += 1;
      else if (chart && !reader.thirdParty.includes("reader.chart")) reader.thirdParty.push("reader.chart");
    }
    if (kind === "slide" && node.type === "note") {
      const note = norm(nodeText(node));
      if (note.length >= 2) reader.notes.push(note);
    }
    const nextCovered =
      coveredByCell ||
      combined.length >= 2 ||
      (node.type === "cell" && text.length >= 2 && !cellWithChildren);
    const nextNote = inNote || (kind === "slide" && node.type === "note");
    const nextTable = inTable || node.type === "table";
    for (const child of node.children ?? []) visit(child, nextCovered, nextNote, nextTable);
    for (const note of node.notes ?? []) {
      if (!(node.children ?? []).includes(note)) visit(note, nextCovered, true, nextTable);
    }
  };
  for (const node of ast.content ?? []) visit(node);
  if (kind === "slide") reader.thirdParty.push("slide.position");
  for (const warning of ast.warnings ?? []) {
    if (warning.message) reader.thirdParty.push("reader.warning");
  }
  return reader;
}

async function packageFlat(xml: string, format: "fodt" | "fodp"): Promise<Uint8Array> {
  const mime =
    format === "fodt"
      ? "application/vnd.oasis.opendocument.text"
      : "application/vnd.oasis.opendocument.presentation";
  let content = xml;
  if (/<office:document[\s>]/.test(xml) && !/<office:document-content[\s>]/.test(xml))
    content = xml
      .replace(/<office:document\b/, "<office:document-content")
      .replace(/<\/office:document>\s*$/, "</office:document-content>");
  const zip = new JSZip();
  zip.file("mimetype", mime, { compression: "STORE" });
  zip.file("content.xml", content);
  zip.file(
    "META-INF/manifest.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <manifest:file-entry manifest:media-type="${mime}" manifest:full-path="/"/>
  <manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/>
</manifest:manifest>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

function xmlPieces(xml: string): string[] {
  const pieces: string[] = [];
  const pattern = /<(?:text:p|text:h|w:t|a:t)\b[^>]*>([\s\S]*?)<\/(?:text:p|text:h|w:t|a:t)>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const text = norm(match[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
    if (text.length >= 2) pieces.push(text);
  }
  return pieces;
}

async function sourceXml(bytes: Uint8Array, format: string): Promise<string> {
  if (format === "fodt" || format === "fodp" || format === "fods" || format === "rtf")
    return new TextDecoder().decode(bytes);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return "";
  try {
    const zip = await JSZip.loadAsync(bytes);
    const part =
      zip.file("content.xml") ??
      zip.file("word/document.xml") ??
      Object.values(zip.files).find((file) => file.name.endsWith("content.xml"));
    return part ? await part.async("string") : "";
  } catch {
    return "";
  }
}

function rememberGaps(reader: OfficeDigest, xml: string) {
  const known = new Set(reader.texts.map(norm));
  let missed = 0;
  for (const piece of xmlPieces(xml)) if (!known.has(piece)) missed += 1;
  if (missed) reader.thirdParty.push("reader.text");
}

/** Empty rows repeated only to fill the sheet are not expanded. */
function collapseEmptyRepeatedRows(xml: string): string {
  return xml.replace(
    /<table:table-row\b([^>]*?)\btable:number-rows-repeated="(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g,
    (whole, _before: string, countText: string, _after: string, inner?: string) => {
      const count = Number(countText);
      if (!(count > 1000)) return whole;
      const body = inner ?? "";
      if (body.includes("<table:table-row")) return whole;
      const hasContent =
        /office:(?:value|string-value|date-value|boolean-value|time-value)=/.test(body) ||
        /table:formula=/.test(body) ||
        /<text:p>[^<\s]/.test(body) ||
        /<draw:/.test(body) ||
        /<office:annotation\b/.test(body);
      if (!hasContent) return "";
      if (count > 1048576)
        throw new OfficeImportError(
          "cell-limit",
          "This file repeats more rows than the spreadsheet grid allows.",
        );
      return whole;
    },
  );
}

async function withoutEmptyFillerRows(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  const part = zip.file("content.xml");
  if (!part) return bytes;
  const xml = await part.async("string");
  const next = collapseEmptyRepeatedRows(xml);
  if (next === xml) return bytes;
  zip.file("content.xml", next);
  return zip.generateAsync({ type: "uint8array" });
}

/** officeparser can skip a spreadsheet picture that is anchored to the sheet. */
function rememberOmittedPictures(reader: OfficeDigest, xml: string) {
  const names = new Set<string>();
  for (const match of xml.matchAll(/<draw:image\b[^>]*\bxlink:href="([^"]+)"/g)) {
    if (/\.(png|jpe?g|gif|webp)$/i.test(match[1] ?? "")) names.add(match[1]);
  }
  if (names.size > reader.images) reader.thirdParty.push("reader.image");
}

/** SheetJS can parse a flat-spreadsheet cell and still leave it outside `!ref`. */
function coverParsedCells(sheet: XLSX.WorkSheet) {
  let startRow = Number.POSITIVE_INFINITY;
  let startColumn = Number.POSITIVE_INFINITY;
  let endRow = -1;
  let endColumn = -1;
  for (const ref of Object.keys(sheet)) {
    if (ref.startsWith("!")) continue;
    const cell = XLSX.utils.decode_cell(ref);
    startRow = Math.min(startRow, cell.r);
    startColumn = Math.min(startColumn, cell.c);
    endRow = Math.max(endRow, cell.r);
    endColumn = Math.max(endColumn, cell.c);
  }
  if (endRow < 0) return;
  sheet["!ref"] = XLSX.utils.encode_range({
    s: { r: startRow, c: startColumn },
    e: { r: endRow, c: endColumn },
  });
}

async function importFlatSheet(bytes: Uint8Array, name: string): Promise<{ file: SuiteFile; reader: OfficeDigest }> {
  const xml = collapseEmptyRepeatedRows(new TextDecoder().decode(bytes));
  const book = XLSX.read(xml, { type: "string", cellFormula: true });
  const reader = emptyDigest();
  for (const sheetName of book.SheetNames) {
    const sheet = book.Sheets[sheetName];
    if (!sheet) continue;
    coverParsedCells(sheet);
    for (const ref of Object.keys(sheet)) {
      if (ref.startsWith("!")) continue;
      const cell = sheet[ref] as { t?: string; v?: unknown; f?: string; w?: string };
      if (cell.f) reader.formulas.push(cell.f.replace(/^=/, ""));
      // A number format, a date, or a TRUE/FALSE spelling is not a separate text value.
      // A value SheetJS could not resolve is not the text "NaN".
      const raw = cell.t === "n" || cell.t === "b" ? cell.v : (cell.w ?? cell.v);
      if (typeof raw === "number" && !Number.isFinite(raw)) continue;
      const text = norm(String(raw ?? ""));
      if (text.length >= 2) reader.texts.push(text);
    }
  }
  const originalNames = [...book.SheetNames];
  const used = new Set<string>();
  const aliases = originalNames.map((sheetName) => excelSheetAlias(sheetName, used));
  if (aliases.some((alias, index) => alias !== originalNames[index])) {
    const sheets: XLSX.WorkBook["Sheets"] = {};
    aliases.forEach((alias, index) => {
      sheets[alias] = book.Sheets[originalNames[index]];
    });
    book.SheetNames = aliases;
    book.Sheets = sheets;
  }
  const written = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const imported = await importOffice(new Uint8Array(written), "xlsx", name);
  const workbook = (imported.file as SheetFile).content.workbook;
  workbook.sheetOrder.forEach((id, index) => {
    const sheet = workbook.sheets[id];
    if (sheet && originalNames[index]) sheet.name = originalNames[index];
  });
  imported.file.importInfo = {
    sourceFormat: "fods",
    sourceName: name.slice(0, 250),
    warnings: [
      ...imported.file.importInfo!.warnings,
      "Flat ODS was read by SheetJS and then opened as a workbook.",
    ],
    features: imported.file.importInfo!.features,
  };
  rememberGaps(reader, new TextDecoder().decode(bytes));
  return { file: parseFile(JSON.stringify(imported.file)), reader };
}

export async function importForeign(
  bytes: Uint8Array,
  format: string,
  name: string,
): Promise<{ file: SuiteFile; reader: OfficeDigest }> {
  const kind = foreignKind(format);
  if (!kind)
    throw new OfficeImportError("wrong-format", `SuiteLeaf cannot open .${format} files.`);
  if (format === "fods") return importFlatSheet(bytes, name);
  let payload = bytes;
  let fileType = format;
  if (format === "fodt" || format === "fodp") {
    payload = await packageFlat(collapseEmptyRepeatedRows(new TextDecoder().decode(bytes)), format);
    fileType = format === "fodt" ? "odt" : "odp";
  } else if (format === "ott") fileType = "ott";
  if (format !== "fodt" && format !== "fodp" && format !== "rtf") payload = await withoutEmptyFillerRows(bytes);
  let ast: Ast;
  try {
    ast = (await OfficeParser.parseOffice(payload, {
      fileType: fileType as "odt",
      extractAttachments: bytes.byteLength < 15 * 1024 * 1024,
      ocr: false,
    })) as Ast;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /password/i.test(message)
      ? "encrypted"
      : /zip|xml|not a|missing/i.test(message)
        ? "invalid-container"
        : "conversion-error";
    throw new OfficeImportError(code, message);
  }
  const title = name.replace(/\.[^.]+$/, "").slice(0, 200) || "Imported file";
  const reader = readerFromAst(ast, kind);
  const xml = await sourceXml(bytes, format);
  rememberGaps(reader, xml);
  if (format === "ods") rememberOmittedPictures(reader, xml);
  let file: SuiteFile;
  if (kind === "doc") {
    const doc = createFile("doc", title) as DocFile;
    const content = blocks(ast.content ?? [], ast.attachments);
    doc.content = { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
    file = doc;
  } else if (kind === "sheet") file = sheetFile(ast, title);
  else file = slideFile(ast, title, ast.attachments);
  file.importInfo = {
    sourceFormat: format as NonNullable<SuiteFile["importInfo"]>["sourceFormat"],
    sourceName: name.slice(0, 250),
    warnings: (ast.warnings ?? []).map((warning) => warning.message || "Import warning").slice(0, 20),
    features: [format],
  };
  return { file: parseFile(JSON.stringify(file)), reader };
}
