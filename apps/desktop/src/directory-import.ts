import {
  open,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  createFile,
  extensionFor,
  isNativeName,
  parseNamedFile,
  serializeFile,
  type SheetFile,
  type SuiteFile,
} from "@suiteleaf/core";
import { isOfficeExtension, openOfficeFile } from "@suiteleaf/core/open-office";
import { htmlToDocument } from "../../../packages/core/src/word";
import {
  defaultDelimitedOptions,
  delimitedCellData,
  parseDelimited,
} from "../../web/src/csv";
import {
  buildMarpFile,
  dataUriFor,
  marpAssetPaths,
} from "../../web/src/editors/slide-marp-import";
import {
  DRAWING_IMPORT_EXTENSIONS,
  importDrawing,
} from "../../web/src/editors/drawing-format";

export type OfficeConverter = (
  bytes: Uint8Array,
  format: string,
  name: string,
) => Promise<SuiteFile>;
export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
}
export interface ImportEvent {
  source: string;
  status: "imported" | "skipped" | "failed";
  destination?: string;
  error?: string;
}
const inside = (path: string, root: string) =>
  path === root || path.startsWith(root + sep);

async function convert(
  path: string,
  convertOffice: OfficeConverter,
): Promise<SuiteFile> {
  const name = basename(path),
    extension = extname(path).slice(1).toLowerCase();
  const native = isNativeName(name),
    office = isOfficeExtension(extension);
  const limit = native ? 200 : office ? 120 : 50;
  if ((await stat(path)).size > limit * 1024 * 1024)
    throw new Error(`File exceeds the ${limit} MB import limit.`);
  const bytes = await readFile(path);
  if (office) return convertOffice(bytes, extension, name);
  const text = bytes.toString("utf8");
  if (native) return parseNamedFile(name, text);
  const drawing = importDrawing(name, text);
  if (drawing) return drawing;
  const title = basename(path, extname(path)).slice(0, 200) || "Imported file";
  if (extension === "csv" || extension === "tsv") {
    const parsed = parseDelimited(text, extension === "tsv" ? "\t" : "");
    if (parsed.error) throw new Error(parsed.error);
    if (!parsed.rows.length) throw new Error("This file has no rows.");
    const columns = parsed.rows.reduce(
      (max, row) => Math.max(max, row.length),
      0,
    );
    if (parsed.rows.length * columns > 200000)
      throw new Error("Imports are limited to 200,000 cells.");
    const file = createFile("sheet", title) as SheetFile;
    const sheet =
      file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
    sheet.rowCount = Math.max(1000, parsed.rows.length);
    sheet.columnCount = Math.max(26, columns);
    sheet.cellData = delimitedCellData(
      parsed.rows,
      defaultDelimitedOptions(parsed.rows, parsed.delimiter),
    );
    return file;
  }
  if (extension === "md" || extension === "markdown") {
    const assets: Record<string, string> = {};
    const root = await realpath(dirname(path));
    for (const asset of marpAssetPaths(text)) {
      try {
        const full = await realpath(resolve(root, asset));
        if (!inside(full, root)) continue;
        if ((await stat(full)).size > 50 * 1024 * 1024) continue;
        assets[asset] = dataUriFor(asset, await readFile(full));
      } catch {
        /* Missing images retain their paths. */
      }
    }
    return buildMarpFile(title, text, assets);
  }
  const file = createFile("doc", title);
  if (file.kind !== "doc") throw new Error("Expected a document.");
  file.content =
    extension === "html" || extension === "htm"
      ? htmlToDocument(text)
      : {
          type: "doc",
          content: text.split(/\r?\n/).map((line) => ({
            type: "paragraph",
            content: line ? [{ type: "text", text: line }] : [],
          })),
        };
  return file;
}

/** Recursively convert files without modifying sources or overwriting existing documents. */
export async function importDirectory(
  source: string,
  destination: string,
  options: {
    convertOffice?: OfficeConverter;
    onFile?: (event: ImportEvent) => void;
  } = {},
): Promise<ImportResult> {
  const root = await realpath(resolve(source));
  if (!(await stat(root)).isDirectory())
    throw new Error("The import source must be a directory.");
  await mkdir(destination, { recursive: true });
  const output = await realpath(resolve(destination));
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0 };
  const walk = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      // Skip symlinks and an output folder nested inside the source tree.
      if (entry.isDirectory()) {
        if (path !== output) {
          try {
            await walk(path);
          } catch (error) {
            result.failed++;
            options.onFile?.({
              source: path,
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = extname(entry.name).slice(1).toLowerCase();
      const supported =
        isNativeName(entry.name) ||
        isOfficeExtension(extension) ||
        ["txt", "csv", "tsv", "html", "htm", "md", "markdown"].includes(
          extension,
        ) ||
        DRAWING_IMPORT_EXTENSIONS.includes(extension);
      if (!supported || (root === output && isNativeName(entry.name))) {
        result.skipped++;
        options.onFile?.({ source: path, status: "skipped" });
        continue;
      }
      try {
        const file = await convert(
          path,
          options.convertOffice ?? openOfficeFile,
        );
        const folder = resolve(output, relative(root, dirname(path)));
        await mkdir(folder, { recursive: true });
        // Do not follow destination directory symlinks out of the chosen folder.
        if (!inside(await realpath(folder), output))
          throw new Error(
            "Destination folder points outside the import directory.",
          );
        const stem = basename(path, extname(path));
        const text = serializeFile(file);
        let saved = "";
        for (let suffix = 0; ; suffix++) {
          const target = join(
            folder,
            `${stem}${suffix ? ` (${suffix})` : ""}.${extensionFor(file.kind)}`,
          );
          let handle;
          try {
            handle = await open(target, "wx");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
            throw error;
          }
          try {
            await handle.writeFile(text, "utf8");
            await handle.sync();
          } catch (error) {
            await handle.close();
            await unlink(target).catch(() => {});
            throw error;
          }
          await handle.close();
          saved = target;
          break;
        }
        result.imported++;
        options.onFile?.({
          source: path,
          status: "imported",
          destination: saved,
        });
      } catch (error) {
        result.failed++;
        options.onFile?.({
          source: path,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
  await walk(root);
  return result;
}
