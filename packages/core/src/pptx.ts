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
import {
  drawingPose,
  fittedLabelSize,
  groupFillXml,
  inheritedLabels,
  inheritedShapes,
  insideFallback,
  placeholderShape,
  placedBox,
  presetTextBox,
  shapeArtwork,
  shapeIsHidden,
  withInheritedFill,
} from "./pptx-geometry";
import { normAutofitFactors } from "./pptx-autofit";
import { retainSharedData } from "./shared-media";
import { exactLineFactor, moveKerningToBoxes, runKern, runTracking } from "./pptx-kerning";
import { diagramElements } from "./pptx-diagrams";
import { readEmbeddedFonts } from "./pptx-fonts";
import {
  bulletPointSize,
  formatAutoNum,
  layoutListRuns,
  symbolBulletFont,
  symbolFontChar,
} from "./pptx-lists";
import { officeSingleSpacing, suiteLeafFont } from "./office-fonts";
import { isSymbolFont, splitSymbolRun } from "./symbol-fonts";
import {
  builtinTableStyle,
  cellMarkUsed,
  explicitTableCell,
  tableLineLayout,
  mergeTableCell,
  tableCellContinues,
  tableFractions,
  tableStyleAt,
  tableStyleById,
  tableStyleEdges,
  tableStyleFlags,
} from "./pptx-table";
import {
  blipOpacity,
  colorChangeDataUrl,
  duotoneSvg,
  applyBlipLuminance,
  jpegWithoutOrientation,
  paintableImage,
  sourceCrop,
  stretchFill,
} from "./pptx-pictures";
import {
  applyThemeOverride,
  backgroundBlip,
  backgroundCss,
  defaultSlideNumberBox,
  duotoneColors,
  paintColor,
  schemeColors,
  themePaint,
} from "./pptx-theme";

/** Video and audio larger than this stay as a poster so a deck of clips can still be drawn. */
const INLINE_MEDIA_LIMIT = 8 * 1024 * 1024;

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

  const defaultTextStyle =
    /<p:defaultTextStyle\b[\s\S]*?<\/p:defaultTextStyle>/.exec(presXml)?.[0] || "";
  const out = createFile("slide", defaultTitle) as SlideFile;
  out.content.width = width;
  out.content.height = height;
  out.content.pointWidth = (emuWidth / 914400) * 72;
  out.content.pointHeight = (emuHeight / 914400) * 72;

  if (slidePaths.length === 0) {
    return out;
  }

  const slides: Record<string, Slide> = {};
  const slideOrder: string[] = [];
  const sharedMedia = new Map<string, string>();
  const tableStylesXml = zip.file("ppt/tableStyles.xml")
    ? await zip.file("ppt/tableStyles.xml")!.async("string")
    : "";

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
    const themeOverride =
      (await readRelatedPart(slidePath, slideRels, "themeOverride")) ||
      (layoutPart
        ? await readRelatedPart(layoutPart.path, layoutPart.rels, "themeOverride")
        : undefined);
    if (themePart && themeOverride)
      themePart.xml = applyThemeOverride(themePart.xml, themeOverride.xml);
    // Office font names become the installed families that lay text out the same way.
    const themeFont = (name: string | undefined) => {
      if (name !== "+mj-lt" && name !== "+mn-lt") return suiteLeafFont(name);
      const kind = name === "+mj-lt" ? "majorFont" : "minorFont";
      const section =
        new RegExp(`<a:${kind}\\b[\\s\\S]*?<\\/a:${kind}>`).exec(
          themePart?.xml || "",
        )?.[0] || "";
      return suiteLeafFont(/<a:latin\b[^>]*typeface="([^"]+)"/.exec(section)?.[1]);
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
    // A slide can swap bg1/tx1 without changing the master. masterClrMapping keeps the master map.
    const colorMap =
      /<a:overrideClrMapping\b[^>]*\/?>/.exec(slideXml)?.[0] ||
      /<a:overrideClrMapping\b[^>]*\/?>/.exec(layoutPart?.xml || "")?.[0] ||
      masterPart?.xml;
    const recolor = (src: string | undefined, xml: string) => {
      if (!src) return;
      const keyed = colorChangeDataUrl(src, xml) ?? src;
      const stops = duotoneColors(
        xml,
        schemeColors(themePart?.xml || "", colorMap),
      );
      return stops ? duotoneSvg(keyed, stops[0], stops[1]) : keyed;
    };
    const bgColor = backgroundCss(themePart?.xml, bgXml, colorMap);

    const slideGroups = (() => {
      const groups: {
        childStart: number;
        end: number;
        ox: number;
        oy: number;
        cx: number;
        cy: number;
        chx: number;
        chy: number;
        chcx: number;
        chcy: number;
      }[] = [];
      const stack: number[] = [];
      const marker = /<p:grpSp\b|<\/p:grpSp>/g;
      let found: RegExpExecArray | null;
      while ((found = marker.exec(slideXml))) {
        if (found[0] === "</p:grpSp>") {
          const start = stack.pop();
          if (start == null) continue;
          const body = slideXml.slice(start, found.index);
          const pr = /<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/.exec(body)?.[0] ?? "";
          const num = (tag: string, attr: string) =>
            Number(
              new RegExp(`<a:${tag}\\b[^>]*\\b${attr}="(-?\\d+)"`).exec(pr)?.[1] ??
                0,
            );
          const prAt = body.indexOf("</p:grpSpPr>");
          groups.push({
            childStart: prAt < 0 ? start : start + prAt,
            end: found.index,
            ox: num("off", "x"),
            oy: num("off", "y"),
            cx: num("ext", "cx") || 1,
            cy: num("ext", "cy") || 1,
            chx: num("chOff", "x"),
            chy: num("chOff", "y"),
            chcx: num("chExt", "cx") || 1,
            chcy: num("chExt", "cy") || 1,
          });
        } else stack.push(found.index);
      }
      return groups;
    })();
    const mapGrouped = (
      emuX: number,
      emuY: number,
      emuW: number,
      emuH: number,
      at: number,
    ) => {
      const chain = slideGroups
        .filter((group) => at >= group.childStart && at < group.end)
        .sort((a, b) => b.childStart - a.childStart);
      for (const group of chain) {
        const sx = group.cx / group.chcx;
        const sy = group.cy / group.chcy;
        emuX = group.ox + (emuX - group.chx) * sx;
        emuY = group.oy + (emuY - group.chy) * sy;
        emuW *= sx;
        emuH *= sy;
      }
      return { emuX, emuY, emuW, emuH };
    };

    // Helper to extract transform. `at` is the shape's index in the slide XML
    // when its own xfrm is in a group's child coordinate space.
    const parseTransform = (xmlChunk: string, at?: number, ownLength?: number) => {
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
          let emuX = parseInt(offAttrs.x, 10) || 0;
          let emuY = parseInt(offAttrs.y, 10) || 0;
          const readEmu = (value: string | undefined) => {
            const parsed = parseInt(value ?? "", 10);
            return Number.isFinite(parsed) ? parsed : 1;
          };
          let emuW = readEmu(extAttrs.cx);
          let emuH = readEmu(extAttrs.cy);
          if (
            at != null &&
            (ownLength == null || xfrmMatch.index < ownLength)
          ) {
            ({ emuX, emuY, emuW, emuH } = mapGrouped(emuX, emuY, emuW, emuH, at));
          }

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
    const softEdgeOf = (xml: string) => {
      const rad = Number(/<a:softEdge\b[^>]*\brad="(\d+)"/.exec(xml)?.[1]);
      if (!(rad > 0)) return {};
      const px = (rad / emuWidth) * width;
      return px > 0.5 ? { softEdge: px } : {};
    };
    const addInheritedImage = async (
      part: typeof ownPart,
      xml: string,
      background = false,
      boxOverride?: { x: number; y: number; width: number; height: number },
    ) => {
      const blip = /<a:blip\b([^>]*)\/?>/.exec(xml);
      if (!blip) return;
      const attrs = parseXmlAttrs(blip[1]);
      const rel = part.rels[attrs["r:embed"]];
      if (!rel) return;
      const image = zip.file(resolveZipPath(part.path, rel.target));
      if (!image) return;
      const bytes = await image.async("uint8array");
      const src = recolor(
        applyBlipLuminance(paintableImage(bytes, detectImageMime(bytes)), xml),
        xml,
      );
      if (!src) return;
      const nativeFrame = nativeOleFrame(part.xml, xml);
      const nativeDrawing = nativeFrame
        ? await gatherNativeDrawing(zip, part.path, nativeFrame)
        : undefined;
      const box = stretchFill(
        xml,
        background
          ? { x: 0, y: 0, width, height }
          : boxOverride || parseTransform(nativeFrame || xml),
      );
      if (!(box.width > 0 && box.height > 0)) return;
      elements.push({
        id: crypto.randomUUID(),
        type: "image",
        ...box,
        ...drawingPose(xml),
        src,
        alt: background ? "Slide background" : "Inherited slide artwork",
        ...softEdgeOf(xml),
        ...sourceCrop(xml),
        ...blipOpacity(xml),
        ...(nativeDrawing ? { nativeDrawing } : {}),
      });
    };
    if (backgroundPart && bgXml) {
      await addInheritedImage(backgroundPart, bgXml, true);
      const themeBg = backgroundBlip(themePart?.xml, bgXml, colorMap);
      const themeRel = themeBg && themePart?.rels[themeBg.embed];
      const themeFile = themeRel
        ? zip.file(resolveZipPath(themePart.path, themeRel.target))
        : null;
      if (themeFile && themeBg) {
        const bytes = await themeFile.async("uint8array");
        let src = paintableImage(bytes, detectImageMime(bytes));
        if (src && themeBg.duotone)
          src = duotoneSvg(src, themeBg.duotone[0], themeBg.duotone[1]);
        if (src)
          elements.push({
            id: crypto.randomUUID(),
            type: "image",
            x: 0,
            y: 0,
            width,
            height,
            src,
            alt: "Slide background",
          });
      }
    }
    // showMasterSp on the slide hides layout shapes (PowerPoint's "hide
    // background graphics"). The same flag on a layout hides only the master.
    const hideLayoutShapes = /<p:sld\b[^>]*\bshowMasterSp="(?:0|false)"/.test(
      slideXml,
    );
    const hideMasterShapes =
      hideLayoutShapes ||
      Boolean(
        layoutPart &&
          /<p:sldLayout\b[^>]*\bshowMasterSp="(?:0|false)"/.test(layoutPart.xml),
      );
    const metrics = { width, height, emuWidth, emuHeight };
    for (const part of layers) {
      if (part === layoutPart && hideLayoutShapes) continue;
      if (part === masterPart && hideMasterShapes) continue;
      const pieces: { at: number; draw: () => Promise<void> }[] = [];
      for (const shape of inheritedShapes(
        part.xml,
        themePart?.xml,
        metrics,
        colorMap,
      )) {
        pieces.push({
          at: shape.at,
          draw: async () => {
            elements.push({ id: crypto.randomUUID(), ...shape.element });
          },
        });
      }
      for (const match of part.xml.matchAll(
        /<p:pic\b[\s\S]*?<\/p:pic>|<p:sp\b[\s\S]*?<\/p:sp>/g,
      )) {
        // Placeholder content is supplied by the slide, rather than inherited.
        if (shapeIsHidden(match[0])) continue;
        if (/<p:ph\b/.test(match[0]) || !/<a:blip\b/.test(match[0])) continue;
        const at = match.index ?? 0;
        const xml = match[0];
        const box = placedBox(part.xml, at, xml, metrics);
        if (!box) continue;
        pieces.push({
          at,
          draw: () => addInheritedImage(part, xml, false, box),
        });
      }
      pieces.sort((a, b) => a.at - b.at);
      for (const piece of pieces) await piece.draw();
    }

    const scheme = schemeColors(themePart?.xml || "", colorMap);

    // Helper to extract text from a txBody
    const parseTextBody = (
      txBodyXml: string,
      inherited: string[] = [],
      defaults?: { color?: string; link?: string },
    ) => {
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
        lineHeight?: number;
        hang?: number;
        listMargin?: number;
        spaceBefore?: number;
        /** Absolute `a:spcPts` spacing; skip the single-spacing grid. */
        exactLine?: boolean;
      }[] = [];
      const autoCounters = new Map<string, { startAt?: number; next: number }>();
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
          defaultTextStyle,
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
        const colorOf = (xml: string) =>
          paintColor(
            /<a:defRPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:defRPr>)/.exec(xml)?.[0] ||
              "",
            scheme,
          );
        const inheritedColor = inherited
          .map(
            (xml) =>
              colorOf(
                new RegExp(
                  `<a:lvl${level}pPr\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/a:lvl${level}pPr>)`,
                ).exec(xml)?.[0] || "",
              ) || "",
          )
          .filter((color) => color)
          .at(-1);
        const ownList =
          /<a:lstStyle\b[\s\S]*?<\/a:lstStyle>/.exec(txBodyXml)?.[0] || "";
        const ownColor = [
          colorOf(
            new RegExp(
              `<a:lvl${level}pPr\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/a:lvl${level}pPr>)`,
            ).exec(ownList)?.[0] || "",
          ),
          colorOf(pPrMatch?.[0] || ""),
        ]
          .filter((color): color is string => Boolean(color))
          .at(-1);
        // The shape's own list colour, then its fontRef, then the master style.
        // otherStyle's tx1 must not cover a light fontRef on a coloured shape.
        const defaultColor = ownColor || defaults?.color || inheritedColor;
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
        const bulletChar = /<a:buChar\b[^>]*\bchar="([^"]*)"/.exec(bulletStyle)?.[1];
        const keepWords = pAttrs.latinLnBrk === "0" || pAttrs.latinLnBrk === "false";
        const spacing = styleParts.join("");
        const linePct = /<a:lnSpc>\s*<a:spcPct\b[^>]*\bval="(\d+)"/.exec(spacing);
        const linePts = /<a:lnSpc>\s*<a:spcPts\b[^>]*\bval="(\d+)"/.exec(spacing);

        let pText = "";
        const textRuns: TextRun[] = [];
        let isBold = false;
        let isItalic = false;
        let isUnderline = false;
        let fontSize: number | undefined = defaultRunAttrs.sz
          ? Number(defaultRunAttrs.sz) / 100
          : undefined;
        // A list default must not keep the box larger than a run that sets sz.
        // The box font is the CSS strut, so a 24pt default clips 10pt lines.
        let sizedRun = false;
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
          // The a:sym face of a run's private-use characters, which the rest of its text is not in.
          let symbolChars: string | undefined;
          const tMatch = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/.exec(rXml);
          const slideField =
            /^<a:fld\b/.test(rXml) && /type="slidenum"/.test(rXml);
          if (tMatch || slideField) {
            const latinFace = /<a:latin\s+typeface="([^"]+)"/.exec(rXml)?.[1];
            const symFace = /<a:sym\b[^>]*\btypeface="([^"]+)"/.exec(rXml)?.[1];
            const t = slideField
              ? String(idx + 1)
              : decodeXmlEntities(tMatch?.[1] || "").replace(/\r\n?/g, "\n");
            // Symbol fonts draw codes, not Unicode: the text keeps them, in the SuiteLeaf face. `a:sym`
            // names the face of the run's private-use characters only.
            if (isSymbolFont(latinFace)) run.font = suiteLeafFont(latinFace);
            else if (isSymbolFont(symFace) && /[\uF000-\uF0FF]/.test(t)) symbolChars = suiteLeafFont(symFace);
            pText += t;
            run.text = t;
          }
          const rPrMatch = /<a:rPr\b([^>]*)>/.exec(rXml);
          {
            // List styles often set u="none". That must not hide a hyperlink;
            // only the run's own underline="none" turns the link style off.
            const ownAttrs = rPrMatch ? parseXmlAttrs(rPrMatch[1]) : {};
            const rAttrs = {
              ...defaultRunAttrs,
              ...ownAttrs,
            };
            if (rAttrs.b === "1" || rAttrs.b === "true") isBold = true;
            run.bold = rAttrs.b === "1" || rAttrs.b === "true";
            run.italic = rAttrs.i === "1" || rAttrs.i === "true";
            run.underline = Boolean(rAttrs.u && rAttrs.u !== "none");
            if (rAttrs.i === "1" || rAttrs.i === "true") isItalic = true;
            if (rAttrs.u && rAttrs.u !== "none") isUnderline = true;
            const ownSz = rPrMatch ? parseXmlAttrs(rPrMatch[1]).sz : undefined;
            const szSource = ownSz || rAttrs.sz;
            if (szSource) {
              const szPt = parseInt(szSource, 10) / 100;
              if (szPt > 0 && szPt < 400) {
                run.fontSize = szPt;
                if (ownSz && !sizedRun) {
                  fontSize = szPt;
                  sizedRun = true;
                } else if (fontSize === undefined) fontSize = szPt;
              }
            }
            if (rAttrs.cap === "small" || rAttrs.cap === "all") run.caps = rAttrs.cap;
            const kern = runKern(rAttrs.kern);
            if (kern !== undefined) run.kern = kern;
            const tracking = runTracking(rAttrs.spc);
            if (tracking !== undefined) run.tracking = tracking;
            if (rAttrs.baseline) {
              const shift = Number(rAttrs.baseline) / 1000;
              if (shift) run.baseline = Math.max(-1000, Math.min(1000, shift));
            }
            const latinMatch = /<a:latin\s+typeface="([^"]+)"/.exec(rXml);
            if (latinMatch && !isSymbolFont(latinMatch[1]))
              fontFamily = themeFont(latinMatch[1]);
            const highlightXml =
              /<a:highlight\b[\s\S]*?<\/a:highlight>/.exec(rXml)?.[0] || "";
            const colorXml = highlightXml ? rXml.replace(highlightXml, "") : rXml;
            const resolved = paintColor(colorXml, scheme);
            if (highlightXml) {
              const painted = paintColor(highlightXml, scheme);
              if (painted) run.highlight = painted;
            }
            if (resolved) {
              run.color = resolved;
              if (!fontColor) fontColor = run.color;
            } else if (defaultColor) run.color = defaultColor;
            else if (defaults?.color) run.color = defaults.color;
            if (/<a:hlinkClick\b/.test(rXml)) {
              if (ownAttrs.u !== "none") {
                run.underline = true;
                isUnderline = true;
              }
              if (defaults?.link && !resolved) {
                run.color = defaults.link;
                if (!fontColor || fontColor === defaults.color)
                  fontColor = defaults.link;
              }
            }
          }
          if (keepWords && run.text && run.text !== "\n") run.unbroken = true;
          if (run.text) textRuns.push(...(symbolChars ? splitSymbolRun(run, symbolChars) : [run]));
        }
        const rightTab = /<a:tab\b[^>]*\balgn="r"/.test(pPrMatch?.[0] || "");
        if (rightTab && /^\t[^\t]*$/.test(pText)) {
          align = "right";
          pText = pText.slice(1);
          const tabbed = textRuns.find((run) => run.text.startsWith("\t"));
          if (tabbed) tabbed.text = tabbed.text.replace(/^\t/, "");
        }
        const autoTag = /<a:buAutoNum\b([^>]*)\/?>/.exec(bulletStyle);
        if (pText && !autoTag) {
          for (const key of autoCounters.keys()) {
            if (key.startsWith(`${level}:`)) autoCounters.delete(key);
          }
        }
        if (autoTag && pText) {
          const attrs = parseXmlAttrs(autoTag[1]);
          const kind = attrs.type || "arabicPeriod";
          const startAt = attrs.startAt ? Number(attrs.startAt) : undefined;
          const key = `${level}:${kind}`;
          let sequence = autoCounters.get(key);
          if (
            !sequence ||
            (startAt !== undefined && startAt !== sequence.startAt)
          ) {
            sequence = {
              startAt,
              next: startAt && startAt > 0 ? startAt : 1,
            };
            autoCounters.set(key, sequence);
          }
          const marker = `${formatAutoNum(kind, sequence.next)} `;
          sequence.next += 1;
          pText = marker + pText;
          const first = textRuns.find((run) => run.text && run.text !== "\n");
          if (first) first.text = marker + first.text;
        }
        if (bulletChar && pText) {
          const symbolFace = symbolBulletFont(
            /<a:buFont\b[^>]*\btypeface="([^"]*)"/.exec(bulletStyle)?.[1],
          );
          const rawBullet = decodeXmlEntities(bulletChar);
          const marker = `${symbolFace ? symbolFontChar(rawBullet) : rawBullet} `;
          pText = marker + pText;
          const symbol = suiteLeafFont(symbolFace);
          const bulletSize = bulletPointSize(
            fontSize,
            /<a:buSzPct\b[^>]*\bval="(\d+)"/.exec(bulletStyle)?.[1],
          );
          const bulletColor = paintColor(
            /<a:buClr\b[\s\S]*?<\/a:buClr>/.exec(bulletStyle)?.[0] || "",
            scheme,
          );
          const first = textRuns.find((run) => run.text && run.text !== "\n");
          if (symbol || bulletSize || bulletColor) {
            const bulletRun: TextRun = {
              text: marker,
              ...(symbol ? { font: symbol } : {}),
              ...(bulletSize ? { fontSize: bulletSize } : {}),
              ...(bulletColor ? { color: bulletColor } : {}),
            };
            const at = first ? textRuns.indexOf(first) : textRuns.length;
            textRuns.splice(at, 0, bulletRun);
          } else if (first) first.text = marker + first.text;
        }

        {
          const indent = Number(pAttrs.indent || 0);
          const margin = Number(pAttrs.marL || 0);
          const px = (emu: number) => (emu / emuWidth) * width;
          const hang = indent < 0 ? px(-indent) : undefined;
          const firstLine = margin + Math.min(0, indent);
          const beforePts = /<a:spcBef>\s*<a:spcPts\b[^>]*\bval="(\d+)"/.exec(
            spacing,
          );
          const spaceBefore = beforePts
            ? ((Number(beforePts[1]) / 100) / 72) * (width / (emuWidth / 914400))
            : undefined;
          paragraphs.push({
            text: pText,
            runs: textRuns.filter((run) => run.text),
            bullet: hasBullet,
            bold: isBold,
            italic: isItalic,
            underline: isUnderline,
            size: fontSize,
            align,
            color: fontColor,
            font: fontFamily,
            ...(hang ? { hang } : {}),
            ...(firstLine > 0 ? { listMargin: px(firstLine) } : {}),
            ...(spaceBefore ? { spaceBefore } : {}),
            ...(linePts && exactLineFactor(linePts[1], fontSize || 18)
              ? {
                  lineHeight: exactLineFactor(linePts[1], fontSize || 18),
                  exactLine: true,
                }
              : linePct
                ? { lineHeight: Math.min(4, Math.max(0.5, Number(linePct[1]) / 100000)) }
                : {}),
          });
        }
      }
      const fit = normAutofitFactors(txBodyXml);
      if (fit.font !== 1 || fit.line !== 1) {
        for (const paragraph of paragraphs) {
          if (paragraph.size) paragraph.size *= fit.font;
          if (fit.line !== 1) {
            const base = paragraph.lineHeight ?? 1;
            paragraph.lineHeight = Math.min(4, Math.max(0.5, base * fit.line));
          }
          for (const run of paragraph.runs) {
            if (run.fontSize) run.fontSize *= fit.font;
          }
        }
      }
      return paragraphs;
    };

    for (const part of layers) {
      if (part === layoutPart && hideLayoutShapes) continue;
      if (part === masterPart && hideMasterShapes) continue;
      for (const label of inheritedLabels(part.xml, metrics)) {
        const paragraphs = parseTextBody(label.txBody);
        if (!paragraphs.some((paragraph) => paragraph.text.trim())) continue;
        const first = paragraphs[0];
        const content = paragraphs.map((paragraph) => paragraph.text).join("\n");
        const declared = first?.size || 18;
        const fontSize = fittedLabelSize(
          content,
          declared,
          label.width,
          label.height,
          !!label.nowrap,
        );
        const scale = declared > 0 ? fontSize / declared : 1;
        elements.push({
          id: crypto.randomUUID(),
          type: "text",
          x: label.x,
          y: label.y,
          width: label.width,
          height: label.height,
          content,
          runs: paragraphs.flatMap((paragraph, index) => [
            ...(index ? [{ text: "\n", paragraphBreak: true as const }] : []),
            ...paragraph.runs.map((run) =>
              scale < 0.999 && run.fontSize
                ? { ...run, fontSize: run.fontSize * scale }
                : run,
            ),
          ]),
          bold: first?.bold,
          italic: first?.italic,
          ...(first?.underline ? { underline: true } : {}),
          fontSize,
          fontFamily: first?.font || "Arial",
          color: first?.color || "#1e293b",
          align: first?.align || "left",
          bullet: paragraphs.some((paragraph) => paragraph.bullet),
          ...(label.valign ? { valign: label.valign } : {}),
          ...(label.inset != null ? { inset: label.inset } : {}),
          ...(label.padLeft != null ? { padLeft: label.padLeft } : {}),
          ...(label.padRight != null ? { padRight: label.padRight } : {}),
          ...(label.padBottom != null ? { padBottom: label.padBottom } : {}),
          lineHeight: officeSingleSpacing(first?.font || "Arial") * (first?.lineHeight ?? 1),
          ...(label.nowrap ? { nowrap: true } : {}),
          ...(label.autofit ? { autofit: true } : {}),
          ...(label.rotation ? { rotation: label.rotation } : {}),
        });
      }
    }

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
        const src = recolor(
          applyBlipLuminance(paintableImage(imgBytes, detectImageMime(imgBytes)), grpPr),
          grpPr,
        );
        const { x, y, width: w, height: h } = stretchFill(grpPr, parseTransform(grpPr));
        if (!src || !(w > 0 && h > 0)) continue;
        elements.push({
          id: crypto.randomUUID(),
          type: "image",
          x,
          y,
          width: w,
          height: h,
          src,
          alt: "Slide image",
          ...softEdgeOf(grpPr),
          ...sourceCrop(grpPr),
          ...blipOpacity(grpPr),
        });
      }
    }

    // 3. Parse Shapes (<p:sp>)
    const hfShown = (xml: string | undefined, name: string) => {
      const tag = xml ? /<p:hf\b([^>]*)\/?>/.exec(xml) : undefined;
      if (!tag) return undefined;
      const value = parseXmlAttrs(tag[1])[name];
      if (value == null) return undefined;
      return value !== "0" && value !== "false";
    };
    // A slide flag wins, then the layout, then the master. Absent means show.
    const slideNumberShown =
      hfShown(slideXml, "sldNum") ??
      hfShown(layoutPart?.xml, "sldNum") ??
      hfShown(masterPart?.xml, "sldNum");
    const hideSlideNumber = slideNumberShown === false;
    let sawSlideNumber = false;
    const spRx = /<p:sp\b[\s\S]*?<\/p:sp>/g;
    let spMatch: RegExpExecArray | null;
    while ((spMatch = spRx.exec(slideXml)) !== null) {
      if (insideFallback(slideXml, spMatch.index ?? 0)) continue;
      const spXml = spMatch[0];
      if (shapeIsHidden(spXml)) continue;
      const phMatch = /<p:ph\b([^>]*)\/?>/.exec(spXml);
      let phType = "";
      if (phMatch) {
        phType = parseXmlAttrs(phMatch[1]).type || "body";
      }

      const layoutPlaceholder = placeholderShape(layoutPart?.xml, spXml);
      const masterPlaceholder = placeholderShape(masterPart?.xml, spXml);
      const masterStyleKind =
        phType === "title" || phType === "ctrTitle"
          ? "titleStyle"
          : phType === "body"
            ? "bodyStyle"
            : "otherStyle";
      // otherStyle belongs to footer-style placeholders. A free text box uses
      // p:defaultTextStyle, which is already the base of parseTextBody.
      const masterStyle = phMatch
        ? new RegExp(
            `<p:${masterStyleKind}\\b[\\s\\S]*?<\\/p:${masterStyleKind}>`,
          ).exec(masterPart?.xml || "")?.[0] || ""
        : "";
      const txBodyMatch = /<p:txBody\b[\s\S]*?<\/p:txBody>/.exec(spXml);
      const spPr = /<p:spPr\b[\s\S]*?<\/p:spPr>/.exec(spXml)?.[0] ?? "";
      const {
        x,
        y,
        width: w,
        height: h,
      } = parseTransform(
        spXml + layoutPlaceholder + masterPlaceholder,
        spMatch.index,
        spXml.length,
      );

      const groupFill = /<a:grpFill\b/.test(spXml)
        ? groupFillXml(slideXml, spMatch.index ?? 0)
        : "";
      const filled = withInheritedFill(
        spXml,
        layoutPlaceholder,
        masterPlaceholder,
      );
      const paint = themePaint(
        themePart?.xml,
        groupFill ? filled.replace(/<a:grpFill\b[^>]*\/>/, groupFill) : filled,
        colorMap,
      );
      const fillColor = paint.fill;
      const bodyAttrs: Record<string, string> = {};
      for (const source of [masterPlaceholder, layoutPlaceholder, spXml]) {
        const tag = /<a:bodyPr\b([^>]*)\/?>/.exec(source || "");
        if (tag) Object.assign(bodyAttrs, parseXmlAttrs(tag[1]));
      }
      const hasBody = [masterPlaceholder, layoutPlaceholder, spXml].some((source) =>
        /<a:bodyPr\b/.test(source || ""),
      );
      const valign =
        bodyAttrs.anchor === "ctr"
          ? "middle"
          : bodyAttrs.anchor === "b"
            ? "bottom"
            : undefined;
      const insetDefault = (name: string) =>
        name === "tIns" || name === "bIns" ? 45720 : 91440;
      const insetOf = (name: string) =>
        ((Number(bodyAttrs[name] ?? insetDefault(name)) || 0) / emuWidth) * width;
      const pad = hasBody
        ? {
            t: insetOf("tIns"),
            r: insetOf("rIns"),
            b: insetOf("bIns"),
            l: insetOf("lIns"),
          }
        : undefined;
      const positioned = /<(?:a|p):off\b/.test(
        spXml + layoutPlaceholder + masterPlaceholder,
      );
      const at =
        phType === "sldNum" && !positioned
          ? defaultSlideNumberBox(width, height)
          : { x, y, width: w, height: h };
      let painted = false;
      const art =
        fillColor || paint.stroke
          ? shapeArtwork(
              filled,
              paint,
              { x: at.x, y: at.y, width: at.width, height: at.height },
              { width, emuWidth },
            )
          : undefined;
      if (art) {
        rememberShape(spXml);
        elements.push({ id: crypto.randomUUID(), ...art });
        painted = true;
      }

      let addedText = false;
      const wantsNumber = phType === "sldNum" && !hideSlideNumber;
      if (txBodyMatch) {
        const paragraphs = parseTextBody(
          txBodyMatch[0],
          [masterStyle, masterPlaceholder, layoutPlaceholder],
          { color: paint.fontColor, link: paint.linkColor },
        );
        if (
          paragraphs.some((paragraph) => paragraph.text.trim()) ||
          wantsNumber
        ) {
          // A slide-number field is already the page number. Keep the date and
          // other runs that share its placeholder instead of dropping them.
          const synthesized =
            wantsNumber && paragraphs.every((paragraph) => !paragraph.text.trim());
          const fullText = synthesized
            ? String(idx + 1)
            : paragraphs.map((p) => p.text).join("\n");
          if (wantsNumber) sawSlideNumber = true;
          if (
            !slideTitle &&
            (phType === "title" ||
              phType === "ctrTitle" ||
              (idx === 0 && at.y < height * 0.35))
          ) {
            slideTitle = fullText;
          }

          const first = paragraphs[0];
          const laid = layoutListRuns(paragraphs);
          const hang = laid.hang;
          const listMargin = laid.listMargin;
          rememberShape(spXml);
          // A flipped shape mirrors its outline. PowerPoint keeps the letters upright.
          const { rotation } = drawingPose(spXml);
          const pose = rotation ? { rotation } : {};
          const fit = normAutofitFactors(txBodyMatch[0]);
          const textAt = presetTextBox(spXml, at) ?? at;
          const declared =
            first?.size ||
            (phType === "title" || phType === "ctrTitle"
              ? 36
              : wantsNumber
                ? 12
                : 18);
          elements.push({
            id: crypto.randomUUID(),
            type: "text",
            x: textAt.x,
            y: textAt.y,
            width: textAt.width,
            height: textAt.height,
            ...pose,
            content: fullText,
            runs: synthesized ? [{ text: fullText }] : laid.runs,
            bold: first?.bold,
            italic: first?.italic,
            ...(first?.underline ? { underline: true } : {}),
            fontSize: first?.size ? declared : declared * fit.font,
            fontFamily: first?.font || "Arial",
            color: first?.color || paint.fontColor || "#1e293b",
            align: first?.align || (wantsNumber ? "right" : "left"),
            bullet: paragraphs.some((p) => p.bullet),
            ...(!painted && fillColor ? { fill: fillColor } : {}),
            ...(valign ? { valign } : {}),
            ...(pad
              ? {
                  inset: pad.t,
                  padLeft: pad.l + listMargin,
                  ...(pad.r !== pad.l ? { padRight: pad.r } : {}),
                  ...(pad.b !== pad.t ? { padBottom: pad.b } : {}),
                }
              : listMargin
                ? { padLeft: listMargin }
                : {}),
            ...(hang ? { hang } : {}),
            lineHeight: first?.exactLine
              ? first.lineHeight
              : officeSingleSpacing(first?.font || "Arial") * (first?.lineHeight ?? fit.line),
            ...(bodyAttrs.wrap === "none" ? { nowrap: true } : {}),
            ...(/<a:spAutoFit\b/.test(txBodyMatch[0]) ? { autofit: true } : {}),
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
            const src = recolor(
              applyBlipLuminance(paintableImage(imgBytes, detectImageMime(imgBytes)), spPr),
              spPr,
            );
            if (src) {
              blipHandled = true;
              const filled = stretchFill(spPr, { x, y, width: w, height: h });
              if (filled.width > 0 && filled.height > 0)
                elements.push({
                  id: crypto.randomUUID(),
                  type: "image",
                  x: filled.x,
                  y: filled.y,
                  width: filled.width,
                  height: filled.height,
                  src,
                  alt: "Shape image fill",
                  ...softEdgeOf(spPr),
                  ...sourceCrop(spPr),
                  ...blipOpacity(spPr),
                });
            }
          }
        }
      }

      const fillHost = spPr.replace(/<a:ln\b[\s\S]*?<\/a:ln>/g, "");
      const invisible = /<a:noFill\b/.test(fillHost);
      // A shape with no fill and no style is empty. Do not invent a grey box.
      if (!addedText && !blipHandled && !painted && !invisible && fillColor) {
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
            fill: fillColor,
          });
        }
      }
    }

    const seenConnectors = new Set<string>();
    for (const match of slideXml.matchAll(/<p:cxnSp\b[\s\S]*?<\/p:cxnSp>/g)) {
      const xml = match[0];
      if (shapeIsHidden(xml)) continue;
      const id = parseXmlAttrs(/<p:cNvPr\b([^>]*)/.exec(xml)?.[1] || "").id;
      if (id && seenConnectors.has(id)) continue;
      if (id) seenConnectors.add(id);
      const paint = themePaint(themePart?.xml, xml, colorMap);
      if (!paint.stroke && !paint.fill) continue;
      const pos = parseTransform(xml, match.index, xml.length);
      const xfrm = parseXmlAttrs(/<(?:a|p):xfrm\b([^>]*)>/.exec(xml)?.[1] || "");
      const arrow = /<a:(?:head|tail)End\b[^>]*\btype="(?!none)[^"]*"/.test(xml);
      rememberShape(xml);
      elements.push({
        id: crypto.randomUUID(),
        type: "shape",
        ...pos,
        shapeType: arrow ? "arrow" : "line",
        fill: "transparent",
        stroke: paint.stroke || "#1e293b",
        strokeWidth: paint.strokeEmu ? (paint.strokeEmu / emuWidth) * width : 1,
        ...(xfrm.flipH === "1" || xfrm.flipH === "true" ? { flipH: true } : {}),
        ...(xfrm.flipV === "1" || xfrm.flipV === "true" ? { flipV: true } : {}),
      });
    }
    if (!hideSlideNumber && !sawSlideNumber) {
      const numberShape = (xml?: string) =>
        xml
          ? [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)]
              .map((item) => item[0])
              .find((shape) => /<p:ph\b[^>]*\btype="sldNum"/.test(shape))
          : undefined;
      const numberIndex = (shape: string | undefined) =>
        shape
          ? (parseXmlAttrs(/<p:ph\b([^>]*)\/?>/.exec(shape)?.[1] || "").idx ?? "0")
          : undefined;
      const layoutNumber = numberShape(layoutPart?.xml);
      const masterNumber = numberShape(masterPart?.xml);
      // A layout that omits the slide-number placeholder hides the master's.
      const inherited = layoutNumber
        ? /<(?:a|p):off\b/.test(layoutNumber)
          ? layoutNumber
          : numberIndex(masterNumber) === numberIndex(layoutNumber)
            ? masterNumber
            : undefined
        : undefined;
      if (inherited && /<(?:a|p):off\b/.test(inherited)) {
        const at = parseTransform(inherited);
        elements.push({
          id: crypto.randomUUID(),
          type: "text",
          ...at,
          content: String(idx + 1),
          runs: [{ text: String(idx + 1) }],
          fontSize: 12,
          fontFamily: "Arial",
          color: paintColor(inherited, scheme) || "#1e293b",
          align: "right",
          lineHeight: officeSingleSpacing("Arial"),
        });
      }
    }

    // 4. Parse Pictures (<p:pic>)
    const picRx = /<p:pic\b[\s\S]*?<\/p:pic>/g;
    let picMatch: RegExpExecArray | null;
    while ((picMatch = picRx.exec(slideXml)) !== null) {
      const picXml = picMatch[0];
      if (shapeIsHidden(picXml)) continue;
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
          const mediaBytes = await media.async("uint8array");
          const src =
            mediaBytes.byteLength <= INLINE_MEDIA_LIMIT
              ? `data:${mime};base64,${uint8ToBase64(mediaBytes)}`
              : undefined;
          if (!src && !poster) continue;
          rememberShape(picXml);
          elements.push({
            id: crypto.randomUUID(),
            type,
            ...parseTransform(picXml, picMatch.index, picXml.length),
            ...(src ? { src } : {}),
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
        // A rotated JPEG keeps its pixels. Clearing EXIF stops the browser
        // applying that turn again on top of the shape rotation.
        const pictureBytes =
          mime === "image/jpeg" && drawingPose(picXml).rotation
            ? jpegWithoutOrientation(imgBytes)
            : imgBytes;
        // An EMF the browser cannot paint keeps its bytes so export writes the same picture.
        const src =
          recolor(applyBlipLuminance(paintableImage(pictureBytes, mime), picXml), picXml) ??
          (mime === "image/emf" ? `data:image/emf;base64,${uint8ToBase64(imgBytes)}` : undefined);
        if (!src) continue;
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
        const layoutHost = placeholderShape(layoutPart?.xml, picXml);
        const masterHost = placeholderShape(masterPart?.xml, picXml);
        const hosted = (xml: string) => (/<(?:a|p):off\b/.test(xml) ? xml : "");
        const host = /<(?:a|p):off\b/.test(picXml)
          ? ""
          : hosted(layoutHost) || hosted(masterHost) || layoutHost || masterHost;
        const frame = host ? picXml + host : picXml;
        const { x, y, width: w, height: h } = stretchFill(
          picXml,
          nativeFrame
            ? parseTransform(nativeFrame)
            : parseTransform(frame, picMatch.index, picXml.length),
        );
        if (!(w > 0 && h > 0)) continue;
        rememberShape(picXml);
        elements.push({
          id: crypto.randomUUID(),
          type: "image",
          x,
          y,
          width: w,
          height: h,
          ...drawingPose(nativeFrame || frame),
          ...softEdgeOf(picXml),
          src,
          alt: "Slide image",
          ...sourceCrop(picXml),
          ...blipOpacity(picXml),
          ...(svgSrc ? { svgSrc } : {}),
          ...(nativeDrawing ? { nativeDrawing } : {}),
          ...(imageLayer ? { imageLayer } : {}),
        });
      }
    }

    // 5. Parse Tables (<a:tbl>)
    const tblRx = /<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g;
    let gfMatch: RegExpExecArray | null;
    let diagramIndex = 0;
    while ((gfMatch = tblRx.exec(slideXml)) !== null) {
      const gfXml = gfMatch[0];
      if (/<dgm:relIds\b/.test(gfXml)) {
        rememberShape(gfXml);
        const drawn = await diagramElements(
          zip,
          slidePath,
          slideRels,
          gfXml,
          diagramIndex,
          metrics,
          themePart?.xml,
          colorMap,
          parseTextBody,
        );
        diagramIndex += 1;
        for (const element of drawn)
          elements.push({ id: crypto.randomUUID(), ...element });
        continue;
      }
      if (/<c:chart\b/.test(gfXml)) {
        rememberShape(gfXml);
        elements.push({
          id: crypto.randomUUID(),
          type: "shape",
          shapeType: "rect",
          ...parseTransform(gfXml, gfMatch.index, gfXml.length),
          alt: "Native PowerPoint chart",
          nativeDrawing: await gatherNativeDrawing(zip, slidePath, gfXml),
        });
        continue;
      }
      const tblMatch = /<a:tbl\b[\s\S]*?<\/a:tbl>/.exec(gfXml);
      if (tblMatch) {
        const tbl = tblMatch[0];
        const frame = parseTransform(gfXml, gfMatch.index, gfXml.length);
        const cols = [...tbl.matchAll(/<a:gridCol\b[^>]*\bw="(\d+)"/g)].map(
          (match) => Number(match[1]),
        );
        const rows: string[][] = [];
        const cellMarks: ReturnType<typeof explicitTableCell>[][] = [];
        const pictures: {
          xEmu: number;
          yEmu: number;
          wEmu: number;
          hEmu: number;
          src: string;
        }[] = [];
        let yEmu = 0;
        const rowEmu: number[] = [];
        const trRx = /<a:tr\b[\s\S]*?<\/a:tr>/g;
        let trMatch: RegExpExecArray | null;
        while ((trMatch = trRx.exec(tbl)) !== null) {
          const rowXml = trMatch[0];
          const rowH = Number(/<a:tr\b[^>]*\bh="(\d+)"/.exec(rowXml)?.[1] ?? 0);
          const row: string[] = [];
          const marks: ReturnType<typeof explicitTableCell>[] = [];
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
            if (tableCellContinues(cell)) {
              xEmu += wEmu;
              col += span;
              continue;
            }
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
              const src = recolor(
                applyBlipLuminance(paintableImage(imgBytes, detectImageMime(imgBytes)), cell),
                cell,
              );
              if (!src) continue;
              pictures.push({
                xEmu,
                yEmu,
                wEmu,
                hEmu: rowH,
                src,
              });
            }
            const cellTx = parseTextBody(cell);
            row.push(cellTx.map((p) => p.text).join("\n"));
            const laid = explicitTableCell(cell, cellTx, (xml) =>
              paintColor(xml, scheme),
            );
            const lines = tableLineLayout(cellTx);
            if (lines) laid.lines = lines;
            marks.push(laid);
            xEmu += wEmu;
            col += span;
          }
          if (row.length > 0) {
            rows.push(row);
            cellMarks.push(marks);
            rowEmu.push(rowH);
          }
          yEmu += rowH;
        }
        const styleId =
          /<a:tableStyleId>([^<]*)<\/a:tableStyleId>/.exec(tbl)?.[1] ?? "";
        const styleXml =
          tableStyleById(tableStylesXml, styleId) ?? builtinTableStyle(styleId);
        const flags = tableStyleFlags(tbl);
        const paint = (xml: string) => paintColor(xml, scheme);
        const styledMarks = cellMarks.map((tableRow, rowIndex) => {
          let grid = 0;
          return tableRow.map((cell) => {
            const colCount = cols.length || grid + (cell.colSpan ?? 1);
            const styled = styleXml
              ? tableStyleAt(
                  styleXml,
                  flags,
                  rowIndex,
                  grid,
                  rows.length,
                  colCount,
                  paint,
                )
              : undefined;
            const edges = styleXml
              ? tableStyleEdges(
                  styleXml,
                  flags,
                  rowIndex,
                  grid,
                  rows.length,
                  colCount,
                  paint,
                )
              : undefined;
            grid += cell.colSpan ?? 1;
            return mergeTableCell(cell, styled, undefined, edges);
          });
        });
        const tableW = cols.reduce((sum, width) => sum + width, 0) || 1;
        // Fractions are of the frame. Dividing by the row sum stretches every
        // line when the frame is taller than the rows.
        const frameCy = Number(
          /<(?:a|p):ext\b[^>]*\bcy="(\d+)"/.exec(
            /<(?:a|p):xfrm\b[\s\S]*?<\/(?:a|p):xfrm>/.exec(gfXml)?.[0] ?? "",
          )?.[1] ?? 0,
        );
        const tableH = frameCy > 0 ? frameCy : yEmu || 1;
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
          const hasMarks = styledMarks.some((tableRow) =>
            tableRow.some((cell) => cellMarkUsed(cell)),
          );
          const colWidths = tableFractions(cols);
          const rowHeights =
            tableH > 0 ? rowEmu.map((height) => height / tableH) : undefined;
          const minorFont = themeFont("+mn-lt");
          rememberShape(gfXml);
          elements.push({
            id: crypto.randomUUID(),
            type: "table",
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            rows,
            ...(minorFont ? { fontFamily: minorFont } : {}),
            ...(colWidths ? { colWidths } : {}),
            ...(rowHeights ? { rowHeights } : {}),
            ...(hasMarks ? { cellMarks: styledMarks } : {}),
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
    moveKerningToBoxes(elements);
    retainSharedData(elements, sharedMedia);
    const hidden = /<p:sld\b[^>]*\bshow="(?:0|false)"/.test(slideXml);
    slides[slideId] = {
      id: slideId,
      title: slideTitle || `Slide ${idx + 1}`,
      background: bgColor ? { color: bgColor } : undefined,
      layout,
      elements,
      notes: notes.trim(),
      ...(hidden ? { hidden: true } : {}),
      ...(motion.transition ? { transition: motion.transition } : {}),
      ...(mapped === 0 && motion.timing ? { timing: motion.timing } : {}),
    };
    slideOrder.push(slideId);
  }

  out.content.slides = slides;
  out.content.slideOrder = slideOrder;
  const fonts = await readEmbeddedFonts(zip);
  if (fonts.length) out.content.fonts = fonts;
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
