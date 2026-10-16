import * as CFB from "cfb";
import { createFile, parseFile, type DocFile } from "./index";

/** Paragraph text from a legacy Word .doc. Formatting in the binary is not read. */
export function extractDocParagraphs(bytes: Uint8Array): string[] {
  const cfb = CFB.read(bytes, { type: "array" });
  const wordEntry = CFB.find(cfb, "WordDocument");
  if (!wordEntry?.content) return [];
  const word = Buffer.from(wordEntry.content);
  if (word.length < 32) return [];
  const magic = word.readUInt16LE(0);
  // Word 6 and Word 95 store 8-bit text between fcMin and fcMac.
  if (magic === 0xa5dc) return ansiRange(word);
  if (magic !== 0xa5ec) return [];
  const flags = word.readUInt16LE(0x0a);
  const tableEntry = CFB.find(cfb, flags & 0x0200 ? "1Table" : "0Table");
  if (!tableEntry?.content) return utf16Scan(word);
  const table = Buffer.from(tableEntry.content);
  const piece = pieceText(word, table);
  return piece.length ? piece : utf16Scan(word);
}

function pieceText(word: Buffer, table: Buffer): string[] {
  const csw = word.readUInt16LE(0x20);
  let offset = 0x22 + csw * 2;
  if (offset + 2 > word.length) return [];
  const cslw = word.readUInt16LE(offset);
  offset += 2 + cslw * 4;
  if (offset + 2 > word.length) return [];
  const pairs = word.readUInt16LE(offset);
  offset += 2;
  // fcClx is pair 33 in the Word 97 file-information block.
  if (pairs < 34 || offset + 34 * 8 > word.length) return [];
  const fcClx = word.readUInt32LE(offset + 33 * 8);
  const lcbClx = word.readUInt32LE(offset + 33 * 8 + 4);
  if (!lcbClx || fcClx + lcbClx > table.length) return [];
  const clx = table.subarray(fcClx, fcClx + lcbClx);
  let cursor = 0;
  while (cursor < clx.length && clx[cursor] === 1) {
    if (cursor + 3 > clx.length) return [];
    cursor += 3 + clx.readUInt16LE(cursor + 1);
  }
  if (cursor >= clx.length || clx[cursor] !== 2) return [];
  cursor += 1;
  if (cursor + 4 > clx.length) return [];
  const plcSize = clx.readUInt32LE(cursor);
  cursor += 4;
  if (plcSize < 12 || cursor + plcSize > clx.length) return [];
  const pieces = (plcSize - 4) / 12;
  if (!Number.isInteger(pieces) || pieces < 1) return [];
  let text = "";
  for (let i = 0; i < pieces; i++) {
    const cpStart = clx.readUInt32LE(cursor + i * 4);
    const cpEnd = clx.readUInt32LE(cursor + (i + 1) * 4);
    const pcd = cursor + (pieces + 1) * 4 + i * 8;
    if (pcd + 6 > clx.length) return [];
    const fcRaw = clx.readUInt32LE(pcd + 2);
    const compressed = (fcRaw & 0x40000000) !== 0;
    const fc = compressed ? (fcRaw & 0x3fffffff) >>> 1 : fcRaw & 0x3fffffff;
    const count = cpEnd - cpStart;
    if (count < 0 || count > 5_000_000) return [];
    const byteLength = compressed ? count : count * 2;
    if (fc + byteLength > word.length) return [];
    const slice = word.subarray(fc, fc + byteLength);
    text += compressed
      ? new TextDecoder("windows-1252").decode(slice)
      : new TextDecoder("utf-16le").decode(slice);
  }
  return paragraphs(text);
}

function ansiRange(word: Buffer): string[] {
  if (word.length < 0x20) return [];
  const fcMin = word.readUInt32LE(0x18);
  const fcMac = word.readUInt32LE(0x1c);
  if (fcMin >= fcMac || fcMac > word.length) return [];
  return paragraphs(
    new TextDecoder("windows-1252").decode(word.subarray(fcMin, fcMac)),
  );
}

function utf16Scan(word: Buffer): string[] {
  if (word.length < 0x20) return [];
  const fcMin = word.readUInt32LE(0x18);
  const fcMac = word.readUInt32LE(0x1c);
  if (fcMin >= fcMac || fcMac > word.length) return [];
  return paragraphs(new TextDecoder("utf-16le").decode(word.subarray(fcMin, fcMac)));
}

function paragraphs(text: string): string[] {
  return text
    .replace(/\u0007/g, "\t")
    .replace(/\u000b/g, "\n")
    .split(/\r/)
    .map((part) =>
      part
        .replace(/[\u0000-\u0008\u000e-\u001f]/g, "")
        .replace(/\u000c/g, "")
        .trim(),
    )
    .filter((part) => part.length > 0);
}

export function importBinaryDoc(
  bytes: Uint8Array,
  format: "doc" | "dot",
  name: string,
): DocFile {
  const title = name.replace(/\.[^.]+$/, "").slice(0, 200) || "Imported file";
  const parts = extractDocParagraphs(bytes);
  const file = createFile("doc", title) as DocFile;
  if (parts.length)
    file.content = {
      type: "doc",
      content: parts.map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    };
  file.importInfo = {
    sourceFormat: format,
    sourceName: name.slice(0, 250),
    warnings: [
      "Legacy DOC import keeps paragraph text. Character and paragraph formatting is not provided by the extractor.",
    ],
    features: ["text"],
  };
  return parseFile(JSON.stringify(file)) as DocFile;
}
