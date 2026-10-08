import JSZip from "jszip";
import * as CFB from "cfb";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { parseFile, type SuiteFile } from "./index";
import { importDocx } from "./word";
import { importXlsx, normalizeBinaryExcel } from "./excel";
export const OFFICE_INPUT_LIMIT = 120 * 1024 * 1024;
export const OFFICE_EXPANDED_LIMIT = 1024 * 1024 * 1024;
export type OfficeFormat = "docx" | "xlsx" | "xls" | "xlsm" | "xlsb" | "xltx";
export type OfficeReport = {
  format: OfficeFormat;
  warnings: string[];
  stats: Record<string, number>;
  textPreserved?: boolean;
  features: string[];
};
export type OfficeImport = { file: SuiteFile; report: OfficeReport };
export class OfficeImportError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "OfficeImportError";
  }
}
export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
});
export function array<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
export function parseXml(xml: string, path: string): any {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new OfficeImportError(
      "unsafe-xml",
      `${path} contains unsupported XML entity declarations.`,
    );
  const valid = XMLValidator.validate(xml);
  if (valid !== true)
    throw new OfficeImportError("invalid-xml", `${path}: ${valid.err.msg}`);
  return xmlParser.parse(xml);
}
export function resolvePart(base: string, target: string): string {
  const parts = target.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const p of target.replace(/\\/g, "/").split("/")) {
    if (p === "..") parts.pop();
    else if (p && p !== ".") parts.push(p);
  }
  return parts.join("/");
}
export async function readXml(zip: JSZip, path: string): Promise<any> {
  const f = zip.file(path);
  if (!f)
    throw new OfficeImportError(
      "missing-part",
      `The Office file is missing ${path}.`,
    );
  return parseXml(await f.async("string"), path);
}
export async function relationships(
  zip: JSZip,
  part: string,
): Promise<Map<string, { path: string; external: boolean; type: string }>> {
  const index = part.lastIndexOf("/");
  const rel = `${part.slice(0, index + 1)}_rels/${part.slice(index + 1)}.rels`;
  const f = zip.file(rel);
  if (!f) return new Map();
  const xml = parseXml(await f.async("string"), rel);
  return new Map(
    array<any>(xml.Relationships?.Relationship).map((r) => [
      r["@_Id"],
      {
        path:
          r["@_TargetMode"] === "External"
            ? r["@_Target"]
            : resolvePart(part, r["@_Target"] ?? ""),
        external: r["@_TargetMode"] === "External",
        type: r["@_Type"] ?? "",
      },
    ]),
  );
}
export async function inspectOffice(
  bytes: Uint8Array,
  format: OfficeFormat,
): Promise<{ zip: JSZip; part: string; xml: string }> {
  if (bytes.byteLength > OFFICE_INPUT_LIMIT)
    throw new OfficeImportError(
      "input-limit",
      "Office imports are limited to 120 MB.",
    );
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    try {
      const cfb = CFB.read(bytes, { type: "array" });
      if (cfb.FullPaths.some((p) => p.endsWith("/EncryptedPackage")))
        throw new OfficeImportError(
          "encrypted",
          "This Office file is password-protected. Open an unencrypted copy saved by Word or Excel.",
        );
    } catch (e) {
      if (e instanceof OfficeImportError) throw e;
    }
    throw new OfficeImportError(
      "wrong-format",
      `This is an older binary Office file, not a ZIP-based ${format.toUpperCase()} file.`,
    );
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new OfficeImportError(
      "invalid-container",
      "This file has a damaged or invalid Office ZIP signature.",
    );
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (e) {
    throw new OfficeImportError(
      "invalid-container",
      `Could not read the Office ZIP package: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  let expanded = 0;
  for (const f of Object.values(zip.files)) {
    expanded += (f as any)._data?.uncompressedSize ?? 0;
    if (expanded > OFFICE_EXPANDED_LIMIT)
      throw new OfficeImportError(
        "expanded-limit",
        "This Office package expands beyond the 1 GB import limit.",
      );
  }
  if (!zip.file("[Content_Types].xml"))
    throw new OfficeImportError(
      "missing-part",
      "The Office package has no content-types manifest.",
    );
  let part =
    format === "docx"
      ? "word/document.xml"
      : format === "xlsb"
        ? "xl/workbook.bin"
        : "xl/workbook.xml";
  // Root relationships live at _rels/.rels, not root.rels.
  const root = zip.file("_rels/.rels");
  if (root) {
    const x = parseXml(await root.async("string"), "_rels/.rels");
    const rel = array<any>(x.Relationships?.Relationship).find((r) =>
      String(r["@_Type"]).endsWith("/officeDocument"),
    );
    if (rel && rel["@_TargetMode"] !== "External")
      part = resolvePart("", rel["@_Target"]);
  }
  const f = zip.file(part);
  if (!f)
    throw new OfficeImportError(
      "missing-part",
      `The Office package is missing its ${format === "docx" ? "document" : "workbook"} part.`,
    );
  let xml: string;
  try {
    xml = await f.async("string");
  } catch (e) {
    throw new OfficeImportError(
      "invalid-container",
      e instanceof Error ? e.message : String(e),
    );
  }
  if (format === "docx") {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new OfficeImportError(
        "unsafe-xml",
        "Document contains XML entity declarations.",
      );
    const valid = XMLValidator.validate(xml);
    if (valid !== true)
      throw new OfficeImportError("invalid-xml", valid.err.msg);
  } else if (format !== "xlsb" || !part.endsWith(".bin")) parseXml(xml, part);
  return { zip, part, xml };
}
export async function importOffice(
  input: ArrayBuffer | Uint8Array,
  format: OfficeFormat,
  name: string,
  options: { password?: string } = {},
): Promise<OfficeImport> {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > OFFICE_INPUT_LIMIT)
    throw new OfficeImportError(
      "input-limit",
      "Office imports are limited to 120 MB.",
    );
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    const { decryptOfficePackage } = await import("./office-encryption");
    bytes = decryptOfficePackage(bytes, options.password);
  }
  const binary = format === "xls" || format === "xlsb";
  if (format === "xlsb") await inspectOffice(bytes, format);
  if (binary) bytes = await normalizeBinaryExcel(bytes);
  const inspected = await inspectOffice(bytes, binary ? "xlsx" : format);
  const title = name.replace(/\.[^.]+$/, "").slice(0, 200) || "Imported file";
  let result: OfficeImport;
  try {
    result =
      format === "docx"
        ? await importDocx(bytes, title, inspected)
        : await importXlsx(bytes, title, inspected);
  } catch (e) {
    if (e instanceof OfficeImportError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    if (
      /uncompressed data size mismatch|Corrupted zip|End of data reached/.test(
        message,
      )
    )
      throw new OfficeImportError(
        "invalid-container",
        `The Office ZIP package contains a corrupt part: ${message}`,
      );
    throw e;
  }
  result.report.format = format;
  if (binary)
    result.report.warnings.push(
      "Binary Excel import preserves cell values, formulas, number formats, merges, and supported dimensions. Cell formatting, charts, drawings, and other workbook features may differ from Excel; macros are not imported.",
    );
  result.file.importInfo = {
    sourceFormat: format,
    sourceName: name.slice(0, 250),
    warnings: result.report.warnings,
    features: result.report.features,
  };
  // Validate the same native format that the application saves and reopens.
  try {
    result.file = parseFile(JSON.stringify(result.file));
  } catch (e) {
    if (e instanceof Error && e.message.includes("200 MB"))
      throw new OfficeImportError(
        "native-limit",
        "The converted workbook exceeds the 200 MB editable native-file limit.",
      );
    throw e;
  }
  return result;
}
