import type JSZip from "jszip";
import { eotToTtf } from "mtx-decompressor";
import type { EmbeddedFont } from "./index";

const GUID =
  /([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})/;

const FACE_LIMIT = 16;
const DATA_URL_LIMIT = 12_000_000;

/** ECMA-376 stores an embedded font XOR'd so it cannot be installed by copying the part out. */
function guidKey(guid: string): Uint8Array | undefined {
  const hex = guid.replace(/[{}-]/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const key = new Uint8Array(16);
  key[0] = bytes[3];
  key[1] = bytes[2];
  key[2] = bytes[1];
  key[3] = bytes[0];
  key[4] = bytes[5];
  key[5] = bytes[4];
  key[6] = bytes[7];
  key[7] = bytes[6];
  key.set(bytes.subarray(8), 8);
  return key;
}

function reveal(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(data);
  for (let i = 0; i < 32 && i < out.length; i++) out[i] ^= key[i % 16];
  return out;
}

function fontMime(bytes: Uint8Array): string | undefined {
  if (bytes.length < 4) return;
  if (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)
    return "font/ttf";
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag === "OTTO" || tag === "true") return "font/otf";
  if (tag === "wOFF") return "font/woff";
  if (tag === "wOF2") return "font/woff2";
  return;
}

function asDataUrl(bytes: Uint8Array, mime: string): string | undefined {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const url = `data:${mime};base64,${btoa(binary)}`;
  return url.length <= DATA_URL_LIMIT ? url : undefined;
}

/** PowerPoint's `LP` magic sits just past the 32-byte XOR prefix, at offset 34. */
function isEmbeddedOpenType(bytes: Uint8Array): boolean {
  return bytes.length > 36 && bytes[34] === 0x4c && bytes[35] === 0x50;
}

/**
 * Office embeds faces as obfuscated TrueType or as MicroType Express EOT.
 * A browser FontFace cannot read EOT, so those parts become TrueType first.
 */
function decodedFontBytes(
  bytes: Uint8Array,
  guid: string | undefined,
): Uint8Array | undefined {
  const key = guid ? guidKey(guid) : undefined;
  const revealed = key ? reveal(bytes, key) : bytes;
  if (isEmbeddedOpenType(revealed)) {
    try {
      const ttf = eotToTtf(revealed);
      if (fontMime(ttf)) return ttf;
    } catch {
      return;
    }
  }
  if (fontMime(revealed)) return revealed;
  if (key && fontMime(bytes)) return bytes;
  return;
}

function openFont(bytes: Uint8Array, guid: string | undefined): string | undefined {
  const decoded = decodedFontBytes(bytes, guid);
  if (!decoded) return;
  const mime = fontMime(decoded);
  return mime ? asDataUrl(decoded, mime) : undefined;
}

function u16(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 2 > bytes.length) return;
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function i16(bytes: Uint8Array, offset: number): number | undefined {
  const value = u16(bytes, offset);
  if (value === undefined) return;
  return value & 0x8000 ? value - 0x10000 : value;
}

function u32(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 4 > bytes.length) return;
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function lineGrid(grid: number): number | undefined {
  return grid > 0.5 && grid < 4 ? grid : undefined;
}

/**
 * `(usWinAscent + usWinDescent) / unitsPerEm`: font extents, not PPTX line pitch. A face that sets OS/2 USE_TYPO_METRICS spaces from the
 * typographic ascender, descender, and line gap instead, which is tighter
 * when the Windows descent is only a clip metric. A face with no shipped
 * metric still has one in the file.
 */
export function windowsLineGrid(bytes: Uint8Array): number | undefined {
  const tables = u16(bytes, 4);
  if (!tables || tables > 64 || 12 + tables * 16 > bytes.length) return;
  let head: number | undefined;
  let os2: number | undefined;
  for (let index = 0; index < tables; index++) {
    const at = 12 + index * 16;
    const tag = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    const offset = u32(bytes, at + 8);
    if (offset === undefined) return;
    if (tag === "head") head = offset;
    else if (tag === "OS/2") os2 = offset;
  }
  if (head === undefined || os2 === undefined) return;
  const units = u16(bytes, head + 18);
  if (!units) return;
  const selection = u16(bytes, os2 + 62) ?? 0;
  if (selection & 0x80) {
    const ascender = i16(bytes, os2 + 68);
    const descender = i16(bytes, os2 + 70);
    const gap = i16(bytes, os2 + 72) ?? 0;
    if (ascender && descender) {
      const typo = lineGrid((ascender + Math.abs(descender) + Math.max(0, gap)) / units);
      if (typo) return typo;
    }
  }
  const ascent = u16(bytes, os2 + 74);
  const descent = u16(bytes, os2 + 76);
  if (ascent === undefined || descent === undefined) return;
  return lineGrid((ascent + descent) / units);
}

function faceStyle(tag: string): Pick<EmbeddedFont, "style" | "weight"> | undefined {
  if (tag === "regular") return { style: "normal", weight: 400 };
  if (tag === "bold") return { style: "normal", weight: 700 };
  if (tag === "italic") return { style: "italic", weight: 400 };
  if (tag === "boldItalic") return { style: "italic", weight: 700 };
  return;
}

function zipPath(target: string): string {
  const clean = target.replace(/^\//, "");
  if (clean.startsWith("ppt/")) return clean;
  return `ppt/${clean.replace(/^\.\.\//, "")}`;
}

/** Read `p:embeddedFontLst` and undo the font-part obfuscation. */
export async function readEmbeddedFonts(zip: JSZip): Promise<EmbeddedFont[]> {
  const pres = await zip.file("ppt/presentation.xml")?.async("string");
  const rels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  if (!pres || !rels) return [];
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[1])?.[1];
    const type = /\bType="([^"]+)"/.exec(match[1])?.[1] ?? "";
    const target = /\bTarget="([^"]+)"/.exec(match[1])?.[1];
    if (id && target && type.endsWith("/font")) targets.set(id, target);
  }
  const fonts: EmbeddedFont[] = [];
  const seen = new Set<string>();
  for (const block of pres.matchAll(/<p:embeddedFont\b[\s\S]*?<\/p:embeddedFont>/g)) {
    const family = /<p:font\b[^>]*\btypeface="([^"]+)"/.exec(block[0])?.[1];
    if (!family) continue;
    for (const face of block[0].matchAll(
      /<p:(regular|bold|italic|boldItalic)\b[^>]*\br:id="([^"]+)"/g,
    )) {
      if (fonts.length >= FACE_LIMIT) return fonts;
      const style = faceStyle(face[1]);
      const target = targets.get(face[2]);
      if (!style || !target) continue;
      const key = `${family}\0${style.style}\0${style.weight}`;
      if (seen.has(key)) continue;
      const part = zip.file(zipPath(target));
      if (!part) continue;
      const bytes = await part.async("uint8array");
      const data = openFont(bytes, GUID.exec(target)?.[1]);
      if (!data) continue;
      seen.add(key);
      fonts.push({ family, ...style, data });
    }
  }
  return fonts;
}

/**
 * Windows line grid of each embedded family. The regular face wins over bold
 * and italic, which can carry a different vertical metric.
 */
export async function embeddedWindowsLineGrids(
  zip: JSZip,
): Promise<Map<string, number>> {
  const pres = await zip.file("ppt/presentation.xml")?.async("string");
  const rels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  const grids = new Map<string, number>();
  if (!pres || !rels) return grids;
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[1])?.[1];
    const type = /\bType="([^"]+)"/.exec(match[1])?.[1] ?? "";
    const target = /\bTarget="([^"]+)"/.exec(match[1])?.[1];
    if (id && target && type.endsWith("/font")) targets.set(id, target);
  }
  const regular = new Set<string>();
  for (const block of pres.matchAll(/<p:embeddedFont\b[\s\S]*?<\/p:embeddedFont>/g)) {
    const family = /<p:font\b[^>]*\btypeface="([^"]+)"/.exec(block[0])?.[1];
    if (!family) continue;
    for (const face of block[0].matchAll(
      /<p:(regular|bold|italic|boldItalic)\b[^>]*\br:id="([^"]+)"/g,
    )) {
      if (regular.has(family)) break;
      const target = targets.get(face[2]);
      if (!target) continue;
      const part = zip.file(zipPath(target));
      if (!part) continue;
      const decoded = decodedFontBytes(
        await part.async("uint8array"),
        GUID.exec(target)?.[1],
      );
      const grid = decoded ? windowsLineGrid(decoded) : undefined;
      if (!grid) continue;
      grids.set(family, grid);
      if (face[1] === "regular") regular.add(family);
    }
  }
  return grids;
}
