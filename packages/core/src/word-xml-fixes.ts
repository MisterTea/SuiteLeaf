import JSZip from "jszip";

/** VML pictures Mammoth does not already import as a drawing. */
export async function vmlPictureSources(zip: JSZip, xml: string): Promise<string[]> {
  const rels = await zip.file("word/_rels/document.xml.rels")?.async("string");
  if (!rels) return [];
  const targets = new Map<string, string>();
  for (const tag of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(tag[0])?.[1];
    const target = /Target="([^"]+)"/.exec(tag[0])?.[1];
    if (id && target) targets.set(id, decodeURIComponent(target));
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const add = async (target: string | undefined) => {
    if (!target || seen.has(target)) return;
    const kind = /\.(png|jpe?g|gif|webp)$/i.exec(target)?.[1]?.toLowerCase();
    if (!kind) return;
    const path = target.replace(/^\//, "").replace(/^\.\//, "");
    const part = zip.file(path.startsWith("word/") ? path : `word/${path}`);
    if (!part) return;
    const mime = kind === "jpg" ? "jpeg" : kind;
    out.push(`data:image/${mime};base64,${await part.async("base64")}`);
    seen.add(target);
  };
  const drawing = new Set(
    [...xml.matchAll(/<a:blip\b[^>]*\br:embed="([^"]+)"/g)].map(
      (match) => targets.get(match[1]) ?? "",
    ),
  );
  for (const match of xml.matchAll(/<v:imagedata\b[^>]*\br:id="([^"]+)"/g)) {
    const target = targets.get(match[1]);
    if (target && drawing.has(target)) continue;
    await add(target);
  }
  return out;
}
/**
 * Mammoth refuses a text run that contains another paragraph and then
 * abandons the whole file. Close the run before that paragraph.
 */
export function liftBlocksOutOfWordText(xml: string): string {
  if (!/<w:t\b/.test(xml)) return xml;
  const blocks = new Set(["w:p", "w:tbl", "w:sdt"]);
  const stop = new Set(["w:body", "w:tc", "w:hdr", "w:ftr", "w:footnote", "w:endnote"]);
  const surplus = new Map<string, number>();
  const stack: string[] = [];
  let out = "";
  let i = 0;
  while (i < xml.length) {
    if (xml.startsWith("<!--", i) || xml.startsWith("<![CDATA[", i) || xml.startsWith("<?", i)) {
      const closer = xml.startsWith("<!--", i) ? "-->" : xml.startsWith("<?", i) ? "?>" : "]]>";
      const end = xml.indexOf(closer, i + 2);
      const next = end < 0 ? xml.length : end + closer.length;
      out += xml.slice(i, next);
      i = next;
      continue;
    }
    if (xml[i] !== "<") {
      const start = i;
      while (i < xml.length && xml[i] !== "<") i++;
      out += xml.slice(start, i);
      continue;
    }
    const end = xml.indexOf(">", i + 1);
    if (end < 0) {
      out += xml.slice(i);
      break;
    }
    const raw = xml.slice(i, end + 1);
    const closing = raw.startsWith("</");
    const self = /\/\s*>$/.test(raw);
    const name = /^<\/?\s*([A-Za-z0-9:]+)/.exec(raw)?.[1] ?? "";
    if (!closing && !self && blocks.has(name) && stack.includes("w:t")) {
      while (stack.length) {
        const open = stack[stack.length - 1]!;
        if (stop.has(open)) break;
        stack.pop();
        out += `</${open}>`;
        surplus.set(open, (surplus.get(open) ?? 0) + 1);
        if (open === "w:p" || open === "w:tbl" || open === "w:sdt") break;
      }
    }
    if (closing) {
      const found = name ? stack.lastIndexOf(name) : -1;
      if (found >= 0) {
        stack.splice(found);
        out += raw;
      } else if ((surplus.get(name) ?? 0) > 0) {
        surplus.set(name, (surplus.get(name) ?? 0) - 1);
      } else out += raw;
    } else {
      out += raw;
      if (!self && name) stack.push(name);
    }
    i = end + 1;
  }
  return out;
}
/** Mammoth ignores ruby, including the word and its reading. */
export function unwrapWordRuby(xml: string): string {
  if (!xml.includes("<w:ruby")) return xml;
  let next = xml.replace(/<w:rubyPr\b[^>]*\/>/g, "");
  let previous = "";
  while (next !== previous) {
    previous = next;
    next = next.replace(/<w:rubyPr\b[^>]*>[\s\S]*?<\/w:rubyPr>/g, "");
  }
  return next.replace(/<\/?w:(?:ruby|rubyBase|rt)\b[^>]*>/g, "");
}
/** Mammoth ignores a content control, including the text inside it. */
export function unwrapWordContentControls(xml: string): string {
  if (!xml.includes("<w:sdt")) return xml;
  let next = xml.replace(/<w:sdtPr\b[^>]*\/>/g, "");
  let previous = "";
  while (next !== previous) {
    previous = next;
    next = next.replace(/<w:sdtPr\b[^>]*>[\s\S]*?<\/w:sdtPr>/g, "");
  }
  return next.replace(/<\/?w:sdt(?:Content)?\b[^>]*>/g, "");
}
/**
 * A hidden paragraph mark only hides the line break. Join those paragraphs
 * and leave the words visible.
 */
export function joinHiddenParagraphMarks(xml: string): string {
  if (!/<w:pPr\b[\s\S]*?<w:vanish\b/.test(xml)) return xml;
  const matches = [...xml.matchAll(/<w:p\b(?:[^>]*?[^/])>[\s\S]*?<\/w:p>/g)];
  if (!matches.length) return xml;
  const markHidden = (paragraph: string) => {
    const props = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/.exec(paragraph)?.[0] ?? "";
    const hidden = /<w:vanish\b([^>]*)(?:\/>|>)/.exec(props);
    if (!hidden) return false;
    const val = /w:val="([^"]*)"/.exec(hidden[1])?.[1];
    return val !== "0" && val !== "false" && val !== "off";
  };
  const reveal = (paragraph: string) =>
    paragraph.replace(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/g, (props) =>
      props
        .replace(/<w:vanish\b[^>]*\/>/g, "")
        .replace(/<w:vanish\b[^>]*>[\s\S]*?<\/w:vanish>/g, ""),
    );
  let out = "";
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const first = matches[i];
    if (first.index === undefined) continue;
    out += xml.slice(cursor, first.index);
    const parts = [first[0]];
    let end = first.index + first[0].length;
    while (markHidden(parts[parts.length - 1] ?? "") && i + 1 < matches.length) {
      const next = matches[i + 1];
      if (next?.index === undefined || next.index < end) break;
      // A table or another element between the paragraphs stays where it is.
      if (xml.slice(end, next.index).trim()) break;
      i += 1;
      parts.push(next[0]);
      end = next.index + next[0].length;
    }
    const joined =
      parts.length === 1
        ? parts[0]
        : (() => {
            const last = parts[parts.length - 1] ?? "<w:p></w:p>";
            const open = /^<w:p\b[^>]*>/.exec(last)?.[0] ?? "<w:p>";
            const props = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/.exec(last)?.[0] ?? "";
            const bodies = parts.map((part) =>
              part
                .replace(/^<w:p\b[^>]*>/, "")
                .replace(/<\/w:p>$/, "")
                .replace(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/, ""),
            );
            return `${open}${props}${bodies.join("")}</w:p>`;
          })();
    out += reveal(joined);
    cursor = end;
  }
  return out + xml.slice(cursor);
}
/** A relationship target with `..` points outside `word/`, which the converter does not read. */
function resolveZipPath(sourcePart: string, target: string): string {
  const parts = sourcePart.split("/").slice(0, -1);
  for (const piece of decodeURIComponent(target).split("/")) {
    if (!piece || piece === ".") continue;
    if (piece === "..") parts.pop();
    else parts.push(piece);
  }
  return parts.join("/");
}
export async function relocateEscapingPictures(zip: JSZip): Promise<boolean> {
  let changed = false;
  for (const relName of Object.keys(zip.files)) {
    if (!/^word\/_rels\/.+\.rels$/i.test(relName)) continue;
    const sourcePart = relName.replace("/_rels/", "/").replace(/\.rels$/i, "");
    const file = zip.file(relName);
    if (!file) continue;
    let rels = await file.async("string");
    let relsChanged = false;
    for (const tag of [...rels.matchAll(/<Relationship\b[^>]*>/g)]) {
      const target = /Target="([^"]+)"/.exec(tag[0])?.[1];
      if (!target || !target.includes("..") || !/\.(png|jpe?g|gif|webp)$/i.test(target))
        continue;
      const resolved = resolveZipPath(sourcePart, target);
      const part = zip.file(resolved);
      if (!part) continue;
      const base = resolved.split("/").pop() || "image";
      let dest = `word/media/${base}`;
      if (zip.file(dest) && dest !== resolved) {
        const dot = base.lastIndexOf(".");
        const stem = dot >= 0 ? base.slice(0, dot) : base;
        const ext = dot >= 0 ? base.slice(dot) : "";
        let n = 2;
        while (zip.file(`word/media/${stem}-${n}${ext}`)) n += 1;
        dest = `word/media/${stem}-${n}${ext}`;
      }
      if (!zip.file(dest)) zip.file(dest, await part.async("uint8array"));
      const nextTarget = dest.slice("word/".length);
      if (nextTarget === target) continue;
      rels = rels.replace(tag[0], tag[0].replace(/Target="[^"]+"/, `Target="${nextTarget}"`));
      relsChanged = true;
    }
    if (!relsChanged) continue;
    zip.file(relName, rels);
    changed = true;
  }
  return changed;
}
/** A vanished run is hidden text, not body text. */
export function withoutHiddenRuns(xml: string): string {
  if (!/<w:vanish\b/.test(xml)) return xml;
  return xml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => {
    const hidden = /<w:vanish\b([^>]*)(?:\/>|>[\s\S]*?<\/w:vanish>)/.exec(run);
    if (!hidden) return run;
    const val = /w:val="([^"]*)"/.exec(hidden[1])?.[1];
    if (val === "0" || val === "false" || val === "off") return run;
    return "";
  });
}
/** Mammoth ignores `w:u` unless `w:val` is set. Omitted means single underline. */
export function withDefaultUnderline(xml: string): string {
  return xml.replace(/<w:u\b([^>]*)>/g, (full, attrs: string) => {
    if (/\bw:val\s*=/.test(attrs)) return full;
    const selfClosing = attrs.endsWith("/");
    const body = selfClosing ? attrs.slice(0, -1) : attrs;
    return `<w:u w:val="single"${body}${selfClosing ? "/>" : ">"}`;
  });
}
