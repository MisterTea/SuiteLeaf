import { createHash } from "node:crypto";
import { exportDocx } from "./docx-export";
import { extractDocParagraphs } from "./doc-binary";
import { openOfficeReader } from "./open-office";
import { OfficeImportError } from "./office";
import { exportPptx } from "./pptx-export";
import { parsePowerPoint } from "./pptx";
import { scanOfficePackage } from "./roundtrip-scan";
import {
  classifyRoundTrip,
  emptyDigest,
  norm,
  type OfficeDigest,
  type RoundTripDifference,
} from "./roundtrip-digest";
import type { JsonNode, SheetFile, SlideFile, SuiteFile } from "./index";
import { importOffice } from "./office";
import { exportXlsx } from "./xlsx-export";

export type { RoundTripDifference } from "./roundtrip-digest";

export interface RoundTripResult {
  path: string;
  sha256: string;
  format: string;
  outcome: "match" | "diff" | "rejected";
  expectedRejection: boolean;
  code?: string;
  differences: RoundTripDifference[];
}

const EXPECTED = new Set([
  "encrypted",
  "wrong-format",
  "wrong-password",
  "invalid-container",
  "missing-part",
  "invalid-xml",
  "unsafe-xml",
  "input-limit",
  "expanded-limit",
  "content-limit",
  "cell-limit",
  "native-limit",
  "memory-limit",
]);

function deletedSuggestion(node: JsonNode): boolean {
  return (node.marks ?? []).some(
    (mark) => mark.type === "suggestion" && mark.attrs?.kind === "delete",
  );
}

function textOf(node: JsonNode): string {
  if (node.type === "hardBreak") return "\n";
  if (node.type === "noteReference") return "";
  if (deletedSuggestion(node)) return "";
  const raw = node.text ?? (node.content ?? []).map(textOf).join("");
  return raw.replace(/\uE000[\s\S]*?\uE001/g, "");
}

function addMark(reader: OfficeDigest, text: string, marks: { type: string }[] | undefined) {
  const types = new Set((marks ?? []).map((mark) => mark.type));
  if (types.has("bold")) reader.bold.push(text);
  if (types.has("italic")) reader.italic.push(text);
  if (types.has("underline")) reader.underline.push(text);
}

/** The editable stand-in for a picture the converter cannot display. */
function withoutImageLabels(value: string): string {
  return value.replace(/\[Unsupported [^\]]* image\]/g, "");
}

function keep(reader: OfficeDigest, feature: string) {
  if (!reader.kept.includes(feature)) reader.kept.push(feature);
}

function walkDoc(node: JsonNode, reader: OfficeDigest) {
  if (node.type === "equation") keep(reader, "doc.equation");
  if (node.type === "textBox") keep(reader, "doc.textbox");
  if ((node.marks ?? []).some((mark) => mark.type === "suggestion"))
    keep(reader, "doc.tracked-changes");
  if (node.type === "image" || node.type === "inlineImage") reader.images += 1;
  if (node.type === "table") reader.tables += 1;
  if (node.type === "paragraph" || node.type === "heading") {
    const text = norm(withoutImageLabels(textOf(node)));
    if (text.length >= 2) reader.texts.push(text);
  }
  if (node.type === "text" && !deletedSuggestion(node)) {
    const text = norm((node.text ?? "").replace(/\uE000[\s\S]*?\uE001/g, ""));
    if (text.length >= 2) addMark(reader, text, node.marks);
  }
  for (const child of node.content ?? []) walkDoc(child, reader);
}

function cellStyle(styles: Record<string, unknown> | undefined, style: unknown) {
  if (!style) return undefined;
  if (typeof style === "object") return style as Record<string, unknown>;
  if (typeof style === "string" && styles) return styles[style] as Record<string, unknown> | undefined;
  return undefined;
}

function digestFile(file: SuiteFile): OfficeDigest {
  const reader = emptyDigest();
  if (file.kind === "doc") {
    walkDoc(file.content, reader);
    return reader;
  }
  if (file.kind === "sheet") {
    const book = (file as SheetFile).content.workbook as {
      styles?: Record<string, unknown>;
      sheetOrder: string[];
      sheets: Record<string, { cellData?: Record<string, Record<string, { v?: unknown; f?: string; s?: unknown }>> }>;
    };
    for (const id of book.sheetOrder) {
      const sheet = book.sheets[id];
      for (const row of Object.values(sheet?.cellData ?? {})) {
        for (const cell of Object.values(row ?? {})) {
          if (!cell) continue;
          if (cell.f) reader.formulas.push(norm(cell.f.replace(/^=/, "")));
          const text = norm(String(cell.v ?? ""));
          if (text.length >= 2) reader.texts.push(text);
          const style = cellStyle(book.styles, cell.s);
          if (style?.bl === 1 || style?.bl === true) reader.bold.push(text);
          if (style?.it === 1 || style?.it === true) reader.italic.push(text);
          const underline = style?.ul as { s?: number } | undefined;
          if (underline?.s) reader.underline.push(text);
        }
      }
    }
    reader.images = ((file as SheetFile).content as { images?: unknown[] }).images?.length ?? 0;
    return reader;
  }
  const deck = (file as SlideFile).content;
  for (const id of deck.slideOrder) {
    const slide = deck.slides[id];
    if (!slide) continue;
    if (slide.notes) {
      const notes = norm(slide.notes);
      if (notes.length >= 2) reader.notes.push(notes);
    }
    if (slide.comments?.length) reader.thirdParty.push("slide.comment");
    if (slide.transition && slide.transition.type !== "none") keep(reader, "slide.transition");
    if (slide.timing) keep(reader, "slide.animation");
    for (const el of slide.elements) {
      if (el.animation) keep(reader, "slide.animation");
      if (el.cellMarks?.some((row) => row.some((cell) => cell.bold || cell.italic)))
        keep(reader, "slide.table-format");
      if (el.type === "image") reader.images += 1;
      if (el.type === "table") {
        reader.tables += 1;
        for (const row of el.rows ?? [])
          for (const cell of row) {
            const text = norm(cell);
            if (text.length >= 2) reader.texts.push(text);
          }
      }
      const text = norm(el.content ?? "");
      if (text.length >= 2) {
        reader.texts.push(text);
        if (el.bold) reader.bold.push(text);
        if (el.italic) reader.italic.push(text);
        if (el.underline) reader.underline.push(text);
      }
      for (const run of el.runs ?? []) {
        const runText = norm(run.text);
        if (runText.length < 2) continue;
        if (run.bold) reader.bold.push(runText);
        if (run.italic) reader.italic.push(runText);
        if (run.underline) reader.underline.push(runText);
      }
    }
  }
  return reader;
}

async function exportAgain(file: SuiteFile, name: string): Promise<SuiteFile> {
  if (file.kind === "doc") {
    const bytes = await exportDocx(file);
    return (await importOffice(bytes, "docx", `${name}.docx`)).file;
  }
  if (file.kind === "sheet") {
    const bytes = await exportXlsx(file);
    return (await importOffice(bytes, "xlsx", `${name}.xlsx`)).file;
  }
  const bytes = await exportPptx(file as SlideFile);
  return parsePowerPoint(bytes, name);
}

function rejected(path: string, sha256: string, format: string, code: string, expected: boolean): RoundTripResult {
  return {
    path,
    sha256,
    format,
    outcome: "rejected",
    expectedRejection: expected,
    code,
    differences: [],
  };
}

/** Import one file, export it, and classify information that did not survive. */
export async function roundTripOffice(
  bytes: Uint8Array,
  format: string,
  path: string,
): Promise<RoundTripResult> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const name = path.split("/").pop() || path;
  try {
    const opened = await openOfficeReader(bytes, format, name);
    const file = opened.file;
    let reader = opened.reader ?? (await scanOfficePackage(bytes, format)) ?? emptyDigest();
    if (!opened.reader && !reader.texts.length && format !== "xls" && format !== "xlsb" && format !== "ppt") {
      const scanned = await scanOfficePackage(bytes, format);
      if (scanned) reader = scanned;
    }
    if (format === "doc" || format === "dot") {
      reader = emptyDigest();
      for (const paragraph of extractDocParagraphs(bytes)) {
        const text = norm(paragraph);
        if (text.length >= 2) reader.texts.push(text);
      }
      reader.thirdParty.push("doc.legacy-formatting");
    }
    if (format === "xls" || format === "xlsb") reader.thirdParty.push("sheet.binary-formatting");
    if (format === "ppt") reader.thirdParty.push("slide.legacy-formatting");
    const model = digestFile(file);
    const again = digestFile(await exportAgain(file, name.replace(/\.[^.]+$/, "")));
    const differences = classifyRoundTrip(reader, model, again);
    return {
      path,
      sha256,
      format,
      outcome: differences.length ? "diff" : "match",
      expectedRejection: false,
      differences,
    };
  } catch (error) {
    const code = error instanceof OfficeImportError ? error.code : "conversion-error";
    return rejected(path, sha256, format, code, EXPECTED.has(code));
  }
}
