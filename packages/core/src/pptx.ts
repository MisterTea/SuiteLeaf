import JSZip from "jszip";
import * as CFB from "cfb";
import {
  createFile,
  type SlideFile,
  type Slide,
  type SlideElement,
  type TextRun,
} from "./index";
import { readClickAnimations, readSlideMotion } from "./slide-motion";
import { gatherNativeDrawing } from "./pptx-native-objects";

function xmlCharacter(code: number, fallback: string): string {
  return Number.isInteger(code) &&
    code > 0 &&
    code <= 0x10ffff &&
    !(code >= 0xd800 && code <= 0xdfff)
    ? String.fromCodePoint(code)
    : fallback;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (entity, n) => xmlCharacter(+n, entity))
    .replace(/&#x([0-9a-fA-F]+);/g, (entity, h) =>
      xmlCharacter(parseInt(h, 16), entity),
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
  const placeableWmf =
    buf.length >= 40 &&
    buf[0] === 0xd7 &&
    buf[1] === 0xcd &&
    buf[2] === 0xc6 &&
    buf[3] === 0x9a;
  const wmfOffset = placeableWmf ? 22 : 0;
  if (
    buf.length >= wmfOffset + 18 &&
    (buf[wmfOffset] === 1 || buf[wmfOffset] === 2) &&
    buf[wmfOffset + 1] === 0 &&
    buf[wmfOffset + 2] === 9 &&
    buf[wmfOffset + 3] === 0 &&
    buf[wmfOffset + 4] === 0 &&
    (buf[wmfOffset + 5] === 1 || buf[wmfOffset + 5] === 3)
  )
    return "image/wmf";
  if (
    buf.length >= 8 &&
    buf[0] === 0x49 &&
    buf[1] === 0x49 &&
    buf[2] === 0xbc &&
    buf[3] === 0x01
  )
    return "image/wdp";
  // Some producers save BMP bytes with a .png name; sniff the header.
  if (buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4d)
    return "image/bmp";
  if (
    buf.length >= 4 &&
    ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0) ||
      (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0 && buf[3] === 0x2a))
  )
    return "image/tiff";
  if (
    buf.length >= 44 &&
    buf[0] === 1 &&
    buf[1] === 0 &&
    buf[2] === 0 &&
    buf[3] === 0 &&
    buf[40] === 0x20 &&
    buf[41] === 0x45 &&
    buf[42] === 0x4d &&
    buf[43] === 0x46
  )
    return "image/emf";
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
    const shapeIndex = new Map<string, number>();
    const elementOrder = new Map<number, number>();
    const rememberShape = (xml: string) => {
      elementOrder.set(elements.length, slideXml.indexOf(xml));
      const attributes = /<p:cNvPr\b([^>]*)/.exec(xml)?.[1];
      const id = attributes ? parseXmlAttrs(attributes).id : undefined;
      if (id && !shapeIndex.has(id)) shapeIndex.set(id, elements.length);
    };

    // Layout and master artwork is visible even when the slide has no local picture.
    const readRelatedPart = async (
      ownerPath: string,
      relationships: ReturnType<typeof parseRels>,
      kind: string,
    ) => {
      const relation = Object.values(relationships).find((rel) =>
        rel.type.endsWith(`/${kind}`),
      );
      if (!relation) return undefined;
      const partPath = resolveZipPath(ownerPath, relation.target);
      const part = zip.file(partPath);
      if (!part) return undefined;
      const relPath = partPath.replace(/([^/]+)$/, "_rels/$1.rels");
      const relFile = zip.file(relPath);
      return {
        path: partPath,
        xml: await part.async("string"),
        rels: relFile ? parseRels(await relFile.async("string")) : {},
      };
    };
    const layoutPart = await readRelatedPart(
      slidePath,
      slideRels,
      "slideLayout",
    );
    const masterPart = layoutPart
      ? await readRelatedPart(layoutPart.path, layoutPart.rels, "slideMaster")
      : undefined;
    const themePart = masterPart
      ? await readRelatedPart(masterPart.path, masterPart.rels, "theme")
      : undefined;
    const themeFont = (name: string | undefined) => {
      if (name !== "+mj-lt" && name !== "+mn-lt") return name;
      const kind = name === "+mj-lt" ? "majorFont" : "minorFont";
      const section =
        new RegExp(`<a:${kind}\\b[\\s\\S]*?<\\/a:${kind}>`).exec(
          themePart?.xml || "",
        )?.[0] || "";
      return /<a:latin\b[^>]*typeface="([^"]+)"/.exec(section)?.[1];
    };
    const layers = [masterPart, layoutPart].filter(
      (part): part is NonNullable<typeof part> => Boolean(part),
    );
    const ownPart = { path: slidePath, xml: slideXml, rels: slideRels };
    // A nearer background overrides its ancestors, including solid fills.
    const backgroundPart = [ownPart, layoutPart, masterPart].find(
      (part) => part && /<p:bg\b/.test(part.xml),
    );
    const bgXml = backgroundPart
      ? (/<p:bg\b[\s\S]*?<\/p:bg>/.exec(backgroundPart.xml)?.[0] ?? "")
      : "";
    const bgColorMatch = /<a:srgbClr\s+val="([0-9a-fA-F]{6})"/.exec(bgXml);
    const bgColor = bgColorMatch ? `#${bgColorMatch[1]}` : undefined;

    // Helper to extract transform
    const parseTransform = (xmlChunk: string) => {
      const xfrmMatch = /<(?:a|p):xfrm\b[\s\S]*?<\/(?:a|p):xfrm>/.exec(
        xmlChunk,
      );
      let x = 40,
        y = 40,
        w = width - 80,
        h = 100;
      if (xfrmMatch) {
        const offMatch = /<(?:a|p):off\b([^>]*)\/?>/.exec(xfrmMatch[0]);
        const extMatch = /<(?:a|p):ext\b([^>]*)\/?>/.exec(xfrmMatch[0]);
        if (offMatch && extMatch) {
          const offAttrs = parseXmlAttrs(offMatch[1]);
          const extAttrs = parseXmlAttrs(extMatch[1]);
          const emuX = parseInt(offAttrs.x, 10) || 0;
          const emuY = parseInt(offAttrs.y, 10) || 0;
          const emuW = parseInt(extAttrs.cx, 10) || 1;
          const emuH = parseInt(extAttrs.cy, 10) || 1;

          x = (emuX / emuWidth) * width;
          y = (emuY / emuHeight) * height;
          w = Math.max(0, (emuW / emuWidth) * width);
          h = Math.max(0, (emuH / emuHeight) * height);
        }
      }
      return { x, y, width: w, height: h };
    };

    const nativeOleFrame = (partXml: string, pictureXml: string) =>
      [
        ...partXml.matchAll(/<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g),
      ].find(
        (match) =>
          /<p:oleObj\b/.test(match[0]) && match[0].includes(pictureXml),
      )?.[0];
    const addInheritedImage = async (
      part: typeof ownPart,
      xml: string,
      background = false,
    ) => {
      const blip = /<a:blip\b([^>]*)\/?>/.exec(xml);
      if (!blip) return;
      const attrs = parseXmlAttrs(blip[1]);
      const rel = part.rels[attrs["r:embed"]];
      if (!rel) return;
      const image = zip.file(resolveZipPath(part.path, rel.target));
      if (!image) return;
      const bytes = await image.async("uint8array");
      const mime = detectImageMime(bytes);
      if (!mime) return;
      const nativeFrame = nativeOleFrame(part.xml, xml);
      const nativeDrawing = nativeFrame
        ? await gatherNativeDrawing(zip, part.path, nativeFrame)
        : undefined;
      elements.push({
        id: crypto.randomUUID(),
        type: "image",
        ...(background ? { x: 0, y: 0, width, height } : parseTransform(nativeFrame || xml)),
        src: `data:${mime};base64,${uint8ToBase64(bytes)}`,
        alt: background ? "Slide background" : "Inherited slide artwork",
        ...(nativeDrawing ? { nativeDrawing } : {}),
      });
    };
    if (backgroundPart && bgXml) {
      await addInheritedImage(backgroundPart, bgXml, true);
    }
    const showMasterShapes =
      !/<p:sld\b[^>]*showMasterSp="(?:0|false)"/.test(slideXml) &&
      !(
        layoutPart &&
        /<p:sldLayout\b[^>]*showMasterSp="(?:0|false)"/.test(layoutPart.xml)
      );
    for (const part of layers) {
      if (part === masterPart && !showMasterShapes) continue;
      for (const match of part.xml.matchAll(
        /<p:pic\b[\s\S]*?<\/p:pic>|<p:sp\b[\s\S]*?<\/p:sp>/g,
      )) {
        // Placeholder content is supplied by the slide, rather than inherited.
        if (/<p:ph\b/.test(match[0])) continue;
        await addInheritedImage(part, match[0]);
      }
    }

    // Helper to extract text from a txBody
    const parseTextBody = (txBodyXml: string, inherited: string[] = []) => {
      const paragraphs: {
        text: string;
        runs: TextRun[];
        bullet?: boolean;
        bold?: boolean;
        italic?: boolean;
        underline?: boolean;
        size?: number;
        align?: "left" | "center" | "right" | "justify";
        color?: string;
        font?: string;
      }[] = [];
      const pRx = /<a:p\b[^>]*?(?:\/>|>[\s\S]*?<\/a:p>)/g;
      let pMatch: RegExpExecArray | null;

      while ((pMatch = pRx.exec(txBodyXml)) !== null) {
        const pXml = pMatch[0];
        const pPrMatch = /<a:pPr\b([^>]*?)(?:\/>|>[\s\S]*?<\/a:pPr>)/.exec(
          pXml,
        );
        const ownParagraphAttrs = pPrMatch ? parseXmlAttrs(pPrMatch[1]) : {};
        const level = Number(ownParagraphAttrs.lvl || 0) + 1;
        const styleParts = [
          ...inherited,
          /<a:lstStyle\b[\s\S]*?<\/a:lstStyle>/.exec(txBodyXml)?.[0] || "",
        ].map(
          (xml) =>
            new RegExp(
              `<a:lvl${level}pPr\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/a:lvl${level}pPr>)`,
            ).exec(xml)?.[0] || "",
        );
        styleParts.push(pPrMatch?.[0] || "");
        const pAttrs = Object.assign(
          {},
          ...styleParts.map((xml) =>
            parseXmlAttrs(/^<[^>]+/.exec(xml)?.[0] || ""),
          ),
          ownParagraphAttrs,
        );
        const defaultRunParts = styleParts.map(
          (xml) =>
            /<a:defRPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:defRPr>)/.exec(xml)?.[0] ||
            "",
        );
        const defaultRunAttrs = Object.assign(
          {},
          ...defaultRunParts.map((xml) =>
            parseXmlAttrs(/^<[^>]+/.exec(xml)?.[0] || ""),
          ),
        );
        const defaultColor = defaultRunParts
          .flatMap((xml) =>
            [...xml.matchAll(/<a:srgbClr\s+val="([0-9a-fA-F]{6})"/g)].map(
              (m) => `#${m[1]}`,
            ),
          )
          .at(-1);
        const defaultFont = defaultRunParts
          .flatMap((xml) =>
            [...xml.matchAll(/<a:latin\s+typeface="([^"]+)"/g)].map(
              (m) => m[1],
            ),
          )
          .at(-1);
        let align: "left" | "center" | "right" | "justify" = "left";
        if (pAttrs.algn === "ctr") align = "center";
        else if (pAttrs.algn === "r") align = "right";
        else if (pAttrs.algn === "just") align = "justify";
        const bulletStyle =
          styleParts
            .filter((xml) => /<a:bu(?:None|Char|AutoNum)\b/.test(xml))
            .at(-1) || "";
        const hasBullet = /<a:buChar\b|<a:buAutoNum\b/.test(bulletStyle);

        let pText = "";
        const textRuns: TextRun[] = [];
        let isBold = false;
        let isItalic = false;
        let isUnderline = false;
        let fontSize: number | undefined = defaultRunAttrs.sz
          ? Number(defaultRunAttrs.sz) / 100
          : undefined;
        let fontColor: string | undefined = defaultColor;
        let fontFamily: string | undefined = themeFont(defaultFont);

        // Text runs
        const rRx =
          /<a:r\b[\s\S]*?<\/a:r>|<a:fld\b[\s\S]*?<\/a:fld>|<a:br\b[^>]*(?:\/>|>[\s\S]*?<\/a:br>)/g;
        let rMatch: RegExpExecArray | null;
        while ((rMatch = rRx.exec(pXml)) !== null) {
          const rXml = rMatch[0];
          if (/^<a:br\b/.test(rXml)) {
            pText += "\n";
            textRuns.push({ text: "\n" });
            continue;
          }
          const run: TextRun = {
            text: "",
            bold: false,
            italic: false,
            underline: false,
          };
          const tMatch = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/.exec(rXml);
          if (tMatch) {
            const t = decodeXmlEntities(tMatch[1]).replace(/\r\n?/g, "\n");
            pText += t;
            run.text = t;
          }
          const rPrMatch = /<a:rPr\b([^>]*)>/.exec(rXml);
          {
            const rAttrs = {
              ...defaultRunAttrs,
              ...(rPrMatch ? parseXmlAttrs(rPrMatch[1]) : {}),
            };
            if (rAttrs.b === "1" || rAttrs.b === "true") isBold = true;
            run.bold = rAttrs.b === "1" || rAttrs.b === "true";
            run.italic = rAttrs.i === "1" || rAttrs.i === "true";
            run.underline = Boolean(rAttrs.u && rAttrs.u !== "none");
            if (rAttrs.i === "1" || rAttrs.i === "true") isItalic = true;
            if (rAttrs.u && rAttrs.u !== "none") isUnderline = true;
            if (rAttrs.sz) {
              const szPt = parseInt(rAttrs.sz, 10) / 100;
              if (szPt > 0 && szPt < 400) {
                if (fontSize === undefined) fontSize = szPt;
                run.fontSize = szPt;
              }
            }
            const latinMatch = /<a:latin\s+typeface="([^"]+)"/.exec(rXml);
            if (latinMatch) fontFamily = themeFont(latinMatch[1]);
            const clrMatch = /<a:srgbClr\s+val="([0-9a-fA-F]{6})"/.exec(rXml);
            if (clrMatch) {
              run.color = `#${clrMatch[1]}`;
              if (!fontColor) fontColor = run.color;
            } else if (defaultColor) run.color = defaultColor;
          }
          if (run.text) textRuns.push(run);
        }

        {
          paragraphs.push({
            text: pText,
            runs: textRuns,
            bullet: hasBullet,
            bold: isBold,
            italic: isItalic,
            underline: isUnderline,
            size: fontSize,
            align,
            color: fontColor,
            font: fontFamily,
          });
        }
      }
      return paragraphs;
    };

    // A picture painted on the group itself sits behind the shapes in that group.
    const grpPrRx = /<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/g;
    let grpPrMatch: RegExpExecArray | null;
    while ((grpPrMatch = grpPrRx.exec(slideXml)) !== null) {
      const grpPr = grpPrMatch[0];
      for (const blipMatch of grpPr.matchAll(/<a:blip\b([^>]*)\/?>/g)) {
        const blipAttrs = parseXmlAttrs(blipMatch[1]);
        const rId = blipAttrs["r:embed"] || blipAttrs["r:link"];
        if (!rId || !slideRels[rId]) continue;
        const mediaFile = zip.file(
          resolveZipPath(slidePath, slideRels[rId].target),
        );
        if (!mediaFile) continue;
        const imgBytes = await mediaFile.async("uint8array");
        const mime = detectImageMime(imgBytes);
        if (!mime) continue;
        const { x, y, width: w, height: h } = parseTransform(grpPr);
        elements.push({
          id: crypto.randomUUID(),
          type: "image",
          x,
          y,
          width: w,
          height: h,
          src: `data:${mime};base64,${uint8ToBase64(imgBytes)}`,
          alt: "Slide image",
        });
      }
    }

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

      const placeholderAttrs = phMatch ? parseXmlAttrs(phMatch[1]) : undefined;
      const inheritedPlaceholder = (xml: string | undefined) => {
        if (!xml || !placeholderAttrs) return "";
        const shapes = [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].map(
          (m) => m[0],
        );
        const sameType = (candidate: string) => {
          const ph = /<p:ph\b([^>]*)\/?>/.exec(candidate);
          if (!ph) return false;
          const attrs = parseXmlAttrs(ph[1]);
          return (
            (attrs.idx || "0") === (placeholderAttrs.idx || "0") &&
            ((attrs.type || "body") === phType ||
              [attrs.type, phType].every(
                (t) => t === "title" || t === "ctrTitle",
              ))
          );
        };
        return shapes.find(sameType) || "";
      };
      const layoutPlaceholder = inheritedPlaceholder(layoutPart?.xml);
      const masterPlaceholder = inheritedPlaceholder(masterPart?.xml);
      const masterStyleKind =
        phType === "title" || phType === "ctrTitle"
          ? "titleStyle"
          : phType === "body"
            ? "bodyStyle"
            : "otherStyle";
      const masterStyle =
        new RegExp(
          `<p:${masterStyleKind}\\b[\\s\\S]*?<\\/p:${masterStyleKind}>`,
        ).exec(masterPart?.xml || "")?.[0] || "";
      const txBodyMatch = /<p:txBody\b[\s\S]*?<\/p:txBody>/.exec(spXml);
      const spPr = /<p:spPr\b[\s\S]*?<\/p:spPr>/.exec(spXml)?.[0] ?? "";
      const {
        x,
        y,
        width: w,
        height: h,
      } = parseTransform(spXml + layoutPlaceholder + masterPlaceholder);

      // Check fill color
      let fillColor: string | undefined = undefined;
      const fillMatch =
        /<a:solidFill\b[\s\S]*?<a:srgbClr\s+val="([0-9a-fA-F]{6})"/.exec(spPr);
      if (fillMatch) fillColor = `#${fillMatch[1]}`;

      let addedText = false;
      if (txBodyMatch) {
        const paragraphs = parseTextBody(txBodyMatch[0], [
          masterStyle,
          masterPlaceholder,
          layoutPlaceholder,
        ]);
        if (paragraphs.some((paragraph) => paragraph.text.trim())) {
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
          rememberShape(spXml);
          elements.push({
            id: crypto.randomUUID(),
            type: "text",
            x,
            y,
            width: w,
            height: h,
            content: fullText,
            runs: paragraphs.flatMap((paragraph, index) => [
              ...(index ? [{ text: "\n", paragraphBreak: true }] : []),
              ...paragraph.runs,
            ]),
            bold: first.bold,
            italic: first.italic,
            ...(first.underline ? { underline: true } : {}),
            fontSize:
              first.size ||
              (phType === "title" || phType === "ctrTitle" ? 36 : 18),
            fontFamily: first.font || "Arial",
            color: first.color || "#1e293b",
            align: first.align || "left",
            bullet: paragraphs.some((p) => p.bullet),
            fill: fillColor,
          });
          addedText = true;
        }
      }

      // A picture filling the shape is separate from a label drawn on top of it.
      const blipMatch = /<a:blip\b([^>]*)\/?>/.exec(spPr);
      let blipHandled = false;
      if (blipMatch) {
        const blipAttrs = parseXmlAttrs(blipMatch[1]);
        const rId = blipAttrs["r:embed"] || blipAttrs["r:link"];
        if (rId && slideRels[rId]) {
          const mediaRelTarget = slideRels[rId].target;
          const mediaZipPath = resolveZipPath(slidePath, mediaRelTarget);
          const mediaFile = zip.file(mediaZipPath);
          if (mediaFile) {
            const imgBytes = await mediaFile.async("uint8array");
            const mime = detectImageMime(imgBytes);
            if (mime) {
              const b64 = uint8ToBase64(imgBytes);
              elements.push({
                id: crypto.randomUUID(),
                type: "image",
                x,
                y,
                width: w,
                height: h,
                src: `data:${mime};base64,${b64}`,
                alt: "Shape image fill",
              });
              blipHandled = true;
            }
          }
        }
      }

      if (!addedText && !blipHandled) {
        // If it's a visible shape without text
        const geomMatch = /<a:prstGeom\s+prst="([^"]+)"/.exec(spXml);
        if (geomMatch || fillColor) {
          rememberShape(spXml);
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
    }

    // 4. Parse Pictures (<p:pic>)
    const picRx = /<p:pic\b[\s\S]*?<\/p:pic>/g;
    let picMatch: RegExpExecArray | null;
    while ((picMatch = picRx.exec(slideXml)) !== null) {
      const picXml = picMatch[0];
      // Embedded clips use a picture container whose blip is its poster frame.
      const mediaTag = /<a:(videoFile|audioFile)\b([^>]*)\/?>/.exec(picXml);
      if (mediaTag) {
        const attrs = parseXmlAttrs(mediaTag[2]);
        const embedded = /<p14:media\b([^>]*)\/?>/.exec(picXml);
        const embeddedAttrs = embedded ? parseXmlAttrs(embedded[1]) : {};
        const rel = slideRels[embeddedAttrs["r:embed"] || attrs["r:link"]];
        const target = rel ? resolveZipPath(slidePath, rel.target) : "";
        const media = target ? zip.file(target) : null;
        const extension = target.split(".").pop()?.toLowerCase();
        const type = mediaTag[1] === "videoFile" ? "video" : "audio";
        const mime =
          type === "video"
            ? (
                { mp4: "video/mp4", webm: "video/webm" } as Record<
                  string,
                  string
                >
              )[extension || ""]
            : (
                {
                  mp3: "audio/mpeg",
                  wav: "audio/wav",
                  ogg: "audio/ogg",
                } as Record<string, string>
              )[extension || ""];
        if (media && mime) {
          const posterTag = /<a:blip\b([^>]*)\/?>/.exec(picXml);
          const posterAttrs = posterTag ? parseXmlAttrs(posterTag[1]) : {};
          const posterRel = slideRels[posterAttrs["r:embed"]];
          const posterFile = posterRel
            ? zip.file(resolveZipPath(slidePath, posterRel.target))
            : null;
          let poster: string | undefined;
          if (posterFile) {
            const bytes = await posterFile.async("uint8array");
            const posterMime = detectImageMime(bytes);
            if (posterMime)
              poster = `data:${posterMime};base64,${uint8ToBase64(bytes)}`;
          }
          rememberShape(picXml);
          elements.push({
            id: crypto.randomUUID(),
            type,
            ...parseTransform(picXml),
            src: `data:${mime};base64,${uint8ToBase64(await media.async("uint8array"))}`,
            alt: target.split("/").pop(),
            ...(poster ? { poster } : {}),
          });
          continue;
        }
      }
      const blips = [...picXml.matchAll(/<a:blip\b([^>]*)\/?>/g)];
      const shapeFill = blips.filter((blip) => {
        const at = blip.index ?? 0;
        return (
          picXml.lastIndexOf("<p:spPr", at) >
          picXml.lastIndexOf("</p:spPr>", at)
        );
      });
      for (const blipMatch of [
        ...shapeFill,
        ...blips.filter((blip) => !shapeFill.includes(blip)),
      ]) {
        const blipAttrs = parseXmlAttrs(blipMatch[1]);
        const rId = blipAttrs["r:embed"] || blipAttrs["r:link"];
        if (!rId || !slideRels[rId]) continue;
        const mediaRelTarget = slideRels[rId].target;
        const mediaZipPath = resolveZipPath(slidePath, mediaRelTarget);
        const mediaFile = zip.file(mediaZipPath);
        if (!mediaFile) continue;
        const imgBytes = await mediaFile.async("uint8array");
        const mime = detectImageMime(imgBytes);
        if (!mime) continue;
        const b64 = uint8ToBase64(imgBytes);
        const nativeFrame =
          blipMatch === blips[0] ? nativeOleFrame(slideXml, picXml) : undefined;
        const nativeDrawing = nativeFrame
          ? await gatherNativeDrawing(zip, slidePath, nativeFrame)
          : undefined;
        const blipEnd = picXml.indexOf("</a:blip>", blipMatch.index);
        const blipXml =
          blipMatch[0].endsWith("/>") || blipEnd < 0
            ? blipMatch[0]
            : picXml.slice(blipMatch.index, blipEnd);
        const svgTag = /<(?:[\w]+:)?svgBlip\b([^>]*)\/?>/.exec(blipXml);
        const svgAttrs = svgTag ? parseXmlAttrs(svgTag[1]) : {};
        const svgRelation = slideRels[svgAttrs["r:embed"]];
        const svgFile = svgRelation
          ? zip.file(resolveZipPath(slidePath, svgRelation.target))
          : null;
        const svgSrc = svgFile
          ? `data:image/svg+xml;base64,${uint8ToBase64(await svgFile.async("uint8array"))}`
          : undefined;
        const layerTag =
          /<a14:imgLayer\b([^>]*)>([\s\S]*?)<\/a14:imgLayer>/.exec(blipXml);
        const layerAttrs = layerTag ? parseXmlAttrs(layerTag[1]) : {};
        const layerRel = slideRels[layerAttrs["r:embed"]];
        const layerFile = layerRel
          ? zip.file(resolveZipPath(slidePath, layerRel.target))
          : null;
        let imageLayer: SlideElement["imageLayer"];
        if (layerFile) {
          const bytes = await layerFile.async("uint8array");
          if (detectImageMime(bytes) === "image/wdp") {
            const removal = /<a14:backgroundRemoval\b([^>]*)/.exec(
              layerTag![2],
            );
            const attrs = removal ? parseXmlAttrs(removal[1]) : {};
            const marks = (kind: string) =>
              [
                ...layerTag![2].matchAll(
                  new RegExp(`<a14:${kind}Mark\\b([^>]*)`, "g"),
                ),
              ].map((match) => {
                const a = parseXmlAttrs(match[1]);
                return {
                  x1: Number(a.x1) || 0,
                  y1: Number(a.y1) || 0,
                  x2: Number(a.x2) || 0,
                  y2: Number(a.y2) || 0,
                };
              });
            imageLayer = {
              src: `data:image/wdp;base64,${uint8ToBase64(bytes)}`,
              ...(removal
                ? {
                    backgroundRemoval: {
                      t: Number(attrs.t) || 0,
                      b: Number(attrs.b) || 0,
                      l: Number(attrs.l) || 0,
                      r: Number(attrs.r) || 0,
                      foregroundMarks: marks("foreground"),
                      backgroundMarks: marks("background"),
                    },
                  }
                : {}),
            };
          }
        }
        const { x, y, width: w, height: h } = parseTransform(nativeFrame || picXml);
        rememberShape(picXml);
        elements.push({
          id: crypto.randomUUID(),
          type: "image",
          x,
          y,
          width: w,
          height: h,
          src: `data:${mime};base64,${b64}`,
          alt: "Slide image",
          ...(svgSrc ? { svgSrc } : {}),
          ...(nativeDrawing ? { nativeDrawing } : {}),
          ...(imageLayer ? { imageLayer } : {}),
        });
      }
    }

    // 5. Parse Tables (<a:tbl>)
    const tblRx = /<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g;
    let gfMatch: RegExpExecArray | null;
    while ((gfMatch = tblRx.exec(slideXml)) !== null) {
      const gfXml = gfMatch[0];
      if (/<c:chart\b/.test(gfXml)) {
        rememberShape(gfXml);
        elements.push({
          id: crypto.randomUUID(),
          type: "shape",
          shapeType: "rect",
          ...parseTransform(gfXml),
          alt: "Native PowerPoint chart",
          nativeDrawing: await gatherNativeDrawing(zip, slidePath, gfXml),
        });
        continue;
      }
      const tblMatch = /<a:tbl\b[\s\S]*?<\/a:tbl>/.exec(gfXml);
      if (tblMatch) {
        const tbl = tblMatch[0];
        const frame = parseTransform(gfXml);
        const cols = [...tbl.matchAll(/<a:gridCol\b[^>]*\bw="(\d+)"/g)].map(
          (match) => Number(match[1]),
        );
        const rows: string[][] = [];
        const cellMarks: { bold?: boolean; italic?: boolean }[][] = [];
        const pictures: {
          xEmu: number;
          yEmu: number;
          wEmu: number;
          hEmu: number;
          src: string;
        }[] = [];
        let yEmu = 0;
        const trRx = /<a:tr\b[\s\S]*?<\/a:tr>/g;
        let trMatch: RegExpExecArray | null;
        while ((trMatch = trRx.exec(tbl)) !== null) {
          const rowXml = trMatch[0];
          const rowH = Number(/<a:tr\b[^>]*\bh="(\d+)"/.exec(rowXml)?.[1] ?? 0);
          const row: string[] = [];
          const marks: { bold?: boolean; italic?: boolean }[] = [];
          let xEmu = 0;
          let col = 0;
          const tcRx = /<a:tc\b[\s\S]*?<\/a:tc>/g;
          let tcMatch: RegExpExecArray | null;
          while ((tcMatch = tcRx.exec(rowXml)) !== null) {
            const cell = tcMatch[0];
            const span = Number(/gridSpan="(\d+)"/.exec(cell)?.[1] ?? 1);
            const wEmu = cols
              .slice(col, col + span)
              .reduce((sum, width) => sum + width, 0);
            const tcPr = /<a:tcPr\b[\s\S]*?<\/a:tcPr>/.exec(cell)?.[0] ?? "";
            for (const blipMatch of tcPr.matchAll(/<a:blip\b([^>]*)\/?>/g)) {
              const blipAttrs = parseXmlAttrs(blipMatch[1]);
              const rId = blipAttrs["r:embed"] || blipAttrs["r:link"];
              if (!rId || !slideRels[rId]) continue;
              const mediaFile = zip.file(
                resolveZipPath(slidePath, slideRels[rId].target),
              );
              if (!mediaFile) continue;
              const imgBytes = await mediaFile.async("uint8array");
              const mime = detectImageMime(imgBytes);
              if (!mime) continue;
              pictures.push({
                xEmu,
                yEmu,
                wEmu,
                hEmu: rowH,
                src: `data:${mime};base64,${uint8ToBase64(imgBytes)}`,
              });
            }
            const cellTx = parseTextBody(cell);
            row.push(cellTx.map((p) => p.text).join("\n"));
            const mark: { bold?: boolean; italic?: boolean } = {};
            if (cellTx.some((paragraph) => paragraph.bold)) mark.bold = true;
            if (cellTx.some((paragraph) => paragraph.italic))
              mark.italic = true;
            marks.push(mark);
            xEmu += wEmu;
            col += span;
          }
          if (row.length > 0) {
            rows.push(row);
            cellMarks.push(marks);
          }
          yEmu += rowH;
        }
        const tableW = cols.reduce((sum, width) => sum + width, 0) || 1;
        const tableH = yEmu || 1;
        for (const picture of pictures) {
          elements.push({
            id: crypto.randomUUID(),
            type: "image",
            x: frame.x + Math.round((picture.xEmu / tableW) * frame.width),
            y: frame.y + Math.round((picture.yEmu / tableH) * frame.height),
            width: Math.max(
              20,
              Math.round((picture.wEmu / tableW) * frame.width),
            ),
            height: Math.max(
              16,
              Math.round((picture.hEmu / tableH) * frame.height),
            ),
            src: picture.src,
            alt: "Slide image",
          });
        }
        if (rows.length > 0) {
          const hasMarks = cellMarks.some((tableRow) =>
            tableRow.some((cell) => cell.bold || cell.italic),
          );
          rememberShape(gfXml);
          elements.push({
            id: crypto.randomUUID(),
            type: "table",
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            rows,
            ...(hasMarks ? { cellMarks } : {}),
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

    let mapped = 0;
    for (const click of readClickAnimations(slideXml)) {
      const index = shapeIndex.get(click.spid);
      const el = index == null ? undefined : elements[index];
      if (!el || el.animation) continue;
      el.animation = click.kind;
      el.animationOrder = click.order;
      mapped += 1;
    }
    const motion = readSlideMotion(slideXml);
    // Import passes visit object kinds separately; restore the source drawing
    // order so tables and pictures retain their position among text boxes.
    let currentOrder = -1;
    const ordered = elements.map((element, index) => {
      currentOrder = elementOrder.get(index) ?? currentOrder;
      return { element, index, order: currentOrder };
    });
    ordered.sort((a, b) => a.order - b.order || a.index - b.index);
    elements.splice(
      0,
      elements.length,
      ...ordered.map(({ element }) => element),
    );
    slides[slideId] = {
      id: slideId,
      title: slideTitle || `Slide ${idx + 1}`,
      background: bgColor ? { color: bgColor } : undefined,
      layout,
      elements,
      notes: notes.trim(),
      ...(motion.transition ? { transition: motion.transition } : {}),
      ...(mapped === 0 && motion.timing ? { timing: motion.timing } : {}),
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
