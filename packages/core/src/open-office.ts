import { importBinaryDoc } from "./doc-binary";
import { importForeign, foreignKind } from "./foreign-import";
import { parseFile, type SuiteFile } from "./index";
import { importOffice, type OfficeFormat } from "./office";
import { parsePowerPoint } from "./pptx";
import type { OfficeDigest } from "./roundtrip-digest";

export const OFFICE_OPEN_EXTENSIONS = [
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
] as const;

const WORD_XML = new Set(["docx", "docm", "dotx", "dotm"]);
const SHEET_XML = new Set(["xlsx", "xlsm", "xltx", "xls", "xlsb"]);
const POWERPOINT = new Set(["pptx", "ppt", "ppsx", "pptm", "potx", "ppsm"]);

export function isOfficeExtension(extension: string): boolean {
  return (OFFICE_OPEN_EXTENSIONS as readonly string[]).includes(extension);
}

export function isPowerPointExtension(extension: string): boolean {
  return POWERPOINT.has(extension.toLowerCase());
}

function titled(file: SuiteFile, format: string, name: string): SuiteFile {
  if (!file.importInfo) return file;
  file.importInfo = {
    ...file.importInfo,
    sourceFormat: format as typeof file.importInfo.sourceFormat,
    sourceName: name.slice(0, 250),
  };
  return parseFile(JSON.stringify(file));
}

/** Open any supported office file into an editable SuiteLeaf document. */
export async function openOfficeFile(
  input: ArrayBuffer | Uint8Array,
  format: string,
  name: string,
  options: { password?: string } = {},
): Promise<SuiteFile> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const extension = format.toLowerCase();
  if (WORD_XML.has(extension) || SHEET_XML.has(extension)) {
    const officeFormat = (
      WORD_XML.has(extension) ? "docx" : extension
    ) as OfficeFormat;
    const imported = await importOffice(bytes, officeFormat, name, options);
    return titled(imported.file, extension, name);
  }
  if (POWERPOINT.has(extension))
    return titled(
      await parsePowerPoint(bytes, name.replace(/\.[^.]+$/, "")),
      extension,
      name,
    );
  if (extension === "doc" || extension === "dot")
    return importBinaryDoc(bytes, extension, name);
  if (foreignKind(extension))
    return (await importForeign(bytes, extension, name)).file;
  throw new Error(`SuiteLeaf cannot open .${extension} files.`);
}

export async function openOfficeReader(
  bytes: Uint8Array,
  format: string,
  name: string,
): Promise<{ file: SuiteFile; reader?: OfficeDigest }> {
  if (foreignKind(format) && format !== "fods") {
    const opened = await importForeign(bytes, format, name);
    return opened;
  }
  if (format === "fods") return importForeign(bytes, format, name);
  return { file: await openOfficeFile(bytes, format, name) };
}
