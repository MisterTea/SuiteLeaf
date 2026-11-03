import JSZip from "jszip";
import * as CFB from "cfb";
import {
  createFile,
  type SlideFile,
  type Slide,
  type SlideElement,
  type TextRun,
} from "./index";
import { assignClickAnimations, readSlideMotion, shapeGroupAncestors } from "./slide-motion";
import { readingOrderIds } from "./pptx-reading-order";
import { gatherNativeDrawing } from "./pptx-native-objects";
import {
  composeRotation,
  mapThroughGroups,
  placeGroupedBox,
  readGroups,
} from "./pptx-group-xform";
import {
  drawingPose,
  readableTextRotation,
  fittedLabelSize,
  groupFillXml,
  inheritedLabels,
  inheritedShapes,
  insideFallback,
  insideHiddenGroup,
  repeatsSlideBackground,
  placeholderShape,
  placedBox,
  presetTextBox,
  shapeArtwork,
  shapeIsHidden,
  verticalTextFlow,
  withInheritedFill,
} from "./pptx-geometry";
import { outerShadow } from "./pptx-run-paint";
import { normAutofitFactors } from "./pptx-autofit";
import { withInheritedGeometry, withInheritedOutline } from "./pptx-placeholder-outline";
import { retainSharedData } from "./shared-media";
import {
  exactLineFactor,
  lastLineSpacing,
  moveKerningToBoxes,
  paragraphGapPoints,
  runKern,
  runTracking,
} from "./pptx-kerning";
import { hyperlinkUsesTextColor, inheritedHyperlink } from "./pptx-hyperlink";
import {
  emptyParagraphPointSize,
  paragraphMarkPointSize,
  trailingBreakIsShorterMark,
} from "./pptx-paragraph-mark";
import { zipFromLocalHeaders } from "./zip-local";
import { chartSvg } from "./pptx-chart-svg";
import { scatterSvg } from "./pptx-scatter-svg";
import { chartExSvg } from "./pptx-chart-ex";
import { diagramElements } from "./pptx-diagrams";
import { vmlOleImageRels } from "./pptx-ole-vml";
import { hidesTitleSpecialPlaceholders } from "./pptx-title-placeholders";
import { embeddedWindowsLineGrids, readEmbeddedFonts } from "./pptx-fonts";
import {
  formatAutoNum,
  foldParagraphGaps,
  inheritedBulletColorXml,
  inheritedBulletPoints,
  inheritedBulletTypeface,
  layoutListRuns,
  pictureBulletEmbed,
  symbolBulletFont,
  symbolFontChar,
} from "./pptx-lists";
import { pictureBulletImage } from "./pptx-picture-bullet";
import { officeSingleSpacing, suiteLeafFont } from "./office-fonts";
import { paragraphTabStops } from "./pptx-tab-stops";
import { lineIsArrowhead, readLineEnd, readLineEndSize } from "./pptx-line-ends";
import { cssStrokeStyle } from "./pptx-line-dash";
import { styleBlipElement } from "./pptx-style-blip";
import { plainWordArt } from "./pptx-word-art";
import { isSymbolFont, splitSymbolRun } from "./symbol-fonts";
import {
  anchorRowSpans,
  builtinTableStyle,
  plainTableGrid,
  cellMarkUsed,
  explicitTableCell,
  tableLineLayout,
  mergeTableCell,
  tableCellContinues,
  distributeUnsetTableRows,
  growClippedTableRows,
  scaleRowsIntoFrame,
  tableFractions,
  tableFrameBox,
  tableTextRowEmu,
  tableStyleAt,
  tableStyleById,
  tableStyleEdges,
  tableStyleFlags,
  tablePropertyFillXml,
} from "./pptx-table";
import { hostedPictureClip, pictureBackdrop, pictureOutline } from "./pptx-picture-clip";
import {
  blipOpacity,
  colorChangeDataUrl,
  duotoneSvg,
  applyBlipLuminance,
  jpegWithoutOrientation,
  paintableImage,
  pictureTile,
  pictureTileSource,
  sourceCrop,
  stretchFill,
  uprightQuarterTurn,
} from "./pptx-pictures";
import {
  applyThemeOverride,
  backgroundBlip,
  backgroundCss,
  paintSlideBackgroundWindow,
  defaultSlideNumberBox,
  duotoneColors,
  paintColor,
  schemeColors,
  themeFillReference,
  themePaint,
} from "./pptx-theme";
import { runPaint } from "./pptx-run-paint";
import { officeMathRuns } from "./pptx-math";

/** Video and audio larger than this stay as a poster so a deck of clips can still be drawn. */
// Lecture clips run past 50 MB. A poster with no bytes leaves Play video with nothing to start.
const INLINE_MEDIA_LIMIT = 64 * 1024 * 1024;

/** MPEG program streams do not play in the slide viewer. Keep an MP4 when ffmpeg can make one. */
async function playableClip(
  bytes: Uint8Array,
  mime: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (mime !== "video/mpeg" || typeof process === "undefined" || !process.versions?.node)
    return { bytes, mime };
  try {
    const { spawn } = await import("node:child_process");
    const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "suiteleaf-mpg-"));
    const input = join(dir, "clip.mpg");
    const output = join(dir, "clip.mp4");
    await writeFile(input, bytes);
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(
        "ffmpeg",
        ["-y", "-i", input, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", output],
        { stdio: "ignore" },
      );
      child.on("error", reject);
      child.on("close", (status) => resolve(status ?? 1));
    });
    if (code !== 0) return { bytes, mime };
    const mp4 = new Uint8Array(await readFile(output));
    await rm(dir, { recursive: true, force: true });
    return { bytes: mp4, mime: "video/mp4" };
  } catch {
    return { bytes, mime };
  }
}

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

/** The picture description a person wrote. Internal SuiteLeaf markers stay out of the alt text. */
function pictureAlt(xml: string): string {
  const raw = /<p:cNvPr\b[^>]*\bdescr="([^"]*)"/.exec(xml)?.[1];
  if (!raw) return "Slide image";
  const text = decodeXmlEntities(raw).trim();
  if (!text || text.startsWith("SuiteLeaf ")) return "Slide image";
  return text;
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
  const embeddedLineGrids = await embeddedWindowsLineGrids(zip);
  const firstSlideNumMatch = /<p:presentation\b[^>]*\bfirstSlideNum="(-?\d+)"/.exec(presXml);
  const firstSlideNumParsed = firstSlideNumMatch ? Number(firstSlideNumMatch[1]) : 1;
  const firstSlideNum = Number.isFinite(firstSlideNumParsed) ? firstSlideNumParsed : 1;

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
  const defTabEmu = Number(
    /<p:presentation\b[^>]*\bdefTabSz="(\d+)"/.exec(presXml)?.[1] || 914400,
  );
  const defTabPoints = ((Number.isFinite(defTabEmu) && defTabEmu > 0 ? defTabEmu : 914400) / 914400) * 72;
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
    // Animation targets use an empty <p:bg/> inside p:spTgt. That is the shape
    // background, not a slide background, and must not hide the master fill.
    const slideBackground = (xml: string | undefined) =>
      xml ? /<p:bg(?:\s[^>]*)?>[\s\S]*?<\/p:bg>/.exec(xml)?.[0] : undefined;
    const backgroundPart = [ownPart, layoutPart, masterPart].find(
      (part) => slideBackground(part?.xml),
    );
    const bgXml = slideBackground(backgroundPart?.xml) ?? "";
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
    let backgroundPicture: string | undefined;

    const slideGroups = readGroups(slideXml);
    const mapGrouped = (
      emuX: number,
      emuY: number,
      emuW: number,
      emuH: number,
      at: number,
    ) => mapThroughGroups(slideGroups, at, emuX, emuY, emuW, emuH);

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
      let groupRotation = 0;
      let groupFlipH = false;
      let groupFlipV = false;
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
            const mapped = mapGrouped(emuX, emuY, emuW, emuH, at);
            emuX = mapped.emuX;
            emuY = mapped.emuY;
            emuW = mapped.emuW;
            emuH = mapped.emuH;
            groupRotation = mapped.rotation;
            groupFlipH = !!mapped.flipH;
            groupFlipV = !!mapped.flipV;
          }

          x = (emuX / emuWidth) * width;
          y = (emuY / emuHeight) * height;
          w = Math.max(0, (emuW / emuWidth) * width);
          h = Math.max(0, (emuH / emuHeight) * height);
        }
      }
      return {
        x,
        y,
        width: w,
        height: h,
        ...(groupRotation ? { rotation: groupRotation } : {}),
        ...(groupFlipH ? { flipH: true } : {}),
        ...(groupFlipV ? { flipV: true } : {}),
      };
    };

    const nativeOleFrame = (partXml: string, pictureXml: string, at?: number) => {
      const frames = [
        ...partXml.matchAll(/<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g),
      ].filter(
        (match) =>
          /<p:oleObj\b/.test(match[0]) && match[0].includes(pictureXml),
      );
      // Copied Photo Editor objects repeat the preview markup. The frame that
      // contains this picture is the one to place, not the first copy.
      if (at != null) {
        const host = frames.find((match) => {
          const start = match.index ?? 0;
          return start <= at && at < start + match[0].length;
        });
        if (host) return host[0];
      }
      return frames[0]?.[0];
    };
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
      const backdrop = pictureBackdrop(
        xml,
        box,
        { width, emuWidth },
        themePart?.xml,
        colorMap,
      );
      if (backdrop)
        elements.push({ id: crypto.randomUUID(), ...backdrop, ...softEdgeOf(xml) });
      const pose = drawingPose(xml);
      const rotation = composeRotation(
        (box as { rotation?: number }).rotation,
        pose.rotation,
      );
      const groupFlip = box as { flipH?: boolean; flipV?: boolean };
      elements.push({
        id: crypto.randomUUID(),
        type: "image",
        ...box,
        ...(rotation ? { rotation } : {}),
        ...((!!groupFlip.flipH !== !!pose.flipH)
          ? { flipH: true }
          : groupFlip.flipH || pose.flipH
            ? { flipH: undefined }
            : {}),
        ...((!!groupFlip.flipV !== !!pose.flipV)
          ? { flipV: true }
          : groupFlip.flipV || pose.flipV
            ? { flipV: undefined }
            : {}),
        src,
        alt: background ? "Slide background" : "Inherited slide artwork",
        ...softEdgeOf(xml),
        ...sourceCrop(xml),
        ...hostedPictureClip(xml, [], box.width, box.height),
        ...blipOpacity(xml),
        ...(() => {
          const tile = pictureTile(xml, bytes, box, { width, emuWidth });
          return tile ? { tile } : {};
        })(),
        ...(nativeDrawing ? { nativeDrawing } : {}),
      });
      const outline = pictureOutline(xml, box, { width, emuWidth }, themePart?.xml, colorMap);
      if (outline) elements.push({ id: crypto.randomUUID(), ...outline });
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
        if (src) {
          backgroundPicture = src;
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
      for (const match of part.xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
        const at = match.index ?? 0;
        const shapeXml = match[0];
        if (shapeIsHidden(shapeXml) || insideHiddenGroup(part.xml, at)) continue;
        if (/<p:ph\b/.test(shapeXml)) continue;
        const box = placedBox(part.xml, at, shapeXml, metrics);
        if (!box) continue;
        pieces.push({
          at,
          draw: async () => {
            const painted = await styleBlipElement(
              zip,
              themePart,
              shapeXml,
              box,
              { width, emuWidth },
              colorMap,
            );
            if (!painted) return;
            rememberShape(shapeXml);
            elements.push({ id: crypto.randomUUID(), ...painted });
          },
        });
      }
      for (const shape of inheritedShapes(
        part.xml,
        themePart?.xml,
        metrics,
        colorMap,
        bgColor || backgroundPicture,
      )) {
        pieces.push({
          at: shape.at,
          draw: async () => {
            if (repeatsSlideBackground(shape.element, bgColor, { width, height }))
              return;
            const revealed = paintSlideBackgroundWindow(shape.element, {
              width,
              height,
            });
            elements.push({ id: crypto.randomUUID(), ...revealed });
          },
        });
      }
      for (const match of part.xml.matchAll(
        /<p:pic\b[\s\S]*?<\/p:pic>|<p:sp\b[\s\S]*?<\/p:sp>/g,
      )) {
        // Placeholder content is supplied by the slide, rather than inherited.
        const at = match.index ?? 0;
        if (shapeIsHidden(match[0]) || insideHiddenGroup(part.xml, at)) continue;
        if (/<p:ph\b/.test(match[0]) || !/<a:blip\b/.test(match[0])) continue;
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
    const paintedSlideNumber = String(idx + firstSlideNum);

    // Helper to extract text from a txBody
    const bulletHosts = [
      masterPart,
      layoutPart,
      { path: slidePath, xml: slideXml, rels: slideRels },
    ].filter((host): host is NonNullable<typeof masterPart> => !!host);
    const bulletImages = new Map<string, string | undefined>();
    const runHyperlink = (xml: string) => {
      const tag = /<a:hlinkClick\b([^>]*?)\/?>/.exec(xml);
      if (!tag) return;
      const id = parseXmlAttrs(tag[1])["r:id"];
      if (!id) return;
      for (const host of [
        { rels: slideRels },
        layoutPart,
        masterPart,
      ]) {
        const rel = host?.rels?.[id];
        if (!rel || !/hyperlink/i.test(rel.type)) continue;
        let target = rel.target.trim();
        try {
          target = decodeURIComponent(target);
        } catch {
          /* The relationship target is already readable. */
        }
        if (
          /^(https?:|mailto:)/i.test(target) &&
          target.length <= 2000 &&
          !/[\s<>"]/.test(target)
        )
          return target;
      }
    };
    const parseTextBody = async (
      txBodyXml: string,
      inherited: string[] = [],
      defaults?: { color?: string; link?: string; table?: boolean },
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
        spaceAfter?: number;
        /** Positive first-line indent, in slide pixels. A negative indent is `hang`. */
        firstIndent?: number;
        /** Explicit tab stops, in points from the paragraph's left edge. */
        tabs?: { pos: number; align: "l" | "ctr" | "r" | "dec" }[];
        /** Default tab interval, in points, when the paragraph contains a tab. */
        tabInterval?: number;
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
          // A table cell does not inherit p:defaultTextStyle. That style is
          // for shapes; applying it paints body cells at the title size.
          defaults?.table ? "" : defaultTextStyle,
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
        // A later defRPr replaces the presentation default. Omitted b/i are
        // off, so defaultTextStyle bold does not leak into a plain body style.
        const specificRunAttrs = Object.assign(
          {},
          ...defaultRunParts.slice(1).map((xml) =>
            parseXmlAttrs(/^<[^>]+/.exec(xml)?.[0] || ""),
          ),
        );
        if (defaultRunParts.slice(1).some((xml) => /<a:defRPr\b/.test(xml))) {
          if (!("b" in specificRunAttrs)) delete defaultRunAttrs.b;
          if (!("i" in specificRunAttrs)) delete defaultRunAttrs.i;
        }
        const colorOf = (xml: string) => {
          const def =
            /<a:defRPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:defRPr>)/.exec(xml)?.[0] ||
            "";
          // A glow, shadow, highlight, or outline is not the glyph fill.
          // A list style that only adds an effect keeps the earlier solid fill.
          const fill = def
            .replace(/<a:effectLst\b[^>]*?(?:\/>|>[\s\S]*?<\/a:effectLst>)/g, "")
            .replace(/<a:highlight\b[\s\S]*?<\/a:highlight>/g, "")
            .replace(/<a:ln\b[^>]*?(?:\/>|>[\s\S]*?<\/a:ln>)/g, "");
          return paintColor(fill, scheme);
        };
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
        // The shape's own list colour, then its fontRef, then the master style,
        // then the presentation default. otherStyle's tx1 must not cover a
        // light fontRef on a coloured shape.
        const presentationColor = colorOf(styleParts[0] || "");
        const defaultColor =
          ownColor || defaults?.color || inheritedColor || presentationColor;
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
            .filter((xml) => /<a:bu(?:None|Char|AutoNum|Blip)\b/.test(xml))
            .at(-1) || "";
        const hasBullet = /<a:buChar\b|<a:buAutoNum\b|<a:buBlip\b/.test(bulletStyle);
        const bulletChar = /<a:buChar\b[^>]*\bchar="([^"]*)"/.exec(bulletStyle)?.[1];
        const keepWords = pAttrs.latinLnBrk === "0" || pAttrs.latinLnBrk === "false";
        const spacing = styleParts.join("");
        const line = lastLineSpacing(spacing);

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

        // Text runs. Office math is `a14:m` / `m:oMath`, which has no `a:t`.
        const rRx =
          /<a14:m\b[\s\S]*?<\/a14:m>|<m:oMathPara\b[\s\S]*?<\/m:oMathPara>|<m:oMath\b[\s\S]*?<\/m:oMath>|<a:r\b[\s\S]*?<\/a:r>|<a:fld\b[\s\S]*?<\/a:fld>|<a:br\b[^>]*(?:\/>|>[\s\S]*?<\/a:br>)/g;
        let rMatch: RegExpExecArray | null;
        while ((rMatch = rRx.exec(pXml)) !== null) {
          const rXml = rMatch[0];
          if (/^<a14:m\b|^<m:oMath/.test(rXml)) {
            for (const mathRun of officeMathRuns(rXml)) {
              if (!mathRun.text) continue;
              pText += mathRun.text;
              if (mathRun.bold) isBold = true;
              if (mathRun.italic) isItalic = true;
              if (mathRun.fontSize && !mathRun.baseline && !mathRun.fraction) {
                if (!sizedRun) {
                  fontSize = mathRun.fontSize;
                  sizedRun = true;
                } else if (fontSize === undefined) fontSize = mathRun.fontSize;
              } else if (mathRun.fontSize && fontSize === undefined) fontSize = mathRun.fontSize;
              if (mathRun.color && !fontColor) fontColor = mathRun.color;
              textRuns.push(mathRun);
            }
            continue;
          }
          if (/^<a:br\b/.test(rXml)) {
            pText += "\n";
            const sz = /<a:rPr\b[^>]*\bsz="(\d+)"/.exec(rXml)?.[1];
            const breakSize = sz ? parseInt(sz, 10) / 100 : undefined;
            textRuns.push({
              text: "\n",
              ...(breakSize && breakSize > 0 && breakSize <= 4000
                ? { fontSize: breakSize }
                : {}),
            });
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
              ? paintedSlideNumber
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
            if (rAttrs.strike === "sngStrike" || rAttrs.strike === "dblStrike") run.strike = true;
            if (rAttrs.i === "1" || rAttrs.i === "true") isItalic = true;
            if (rAttrs.u && rAttrs.u !== "none") isUnderline = true;
            const ownSz = rPrMatch ? parseXmlAttrs(rPrMatch[1]).sz : undefined;
            const szSource = ownSz || rAttrs.sz;
            if (szSource) {
              const szPt = parseInt(szSource, 10) / 100;
              // PowerPoint display type goes up to 4000pt. A 400pt section
              // numeral is real; dropping it leaves the default 18pt off the slide.
              if (szPt > 0 && szPt <= 4000) {
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
              if (shift) {
                run.baseline = Math.max(-1000, Math.min(1000, shift));
                // An explicit sz is already the script size. Omitting sz is
                // PowerPoint's superscript or subscript, drawn at 65%.
                if (!ownSz) run.scriptScale = true;
              }
            }
            const latinMatch = /<a:latin\s+typeface="([^"]+)"/.exec(rXml);
            if (latinMatch && !isSymbolFont(latinMatch[1])) {
              fontFamily = themeFont(latinMatch[1]);
              // The box face is one paragraph. A run that names its own face
              // must keep it, or a later Calibri line paints in the theme Arial.
              if (!run.font && fontFamily) run.font = fontFamily;
            }
            const painted = runPaint(rXml, scheme);
            const resolved =
              painted.color && painted.color !== "transparent"
                ? painted.color
                : undefined;
            if (painted.highlight) run.highlight = painted.highlight;
            if (painted.stroke && painted.strokeWidth) {
              run.stroke = painted.stroke;
              run.strokeWidth = painted.strokeWidth;
            }
            if (painted.shadow) run.shadow = painted.shadow;
            if (painted.gradient) run.gradient = painted.gradient;
            if (painted.reflection) run.reflection = painted.reflection;
            if (painted.color) {
              run.color = painted.color;
              if (resolved && !fontColor) fontColor = resolved;
            } else if (defaultColor) run.color = defaultColor;
            else if (defaults?.color) run.color = defaults.color;
            const href =
              runHyperlink(rXml) ||
              (inheritedHyperlink(defaultRunParts)
                ? runHyperlink(defaultRunParts.join(""))
                : undefined);
            if (href) run.href = href;
            if (/<a:hlinkClick\b/.test(rXml) || inheritedHyperlink(defaultRunParts)) {
              if (ownAttrs.u !== "none") {
                run.underline = true;
                isUnderline = true;
              }
              // PowerPoint paints the theme hyperlink colour. A run solidFill,
              // including the blue Google writes next to hlinkClick, does not replace it.
              // hlinkClr val="tx" is the exception: the run colour stays.
              if (defaults?.link && !hyperlinkUsesTextColor(rXml, defaultRunParts.join(""))) {
                run.color = defaults.link;
                if (!fontColor || fontColor === defaults.color || fontColor === resolved)
                  fontColor = defaults.link;
              }
            }
          }
          if (keepWords && run.text && run.text !== "\n") run.unbroken = true;
          if (run.text) textRuns.push(...(symbolChars ? splitSymbolRun(run, symbolChars) : [run]));
        }
        const markPoints = paragraphMarkPointSize(pXml);
        const lastRun = textRuns[textRuns.length - 1];
        if (lastRun?.text === "\n" && pText.replace(/\n/g, "").trim()) {
          let breakPoints = lastRun.fontSize;
          if (!breakPoints) {
            for (let index = textRuns.length - 2; index >= 0; index--) {
              const earlier = textRuns[index];
              if (earlier.text === "\n") break;
              if (earlier.fontSize) {
                breakPoints = earlier.fontSize;
                break;
              }
            }
          }
          if (trailingBreakIsShorterMark(breakPoints || fontSize, markPoints)) {
            textRuns.pop();
            pText = pText.slice(0, -1);
          }
        }
        const rightTab = /<a:tab\b[^>]*\balgn="r"/.test(pPrMatch?.[0] || "");
        if (rightTab && /^\t[^\t]*$/.test(pText)) {
          align = "right";
          pText = pText.slice(1);
          const tabbed = textRuns.find((run) => run.text.startsWith("\t"));
          if (tabbed) tabbed.text = tabbed.text.replace(/^\t/, "");
        }
        const autoTag = /<a:buAutoNum\b([^>]*)\/?>/.exec(bulletStyle);
        // A paragraph that is not numbered ends the sequence, including an
        // empty buNone between items. PowerPoint starts the next list at 1.
        if (!autoTag) {
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
          const firstRunXml =
            /<a:r\b[\s\S]*?<\/a:r>|<a:fld\b[\s\S]*?<\/a:fld>/.exec(pXml)?.[0] || "";
          const bulletColor = paintColor(inheritedBulletColorXml(styleParts), scheme);
          const bulletSize = inheritedBulletPoints(styleParts, fontSize);
          const numberFace = inheritedBulletTypeface(styleParts);
          const numberFont = symbolBulletFont(numberFace)
            ? undefined
            : suiteLeafFont(numberFace);
          const linked = /<a:hlinkClick\b/.test(firstRunXml);
          // The marker is not part of a hyperlink run. Folding it into that
          // run paints the number in the link colour and underlines it.
          if ((linked || bulletColor || bulletSize || numberFont) && first) {
            const at = textRuns.indexOf(first);
            textRuns.splice(at, 0, {
              text: marker,
              ...(bulletColor || linked
                ? { color: bulletColor || defaultColor }
                : first.color
                  ? { color: first.color }
                  : {}),
              ...(bulletSize ? { fontSize: bulletSize } : {}),
              ...(numberFont ? { font: numberFont } : {}),
            });
          } else if (first) first.text = marker + first.text;
        }
        if (bulletChar && pText) {
          const bulletFace = inheritedBulletTypeface(styleParts);
          const symbolFace = symbolBulletFont(bulletFace);
          const rawBullet = decodeXmlEntities(bulletChar);
          const marker = `${symbolFace ? symbolFontChar(rawBullet) : rawBullet} `;
          pText = marker + pText;
          const symbol = suiteLeafFont(symbolFace);
          // StarSymbol draws ▪ as a square about 1.85 times the Unicode small square.
          // The face is set so the marker does not become the paragraph's strut.
          const starSquare = /starsymbol/i.test(bulletFace || "") && rawBullet === "▪";
          const bulletSize =
            inheritedBulletPoints(styleParts, fontSize) ??
            (starSquare && fontSize ? Math.round(fontSize * 1.85 * 100) / 100 : undefined);
          const bulletColor = starSquare
            ? "#000000"
            : paintColor(inheritedBulletColorXml(styleParts), scheme);
          const first = textRuns.find((run) => run.text && run.text !== "\n");
          if (symbol || bulletSize || bulletColor) {
            const bulletRun: TextRun = {
              text: marker,
              ...(symbol ? { font: symbol } : starSquare ? { font: suiteLeafFont("Calibri") } : {}),
              ...(bulletSize ? { fontSize: bulletSize } : {}),
              ...(bulletColor ? { color: bulletColor } : {}),
            };
            const at = first ? textRuns.indexOf(first) : textRuns.length;
            textRuns.splice(at, 0, bulletRun);
          } else if (first) first.text = marker + first.text;
        }
        const blipId = pictureBulletEmbed(styleParts);
        if (blipId && pText && !bulletChar && !autoTag) {
          let src = bulletImages.get(blipId);
          if (src === undefined && !bulletImages.has(blipId)) {
            src = await pictureBulletImage(zip, blipId, bulletHosts);
            bulletImages.set(blipId, src);
          }
          const marker = "• ";
          pText = marker + pText;
          const bulletSize = inheritedBulletPoints(styleParts, fontSize) || fontSize;
          const bulletRun: TextRun = {
            text: marker,
            ...(src ? { bulletSrc: src } : {}),
            ...(bulletSize ? { fontSize: bulletSize } : {}),
          };
          const first = textRuns.find((run) => run.text && run.text !== "\n");
          const at = first ? textRuns.indexOf(first) : textRuns.length;
          textRuns.splice(at, 0, bulletRun);
        }

        {
          const indent = Number(pAttrs.indent || 0);
          const margin = Number(pAttrs.marL || 0);
          const px = (emu: number) => (emu / emuWidth) * width;
          const hang = indent < 0 ? px(-indent) : undefined;
          const firstIndent = indent > 0 ? px(indent) : undefined;
          const firstLine = margin + Math.min(0, indent);
          const tabs = paragraphTabStops(pPrMatch?.[0] || "", (emu) => (emu / 914400) * 72);
          const slidePoints = (points: number | undefined) =>
            points
              ? (points / 72) * (width / (emuWidth / 914400))
              : undefined;
          if (!pText.trim()) {
            const marked = emptyParagraphPointSize(pXml);
            if (marked) fontSize = marked;
          }
          // The paragraph mark sits on the last line. A larger mark, after a
          // hard break, is that empty line's height so bottom-aligned text
          // stays where PowerPoint puts it.
          const markSize = paragraphMarkPointSize(pXml);
          if (markSize) {
            let lineSize = 0;
            for (const run of textRuns) {
              if (run.text === "\n") lineSize = 0;
              else if (run.fontSize) lineSize = Math.max(lineSize, run.fontSize);
            }
            if (markSize > lineSize + 0.05)
              textRuns.push({ text: "\u200b", fontSize: markSize });
          }
          const gapPt = fontSize || Number(defaultRunAttrs.sz || 0) / 100 || 18;
          const spaceBefore = slidePoints(paragraphGapPoints(spacing, "spcBef", gapPt));
          const spaceAfter = slidePoints(paragraphGapPoints(spacing, "spcAft", gapPt));
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
            ...(firstIndent ? { firstIndent } : {}),
            ...(firstLine > 0 ? { listMargin: px(firstLine) } : {}),
            ...(tabs.length ? { tabs } : {}),
            ...(pText.includes("\t")
              ? {
                  tabInterval:
                    Number(pAttrs.defTabSz) > 0
                      ? (Number(pAttrs.defTabSz) / 914400) * 72
                      : defTabPoints,
                }
              : {}),
            ...(spaceBefore ? { spaceBefore } : {}),
            ...(spaceAfter ? { spaceAfter } : {}),
            ...(line?.kind === "pts" && exactLineFactor(line.value, fontSize || 18)
              ? {
                  lineHeight: exactLineFactor(line.value, fontSize || 18),
                  exactLine: true,
                }
              : line?.kind === "pct"
                ? { lineHeight: line.value }
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
      return foldParagraphGaps(
        paragraphs,
        /<a:bodyPr\b[^>]*\bspcFirstLastPara="(?:1|true)"/.test(txBodyXml),
      );
    };

    for (const part of layers) {
      if (part === layoutPart && hideLayoutShapes) continue;
      if (part === masterPart && hideMasterShapes) continue;
      for (const label of inheritedLabels(part.xml, metrics)) {
        const paragraphs = await parseTextBody(label.txBody);
        if (!paragraphs.some((paragraph) => paragraph.text.trim())) continue;
        const first =
          paragraphs.find((paragraph) => paragraph.text.trim()) ?? paragraphs[0];
        const content = paragraphs.map((paragraph) => paragraph.text).join("\n");
        const declared = first?.size || 18;
        const fontSize = label.stretchText
          ? declared
          : fittedLabelSize(
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
          lineHeight:
            officeSingleSpacing(first?.font || "Arial", embeddedLineGrids) *
            (first?.lineHeight ?? 1),
          ...(label.nowrap ? { nowrap: true } : {}),
          ...(label.stretchText ? { stretchText: true } : {}),
          ...(label.autofit ? { autofit: true } : {}),
          ...(label.rotation ? { rotation: label.rotation } : {}),
          ...(label.textFlow ? { textFlow: label.textFlow } : {}),
        });
      }
    }

    // A picture painted on the group itself sits behind the shapes in that group.
    const grpPrRx = /<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/g;
    let grpPrMatch: RegExpExecArray | null;
    while ((grpPrMatch = grpPrRx.exec(slideXml)) !== null) {
      if (insideHiddenGroup(slideXml, grpPrMatch.index ?? 0)) continue;
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
          ...hostedPictureClip(grpPr, [], w, h),
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
    const hideTitleChrome = hidesTitleSpecialPlaceholders(
      presXml,
      layoutPart?.xml,
    );
    // A slide or layout flag that names sldNum wins. Otherwise a title layout
    // drops the date, footer, and slide number when the presentation says so.
    const hideSlideNumber =
      slideNumberShown === false ||
      (slideNumberShown !== true && hideTitleChrome);
    // chartEx has no c:chart part. Paint it when the tree reaches it so a later
    // callout sits above the funnel, and skip the fallback bitmap.
    const chartExFrames = [
      ...slideXml.matchAll(/<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g),
    ].filter((match) => /<cx:chart\b/.test(match[0]));
    let chartExCursor = 0;
    const paintChartExFrame = async (gfXml: string) => {
      rememberShape(gfXml);
      const frame = parseTransform(gfXml);
      const chartId = /<cx:chart\b[^>]*\br:id="([^"]+)"/.exec(gfXml)?.[1];
      const chartRel = chartId ? slideRels[chartId] : undefined;
      const chartFile = chartRel
        ? zip.file(resolveZipPath(slidePath, chartRel.target))
        : null;
      const chartXml = chartFile ? await chartFile.async("string") : "";
      const chartPath = chartRel
        ? resolveZipPath(slidePath, chartRel.target)
        : "";
      const relsPath = chartPath
        ? chartPath.replace(
            /[^/]+$/,
            `_rels/${chartPath.slice(chartPath.lastIndexOf("/") + 1)}.rels`,
          )
        : "";
      const relsXml = relsPath ? await zip.file(relsPath)?.async("string") : undefined;
      const colorTarget = relsXml
        ? /relationships\/chartColorStyle"[^>]*Target="([^"]+)"/.exec(relsXml)?.[1]
        : undefined;
      const colorStyle = colorTarget
        ? await zip.file(resolveZipPath(chartPath, colorTarget))?.async("string")
        : undefined;
      const src = chartXml
        ? chartExSvg(
            chartXml,
            themePart?.xml,
            colorMap,
            frame.width,
            frame.height,
            colorStyle,
          )
        : undefined;
      elements.push(
        src
          ? {
              id: crypto.randomUUID(),
              type: "image",
              ...frame,
              src,
              alt: "Native PowerPoint chart",
            }
          : {
              id: crypto.randomUUID(),
              type: "shape",
              shapeType: "rect",
              ...frame,
              fill: "transparent",
              alt: "Native PowerPoint chart",
            },
      );
    };
    const paintChartExThrough = async (index: number) => {
      while (
        chartExCursor < chartExFrames.length &&
        (chartExFrames[chartExCursor]?.index ?? 0) <= index
      ) {
        const frame = chartExFrames[chartExCursor];
        chartExCursor += 1;
        if (frame) await paintChartExFrame(frame[0]);
      }
    };
    const spRx = /<p:sp\b[\s\S]*?<\/p:sp>/g;
    let spMatch: RegExpExecArray | null;
    while ((spMatch = spRx.exec(slideXml)) !== null) {
      if (insideFallback(slideXml, spMatch.index ?? 0)) continue;
      await paintChartExThrough((spMatch.index ?? 0) - 1);
      const spXml = spMatch[0];
      if (shapeIsHidden(spXml) || insideHiddenGroup(slideXml, spMatch.index ?? 0))
        continue;
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
          : phType === "body" || phType === "subTitle" || phType === "obj"
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
      const placed = parseTransform(
        spXml + layoutPlaceholder + masterPlaceholder,
        spMatch.index,
        spXml.length,
      );
      const { x, y, width: w, height: h } = placed;
      const groupRotation = placed.rotation;

      const groupFill = /<a:grpFill\b/.test(spXml)
        ? groupFillXml(slideXml, spMatch.index ?? 0)
        : "";
      const filled = withInheritedOutline(
        withInheritedFill(
          withInheritedGeometry(spXml, layoutPlaceholder, masterPlaceholder),
          layoutPlaceholder,
          masterPlaceholder,
        ),
        layoutPlaceholder,
        masterPlaceholder,
      );
      const paint = themePaint(
        themePart?.xml,
        groupFill ? filled.replace(/<a:grpFill\b[^>]*\/>/, groupFill) : filled,
        colorMap,
        bgColor || backgroundPicture,
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
      const textFlow = verticalTextFlow(bodyAttrs.vert);
      const stretchText = txBodyMatch ? plainWordArt(txBodyMatch[0]) : false;
      const insetDefault = (name: string) =>
        name === "tIns" || name === "bIns" ? 45720 : 91440;
      const insetOf = (name: string) =>
        (Math.max(0, Number(bodyAttrs[name] ?? insetDefault(name)) || 0) / emuWidth) *
        width;
      const pad = hasBody
        ? stretchText
          ? { t: 0, r: 0, b: 0, l: 0 }
          : {
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
      const styledPicture = await styleBlipElement(
        zip,
        themePart,
        spXml,
        at,
        { width, emuWidth },
        colorMap,
      );
      if (styledPicture) {
        rememberShape(spXml);
        elements.push({ id: crypto.randomUUID(), ...styledPicture });
        painted = true;
      }
      // A picture fill is painted later, rotated with the shape. Drawing the
      // outline here would sit under that photo and disappear.
      const shapePicture = /<a:blipFill\b/.test(spPr);
      const art =
        fillColor || (paint.stroke && !shapePicture)
          ? shapeArtwork(
              filled,
              paint,
              {
                x: at.x,
                y: at.y,
                width: at.width,
                height: at.height,
                ...(groupRotation ? { rotation: groupRotation } : {}),
                ...(placed.flipH ? { flipH: true } : {}),
                ...(placed.flipV ? { flipV: true } : {}),
              },
              { width, emuWidth },
            )
          : undefined;
      if (art) {
        rememberShape(spXml);
        const revealed = paintSlideBackgroundWindow(art, { width, height });
        elements.push({ id: crypto.randomUUID(), ...revealed });
        painted = true;
      }

      let addedText = false;
      const wantsNumber = phType === "sldNum" && !hideSlideNumber;
      if (txBodyMatch) {
        const paragraphs = await parseTextBody(
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
            ? paintedSlideNumber
            : paragraphs.map((p) => p.text).join("\n");
          if (
            !slideTitle &&
            (phType === "title" ||
              phType === "ctrTitle" ||
              (idx === 0 && at.y < height * 0.35))
          ) {
            slideTitle = fullText;
          }

          const first =
            paragraphs.find((paragraph) => paragraph.text.trim()) ?? paragraphs[0];
          const boxSize = first?.size || 18;
          // A unitless line-height is relative to the box font. A smaller
          // paragraph has to shrink that number, or its lines stay as tall as
          // the heading and the block drifts down the slide.
          const cssLineOf = (paragraph: (typeof paragraphs)[number]) => {
            if (paragraph.exactLine) return paragraph.lineHeight;
            const factor = paragraph.lineHeight ?? 1;
            const size = paragraph.text.trim() && paragraph.size ? paragraph.size : boxSize;
            // A symbol or math face on the paragraph must not pick the line grid.
            // The box face is the text; only the point size changes per paragraph.
            const single = officeSingleSpacing(first?.font || "Arial", embeddedLineGrids);
            return single * factor * (size / boxSize);
          };
          const cssLines = paragraphs.map(cssLineOf);
          const mixedLines =
            cssLines.length > 1 &&
            cssLines.some(
              (line, index) =>
                line != null &&
                cssLines[0] != null &&
                Math.abs(line - cssLines[0]) > 0.02,
            );
          const laid = layoutListRuns(
            mixedLines
              ? paragraphs.map((paragraph, index) => ({
                  ...paragraph,
                  ...(cssLines[index] != null ? { cssLine: cssLines[index] } : {}),
                }))
              : paragraphs,
          );
          const hang = laid.hang;
          const listMargin = laid.listMargin;
          rememberShape(spXml);
          // A flipped shape mirrors its outline. PowerPoint keeps the letters upright,
          // including a half turn stored with a single flip.
          const shapePose = drawingPose(spXml);
          const rotation = composeRotation(
            groupRotation,
            readableTextRotation(shapePose.rotation, shapePose.flipH, shapePose.flipV),
          );
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
              : officeSingleSpacing(first?.font || "Arial", embeddedLineGrids) *
                (first?.lineHeight ?? fit.line),
            ...(bodyAttrs.wrap === "none" || stretchText ? { nowrap: true } : {}),
            ...(stretchText ? { stretchText: true } : {}),
            ...(/<a:spAutoFit\b/.test(txBodyMatch[0]) ? { autofit: true } : {}),
            ...(textFlow ? { textFlow } : {}),
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
              const stretched = stretchFill(spPr, { x, y, width: w, height: h });
              if (stretched.width > 0 && stretched.height > 0) {
                // The transform's rot is the shape's turn. A picture fill uses
                // that same center, including a group around the shape.
                const pose = drawingPose(spPr);
                const rotation = composeRotation(groupRotation, pose.rotation);
                const pictureBytes =
                  detectImageMime(imgBytes) === "image/jpeg" && rotation
                    ? jpegWithoutOrientation(imgBytes)
                    : imgBytes;
                const turnedSrc =
                  pictureBytes === imgBytes
                    ? src
                    : recolor(
                        applyBlipLuminance(
                          paintableImage(pictureBytes, "image/jpeg"),
                          spPr,
                        ),
                        spPr,
                      ) || src;
                // The inner box must not shadow the group placement. A shape
                // flip and a group flip cancel, the same way a picture does.
                const filled = uprightQuarterTurn(
                  {
                    x: stretched.x,
                    y: stretched.y,
                    width: stretched.width,
                    height: stretched.height,
                    ...((!!placed.flipH !== !!pose.flipH) ? { flipH: true } : {}),
                    ...((!!placed.flipV !== !!pose.flipV) ? { flipV: true } : {}),
                    ...(rotation ? { rotation } : {}),
                  },
                  turnedSrc,
                );
                elements.push({
                  id: crypto.randomUUID(),
                  type: "image",
                  x: filled.x,
                  y: filled.y,
                  width: filled.width,
                  height: filled.height,
                  ...(filled.rotation ? { rotation: filled.rotation } : {}),
                  ...(filled.flipH ? { flipH: true } : {}),
                  ...(filled.flipV ? { flipV: true } : {}),
                  src: turnedSrc,
                  alt: "Shape image fill",
                  ...softEdgeOf(spPr),
                  ...sourceCrop(spPr),
                  ...hostedPictureClip(spPr, [], filled.width, filled.height),
                  ...blipOpacity(spPr),
                  ...(() => {
                    const tile = pictureTile(spPr, imgBytes, filled, { width, emuWidth });
                    return tile ? { tile } : {};
                  })(),
                });
                // shapeArtwork also reads rot off the transform. The image already
                // carries the composed turn, so the outline must not add it again.
                const outlineXml = spXml.replace(
                  /(<(?:a|p):xfrm\b[^>]*?)\s+rot="[^"]*"/,
                  "$1",
                );
                const outline = pictureOutline(
                  outlineXml,
                  {
                    x: filled.x,
                    y: filled.y,
                    width: filled.width,
                    height: filled.height,
                    ...(filled.rotation ? { rotation: filled.rotation } : {}),
                  },
                  { width, emuWidth },
                  themePart?.xml,
                  colorMap,
                );
                if (outline) elements.push({ id: crypto.randomUUID(), ...outline });
              }
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
      if (shapeIsHidden(xml) || insideHiddenGroup(slideXml, match.index ?? 0))
        continue;
      const id = parseXmlAttrs(/<p:cNvPr\b([^>]*)/.exec(xml)?.[1] || "").id;
      if (id && seenConnectors.has(id)) continue;
      if (id) seenConnectors.add(id);
      const paint = themePaint(themePart?.xml, xml, colorMap, bgColor || backgroundPicture);
      if (!paint.stroke && !paint.fill) continue;
      const pos = parseTransform(xml, match.index, xml.length);
      const pose = drawingPose(xml);
      const rotation = composeRotation(pos.rotation, pose.rotation);
      const geom = /<a:prstGeom\s+prst="([^"]+)"/.exec(xml)?.[1] ?? "";
      rememberShape(xml);
      // An elbow or curve is the preset path. A straight diagonal loses the bend.
      if (/^(?:bent|curved)Connector\d/.test(geom)) {
        const art = shapeArtwork(
          xml,
          paint,
          {
            x: pos.x,
            y: pos.y,
            width: pos.width,
            height: pos.height,
            ...(pos.rotation ? { rotation: pos.rotation } : {}),
            ...(pos.flipH ? { flipH: true } : {}),
            ...(pos.flipV ? { flipV: true } : {}),
          },
          { width, emuWidth },
        );
        if (art) {
          const revealed = paintSlideBackgroundWindow(art, { width, height });
          elements.push({ id: crypto.randomUUID(), ...revealed });
          continue;
        }
      }
      const head = readLineEnd(xml, "head");
      const tail = readLineEnd(xml, "tail");
      const headSize = readLineEndSize(xml, "head");
      const tailSize = readLineEndSize(xml, "tail");
      const pointed = lineIsArrowhead(head) || lineIsArrowhead(tail);
      elements.push({
        id: crypto.randomUUID(),
        type: "shape",
        ...pos,
        shapeType: pointed ? "arrow" : "line",
        fill: "transparent",
        stroke: paint.stroke || "#1e293b",
        strokeWidth: paint.strokeEmu ? (paint.strokeEmu / emuWidth) * width : 1,
        ...(cssStrokeStyle(paint.dash) ? { strokeStyle: cssStrokeStyle(paint.dash) } : {}),
        ...(head ? { lineHead: head } : {}),
        ...(tail ? { lineTail: tail } : {}),
        ...(headSize ? { lineHeadSize: headSize } : {}),
        ...(tailSize ? { lineTailSize: tailSize } : {}),
        ...((!!pos.flipH !== !!pose.flipH) ? { flipH: true } : {}),
        ...((!!pos.flipV !== !!pose.flipV) ? { flipV: true } : {}),
        ...(rotation ? { rotation } : {}),
      });
    }
    // A slide number is the placeholder on that slide. The layout and master
    // copies are only the position and style. Painting them when the slide
    // omits the placeholder adds a number PowerPoint does not print.

    // 4. Parse Pictures (<p:pic>)
    const picRx = /<p:pic\b[\s\S]*?<\/p:pic>/g;
    let picMatch: RegExpExecArray | null;
    while ((picMatch = picRx.exec(slideXml)) !== null) {
      const picXml = picMatch[0];
      if (shapeIsHidden(picXml) || insideHiddenGroup(slideXml, picMatch.index ?? 0))
        continue;
      if (insideFallback(slideXml, picMatch.index ?? 0)) {
        const blockStart = slideXml.lastIndexOf("<mc:AlternateContent", picMatch.index ?? 0);
        const blockEnd = slideXml.indexOf("</mc:AlternateContent>", picMatch.index ?? 0);
        const choice =
          blockStart >= 0 && blockEnd > blockStart
            ? /<mc:Choice\b[\s\S]*?<\/mc:Choice>/.exec(
                slideXml.slice(blockStart, blockEnd),
              )?.[0] ?? ""
            : "";
        if (/<cx:chart\b|<c:chart\b/.test(choice)) continue;
      }
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
                {
                  mp4: "video/mp4",
                  m4v: "video/mp4",
                  webm: "video/webm",
                  mov: "video/quicktime",
                  mpg: "video/mpeg",
                  mpeg: "video/mpeg",
                } as Record<string, string>
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
          const frame = parseTransform(picXml, picMatch.index, picXml.length);
          const pose = drawingPose(picXml);
          const rotation = composeRotation(frame.rotation, pose.rotation);
          let poster: string | undefined;
          if (posterFile) {
            const bytes = await posterFile.async("uint8array");
            const posterMime = detectImageMime(bytes);
            // PowerPoint turns the poster with the picture and ignores EXIF.
            const pictureBytes =
              posterMime === "image/jpeg" && rotation
                ? jpegWithoutOrientation(bytes)
                : bytes;
            poster = paintableImage(pictureBytes, posterMime);
          }
          const rawMedia = await media.async("uint8array");
          const playable = await playableClip(rawMedia, mime);
          const src =
            playable.bytes.byteLength <= INLINE_MEDIA_LIMIT
              ? `data:${playable.mime};base64,${uint8ToBase64(playable.bytes)}`
              : undefined;
          if (!src && !poster) continue;
          rememberShape(picXml);
          elements.push({
            id: crypto.randomUUID(),
            type,
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            ...(rotation ? { rotation } : {}),
            ...((!!frame.flipH !== !!pose.flipH) ? { flipH: true } : {}),
            ...((!!frame.flipV !== !!pose.flipV) ? { flipV: true } : {}),
            ...(src ? { src } : {}),
            alt: target.split("/").pop(),
            ...(poster ? { poster } : {}),
            // The poster is a picture: PowerPoint crops it with srcRect.
            ...sourceCrop(picXml),
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
          blipMatch === blips[0]
            ? nativeOleFrame(slideXml, picXml, picMatch.index)
            : undefined;
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
        // The frame's xfrm is in the group's child space. Its index lets the
        // group offset move a copied Photo Editor object off the original.
        const nativeFrameAt = nativeFrame
          ? slideXml.lastIndexOf(nativeFrame, (picMatch.index ?? 0) + picXml.length)
          : -1;
        const stretched = stretchFill(
          picXml,
          nativeFrame
            ? parseTransform(
                nativeFrame,
                nativeFrameAt >= 0 ? nativeFrameAt : undefined,
                nativeFrame.length,
              )
            : parseTransform(frame, picMatch.index, picXml.length),
        );
        const { x, y, width: w, height: h } = stretched;
        if (!(w > 0 && h > 0)) continue;
        rememberShape(picXml);
        // A picture placeholder often stores only its box. The layout path
        // still clips the shape fill, so a section wedge is not a white rectangle.
        const shaped = withInheritedGeometry(picXml, layoutHost, masterHost);
        const backdrop = pictureBackdrop(
          shaped,
          { x, y, width: w, height: h },
          { width, emuWidth },
          themePart?.xml,
          colorMap,
        );
        if (backdrop)
          elements.push({ id: crypto.randomUUID(), ...backdrop, ...softEdgeOf(picXml) });
        const pose = drawingPose(nativeFrame || frame);
        const rotation = composeRotation(stretched.rotation, pose.rotation);
        const placed = uprightQuarterTurn(
          {
            x,
            y,
            width: w,
            height: h,
            ...((!!stretched.flipH !== !!pose.flipH) ? { flipH: true } : {}),
            ...((!!stretched.flipV !== !!pose.flipV) ? { flipV: true } : {}),
            ...(rotation ? { rotation } : {}),
          },
          src,
        );
        const pictureHref = runHyperlink(picXml);
        elements.push({
          id: crypto.randomUUID(),
          type: "image",
          x: placed.x,
          y: placed.y,
          width: placed.width,
          height: placed.height,
          ...(pictureHref ? { href: pictureHref } : {}),
          ...(placed.rotation ? { rotation: placed.rotation } : {}),
          ...(placed.flipH ? { flipH: placed.flipH } : {}),
          ...(placed.flipV ? { flipV: placed.flipV } : {}),
          ...softEdgeOf(picXml),
          src,
          alt: pictureAlt(picXml),
          ...sourceCrop(picXml),
          ...hostedPictureClip(picXml, [layoutHost, masterHost], placed.width, placed.height),
          ...blipOpacity(picXml),
          ...(() => {
            const tile = pictureTile(pictureTileSource(picXml), imgBytes, placed, { width, emuWidth });
            return tile ? { tile } : {};
          })(),
          ...(svgSrc ? { svgSrc } : {}),
          ...(nativeDrawing ? { nativeDrawing } : {}),
          ...(imageLayer ? { imageLayer } : {}),
        });
        if (blipMatch === blips[0]) {
          const host = nativeOleFrame(slideXml, picXml, picMatch.index);
          const oleId = host
            ? /<p:nvGraphicFramePr\b[\s\S]*?<p:cNvPr\b[^>]*\bid="(\d+)"/.exec(host)?.[1]
            : undefined;
          if (oleId && oleId !== "0" && !shapeIndex.has(oleId))
            shapeIndex.set(oleId, elements.length - 1);
        }
        const outline = pictureOutline(
          shaped,
          { x: placed.x, y: placed.y, width: placed.width, height: placed.height },
          { width, emuWidth },
          themePart?.xml,
          colorMap,
        );
        if (outline) elements.push({ id: crypto.randomUUID(), ...outline });
      }
    }

    // 5. Parse Tables (<a:tbl>)
    const vmlPart = await readRelatedPart(slidePath, slideRels, "vmlDrawing");
    const vmlPreviews = new Map<string, string>();
    if (vmlPart) {
      for (const item of vmlOleImageRels(vmlPart.xml)) {
        const relation = vmlPart.rels[item.relId];
        if (!relation) continue;
        const file = zip.file(resolveZipPath(vmlPart.path, relation.target));
        if (!file) continue;
        const bytes = await file.async("uint8array");
        const src = paintableImage(bytes, detectImageMime(bytes));
        if (src) vmlPreviews.set(item.spid, src);
      }
    }
    const tblRx = /<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g;
    let gfMatch: RegExpExecArray | null;
    let diagramIndex = 0;
    while ((gfMatch = tblRx.exec(slideXml)) !== null) {
      const gfXml = gfMatch[0];
      // The Choice table, chart, or diagram is the one to paint. Its Fallback
      // is the same object drawn again for older apps, and stacking both
      // ghosts a second grid over the math.
      if (insideFallback(slideXml, gfMatch.index ?? 0)) {
        const blockStart = slideXml.lastIndexOf(
          "<mc:AlternateContent",
          gfMatch.index ?? 0,
        );
        const blockEnd = slideXml.indexOf(
          "</mc:AlternateContent>",
          gfMatch.index ?? 0,
        );
        const choice =
          blockStart >= 0 && blockEnd > blockStart
            ? (/<mc:Choice\b[\s\S]*?<\/mc:Choice>/.exec(
                slideXml.slice(blockStart, blockEnd),
              )?.[0] ?? "")
            : "";
        if (/<(?:a:tbl|c:chart|cx:chart|dgm:relIds)\b/.test(choice)) continue;
      }
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
        const slideMetrics = { width, height, emuWidth, emuHeight };
        for (const element of drawn) {
          const placed = placeGroupedBox(
            slideGroups,
            gfMatch.index ?? 0,
            element,
            slideMetrics,
          );
          elements.push({ id: crypto.randomUUID(), ...placed });
        }
        continue;
      }
      if (/<cx:chart\b/.test(gfXml)) {
        await paintChartExThrough(gfMatch.index ?? 0);
        continue;
      }
      if (/<c:chart\b/.test(gfXml)) {
        rememberShape(gfXml);
        const frame = parseTransform(gfXml, gfMatch.index, gfXml.length);
        const nativeDrawing = await gatherNativeDrawing(zip, slidePath, gfXml);
        const chartId = /<c:chart\b[^>]*\br:id="([^"]+)"/.exec(gfXml)?.[1];
        const chartRel = chartId ? slideRels[chartId] : undefined;
        const chartFile = chartRel
          ? zip.file(resolveZipPath(slidePath, chartRel.target))
          : null;
        const chartXml = chartFile ? await chartFile.async("string") : "";
        const chartPath = chartRel
          ? resolveZipPath(slidePath, chartRel.target)
          : "";
        const chartRels = chartPath
          ? await zip
              .file(
                chartPath.replace(
                  /[^/]+$/,
                  `_rels/${chartPath.slice(chartPath.lastIndexOf("/") + 1)}.rels`,
                ),
              )
              ?.async("string")
          : undefined;
        const styleTarget = chartRels
          ? /relationships\/chartStyle"[^>]*Target="([^"]+)"/.exec(chartRels)?.[1]
          : undefined;
        const styleXml = styleTarget
          ? await zip.file(resolveZipPath(chartPath, styleTarget))?.async("string")
          : undefined;
        const chartScale = width / (out.content.pointWidth || width);
        const src = chartXml
          ? chartSvg(
              chartXml,
              themePart?.xml,
              frame.width,
              frame.height,
              chartScale,
              colorMap,
              styleXml,
            ) ||
            scatterSvg(
              chartXml,
              themePart?.xml,
              frame.width,
              frame.height,
              chartScale,
              colorMap,
            )
          : undefined;
        elements.push(
          src
            ? {
                id: crypto.randomUUID(),
                type: "image",
                ...frame,
                src,
                alt: "Native PowerPoint chart",
                nativeDrawing,
              }
            : {
                id: crypto.randomUUID(),
                type: "shape",
                shapeType: "rect",
                ...frame,
                // An empty chart part has nothing to paint. The default shape
                // fill would cover the real chart that shares the frame.
                fill: "transparent",
                alt: "Native PowerPoint chart",
                nativeDrawing,
              },
        );
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
        const rowSpans = anchorRowSpans(tbl);
        let anchor = 0;
        const pictures: {
          xEmu: number;
          yEmu: number;
          wEmu: number;
          hEmu: number;
          src: string;
          rowIndex: number;
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
                rowIndex: rowEmu.length,
              });
            }
            const cellTx = await parseTextBody(cell, [], { table: true });
            row.push(cellTx.map((p) => p.text).join("\n"));
            const laid = explicitTableCell(cell, cellTx, (xml) =>
              paintColor(xml, scheme),
            );
            const lines = tableLineLayout(cellTx);
            if (lines) laid.lines = lines;
            const rowSpan = rowSpans[anchor] ?? 1;
            anchor += 1;
            if (rowSpan > 1) laid.rowSpan = rowSpan;
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
          /<a:tableStyleId>([^<]*)<\/a:tableStyleId>/.exec(tbl)?.[1]?.trim() ?? "";
        const styleXml = styleId
          ? (tableStyleById(tableStylesXml, styleId) ?? builtinTableStyle(styleId))
          : plainTableGrid();
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
        // A row that clips its text grows, and growth past the frame is scaled
        // back into the frame. A modest on-slide frame that is taller than
        // those rows is the resized table, so the rows scale up to fill it.
        const xfrm =
          /<(?:a|p):xfrm\b[\s\S]*?<\/(?:a|p):xfrm>/.exec(gfXml)?.[0] ?? "";
        const frameCx = Number(/<(?:a|p):ext\b[^>]*\bcx="(\d+)"/.exec(xfrm)?.[1] ?? 0);
        const frameCy = Number(/<(?:a|p):ext\b[^>]*\bcy="(\d+)"/.exec(xfrm)?.[1] ?? 0);
        const frameTop = Number(/<(?:a|p):off\b[^>]*\by="(-?\d+)"/.exec(xfrm)?.[1] ?? 0);
        const distributedRows = distributeUnsetTableRows(rowEmu, frameCy, frameCx);
        const neededRows = tableTextRowEmu(rows, styledMarks, cols);
        const grownRows = growClippedTableRows(
          distributedRows,
          neededRows,
          frameCy,
          frameCx,
        );
        // Stored rows that clip their text, inside a modest on-slide frame,
        // are the resized grid. Rows that already fit leave the extra frame empty.
        const storedClipsText = distributedRows.some(
          (height, index) => (neededRows[index] ?? 0) > height + 12700,
        );
        const resolvedRows = storedClipsText
          ? scaleRowsIntoFrame(grownRows, frameCy, frameTop, frameCx, emuHeight)
          : grownRows;
        const rowStart: number[] = [];
        let gridH = 0;
        for (const height of resolvedRows) {
          rowStart.push(gridH);
          gridH += height;
        }
        for (const picture of pictures) {
          const start = rowStart[picture.rowIndex];
          if (start == null) continue;
          picture.yEmu = start;
          picture.hEmu = resolvedRows[picture.rowIndex] ?? picture.hEmu;
        }
        const box = tableFrameBox(
          frame,
          frameCx,
          frameCy,
          tableW,
          gridH || yEmu || 1,
          { width, height, emuWidth, emuHeight },
        );
        const tableH = box.emuHeight;
        for (const picture of pictures) {
          elements.push({
            id: crypto.randomUUID(),
            type: "image",
            x: frame.x + Math.round((picture.xEmu / tableW) * box.width),
            y: frame.y + Math.round((picture.yEmu / tableH) * box.height),
            width: Math.max(
              20,
              Math.round((picture.wEmu / tableW) * box.width),
            ),
            height: Math.max(
              16,
              Math.round((picture.hEmu / tableH) * box.height),
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
            tableH > 0 ? resolvedRows.map((height) => height / tableH) : undefined;
          const minorFont = themeFont("+mn-lt");
          const directFill = tablePropertyFillXml(tbl);
          const styleBg = themeFillReference(
            themePart?.xml,
            /<a:tblBg\b[\s\S]*?<\/a:tblBg>/.exec(styleXml || "")?.[0] ?? "",
            colorMap,
          );
          const directBg =
            directFill && directFill !== "none"
              ? themeFillReference(themePart?.xml, directFill, colorMap)
              : undefined;
          // A gradient or solid on tblPr is the wash behind transparent cells.
          // noFill is an explicit empty background, not a request for the style.
          const tableBg = directFill === "none" ? undefined : directBg || styleBg;
          rememberShape(gfXml);
          elements.push({
            id: crypto.randomUUID(),
            type: "table",
            x: frame.x,
            y: frame.y,
            width: box.width,
            height: box.height,
            rows,
            ...(tableBg ? { fill: tableBg } : {}),
            ...(minorFont ? { fontFamily: minorFont } : {}),
            ...(colWidths ? { colWidths } : {}),
            ...(rowHeights ? { rowHeights } : {}),
            ...(hasMarks ? { cellMarks: styledMarks } : {}),
            ...(/\brtl="(?:1|true)"/.test(/<a:tblPr\b[^>]*>/.exec(tbl)?.[0] ?? "")
              ? { rtl: true }
              : {}),
          });
        }
      }
      const oleSpid = /<p:oleObj\b[^>]*\bspid="([^"]+)"/.exec(gfXml)?.[1];
      if (oleSpid && vmlPreviews && !/<p:pic\b/.test(gfXml)) {
        const preview = vmlPreviews.get(oleSpid);
        if (preview) {
          rememberShape(gfXml);
          elements.push({
            id: crypto.randomUUID(),
            type: "image",
            ...parseTransform(gfXml, gfMatch.index, gfXml.length),
            src: preview,
            alt: "OLE preview",
            nativeDrawing: await gatherNativeDrawing(zip, slidePath, gfXml),
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
              const tx = await parseTextBody(nspXml);
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

    const mapped = assignClickAnimations(slideXml, elements, shapeIndex);
    const ancestors = shapeGroupAncestors(slideXml);
    const effectsOf = (xml: string) => {
      const hidden = /<a14:hiddenEffects\b[\s\S]*?<\/a14:hiddenEffects>/.exec(xml)?.[0] ?? "";
      if (/<a:outerShdw\b/.test(hidden)) return hidden;
      return /<a:effectLst\b[\s\S]*?<\/a:effectLst>/.exec(xml)?.[0] ?? "";
    };
    for (const match of slideXml.matchAll(/<p:(sp|pic)\b[\s\S]*?<\/p:\1>/g)) {
      const xml = match[0];
      const localId = /<p:cNvPr\b[^>]*\bid="(\d+)"/.exec(xml)?.[1];
      const frameAt = slideXml.lastIndexOf("<p:graphicFrame", match.index ?? 0);
      const frameHead = frameAt >= 0 ? slideXml.slice(frameAt, match.index ?? 0) : "";
      const frameId = /<p:oleObj\b/.test(frameHead)
        ? /<p:cNvPr\b[^>]*\bid="(\d+)"/.exec(frameHead)?.[1]
        : undefined;
      const id = frameId && frameId !== "0" ? frameId : localId;
      const shadow = outerShadow(effectsOf(xml), scheme);
      const index = id ? shapeIndex.get(id) : undefined;
      if (shadow && index != null && !elements[index].shadow) elements[index].shadow = shadow;
    }
    const groupShadow = new Map<string, NonNullable<ReturnType<typeof outerShadow>>>();
    for (const match of slideXml.matchAll(
      /<p:nvGrpSpPr>\s*<p:cNvPr\b[^>]*\bid="(\d+)"[\s\S]*?<\/p:nvGrpSpPr>\s*<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/g,
    )) {
      const effects = /<a:effectLst\b[\s\S]*?<\/a:effectLst>/.exec(match[0])?.[0] ?? "";
      const shadow = outerShadow(effects, scheme);
      if (shadow) groupShadow.set(match[1], shadow);
    }
    for (const [spid, chain] of ancestors) {
      const index = shapeIndex.get(spid);
      if (index == null || elements[index].shadow) continue;
      for (const groupId of chain) {
        const shadow = groupShadow.get(groupId);
        if (!shadow) continue;
        elements[index].shadow = shadow;
        break;
      }
    }
    const motion = readSlideMotion(slideXml);
    const storedOrder = readingOrderIds(slideXml, shapeIndex, elements);
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
      ...(storedOrder.length ? { readingOrder: storedOrder } : {}),
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
      // A missing end-of-central-directory record still leaves local headers.
      const repaired = zipFromLocalHeaders(u8);
      if (repaired) {
        try {
          const zip = await JSZip.loadAsync(repaired);
          return await parseZipPptx(zip, defaultTitle);
        } catch {
          // The local members were not a readable package.
        }
      }
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
