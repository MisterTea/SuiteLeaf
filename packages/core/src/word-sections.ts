/**
 * Word sections. Each section but the last ends with section properties in
 * its last paragraph; the body's own properties belong to the last section.
 * A section that names no header or footer of a kind keeps the previous
 * section's, as Word does.
 */
import type JSZip from "jszip";
import type { JsonNode } from "./index";
import { headerPartText } from "./word-headers";

const SECT = /<w:sectPr\b[^>]*>([\s\S]*?)<\/w:sectPr>|<w:sectPr\b[^>]*\/>/g;
/** A paragraph whose properties end a section. */
const SECTION_END = /<w:p\b(?:(?!<\/w:p>)[\s\S])*?<w:sectPr\b(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g;

/** Each section's properties, in document order. */
export function wordSectionProperties(documentXml: string): string[] {
  return [...documentXml.matchAll(SECT)].map((m) => m[1] ?? "");
}

/** The section on the first page. Its header and footer are the document's own. */
export function firstSectionXml(documentXml: string): string {
  return wordSectionProperties(documentXml)[0] ?? "";
}

/** `nextPage`, `oddPage`, `evenPage`, `continuous`, or `nextColumn`. Word's default is `nextPage`. */
export function sectionStart(sect: string): string {
  return /<w:type\b[^>]*w:val="([^"]+)"/.exec(sect)?.[1] ?? "nextPage";
}

export function sectionLandscape(sect: string): boolean {
  return /<w:pgSz\b[^>]*w:orient="landscape"/.test(sect);
}

export function sectionRestart(sect: string): number | null {
  const start = /<w:pgNumType\b[^>]*w:start="(\d+)"/.exec(sect)?.[1];
  return start === undefined ? null : Number(start);
}

function defaultReference(sect: string, kind: "header" | "footer"): string | undefined {
  for (const match of sect.matchAll(new RegExp(`<w:${kind}Reference\\b([^>]*)\\/?>`, "g"))) {
    const type = /w:type="([^"]+)"/.exec(match[1]!)?.[1] ?? "default";
    if (type === "default") return /r:id="([^"]+)"/.exec(match[1]!)?.[1];
  }
  return undefined;
}

function relationTargets(relsXml: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /(?:^|\s)Id="([^"]+)"/.exec(match[1]!)?.[1];
    const target = /(?:^|\s)Target="([^"]+)"/.exec(match[1]!)?.[1];
    if (id && target) map.set(id, target.replace(/^\/?(word\/)?/, "word/"));
  }
  return map;
}

/** The first line of text in each section after the first, where its section break goes. */
export function sectionAnchors(documentXml: string): string[] {
  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(documentXml)?.[1] ?? "";
  // The text after each section's last paragraph. A one-paragraph section is the next anchor's own text.
  return [...body.matchAll(SECTION_END)].map((end) => {
    const after = body.slice(end.index + end[0].length);
    return headerPartText(after.replace(SECT, "")).text.split("\n")[0]?.trim() ?? "";
  });
}

const flat = (value: string) => value.replace(/[\s​﻿]+/gu, "");
const textOf = (node: JsonNode): string => (node.text ?? "") + (node.content ?? []).map(textOf).join("");

/**
 * Put a section break where each Word section after the first starts, unless
 * it continues on the same page. The break carries that section's header and
 * footer text and its page-number restart. A section break SuiteLeaf cannot
 * place, or a page orientation it cannot store per section, is reported.
 */
export async function insertWordSectionBreaks(content: JsonNode, documentXml: string, zip: JSZip): Promise<string[]> {
  const sects = wordSectionProperties(documentXml);
  if (sects.length < 2 || !content.content) return [];
  const rels = relationTargets((await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "");
  const read = async (id: string | undefined) => {
    const path = id ? rels.get(id) : undefined;
    const xml = path ? await zip.file(path)?.async("string") : undefined;
    return xml === undefined ? undefined : headerPartText(xml).text;
  };
  const anchors = sectionAnchors(documentXml);
  const warnings: string[] = [];
  let header = (await read(defaultReference(sects[0]!, "header"))) ?? "";
  let footer = (await read(defaultReference(sects[0]!, "footer"))) ?? "";
  const landscape = sectionLandscape(sects[0]!);
  let from = 0;
  let unplaced = 0;
  let oriented = 0;
  for (let index = 1; index < sects.length; index += 1) {
    const sect = sects[index]!;
    header = (await read(defaultReference(sect, "header"))) ?? header;
    footer = (await read(defaultReference(sect, "footer"))) ?? footer;
    if (sectionLandscape(sect) !== landscape) oriented += 1;
    if (sectionStart(sect) === "continuous" || sectionStart(sect) === "nextColumn") continue;
    const want = flat(anchors[index - 1] ?? "");
    const blocks = content.content;
    const at = want
      ? blocks.findIndex((node, i) => {
          if (i < from) return false;
          const text = flat(textOf(node));
          return text === want || (want.length >= 4 && text.startsWith(want));
        })
      : -1;
    if (at < 0) {
      unplaced += 1;
      continue;
    }
    const restartAt = sectionRestart(sect);
    const attrs: Record<string, unknown> = { header, footer };
    if (restartAt !== null) attrs.restartAt = restartAt;
    // A page break already standing there is the section's own new page.
    const replace = blocks[at - 1]?.type === "pageBreak" ? 1 : 0;
    blocks.splice(at - replace, replace, { type: "sectionBreak", attrs });
    from = at - replace + 1;
  }
  if (unplaced) warnings.push(`${unplaced} Word section break${unplaced === 1 ? " was" : "s were"} not placed, so ${unplaced === 1 ? "its" : "their"} header and footer were not kept.`);
  if (oriented) warnings.push(`${oriented} Word section${oriented === 1 ? " uses" : "s use"} a different page orientation. SuiteLeaf uses one orientation for the whole document.`);
  return warnings;
}
