import {
  defaultDelimitedOptions,
  delimitedCellData,
  parseDelimited,
  type DelimitedOptions,
} from "./csv";
import {
  createFile,
  isNativeName,
  parseNamedFile,
  type SuiteFile,
  type SheetFile,
} from "@suiteleaf/core";
import { createMarpFile, marpToDeck } from "./editors/slide-marp";

export const maxDelimitedCells = 200000;
/** A parsed CSV/TSV file awaiting the person's import choices. */
export interface DelimitedDraft {
  name: string;
  text: string;
  rows: string[][];
  delimiter: string;
}
/** Shows a delimited import for review; resolves to null when cancelled. */
export type ReviewDelimited = (
  draft: DelimitedDraft,
) => Promise<DelimitedOptions | null>;

/** Converts a picked file; resolves to null if the person cancels a review step. */
export async function importFile(
  file: File,
  review?: ReviewDelimited,
): Promise<SuiteFile | null> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (
    [
      "docx",
      "docm",
      "dotx",
      "dotm",
      "doc",
      "dot",
      "xlsx",
      "xlsm",
      "xlsb",
      "xltx",
      "xls",
      "pptx",
      "ppt",
      "ppsx",
      "pptm",
      "potx",
      "ppsm",
      "odt",
      "ott",
      "fodt",
      "ods",
      "fods",
      "odp",
      "fodp",
      "rtf",
    ].includes(ext ?? "")
  ) {
    if (file.size > 120 * 1024 * 1024)
      throw new Error("Office imports are limited to 120 MB.");
    const { importOfficeFile } = await import("./office-import");
    return importOfficeFile(file);
  }
  const native = isNativeName(file.name);
  if (file.size > (native ? 200 : 50) * 1024 * 1024)
    throw new Error(
      native
        ? "Choose a native file smaller than 200 MB."
        : "Choose a file smaller than 50 MB.",
    );
  const text = await file.text();
  if (native) return parseNamedFile(file.name, text);
  const title =
    file.name.replace(/\.[^.]+$/, "").slice(0, 200) || "Imported file";
  if (ext === "html" || ext === "htm") {
    const { importHTML } = await import("./editors/Docs");
    return {
      ...createFile("doc", title),
      kind: "doc",
      content: importHTML(text),
    };
  }
  if (ext === "txt")
    return {
      ...createFile("doc", title),
      kind: "doc",
      content: {
        type: "doc",
        content: text.split(/\r?\n/).map((t) => ({
          type: "paragraph",
          content: t ? [{ type: "text", text: t }] : [],
        })),
      },
    };
  if (ext === "csv" || ext === "tsv") {
    const parsed = parseDelimited(text, ext === "tsv" ? "\t" : "");
    if (parsed.error)
      throw new Error(`Could not parse delimited file: ${parsed.error}`);
    if (!parsed.rows.length) throw new Error("This file has no rows.");
    const options = review
      ? await review({ name: file.name, text, ...parsed })
      : defaultDelimitedOptions(parsed.rows, parsed.delimiter);
    if (!options) return null;
    let rows = parsed.rows;
    if (options.delimiter !== parsed.delimiter) {
      const again = parseDelimited(text, options.delimiter);
      if (again.error)
        throw new Error(`Could not parse delimited file: ${again.error}`);
      rows = again.rows;
    }
    const out = createFile("sheet", title) as SheetFile,
      sheet = out.content.workbook.sheets[out.content.workbook.sheetOrder[0]];
    const cols = rows.reduce((max, r) => Math.max(max, r.length), 0);
    if (rows.length * cols > maxDelimitedCells)
      throw new Error("Imports are limited to 200,000 cells.");
    sheet.rowCount = Math.max(1000, rows.length);
    sheet.columnCount = Math.max(26, cols);
    sheet.cellData = delimitedCellData(rows, options);
    return out;
  }
  if (ext === "md" || ext === "markdown") {
    const deck = createMarpFile(title);
    const parsed = marpToDeck(text, deck.content, { marp: true });
    if ("error" in parsed) throw new Error(parsed.error);
    deck.content = parsed.deck;
    deck.content.marp = true;
    return deck;
  }
  throw new Error(
    "Supported formats: SuiteLeaf (.sldoc, .slsheet, .slslides, .suiteleaf), Word, Excel, PowerPoint, OpenDocument, RTF, Markdown (.md), HTML, text, CSV, and TSV.",
  );
}
