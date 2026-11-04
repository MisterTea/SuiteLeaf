import type JSZip from "jszip";
import type { SlideElement } from "./index";
import { mapThroughGroups, readGroups } from "./pptx-group-xform";
import { suiteLeafFont } from "./office-fonts";
import { colorChangeDataUrl, duotoneSvg } from "./pptx-pictures";
import {
  applyThemeOverride,
  backgroundCss,
  duotoneColors,
  schemeColors,
} from "./pptx-theme";
import { parseRels, parseXmlAttrs, readRelatedPart } from "./pptx-package";
import { textBodyParser } from "./pptx-text-body";

/** Presentation-wide values every slide reads. */
export type PptxDeck = {
  zip: JSZip;
  presXml: string;
  width: number;
  height: number;
  emuWidth: number;
  emuHeight: number;
  pointWidth?: number;
  firstSlideNum: number;
  defaultTextStyle: string;
  defTabPoints: number;
  embeddedLineGrids: Map<string, number>;
  tableStylesXml: string;
};

export type SlideContext = NonNullable<Awaited<ReturnType<typeof openSlide>>>;

/** One slide with its layout, master, and theme, and the helpers its drawing passes share. */
export async function openSlide(deck: PptxDeck, idx: number, slidePath: string) {
  const {
    zip,
    width,
    height,
    emuWidth,
    emuHeight,
    firstSlideNum,
    defaultTextStyle,
    defTabPoints,
  } = deck;
  const slideXmlFile = zip.file(slidePath);
  if (!slideXmlFile) return undefined;
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
  const layoutPart = await readRelatedPart(
    zip,
    slidePath,
    slideRels,
    "slideLayout",
  );
  const masterPart = layoutPart
    ? await readRelatedPart(zip, layoutPart.path, layoutPart.rels, "slideMaster")
    : undefined;
  const themePart = masterPart
    ? await readRelatedPart(zip, masterPart.path, masterPart.rels, "theme")
    : undefined;
  const themeOverride =
    (await readRelatedPart(zip, slidePath, slideRels, "themeOverride")) ||
    (layoutPart
      ? await readRelatedPart(zip, layoutPart.path, layoutPart.rels, "themeOverride")
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

  const scheme = schemeColors(themePart?.xml || "", colorMap);
  const paintedSlideNumber = String(idx + firstSlideNum);

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

  const parseTextBody = textBodyParser({
    zip,
    width,
    emuWidth,
    defaultTextStyle,
    defTabPoints,
    scheme,
    themeFont,
    paintedSlideNumber,
    runHyperlink,
    bulletHosts,
    bulletImages,
  });

  return {
    ...deck,
    idx,
    slidePath,
    slideXml,
    slideRels,
    slideId,
    slideTitle: "",
    elements,
    shapeIndex,
    elementOrder,
    rememberShape,
    layoutPart,
    masterPart,
    themePart,
    themeFont,
    layers,
    backgroundPart,
    bgXml,
    colorMap,
    recolor,
    bgColor,
    backgroundPicture: undefined as string | undefined,
    slideGroups,
    parseTransform,
    nativeOleFrame,
    softEdgeOf,
    hideLayoutShapes,
    hideMasterShapes,
    metrics,
    scheme,
    paintedSlideNumber,
    runHyperlink,
    parseTextBody,
  };
}
