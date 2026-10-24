import JSZip from "jszip";
import { implicitIntersectConcatenatedWholeColumns } from "./excel";
import { emptyDigest, norm, type OfficeDigest } from "./roundtrip-digest";
import { rewriteWordCitations } from "./citations";
import { rewriteWordNotes } from "./doc-notes";
import { wordParagraphs } from "./word";

function withoutFieldTokens(text: string): string {
  return text.replace(/SLFN\d+END|SLEN\d+END|SLTOC\d[PL]|SLBIB|SLCITE[A-Za-z0-9]+/g, "");
}

/** Excel addresses run from A1 through XFD1048576. `B` is not a cell. */
function spreadsheetCell(ref: string | undefined): boolean {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec((ref ?? "").toUpperCase());
  if (!match) return false;
  const row = Number(match[2]);
  if (row > 1048576) return false;
  let column = 0;
  for (const ch of match[1]) column = column * 26 + (ch.charCodeAt(0) - 64);
  return column >= 1 && column <= 16384;
}

/** Excel writes some characters as `_x000D_` inside cell text. */
function excelText(value: string): string {
  return norm(
    value.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    ),
  );
}

function xmlCodePoint(code: number, entity: string): string {
  if (
    !Number.isInteger(code) ||
    code < 0 ||
    code > 0x10ffff ||
    (code >= 0xd800 && code <= 0xdfff)
  )
    return entity;
  return String.fromCodePoint(code);
}

/** Named entities are decoded after numeric ones, so `&amp;#xA;` stays the letters `&#xA;`. */
function decode(value: string): string {
  return value
    .replace(/&#x([0-9A-Fa-f]+);/gi, (entity, hex) =>
      xmlCodePoint(Number.parseInt(hex, 16), entity),
    )
    .replace(/&#(\d+);/g, (entity, digits) =>
      xmlCodePoint(Number(digits), entity),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function visibleWordXml(xml: string): string {
  const stripped = removePaired(removePaired(xml, "m:oMath"), "w:txbxContent");
  const withoutDeletedText = withoutDeletedRows(stripped).replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, "");
  return withoutHiddenRuns(mergeBrokenParagraphMarks(withoutDeletedText).replace(/<w:del\b[^>]*\/>/g, ""));
}

/** A row whose row mark was deleted is not part of the accepted table. */
function withoutDeletedRows(xml: string): string {
  let out = "";
  let cursor = 0;
  const openRe = /<w:tr(?:\s[^>]*[^/])?>/g;
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(xml))) {
    const start = match.index ?? 0;
    if (start < cursor) continue;
    let depth = 1;
    let i = openRe.lastIndex;
    while (depth > 0 && i < xml.length) {
      const nextOpenRel = xml.slice(i).search(/<w:tr(?:\s[^>]*[^/])?>/);
      const nextClose = xml.indexOf("</w:tr>", i);
      if (nextClose < 0) {
        i = xml.length;
        break;
      }
      const openAt = nextOpenRel < 0 ? Number.POSITIVE_INFINITY : i + nextOpenRel;
      if (openAt < nextClose) {
        depth += 1;
        i = openAt + 5;
      } else {
        depth -= 1;
        i = nextClose + "</w:tr>".length;
      }
    }
    const row = xml.slice(start, i);
    const nestedAt = row.slice(match[0].length).search(/<w:tr\b/);
    const head = nestedAt < 0 ? row : row.slice(0, match[0].length + nestedAt);
    const props = /<w:trPr\b[^>]*>[\s\S]*?<\/w:trPr>/.exec(head)?.[0] ?? "";
    if (/<w:del\b/.test(props)) {
      out += xml.slice(cursor, start);
      cursor = i;
    }
    openRe.lastIndex = i;
  }
  return out + xml.slice(cursor);
}

/** A deleted or hidden paragraph mark joins that paragraph with the next one. */
function paragraphMarkGone(paragraph: string): boolean {
  const props = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/.exec(paragraph)?.[0] ?? "";
  if (/<w:del\b/.test(props)) return true;
  const hidden = /<w:vanish\b([^>]*)(?:\/>|>)/.exec(props);
  if (!hidden) return false;
  const val = /w:val="([^"]*)"/.exec(hidden[1])?.[1];
  return val !== "0" && val !== "false" && val !== "off";
}

function mergeBrokenParagraphMarks(xml: string): string {
  const matches = [...xml.matchAll(/<w:p\b(?:[^>]*?[^/])>[\s\S]*?<\/w:p>/g)];
  if (matches.length < 2) return xml;
  let out = "";
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const first = matches[i];
    if (first.index === undefined) continue;
    out += xml.slice(cursor, first.index);
    const parts = [first[0]];
    let end = first.index + first[0].length;
    while (paragraphMarkGone(parts[parts.length - 1]) && i + 1 < matches.length) {
      const next = matches[i + 1];
      if (next.index === undefined || next.index < end) break;
      i += 1;
      parts.push(next[0]);
      end = next.index + next[0].length;
    }
    out += parts.length === 1 ? parts[0] : joinParagraphs(parts);
    cursor = end;
  }
  return out + xml.slice(cursor);
}

function joinParagraphs(parts: string[]): string {
  const last = parts[parts.length - 1];
  const open = /^<w:p\b[^>]*>/.exec(last)?.[0] ?? "<w:p>";
  const props = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/.exec(last)?.[0] ?? "";
  const bodies = parts.map((part) =>
    part
      .replace(/^<w:p\b[^>]*>/, "")
      .replace(/<\/w:p>$/, "")
      .replace(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/, ""),
  );
  return `${open}${props}${bodies.join("")}</w:p>`;
}

function withoutHiddenRuns(xml: string): string {
  return xml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => {
    const hidden = /<w:vanish\b([^>]*)(?:\/>|>[\s\S]*?<\/w:vanish>)/.exec(run);
    if (!hidden) return run;
    const val = /w:val="([^"]*)"/.exec(hidden[1])?.[1];
    if (val === "0" || val === "false" || val === "off") return run;
    return "";
  });
}

/** Self-closing paragraph-mark deletions must not swallow the following text. */
function removePaired(xml: string, tag: string): string {
  const next = xml.replace(new RegExp(`<${tag}\\b[^>]*/>`, "g"), "");
  return next.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "g"), "");
}

/** A self-closing tag such as `<a:t/>` is empty and must not consume the next element. */
function rawText(xml: string, tag: string): string[] {
  const out: string[] = [];
  const pattern = new RegExp(`<${tag}\\b([^>]*)>`, "g");
  for (const match of xml.matchAll(pattern)) {
    if (match[1].endsWith("/")) continue;
    const start = (match.index ?? 0) + match[0].length;
    const close = xml.indexOf(`</${tag}>`, start);
    if (close < 0) continue;
    out.push(xml.slice(start, close));
  }
  return out;
}

function drawingText(xml: string): string {
  const parts: string[] = [];
  for (const paragraph of xml.split(/<a:p[\s>]/).slice(1)) {
    const body = paragraph.split(/<\/a:p>/)[0] ?? paragraph;
    const text = norm(rawText(body, "a:t").map(decode).join(""));
    if (text) parts.push(text);
  }
  return norm(parts.join("\n"));
}

/** Join every rich-text run, including a one-character run, then normalize once. */
function excelRuns(xml: string): string {
  return excelText(
    rawText(xml, "t")
      .map((value) => decode(value.replace(/<[^>]+>/g, "")))
      .join(""),
  );
}

function tagged(xml: string, tag: string): string[] {
  const out: string[] = [];
  for (const value of rawText(xml, tag)) {
    const text = norm(decode(value.replace(/<[^>]+>/g, "")));
    if (text.length >= 2) out.push(text);
  }
  return out;
}

function limits(xml: string, reader: OfficeDigest) {
  if (/<m:oMath\b/.test(xml)) reader.limits.push("doc.equation");
  if (/<w:del\b/.test(xml) || /<w:ins\b/.test(xml)) reader.limits.push("doc.tracked-changes");
  if (/<w:txbxContent\b/.test(xml) || /<wps:wsp\b/.test(xml)) reader.limits.push("doc.textbox");
  if (/vbaProject\.bin/.test(xml)) reader.limits.push("macros");
  if (/<p:transition\b/.test(xml)) reader.limits.push("slide.transition");
  if (/<p:timing\b/.test(xml)) reader.limits.push("slide.animation");
}

async function scanDocx(zip: JSZip): Promise<OfficeDigest> {
  const reader = emptyDigest();
  const part = zip.file("word/document.xml");
  if (!part) return reader;
  const raw = await part.async("string");
  limits(raw, reader);
  const xml = visibleWordXml(raw);
  const cited = rewriteWordCitations(xml);
  const notes = rewriteWordNotes(cited.xml);
  const removedLines = new Map<string, number>();
  for (const paragraph of [...cited.removedParagraphs, ...notes.removedParagraphs]) {
    const text = norm(paragraph);
    if (text.length >= 2) removedLines.set(text, (removedLines.get(text) ?? 0) + 1);
  }
  for (const paragraph of wordParagraphs(splitFloatingAnchors(notes.xml), false)) {
    const text = norm(withoutFieldTokens(paragraph));
    // A soft hyphen is a line-break hint. A paragraph made only of those hints has no text.
    if (text.length >= 2 && text.replaceAll("\u00AD", "").length >= 2) reader.texts.push(text);
  }
  const fieldSpans = cachedFieldSpans(xml);
  const movedAway = elementSpans(xml, "w:moveFrom");
  for (const paragraph of xml.matchAll(/<w:p\b(?:[^>]*?[^/])>[\s\S]*?<\/w:p>/g)) {
    const at = paragraph.index ?? 0;
    if (fieldSpans.some(([start, end]) => at >= start && at < end)) continue;
    const body = paragraph[0];
    const paragraphText = norm(
      rawText(body.replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, ""), "w:t")
        .map((value) => decode(value.replace(/<[^>]+>/g, "")))
        .join(""),
    );
    const skipped = removedLines.get(paragraphText) ?? 0;
    if (skipped > 0) {
      removedLines.set(paragraphText, skipped - 1);
      continue;
    }
    for (const runMatch of body.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)) {
      const runAt = at + (runMatch.index ?? 0);
      if (fieldSpans.some(([start, end]) => runAt >= start && runAt < end)) continue;
      if (movedAway.some(([start, end]) => runAt >= start && runAt < end)) continue;
      const run = runMatch[0].replace(/<w:rPrChange\b[\s\S]*?<\/w:rPrChange>/g, "");
      const runText = norm(
        tagged(run.replace(/<w:(?:tab|br|cr)\b[^>]*\/>/g, " "), "w:t").join(" "),
      );
      if (runText.length < 2) continue;
      if (/<w:b\b/.test(run) && !/<w:b\b[^>]*w:val="(?:0|false|off)"/.test(run))
        reader.bold.push(runText);
      if (/<w:i\b/.test(run) && !/<w:i\b[^>]*w:val="(?:0|false|off)"/.test(run))
        reader.italic.push(runText);
      if (/<w:u\b/.test(run) && !/<w:u\b[^>]*w:val="none"/.test(run))
        reader.underline.push(runText);
    }
  }
  const coverPage =
    /<w:docPartGallery\b[^>]*w:val="Cover Pages"/.test(raw) ||
    (/<w:alias\b[^>]*w:val="Title"/.test(raw) &&
      (/<w:alias\b[^>]*w:val="Subtitle"/.test(raw) ||
        /<w:alias\b[^>]*w:val="Author"/.test(raw)));
  const depth = tableDepth(xml);
  if (depth > 100) reader.limits.push("doc.nesting");
  reader.tables = depth > 100 || coverPage ? 0 : countedTables(xml);
  reader.images = await bodyImages(zip, raw);
  return reader;
}

function tableDepth(xml: string): number {
  let depth = 0;
  let max = 0;
  for (const match of xml.matchAll(/<(\/?)w:tbl\b/g)) {
    if (match[1]) depth = Math.max(0, depth - 1);
    else max = Math.max(max, ++depth);
  }
  return max;
}

/** Words on either side of a floating picture are separate runs, not one word. */
function splitFloatingAnchors(xml: string): string {
  if (!/<wp:anchor\b/.test(xml)) return xml;
  return xml.replace(/<w:p\b(?:[^>]*?[^/])>[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (!/<wp:anchor\b/.test(paragraph)) return paragraph;
    const open = /^<w:p\b[^>]*>/.exec(paragraph)?.[0] ?? "<w:p>";
    const props = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/.exec(paragraph)?.[0] ?? "";
    const body = paragraph
      .slice(open.length, paragraph.length - "</w:p>".length)
      .replace(props, "");
    const groups: string[] = [];
    let current = "";
    let last = 0;
    for (const match of body.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)) {
      const at = match.index ?? 0;
      current += body.slice(last, at);
      // A floating text box stays between the words. Only a floating picture splits them.
      if (/<wp:anchor\b/.test(match[0]) && /<(?:pic:pic|v:imagedata)\b/.test(match[0])) {
        groups.push(current);
        current = "";
      } else current += match[0];
      last = at + match[0].length;
    }
    groups.push(current + body.slice(last));
    return groups.map((group) => `${open}${props}${group}</w:p>`).join("");
  });
}

function closingField(xml: string, beginAt: number): number {
  const re = /w:fldCharType="(begin|end)"/g;
  let depth = 0;
  for (const match of xml.matchAll(re)) {
    if ((match.index ?? 0) < beginAt) continue;
    depth += match[1] === "begin" ? 1 : -1;
    if (depth === 0) return match.index ?? -1;
  }
  return -1;
}

function elementSpans(xml: string, tag: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const starts: number[] = [];
  for (const match of xml.matchAll(new RegExp(`<(/?)${tag}\\b[^>]*>`, "g"))) {
    const at = match.index ?? 0;
    if (match[1]) {
      const start = starts.pop();
      if (start !== undefined && starts.length === 0) spans.push([start, at + match[0].length]);
    } else starts.push(at);
  }
  return spans;
}

/** The paragraph an importer replaces when it turns a cached contents field into a token. */
function cachedFieldParagraphSpans(xml: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const match of xml.matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g)) {
    const instruction = decode(match[1].replace(/<[^>]+>/g, ""));
    if (!/\b(?:TOC|BIBLIOGRAPHY)\b/.test(instruction)) continue;
    const at = match.index ?? 0;
    const windowStart = Math.max(0, at - 20000);
    const beginRel = xml.slice(windowStart, at).lastIndexOf('w:fldCharType="begin"');
    if (beginRel < 0) continue;
    const beginAt = windowStart + beginRel;
    const endAt = closingField(xml, beginAt);
    if (endAt < beginAt) continue;
    const opens = [...xml.slice(0, beginAt).matchAll(/<w:p(?=[\s>])/g)];
    const paraStart = opens.length ? (opens[opens.length - 1].index ?? -1) : -1;
    const endPara = xml.indexOf("</w:p>", endAt);
    if (paraStart < 0 || endPara < 0) continue;
    spans.push([paraStart, endPara + "</w:p>".length]);
  }
  return spans;
}

function cachedFieldSpans(xml: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const match of xml.matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g)) {
    const instruction = decode(match[1].replace(/<[^>]+>/g, ""));
    if (!/\b(?:TOC|BIBLIOGRAPHY)\b/.test(instruction)) continue;
    const at = match.index ?? 0;
    const windowStart = Math.max(0, at - 20000);
    const beginRel = xml.slice(windowStart, at).lastIndexOf('w:fldCharType="begin"');
    if (beginRel < 0) continue;
    const beginAt = windowStart + beginRel;
    const endAt = closingField(xml, beginAt);
    if (endAt > beginAt) spans.push([beginAt, endAt]);
  }
  return spans;
}

function tableContainsCell(xml: string, start: number): boolean {
  let depth = 0;
  for (const match of xml.matchAll(/<(\/?)w:tbl\b|<w:tc\b/g)) {
    if ((match.index ?? 0) < start) continue;
    if (match[1] === "/") {
      depth -= 1;
      if (depth === 0) return false;
    } else if (match[0].startsWith("<w:tbl")) depth += 1;
    else return true;
  }
  return false;
}

/** A table cached inside a table-of-contents or bibliography field is not a body table. */
function countedTables(xml: string): number {
  const spans = cachedFieldSpans(xml);
  let count = 0;
  for (const match of xml.matchAll(/<w:tbl\b/g)) {
    const at = match.index ?? 0;
    if (spans.some(([start, end]) => at >= start && at < end)) continue;
    if (!tableContainsCell(xml, at)) continue;
    count += 1;
  }
  return count;
}

async function bodyImages(zip: JSZip, xml: string): Promise<number> {
  const visible = withoutHiddenRuns(removePaired(xml, "w:txbxContent"));
  const body = visible.slice(Math.max(0, visible.search(/<w:body\b/)));
  const skipped = cachedFieldParagraphSpans(body);
  const ids = new Set<string>();
  const keep = (at: number, id: string) => {
    if (skipped.some(([start, end]) => at >= start && at < end)) return;
    ids.add(id);
  };
  let cursor = 0;
  for (const region of body.split(/<pic:pic\b/).slice(1)) {
    const marker = body.indexOf("<pic:pic", cursor);
    const pic = region.split(/<\/pic:pic>/)[0] ?? region;
    for (const match of pic.matchAll(/<a:blip\b[^>]*\br:embed="([^"]+)"/g))
      keep(marker + "<pic:pic".length + (match.index ?? 0), match[1]);
    cursor = marker + "<pic:pic".length;
  }
  for (const match of body.matchAll(/<v:imagedata\b[^>]*\br:id="([^"]+)"/g))
    keep(match.index ?? 0, match[1]);
  const rels = zip.file("word/_rels/document.xml.rels");
  if (!rels || !ids.size) return 0;
  const targets = new Map<string, string>();
  for (const tag of (await rels.async("string")).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(tag[0])?.[1];
    const target = /Target="([^"]+)"/.exec(tag[0])?.[1];
    if (id && target) targets.set(id, target);
  }
  let count = 0;
  for (const id of ids) {
    const target = targets.get(id) ?? "";
    if (!/\.(png|jpe?g|gif)$/i.test(target)) continue;
    const path = decodeURIComponent(target).replace(/^\//, "").replace(/^\.\//, "");
    if (!zip.file(path.startsWith("word/") ? path : `word/${path}`)) continue;
    count += 1;
  }
  return count;
}

async function scanXlsx(zip: JSZip): Promise<OfficeDigest> {
  const reader = emptyDigest();
  const shared: string[] = [];
  const strings = zip.file("xl/sharedStrings.xml");
  if (strings) {
    for (const item of (await strings.async("string")).split(/<si\b/).slice(1))
      shared.push(excelRuns(item));
  }
  const sheets = Object.keys(zip.files).filter((name) =>
    /^xl\/worksheets\/sheet\d+\.xml$/i.test(name),
  );
  for (const name of sheets) {
    const xml = await zip.file(name)!.async("string");
    for (const cell of xml.split(/<c\b/).slice(1)) {
      const head = cell.slice(0, cell.indexOf(">"));
      if (!spreadsheetCell(/r="([^"]*)"/.exec(head)?.[1])) continue;
      const kind = /t="([^"]+)"/.exec(head)?.[1];
      const formula = /<f\b([^>]*)>([\s\S]*?)<\/f>/.exec(cell);
      if (formula) {
        // SheetJS removes the Excel future-function marker before the formula is stored.
        let text = decode(formula[2]).replace(/^=/, "").replaceAll("_xlfn.", "");
        if (/t="shared"/.test(formula[1])) {
          const row = Number(/r="[A-Z]+(\d+)"/.exec(head)?.[1] ?? "1") - 1;
          text = implicitIntersectConcatenatedWholeColumns(text, row);
        }
        reader.formulas.push(norm(text));
      }
      let text = "";
      if (kind === "s") {
        const index = Number(/<v>(\d+)<\/v>/.exec(cell)?.[1]);
        text = shared[index] ?? "";
      } else if (kind === "inlineStr") text = excelRuns(cell);
      else if (kind === "str") {
        const value = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1];
        if (value) text = excelText(decode(value));
      }
      if (text.length >= 2) reader.texts.push(text);
    }
  }
  reader.images = await sheetImages(zip);
  return reader;
}

/** A zero-width drawing is not a picture the importer can place. */
function visiblePictures(xml: string): string {
  const parts: string[] = [];
  for (const anchor of xml.split(/<xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)\b/).slice(1)) {
    const body = anchor.split(/<\/xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)>/)[0] ?? anchor;
    if (!body.includes("<xdr:pic")) continue;
    const xfrm = /<a:xfrm\b[\s\S]*?<\/a:xfrm>/.exec(body)?.[0] ?? "";
    const attrs = /<a:ext\b([^>]*)\/?>/.exec(xfrm)?.[1] ?? /<xdr:ext\b([^>]*)\/?>/.exec(body)?.[1] ?? "";
    const cx = Number(/cx="(-?\d+(?:\.\d+)?)"/.exec(attrs)?.[1]);
    const cy = Number(/cy="(-?\d+(?:\.\d+)?)"/.exec(attrs)?.[1]);
    if (cx > 0 && cy > 0) parts.push(body);
  }
  return parts.join("\n");
}

/** Placed pictures only. A worksheet `<picture>` is the sheet background. */
async function sheetImages(zip: JSZip): Promise<number> {
  let count = 0;
  const parts = Object.keys(zip.files).filter((name) =>
    /^xl\/drawings\/(?:drawing\d+\.xml|vmlDrawing\d+\.vml)$/i.test(name),
  );
  for (const name of parts) {
    const xml = await zip.file(name)!.async("string");
    const rels =
      (await zip.file(name.replace(/^xl\/drawings\//, "xl/drawings/_rels/") + ".rels")?.async("string")) ??
      "";
    const targets = new Map<string, string>();
    for (const tag of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(tag[0])?.[1];
      const target = /Target="([^"]+)"/.exec(tag[0])?.[1] ?? "";
      if (id) targets.set(id, target);
    }
    const marks = name.endsWith(".vml")
      ? [...xml.matchAll(/<v:imagedata\b([^>]*)\/?>/g)]
      : [...visiblePictures(xml).matchAll(/<a:blip\b([^>]*)\/?>/g)];
    for (const mark of marks) {
      const id =
        /r:embed="([^"]+)"/.exec(mark[1])?.[1] ??
        /r:link="([^"]+)"/.exec(mark[1])?.[1] ??
        /r:id="([^"]+)"/.exec(mark[1])?.[1] ??
        /o:relid="([^"]+)"/.exec(mark[1])?.[1];
      const target = decode(id ? (targets.get(id) ?? "") : "");
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      if (!/\.(png|jpe?g|gif)$/i.test(target.split("?")[0] ?? target)) continue;
      if (zip.file(zipPath(name, target))) count += 1;
    }
  }
  return count;
}

async function scanPptx(zip: JSZip): Promise<OfficeDigest> {
  const reader = emptyDigest();
  const slides = Object.keys(zip.files).filter((name) =>
    /^ppt\/slides\/slide\d+\.xml$/i.test(name),
  );
  for (const name of slides) {
    const xml = await zip.file(name)!.async("string");
    limits(xml, reader);
    for (const shape of xml.split(/<p:sp\b/).slice(1)) {
      const body = shape.split(/<\/p:sp>/)[0] ?? shape;
      const text = drawingText(body);
      if (text.length >= 2) reader.texts.push(text);
    }
    for (const frame of xml.split(/<p:graphicFrame\b/).slice(1)) {
      const body = frame.split(/<\/p:graphicFrame>/)[0] ?? frame;
      for (const cell of body.split(/<a:tc\b/).slice(1)) {
        const text = drawingText(cell.split(/<\/a:tc>/)[0] ?? cell);
        if (text.length >= 2) reader.texts.push(text);
      }
    }
    reader.tables += (xml.match(/<a:tbl\b/g) ?? []).length;
  }
  const notes = Object.keys(zip.files).filter((name) =>
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name),
  );
  for (const name of notes) {
    const xml = await zip.file(name)!.async("string");
    const parts: string[] = [];
    for (const shape of xml.split(/<p:sp\b/).slice(1)) {
      const body = shape.split(/<\/p:sp>/)[0] ?? shape;
      const placeholder = /<p:ph\b[^>]*>/.exec(body)?.[0] ?? "";
      const type = /type="([^"]+)"/.exec(placeholder)?.[1];
      if (placeholder && type !== "body") continue;
      const text = drawingText(body);
      // A one-character note stays with the other notes on this slide.
      if (text) parts.push(text);
    }
    const text = norm(parts.join("\n"));
    if (text.length >= 2) reader.notes.push(text);
  }
  reader.images = await slideImages(zip);
  return reader;
}

function zipPath(base: string, relative: string): string {
  if (relative.startsWith("/")) return relative.slice(1);
  const parts = base.split("/");
  parts.pop();
  for (const segment of relative.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== "." && segment !== "") parts.push(segment);
  }
  return parts.join("/");
}

/** A section zoom stores a thumbnail and a fallback picture of the same object. */
function choiceCoveredByFallback(
  xml: string,
  index: number,
  targets: Map<string, string>,
): boolean {
  const choice = xml.lastIndexOf("<mc:Choice", index);
  if (choice === -1 || xml.lastIndexOf("</mc:Choice>", index) > choice) return false;
  const content = xml.lastIndexOf("<mc:AlternateContent", index);
  const end = xml.indexOf("</mc:AlternateContent>", index);
  if (content === -1 || end === -1 || content > choice) return false;
  const fallback = /<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/.exec(xml.slice(content, end));
  if (!fallback) return false;
  for (const blip of fallback[0].matchAll(/<a:blip\b([^>]*)\/?>/g)) {
    const id =
      /r:embed="([^"]+)"/.exec(blip[1])?.[1] ?? /r:link="([^"]+)"/.exec(blip[1])?.[1];
    const target = decode(id ? (targets.get(id) ?? "") : "");
    if (/\.(png|jpe?g|gif)$/i.test(target.split("?")[0] ?? target)) return true;
  }
  return false;
}

async function slideImages(zip: JSZip): Promise<number> {
  let count = 0;
  const slides = Object.keys(zip.files).filter((name) =>
    /^ppt\/slides\/slide\d+\.xml$/i.test(name),
  );
  for (const name of slides) {
    const xml = await zip.file(name)!.async("string");
    const rels = await zip
      .file(name.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels")
      ?.async("string");
    const targets = new Map<string, string>();
    for (const tag of (rels ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(tag[0])?.[1];
      const target = /Target="([^"]+)"/.exec(tag[0])?.[1] ?? "";
      if (id) targets.set(id, target);
    }
    // Text paint, slide backgrounds, and picture bullets are not placed pictures.
    let visible = xml;
    for (const tag of ["a:rPr", "a:defRPr", "a:endParaRPr", "p:bg", "a:buBlip"])
      visible = removePaired(visible, tag);
    for (const blip of visible.matchAll(/<a:blip\b([^>]*)\/?>/g)) {
      if (choiceCoveredByFallback(visible, blip.index ?? 0, targets)) continue;
      const id =
        /r:embed="([^"]+)"/.exec(blip[1])?.[1] ?? /r:link="([^"]+)"/.exec(blip[1])?.[1];
      const target = decode(id ? (targets.get(id) ?? "") : "");
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      if (!/\.(png|jpe?g|gif)$/i.test(target.split("?")[0] ?? target)) continue;
      if (zip.file(zipPath(name, target))) count += 1;
    }
  }
  return count;
}

/** Schema-level features in an OOXML package we already import ourselves. */
export async function scanOfficePackage(
  bytes: Uint8Array,
  format: string,
): Promise<OfficeDigest | null> {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return null;
  }
  if (zip.file("word/document.xml") && ["docx", "docm", "dotx", "dotm"].includes(format))
    return scanDocx(zip);
  if (zip.file("xl/workbook.xml") && ["xlsx", "xlsm", "xltx"].includes(format))
    return scanXlsx(zip);
  if (
    Object.keys(zip.files).some((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)) &&
    ["pptx", "pptm", "ppsx", "potx", "ppsm"].includes(format)
  )
    return scanPptx(zip);
  return null;
}
