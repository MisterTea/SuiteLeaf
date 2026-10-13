import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import type { PageSettings } from "./document-layout";
import type { JsonNode } from "./index";

type Kind = "header" | "footer";
type Variant = "default" | "first" | "even";
type PartRef = { kind: Kind; variant: Variant; path: string };

export type WordPageFurniture = {
  settings: Partial<PageSettings>;
  /** Image blocks kept in the body. Header text is not included. */
  blocks: JsonNode[];
  warnings: string[];
  supplementary: number;
};

const pageInstr = /\b(?:PAGE|NUMPAGES)\b/;

function decodeXml(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Visible header or footer text. A PAGE or NUMPAGES field is not text: its
 * instruction and cached result (often "1" or "3") are dropped so a header
 * that is only a page number stays a page number.
 */
export function headerPartText(xml: string): {
  text: string;
  pageNumber: boolean;
} {
  const token =
    /<w:fldChar\b[^>]*w:fldCharType="(begin|separate|end)"[^>]*\/?>|<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>|<w:fldSimple\b([^>]*)>([\s\S]*?)<\/w:fldSimple>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<\/w:p>/g;
  const paragraphs: string[] = [];
  let current = "";
  let pageNumber = false;
  const stack: { instr: string; result: boolean; page: boolean }[] = [];
  const flush = () => {
    const line = current.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
    if (line) paragraphs.push(line);
    current = "";
  };
  const skipping = () => stack[stack.length - 1]?.page === true;
  for (const match of xml.matchAll(token)) {
    if (match[1] === "begin") {
      stack.push({ instr: "", result: false, page: false });
    } else if (match[1] === "separate") {
      const top = stack[stack.length - 1];
      if (top) top.result = true;
    } else if (match[1] === "end") {
      const top = stack.pop();
      if (top && pageInstr.test(top.instr)) pageNumber = true;
    } else if (match[2] !== undefined) {
      const top = stack[stack.length - 1];
      if (top && !top.result) {
        top.instr += match[2];
        if (pageInstr.test(top.instr)) {
          top.page = true;
          pageNumber = true;
        }
      }
    } else if (match[3] !== undefined) {
      if (pageInstr.test(match[3])) pageNumber = true;
      else current += headerPartText(match[4] ?? "").text;
    } else if (match[5] !== undefined) {
      if (!skipping()) current += decodeXml(match[5]);
    } else if (match[0].startsWith("<w:tab") && !skipping()) {
      current += "\t";
    } else if (match[0].startsWith("<w:br") && !skipping()) {
      current += "\n";
    } else if (match[0] === "</w:p>") {
      flush();
    }
  }
  flush();
  let text = paragraphs.join("\n").slice(0, 500);
  if (pageNumber) {
    // "Minutes  / " is the title plus the separator between PAGE and NUMPAGES.
    text = text
      .replace(/^(?:\s*\/\s*)+/g, "")
      .replace(/(?:\s*\/\s*)+$/g, "")
      .trim();
    if (/^\d+$/.test(text.replace(/\s+/g, ""))) text = "";
  }
  return { text, pageNumber };
}

function readableXml(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return false;
  try {
    new XMLParser({ ignoreAttributes: true }).parse(xml);
    return true;
  } catch {
    return false;
  }
}

function resolveWordTarget(target: string) {
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  const stack: string[] = [];
  for (const part of ["word", ...target.split("/")]) {
    if (part === "..") stack.pop();
    else if (part && part !== ".") stack.push(part);
  }
  return stack.join("/");
}

function partRels(xml: string) {
  const map = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /(?:^|\s)Id="([^"]+)"/.exec(match[1])?.[1];
    const target = /(?:^|\s)Target="([^"]+)"/.exec(match[1])?.[1];
    const mode = /(?:^|\s)TargetMode="([^"]+)"/.exec(match[1])?.[1];
    if (!id || !target || mode === "External") continue;
    map.set(id, resolveWordTarget(target));
  }
  return map;
}

function sectionXml(documentXml: string) {
  const sects = [
    ...documentXml.matchAll(/<w:sectPr\b[^>]*>([\s\S]*?)<\/w:sectPr>/g),
  ];
  if (!sects.length) return "";
  const last = sects[sects.length - 1][1];
  if (/<w:(?:header|footer)Reference\b/.test(last)) return last;
  return sects.map((sect) => sect[1]).join("\n");
}

function explicitFlag(xml: string, tag: string): boolean | null {
  const match = new RegExp(`<w:${tag}\\b([^>]*)\\/?>`).exec(xml);
  if (!match) return null;
  return /w:val="(?:false|0|off)"/.test(match[1]) ? false : true;
}

function references(
  sect: string,
  rels: Map<string, string>,
  paths: string[],
): PartRef[] {
  const refs: PartRef[] = [];
  for (const match of sect.matchAll(
    /<w:(headerReference|footerReference)\b([^>]*)\/?>/g,
  )) {
    const kind: Kind = match[1] === "headerReference" ? "header" : "footer";
    const variant = (/w:type="(first|even|default)"/.exec(match[2])?.[1] ??
      "default") as Variant;
    const id = /r:id="([^"]+)"/.exec(match[2])?.[1];
    const path = id ? rels.get(id) : undefined;
    if (path) refs.push({ kind, variant, path });
  }
  if (refs.length) return refs;
  const header = paths.filter((p) => /\/header\d*\.xml$/i.test(p)).sort()[0];
  const footer = paths.filter((p) => /\/footer\d*\.xml$/i.test(p)).sort()[0];
  if (header) refs.push({ kind: "header", variant: "default", path: header });
  if (footer) refs.push({ kind: "footer", variant: "default", path: footer });
  return refs;
}

function detectImageMime(buf: Uint8Array): string | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "image/jpeg";
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38
  )
    return "image/gif";
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "image/webp";
  return null;
}

function uint8ToBase64(u8: Uint8Array) {
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
  let binary = "";
  for (let i = 0; i < u8.byteLength; i += 8192)
    binary += String.fromCharCode(...u8.subarray(i, i + 8192));
  return btoa(binary);
}

async function imagesIn(zip: JSZip, path: string, xml: string, kind: Kind) {
  const nodes: JsonNode[] = [];
  const relsPath = path.replace(/^(.*\/)([^/]+)$/, "$1_rels/$2.rels");
  const relsFile = zip.file(relsPath);
  if (!relsFile) return nodes;
  const relsXml = await relsFile.async("string");
  const rels = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /Id="([^"]+)"/.exec(match[1])?.[1];
    const target = /Target="([^"]+)"/.exec(match[1])?.[1];
    if (id && target) rels.set(id, target);
  }
  const cleaned = xml.replace(
    /<(?:ve|mc):AlternateContent>[\s\S]*?<(?:ve|mc):Fallback>([\s\S]*?)<\/(?:ve|mc):Fallback>[\s\S]*?<\/(?:ve|mc):AlternateContent>/g,
    "$1",
  );
  for (const match of cleaned.matchAll(
    /<(?:a:blip|v:imagedata)\b[^>]*(?:r:embed|r:id)="([^"]+)"/g,
  )) {
    const target = rels.get(match[1]);
    if (!target) continue;
    const base = path.split("/").slice(0, -1).join("/");
    const zPath = target.startsWith("/")
      ? target.slice(1)
      : `${base}/${target}`;
    const imgFile = zip.file(zPath);
    if (!imgFile) continue;
    const bytes = await imgFile.async("uint8array");
    const mime = detectImageMime(bytes);
    if (!mime) continue;
    nodes.push({
      type: "image",
      attrs: {
        src: `data:${mime};base64,${uint8ToBase64(bytes)}`,
        alt: kind === "header" ? "Header image" : "Footer image",
      },
    });
  }
  return nodes;
}

function furnitureSettings(
  text: Record<Kind, Record<Variant, string>>,
  sect: string,
  settingsXml: string,
  refs: PartRef[],
  pageNumber: boolean,
): Partial<PageSettings> {
  const title = explicitFlag(sect, "titlePg");
  const oddEven = explicitFlag(settingsXml, "evenAndOddHeaders");
  const differentFirst =
    title === true ||
    (title !== false && refs.some((ref) => ref.variant === "first"));
  const differentOdd =
    oddEven === true ||
    (oddEven !== false && refs.some((ref) => ref.variant === "even"));
  const settings: Partial<PageSettings> = {
    header: text.header.default,
    footer: text.footer.default,
  };
  if (pageNumber) settings.pageNumbers = true;
  if (differentFirst) {
    settings.differentFirstPage = true;
    settings.firstHeader = text.header.first;
    settings.firstFooter = text.footer.first;
  }
  if (differentOdd) {
    settings.differentOddEven = true;
    settings.evenHeader = text.header.even;
    settings.evenFooter = text.footer.even;
    settings.oddHeader = text.header.default;
    settings.oddFooter = text.footer.default;
  }
  return settings;
}

/**
 * Map Word's first, even, and default headers and footers onto page settings.
 * Text stays in those fields. It is not concatenated into one header or copied
 * into the document body. A part that is only a page number turns page numbers on.
 */
export async function importWordPageFurniture(
  zip: JSZip,
  documentXml: string,
): Promise<WordPageFurniture | null> {
  const paths = Object.keys(zip.files).filter((p) =>
    /word\/(header\d*|footer\d*)\.xml$/i.test(p),
  );
  if (!paths.length && !/<w:(?:header|footer)Reference\b/.test(documentXml))
    return null;
  const relsXml =
    (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "";
  const settingsXml = (await zip.file("word/settings.xml")?.async("string")) ?? "";
  const sect = sectionXml(documentXml);
  const refs = references(sect, partRels(relsXml), paths);
  const warnings: string[] = [];
  const blocks: JsonNode[] = [];
  let supplementary = 0;
  const text: Record<Kind, Record<Variant, string>> = {
    header: { default: "", first: "", even: "" },
    footer: { default: "", first: "", even: "" },
  };
  let pageNumber = false;
  const seen = new Set<string>();
  const take = async (ref: PartRef, assignText: boolean) => {
    if (seen.has(ref.path)) return;
    seen.add(ref.path);
    const file = zip.file(ref.path);
    if (!file) {
      warnings.push(`An unreadable header/footer (${ref.path}) was omitted.`);
      return;
    }
    const xml = await file.async("string");
    if (!xml.trim()) return;
    if (!readableXml(xml)) {
      warnings.push(`An unreadable header/footer (${ref.path}) was omitted.`);
      return;
    }
    const part = headerPartText(xml);
    if (assignText) text[ref.kind][ref.variant] = part.text;
    if (part.pageNumber) pageNumber = true;
    const images = await imagesIn(zip, ref.path, xml, ref.kind);
    if (!images.length) return;
    blocks.push(
      {
        type: "heading",
        attrs: { level: 2 },
        content: [
          {
            type: "text",
            text: ref.kind === "header" ? "Imported header" : "Imported footer",
          },
        ],
      },
      ...images,
    );
    supplementary += 1 + images.length;
  };
  for (const ref of refs) await take(ref, true);
  for (const path of paths) {
    if (seen.has(path)) continue;
    // Extra parts keep their images. Their text is not folded into the default header.
    await take(
      {
        kind: /header/i.test(path) ? "header" : "footer",
        variant: "default",
        path,
      },
      false,
    );
  }
  return {
    settings: furnitureSettings(text, sect, settingsXml, refs, pageNumber),
    blocks,
    warnings,
    supplementary,
  };
}

function nodeText(node: JsonNode): string {
  return (node.text ?? "") + (node.content ?? []).map(nodeText).join("");
}

/** Put a page break before the first paragraph of each Word page after the first. */
export function insertWordPageBreaks(content: JsonNode, documentXml: string) {
  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(documentXml)?.[1];
  if (!body || !/<w:br\b[^>]*w:type="page"|<w:lastRenderedPageBreak\b/.test(body))
    return;
  const chunks = body.split(
    /<w:br\b[^>]*w:type="page"[^>]*\/?>|<w:lastRenderedPageBreak\b[^>]*\/?>/,
  );
  const anchors = chunks
    .slice(1)
    .map((chunk) => headerPartText(chunk).text.split("\n")[0]?.trim() ?? "")
    .filter(Boolean);
  const blocks = content.content;
  if (!blocks || !anchors.length) return;
  const norm = (value: string) => value.replace(/[\s\u200b\ufeff]+/gu, "");
  let from = 0;
  for (const anchor of anchors) {
    const want = norm(anchor);
    const index = blocks.findIndex((node, i) => {
      if (i < from || node.type === "pageBreak") return false;
      const text = norm(nodeText(node));
      return text === want || (want.length >= 4 && text.startsWith(want));
    });
    if (index < 0) continue;
    if (blocks[index - 1]?.type === "pageBreak") {
      from = index + 1;
      continue;
    }
    blocks.splice(index, 0, { type: "pageBreak" });
    from = index + 2;
  }
}
