import Papa from "papaparse";
import { csvCell } from "./csv";
import {
  createFile,
  parseFile,
  type SuiteFile,
  type SheetFile,
} from "@suiteleaf/core";
export async function importFile(file: File): Promise<SuiteFile> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (["docx", "xlsx", "xls", "xlsm", "xlsb", "xltx"].includes(ext ?? "")) {
    if (file.size > 120 * 1024 * 1024)
      throw new Error("Office imports are limited to 120 MB.");
    const { importOfficeFile } = await import("./office-import");
    return importOfficeFile(file);
  }
  if (file.size > (ext === "suiteleaf" ? 200 : 50) * 1024 * 1024)
    throw new Error(
      ext === "suiteleaf"
        ? "Choose a native file smaller than 200 MB."
        : "Choose a file smaller than 50 MB.",
    );
  const text = await file.text();
  if (ext === "suiteleaf") return parseFile(text);
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
    const parsed = Papa.parse<string[]>(text, {
      delimiter: ext === "tsv" ? "\t" : "",
      skipEmptyLines: "greedy",
    });
    if (parsed.errors.some((e) => e.code !== "UndetectableDelimiter"))
      throw new Error(
        `Could not parse delimited file: ${parsed.errors[0].message}`,
      );
    if (!parsed.data.length) throw new Error("This file has no rows.");
    const delimiter =
      parsed.meta.delimiter === "\t" ? "tab" : parsed.meta.delimiter;
    const preview = parsed.data
      .slice(0, 4)
      .map((r) => r.slice(0, 5).join(" | "))
      .join("\n");
    if (
      !window.confirm(
        `Import ${parsed.data.length} rows using ${delimiter} delimiter?\n\n${preview}\n\nThe first row is retained. Numbers are recognized; formulas and identifiers with leading zeros stay text.`,
      )
    )
      throw new Error("Import cancelled.");
    const out = createFile("sheet", title) as SheetFile,
      sheet = out.content.workbook.sheets[out.content.workbook.sheetOrder[0]];
    const cols = parsed.data.reduce((max, r) => Math.max(max, r.length), 0);
    if (parsed.data.length * cols > 200000)
      throw new Error("Imports are limited to 200,000 cells.");
    sheet.rowCount = Math.max(1000, parsed.data.length);
    sheet.columnCount = Math.max(26, cols);
    sheet.cellData = Object.fromEntries(
      parsed.data.map((r, i) => [
        i,
        Object.fromEntries(r.map((v, j) => [j, csvCell(v)])),
      ]),
    );
    return out;
  }
  if (
    ext === "pptx" ||
    ext === "ppt" ||
    ext === "ppsx" ||
    ext === "pptm" ||
    ext === "potx" ||
    ext === "ppsm"
  ) {
    const { parsePowerPoint } = await import("@suiteleaf/core");
    const buffer = await file.arrayBuffer();
    return parsePowerPoint(buffer, title);
  }
  throw new Error(
    "Supported formats: .suiteleaf, DOCX, Excel (.xlsx, .xls, .xlsm, .xlsb, .xltx), PowerPoint (.pptx, .ppt), HTML, text, CSV, and TSV.",
  );
}
