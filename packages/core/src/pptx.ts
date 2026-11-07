import JSZip from "jszip";
import { createFile, type SlideFile, type Slide } from "./index";
import { assignClickAnimations, readSlideMotion, shapeGroupAncestors } from "./slide-motion";
import { readingOrderIds } from "./pptx-reading-order";
import { outerShadow } from "./pptx-run-paint";
import { retainSharedData } from "./shared-media";
import { moveKerningToBoxes } from "./pptx-kerning";
import { zipFromLocalHeaders } from "./zip-local";
import { embeddedWindowsLineGrids, readEmbeddedFonts } from "./pptx-fonts";
import { parseRels, parseXmlAttrs, resolveZipPath } from "./pptx-package";
import { extractRawStrings, parseBinaryPpt } from "./pptx-binary";
import { openSlide, type PptxDeck } from "./pptx-slide-context";
import {
  paintGroupPictures,
  paintSlideBackdrop,
} from "./pptx-slide-layers";
import { paintConnectors, paintSlideShapes } from "./pptx-slide-shapes";
import { paintSlidePictures } from "./pptx-slide-pictures";
import { chartExPainter, paintGraphicFrames } from "./pptx-slide-frames";

// Parse Open XML PPTX
async function parseZipPptx(
  zip: JSZip,
  defaultTitle: string,
  onProgress?: (completed: number, total: number) => void,
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

  const deck: PptxDeck = {
    zip,
    presXml,
    width,
    height,
    emuWidth,
    emuHeight,
    pointWidth: out.content.pointWidth,
    firstSlideNum,
    defaultTextStyle,
    defTabPoints,
    embeddedLineGrids,
    tableStylesXml,
  };

  onProgress?.(0, slidePaths.length);
  for (let idx = 0; idx < slidePaths.length; idx++) {
    const slide = await openSlide(deck, idx, slidePaths[idx]);
    if (!slide) { onProgress?.(idx + 1, slidePaths.length); continue; }
    await paintSlideBackdrop(slide);
    await paintGroupPictures(slide);

    // 3. Parse Shapes (<p:sp>)
    const paintChartExThrough = chartExPainter(slide);
    await paintSlideShapes(slide, paintChartExThrough);
    paintConnectors(slide);
    // A slide number is the placeholder on that slide. The layout and master
    // copies are only the position and style. Painting them when the slide
    // omits the placeholder adds a number PowerPoint does not print.

    // 4. Parse Pictures (<p:pic>)
    await paintSlidePictures(slide);

    // 5. Parse Tables (<a:tbl>)
    await paintGraphicFrames(slide, paintChartExThrough);

    const {
      slideId,
      slideXml,
      slideRels,
      slidePath,
      slideTitle,
      elements,
      shapeIndex,
      elementOrder,
      scheme,
      bgColor,
      parseTextBody,
    } = slide;

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
    onProgress?.(idx + 1, slidePaths.length);
  }

  out.content.slides = slides;
  out.content.slideOrder = slideOrder;
  const fonts = await readEmbeddedFonts(zip);
  if (fonts.length) out.content.fonts = fonts;
  return out;
}

// Main PowerPoint import function
export async function parsePowerPoint(
  input: ArrayBuffer | Uint8Array,
  title?: string,
  onProgress?: (completed: number, total: number) => void,
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
      return await parseZipPptx(zip, defaultTitle, onProgress);
    } catch {
      // A missing end-of-central-directory record still leaves local headers.
      const repaired = zipFromLocalHeaders(u8);
      if (repaired) {
        try {
          const zip = await JSZip.loadAsync(repaired);
          return await parseZipPptx(zip, defaultTitle, onProgress);
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
