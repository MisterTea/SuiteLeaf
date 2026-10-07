import JSZip from "jszip";
import * as CFB from "cfb";
import {
  createFile,
  type SlideFile,
  type Slide,
  type SlideElement,
} from "./index";

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&amp;/g, "&");
}

function parseXmlAttrs(tagStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const rx = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(tagStr)) !== null) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return attrs;
}

function resolveZipPath(basePath: string, relativePath: string): string {
  if (relativePath.startsWith("/")) return relativePath.slice(1);
  const parts = basePath.split("/");
  parts.pop(); // remove filename
  for (const seg of relativePath.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

function detectImageMime(buf: Uint8Array): string | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46
  ) {
    return "image/gif";
  }
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
  ) {
    return "image/webp";
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(
    buf.slice(0, 200),
  );
  if (text.includes("<svg") || text.includes("<?xml")) {
    return "image/svg+xml";
  }
  return null;
}

function uint8ToBase64(u8: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(u8).toString("base64");
  }
  let binary = "";
  const len = u8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(u8[i]);
  }
  return btoa(binary);
}

// Extract printable strings from raw buffer when files are corrupted or non-standard
function extractRawStrings(buf: Uint8Array, minLen = 4): string[] {
  const result: string[] = [];
  // 1. ASCII / UTF-8
  let curr = "";
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 32 && c <= 126) {
      curr += String.fromCharCode(c);
    } else {
      if (
        curr.length >= minLen &&
        !curr.startsWith("http://schemas.") &&
        !curr.startsWith("application/")
      ) {
        result.push(curr);
      }
      curr = "";
    }
  }
  if (curr.length >= minLen) result.push(curr);

  // 2. UTF-16LE
  curr = "";
  for (let i = 0; i < buf.length - 1; i += 2) {
    const code = buf[i] | (buf[i + 1] << 8);
    if (code >= 32 && code <= 126) {
      curr += String.fromCharCode(code);
    } else {
      if (
        curr.length >= minLen &&
        !curr.startsWith("http://schemas.") &&
        !curr.startsWith("application/")
      ) {
        result.push(curr);
      }
      curr = "";
    }
  }
  if (curr.length >= minLen) result.push(curr);

  // Deduplicate and filter out XML tags / internal junk
  const clean = result
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length >= minLen &&
        !/^<[^>]+>$/.test(s) &&
        !/^[0-9a-fA-F-]{20,}$/.test(s),
    );
  return Array.from(new Set(clean));
}

// Parse Relationships XML
function parseRels(
  xml: string,
): Record<string, { target: string; type: string }> {
  const rels: Record<string, { target: string; type: string }> = {};
  const rx = /<Relationship\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(xml)) !== null) {
    const attrs = parseXmlAttrs(m[1]);
    if (attrs.Id && attrs.Target) {
      rels[attrs.Id] = { target: attrs.Target, type: attrs.Type || "" };
    }
  }
  return rels;
}

// Parse Open XML PPTX
async function parseZipPptx(
  zip: JSZip,
  defaultTitle: string,
): Promise<SlideFile> {
  const presFile = zip.file("ppt/presentation.xml");
  const presXml = presFile ? await presFile.async("string") : "";

  // 1. Slide dimensions
  let width = 960;
  let height = 540;
  let emuWidth = 9144000;
  let emuHeight = 5143500;
  if (presXml) {
    const szMatch = /<p:sldSz\b([^>]*)\/?>/.exec(presXml);
    if (szMatch) {
      const attrs = parseXmlAttrs(szMatch[1]);
      if (attrs.cx && attrs.cy) {
        emuWidth = parseInt(attrs.cx, 10) || emuWidth;
        emuHeight = parseInt(attrs.cy, 10) || emuHeight;
        // Keep 960 width base, calculate proportional height
        width = 960;
        height = Math.round((emuHeight / emuWidth) * 960);
        if (height <= 0 || isNaN(height)) height = 540;
      }
    }
  }

  // 2. Slide list
  const slidePaths: string[] = [];
  const presRelsFile = zip.file("ppt/_rels/presentation.xml.rels");
  const presRelsXml = presRelsFile ? await presRelsFile.async("string") : "";
  const presRels = presRelsXml ? parseRels(presRelsXml) : {};

  if (presXml) {
    const sldIdRx = /<p:sldId\b([^>]*)\/?>/g;
    let sldMatch: RegExpExecArray | null;
    while ((sldMatch = sldIdRx.exec(presXml)) !== null) {
      const attrs = parseXmlAttrs(sldMatch[1]);
      const rId = attrs["r:id"] || attrs["id"];
      if (rId && presRels[rId]) {
        const target = resolveZipPath(
          "ppt/presentation.xml",
          presRels[rId].target,
        );
        if (zip.file(target)) {
          slidePaths.push(target);
        }
      }
    }
  }

  // Fallback: search all files matching ppt/slides/slide*.xml
  if (slidePaths.length === 0) {
    const allFiles = Object.keys(zip.files).filter((f) =>
      /^ppt\/slides\/slide\d+\.xml$/i.test(f),
    );
    allFiles.sort((a, b) => {
      const na = parseInt((a.match(/\d+/) || ["0"])[0], 10);
      const nb = parseInt((b.match(/\d+/) || ["0"])[0], 10);
      return na - nb;
    });
    slidePaths.push(...allFiles);
  }

  const out = createFile("slide", defaultTitle) as SlideFile;
  out.content.width = width;
  out.content.height = height;

  if (slidePaths.length === 0) {
    return out;
  }

  const slides: Record<string, Slide> = {};
  const slideOrder: string[] = [];

  for (let idx = 0; idx < slidePaths.length; idx++) {
    const slidePath = slidePaths[idx];
    const slideXmlFile = zip.file(slidePath);
    if (!slideXmlFile) continue;
    const slideXml = await slideXmlFile.async("string");

    // Relationships for this slide
    const slideRelsPath = slidePath.replace(
      /ppt\/slides\/([^/]+)$/,
      "ppt/slides/_rels/$1.rels",
    );
    const slideRelsFile = zip.file(slideRelsPath);
    const slideRelsXml = slideRelsFile
      ? await slideRelsFile.async("string")
      : "";
    const slideRels = slideRelsXml ? parseRels(slideRelsXml) : {};

    const slideId = crypto.randomUUID();
    let slideTitle = "";
    const elements: SlideElement[] = [];

    // Parse Background Color
    let bgColor: string | undefined = undefined;
    const bgMatch = /<p:bg\b[\s\S]*?<\/p:bg>/.exec(slideXml);
    if (bgMatch) {
      const clrMatch = /<a:srgbClr\s+val="([0-9a-fA-F]{6})"/.exec(bgMatch[0]);
      if (clrMatch) bgColor = `#${clrMatch[1]}`;
    }

    // Helper to extract transform
    const parseTransform = (xmlChunk: string) => {
      const xfrmMatch = /<a:xfrm\b[\s\S]*?<\/a:xfrm>/.exec(xmlChunk);
      let x = 40,
        y = 40,
        w = width - 80,
        h = 100;
      if (xfrmMatch) {
        const offMatch = /<a:off\b([^>]*)\/?>/.exec(xfrmMatch[0]);
        const extMatch = /<a:ext\b([^>]*)\/?>/.exec(xfrmMatch[0]);
        if (offMatch && extMatch) {
          const offAttrs = parseXmlAttrs(offMatch[1]);
          const extAttrs = parseXmlAttrs(extMatch[1]);
          const emuX = parseInt(offAttrs.x, 10) || 0;
          const emuY = parseInt(offAttrs.y, 10) || 0;
          const emuW = parseInt(extAttrs.cx, 10) || 1;
          const emuH = parseInt(extAttrs.cy, 10) || 1;

          x = Math.round((emuX / emuWidth) * width);
          y = Math.round((emuY / emuHeight) * height);
          w = Math.max(20, Math.round((emuW / emuWidth) * width));
          h = Math.max(16, Math.round((emuH / emuHeight) * height));
        }
      }
      return { x, y, width: w, height: h };
    };

    // Helper to extract text from a txBody
    const parseTextBody = (txBodyXml: string) => {
      const paragraphs: {
        text: string;
        bullet?: boolean;
        bold?: boolean;
        italic?: boolean;
        size?: number;
        align?: "left" | "center" | "right" | "justify";
        color?: string;
        font?: string;
      }[] = [];
      const pRx = /<a:p\b[\s\S]*?<\/a:p>/g;
      let pMatch: RegExpExecArray | null;

      while ((pMatch = pRx.exec(txBodyXml)) !== null) {
        const pXml = pMatch[0];
        const pPrMatch = /<a:pPr\b([^>]*)>/.exec(pXml);
        let align: "left" | "center" | "right" | "justify" = "left";
        let hasBullet = false;
        if (pPrMatch) {
          const pAttrs = parseXmlAttrs(pPrMatch[1]);
          if (pAttrs.algn === "ctr") align = "center";
          else if (pAttrs.algn === "r") align = "right";
          else if (pAttrs.algn === "just") align = "justify";
          if (/<a:buChar\b|<a:buAutoNum\b/.test(pXml)) {
            hasBullet = true;
          }
        }

        let pText = "";
        let isBold = false;
        let isItalic = false;
        let fontSize: number | undefined = undefined;
        let fontColor: string | undefined = undefined;
        let fontFamily: string | undefined = undefined;

        // Text runs
        const rRx = /<a:r\b[\s\S]*?<\/a:r>|<a:fld\b[\s\S]*?<\/a:fld>/g;
        let rMatch: RegExpExecArray | null;
        while ((rMatch = rRx.exec(pXml)) !== null) {
          const rXml = rMatch[0];
          const tMatch = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/.exec(rXml);
          if (tMatch) {
            const t = decodeXmlEntities(tMatch[1]);
            pText += t;
          }
          const rPrMatch = /<a:rPr\b([^>]*)>/.exec(rXml);
          if (rPrMatch) {
            const rAttrs = parseXmlAttrs(rPrMatch[1]);
            if (rAttrs.b === "1" || rAttrs.b === "true") isBold = true;
            if (rAttrs.i === "1" || rAttrs.i === "true") isItalic = true;
            if (rAttrs.sz) {
              const szPt = Math.round(parseInt(rAttrs.sz, 10) / 100);
              if (szPt > 6 && szPt < 120) fontSize = szPt;
            }
            const latinMatch = /<a:latin\s+typeface="([^"]+)"/.exec(rXml);
            if (latinMatch) fontFamily = latinMatch[1];
            const clrMatch = /<a:srgbClr\s+val="([0-9a-fA-F]{6})"/.exec(rXml);
            if (clrMatch) fontColor = `#${clrMatch[1]}`;
          }
        }

        if (pText.trim()) {
          paragraphs.push({
            text: pText,
            bullet: hasBullet,
            bold: isBold,
            italic: isItalic,
            size: fontSize,
            align,
            color: fontColor,
            font: fontFamily,
          });
        }
      }
      return paragraphs;
    };

    // 3. Parse Shapes (<p:sp>)
    const spRx = /<p:sp\b[\s\S]*?<\/p:sp>/g;
    let spMatch: RegExpExecArray | null;
    while ((spMatch = spRx.exec(slideXml)) !== null) {
      const spXml = spMatch[0];
      const phMatch = /<p:ph\b([^>]*)\/?>/.exec(spXml);
      let phType = "";
      if (phMatch) {
        phType = parseXmlAttrs(phMatch[1]).type || "body";
      }

      const txBodyMatch = /<p:txBody\b[\s\S]*?<\/p:txBody>/.exec(spXml);
      const { x, y, width: w, height: h } = parseTransform(spXml);

      // Check fill color
      let fillColor: string | undefined = undefined;
      const fillMatch =
        /<a:spPr\b[\s\S]*?<a:solidFill\b[\s\S]*?<a:srgbClr\s+val="([0-9a-fA-F]{6})"/.exec(
          spXml,
        );
      if (fillMatch) fillColor = `#${fillMatch[1]}`;

      if (txBodyMatch) {
        const paragraphs = parseTextBody(txBodyMatch[0]);
        if (paragraphs.length > 0) {
          const fullText = paragraphs.map((p) => p.text).join("\n");
          if (
            !slideTitle &&
            (phType === "title" ||
              phType === "ctrTitle" ||
              (idx === 0 && y < height * 0.35))
          ) {
            slideTitle = fullText;
          }

          const first = paragraphs[0];
          elements.push({
            id: crypto.randomUUID(),
            type: "text",
            x,
            y,
            width: w,
            height: h,
            content: fullText,
            bold: first.bold,
            italic: first.italic,
            fontSize:
              first.size ||
              (phType === "title" || phType === "ctrTitle" ? 36 : 18),
            fontFamily: first.font || "Arial",
            color: first.color || "#1e293b",
            align: first.align || "left",
            bullet: paragraphs.some((p) => p.bullet),
            fill: fillColor,
          });
          continue;
        }
      }

      // If it's a visible shape without text
      const geomMatch = /<a:prstGeom\s+prst="([^"]+)"/.exec(spXml);
      if (geomMatch || fillColor) {
        let shapeType: "rect" | "roundRect" | "ellipse" | "line" | "arrow" =
          "rect";
        const geom = geomMatch ? geomMatch[1] : "rect";
        if (geom.includes("roundRect")) shapeType = "roundRect";
        else if (geom.includes("ellipse") || geom.includes("circle"))
          shapeType = "ellipse";
        else if (geom.includes("line")) shapeType = "line";
        else if (geom.includes("Arrow")) shapeType = "arrow";

        elements.push({
          id: crypto.randomUUID(),
          type: "shape",
          x,
          y,
          width: w,
          height: h,
          shapeType,
          fill: fillColor || "#e2e8f0",
        });
      }
    }

    // 4. Parse Pictures (<p:pic>)
    const picRx = /<p:pic\b[\s\S]*?<\/p:pic>/g;
    let picMatch: RegExpExecArray | null;
    while ((picMatch = picRx.exec(slideXml)) !== null) {
      const picXml = picMatch[0];
      const blipMatch = /<a:blip\b([^>]*)\/?>/.exec(picXml);
      if (!blipMatch) continue;
      const blipAttrs = parseXmlAttrs(blipMatch[1]);
      const rId = blipAttrs["r:embed"] || blipAttrs["r:link"];
      if (!rId || !slideRels[rId]) continue;

      const mediaRelTarget = slideRels[rId].target;
      const mediaZipPath = resolveZipPath(slidePath, mediaRelTarget);
      const mediaFile = zip.file(mediaZipPath);
      if (mediaFile) {
        const imgBytes = await mediaFile.async("uint8array");
        const mime = detectImageMime(imgBytes);
        if (mime) {
          const b64 = uint8ToBase64(imgBytes);
          const { x, y, width: w, height: h } = parseTransform(picXml);
          elements.push({
            id: crypto.randomUUID(),
            type: "image",
            x,
            y,
            width: w,
            height: h,
            src: `data:${mime};base64,${b64}`,
            alt: "Slide image",
          });
        }
      }
    }

    // 5. Parse Tables (<a:tbl>)
    const tblRx = /<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g;
    let gfMatch: RegExpExecArray | null;
    while ((gfMatch = tblRx.exec(slideXml)) !== null) {
      const gfXml = gfMatch[0];
      const tblMatch = /<a:tbl\b[\s\S]*?<\/a:tbl>/.exec(gfXml);
      if (tblMatch) {
        const rows: string[][] = [];
        const trRx = /<a:tr\b[\s\S]*?<\/a:tr>/g;
        let trMatch: RegExpExecArray | null;
        while ((trMatch = trRx.exec(tblMatch[0])) !== null) {
          const row: string[] = [];
          const tcRx = /<a:tc\b[\s\S]*?<\/a:tc>/g;
          let tcMatch: RegExpExecArray | null;
          while ((tcMatch = tcRx.exec(trMatch[0])) !== null) {
            const cellTx = parseTextBody(tcMatch[0]);
            row.push(cellTx.map((p) => p.text).join(" "));
          }
          if (row.length > 0) rows.push(row);
        }
        if (rows.length > 0) {
          const { x, y, width: w, height: h } = parseTransform(gfXml);
          elements.push({
            id: crypto.randomUUID(),
            type: "table",
            x,
            y,
            width: w,
            height: h,
            rows,
          });
        }
      }
    }

    // 6. Speaker Notes
    let notes = "";
    for (const rel of Object.values(slideRels)) {
      if (rel.type.includes("notesSlide")) {
        const notesPath = resolveZipPath(slidePath, rel.target);
        const notesFile = zip.file(notesPath);
        if (notesFile) {
          const notesXml = await notesFile.async("string");
          const notesSpRx = /<p:sp\b[\s\S]*?<\/p:sp>/g;
          let nspMatch: RegExpExecArray | null;
          while ((nspMatch = notesSpRx.exec(notesXml)) !== null) {
            const nspXml = nspMatch[0];
            if (
              /<p:ph\b[^>]*type="body"/.test(nspXml) ||
              !/<p:ph\b/.test(nspXml)
            ) {
              const tx = parseTextBody(nspXml);
              if (tx.length > 0) {
                notes =
                  (notes ? notes + "\n" : "") +
                  tx.map((p) => p.text).join("\n");
              }
            }
          }
        }
      }
    }

    // Determine layout
    let layout: Slide["layout"] = "title-body";
    if (idx === 0) layout = "title";
    else if (elements.length === 0) layout = "blank";
    else if (elements.length >= 3) layout = "two-column";

    slides[slideId] = {
      id: slideId,
      title: slideTitle || `Slide ${idx + 1}`,
      background: bgColor ? { color: bgColor } : undefined,
      layout,
      elements,
      notes: notes.trim(),
    };
    slideOrder.push(slideId);
  }

  out.content.slides = slides;
  out.content.slideOrder = slideOrder;
  return out;
}

// Parse legacy binary PPT (.ppt) via CFB
function parseBinaryPpt(u8: Uint8Array, defaultTitle: string): SlideFile {
  const cfb = CFB.read(u8, { type: "buffer" });
  const docEntry = CFB.find(cfb, "PowerPoint Document");
  const out = createFile("slide", defaultTitle) as SlideFile;

  if (!docEntry || !docEntry.content) {
    const rawStrings = extractRawStrings(u8);
    if (rawStrings.length > 0) {
      const slideId = out.content.slideOrder[0];
      out.content.slides[slideId].elements = [
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 60,
          y: 60,
          width: 840,
          height: 420,
          content: rawStrings.slice(0, 30).join("\n"),
          fontSize: 18,
          align: "left",
        },
      ];
    }
    return out;
  }

  const data = Buffer.isBuffer(docEntry.content)
    ? docEntry.content
    : Buffer.from(docEntry.content);

  // Parse records from PowerPoint Document stream
  // [MS-PPT] records
  const slideTexts: { text: string; isNote?: boolean }[][] = [];
  let currentSlideTexts: { text: string; isNote?: boolean }[] = [];

  let pos = 0;
  while (pos + 8 <= data.length) {
    const verInst = data.readUInt16LE(pos);
    const recType = data.readUInt16LE(pos + 2);
    const recLen = data.readUInt32LE(pos + 4);
    const isContainer = (verInst & 0x0f) === 0x0f;

    // SlideContainer = 3998
    if (recType === 3998) {
      if (currentSlideTexts.length > 0) {
        slideTexts.push(currentSlideTexts);
      }
      currentSlideTexts = [];
    }

    // TextCharsAtom = 4008 (UTF-16LE characters)
    if (recType === 4008 && pos + 8 + recLen <= data.length) {
      const raw = data.slice(pos + 8, pos + 8 + recLen);
      // Check if it's UTF-16LE or ASCII
      let str = "";
      if (raw.length % 2 === 0 && raw.some((b, i) => i % 2 === 1 && b === 0)) {
        str = raw.toString("utf16le");
      } else {
        str = raw.toString("latin1");
      }
      str = str.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim();
      if (str.length > 0) {
        currentSlideTexts.push({ text: str });
      }
    }

    // TextBytesAtom = 4000 (1-byte Latin1 / ANSI characters)
    if (recType === 4000 && pos + 8 + recLen <= data.length) {
      const raw = data.slice(pos + 8, pos + 8 + recLen);
      let str = "";
      if (raw.length >= 2 && raw.some((b, i) => i % 2 === 1 && b === 0)) {
        str = raw.toString("utf16le");
      } else {
        str = raw.toString("latin1");
      }
      str = str.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim();
      if (str.length > 0) {
        currentSlideTexts.push({ text: str });
      }
    }

    if (isContainer) {
      pos += 8;
    } else {
      pos += 8 + recLen;
    }
  }

  if (currentSlideTexts.length > 0) {
    slideTexts.push(currentSlideTexts);
  }

  if (slideTexts.length === 0) {
    const rawStrings = extractRawStrings(u8);
    if (rawStrings.length > 0) {
      const slideId = out.content.slideOrder[0];
      out.content.slides[slideId].elements = [
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 60,
          y: 60,
          width: 840,
          height: 420,
          content: rawStrings.slice(0, 30).join("\n"),
          fontSize: 18,
          align: "left",
        },
      ];
    }
    return out;
  }

  const slides: Record<string, Slide> = {};
  const slideOrder: string[] = [];

  for (let i = 0; i < slideTexts.length; i++) {
    const texts = slideTexts[i];
    const slideId = crypto.randomUUID();
    const title = texts[0]?.text || `Slide ${i + 1}`;
    const bodyTexts = texts.slice(1);

    const elements: SlideElement[] = [
      {
        id: crypto.randomUUID(),
        type: "text",
        x: 80,
        y: 60,
        width: 800,
        height: 80,
        content: title,
        fontSize: i === 0 ? 38 : 28,
        bold: true,
        align: i === 0 ? "center" : "left",
        color: "#1e293b",
      },
    ];

    if (bodyTexts.length > 0) {
      elements.push({
        id: crypto.randomUUID(),
        type: "text",
        x: 80,
        y: 160,
        width: 800,
        height: 320,
        content: bodyTexts.map((t) => t.text).join("\n\n"),
        fontSize: 18,
        bullet: true,
        align: "left",
        color: "#334155",
      });
    }

    slides[slideId] = {
      id: slideId,
      title,
      layout: i === 0 ? "title" : "title-body",
      elements,
      notes: "",
    };
    slideOrder.push(slideId);
  }

  out.content.slides = slides;
  out.content.slideOrder = slideOrder;
  return out;
}

// Main PowerPoint import function
export async function parsePowerPoint(
  input: ArrayBuffer | Uint8Array,
  title?: string,
): Promise<SlideFile> {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const defaultTitle = title?.trim() || "Imported presentation";

  // Check if ZIP (PK\x03\x04 or PK\x05\x06)
  const isZip =
    u8.length >= 4 &&
    u8[0] === 0x50 &&
    u8[1] === 0x4b &&
    (u8[2] === 0x03 || u8[2] === 0x05 || u8[2] === 0x07);

  if (isZip) {
    try {
      const zip = await JSZip.loadAsync(u8);
      return await parseZipPptx(zip, defaultTitle);
    } catch {
      // If JSZip fails on corrupted/truncated ZIP, attempt recovery from raw strings/xml
      const rawStrings = extractRawStrings(u8);
      const out = createFile("slide", defaultTitle) as SlideFile;
      if (rawStrings.length > 0) {
        const slideId = out.content.slideOrder[0];
        out.content.slides[slideId].elements = [
          {
            id: crypto.randomUUID(),
            type: "text",
            x: 60,
            y: 60,
            width: 840,
            height: 420,
            content: rawStrings.slice(0, 30).join("\n"),
            fontSize: 18,
            align: "left",
          },
        ];
      }
      return out;
    }
  }

  // Check if CFBF / OLE container
  const isOle =
    u8.length >= 8 &&
    u8[0] === 0xd0 &&
    u8[1] === 0xcf &&
    u8[2] === 0x11 &&
    u8[3] === 0xe0 &&
    u8[4] === 0xa1 &&
    u8[5] === 0xb1 &&
    u8[6] === 0x1a &&
    u8[7] === 0xe1;

  if (isOle) {
    try {
      return parseBinaryPpt(u8, defaultTitle);
    } catch {
      const rawStrings = extractRawStrings(u8);
      const out = createFile("slide", defaultTitle) as SlideFile;
      if (rawStrings.length > 0) {
        const slideId = out.content.slideOrder[0];
        out.content.slides[slideId].elements = [
          {
            id: crypto.randomUUID(),
            type: "text",
            x: 60,
            y: 60,
            width: 840,
            height: 420,
            content: rawStrings.slice(0, 30).join("\n"),
            fontSize: 18,
            align: "left",
          },
        ];
      }
      return out;
    }
  }

  // Fallback for non-standard / damaged files (e.g. CVE fixtures, raw text, HTML error pages)
  const rawStrings = extractRawStrings(u8);
  const out = createFile("slide", defaultTitle) as SlideFile;
  if (rawStrings.length > 0) {
    const slideId = out.content.slideOrder[0];
    out.content.slides[slideId].elements = [
      {
        id: crypto.randomUUID(),
        type: "text",
        x: 60,
        y: 60,
        width: 840,
        height: 420,
        content: rawStrings.slice(0, 30).join("\n"),
        fontSize: 18,
        align: "left",
      },
    ];
  }
  return out;
}
