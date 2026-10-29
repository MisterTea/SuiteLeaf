import type JSZip from "jszip";
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

function openFont(bytes: Uint8Array, guid: string | undefined): string | undefined {
  const key = guid ? guidKey(guid) : undefined;
  const revealed = key ? reveal(bytes, key) : bytes;
  const mime = fontMime(revealed) ?? (!key ? undefined : fontMime(bytes));
  const chosen = fontMime(revealed) ? revealed : bytes;
  return mime ? asDataUrl(chosen, mime) : undefined;
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
