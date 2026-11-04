import { gatherNativeDrawing } from "./pptx-native-objects";
import { composeRotation } from "./pptx-group-xform";
import {
  drawingPose,
  inheritedLabels,
  inheritedShapes,
  insideHiddenGroup,
  placedBox,
  repeatsSlideBackground,
  shapeIsHidden,
} from "./pptx-geometry";
import { styleBlipElement } from "./pptx-style-blip";
import { officeSingleSpacing } from "./office-fonts";
import { hostedPictureClip, pictureBackdrop, pictureOutline } from "./pptx-picture-clip";
import {
  applyBlipLuminance,
  blipOpacity,
  duotoneSvg,
  paintableImage,
  pictureTile,
  sourceCrop,
  stretchFill,
} from "./pptx-pictures";
import { backgroundBlip, paintSlideBackgroundWindow } from "./pptx-theme";
import { parseXmlAttrs, resolveZipPath, type PptxPart } from "./pptx-package";
import { detectImageMime } from "./pptx-media";
import type { SlideContext } from "./pptx-slide-context";

/** Slide background, then the layout and master artwork under the slide's own shapes. */
export async function paintSlideBackdrop(slide: SlideContext) {
  const {
    zip,
    width,
    height,
    emuWidth,
    elements,
    themePart,
    colorMap,
    recolor,
    nativeOleFrame,
    parseTransform,
    softEdgeOf,
    backgroundPart,
    bgXml,
    bgColor,
    layers,
    layoutPart,
    masterPart,
    hideLayoutShapes,
    hideMasterShapes,
    metrics,
    rememberShape,
  } = slide;
  const addInheritedImage = async (
    part: PptxPart,
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
        slide.backgroundPicture = src;
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
      bgColor || slide.backgroundPicture,
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
    await paintInheritedLabels({ ...slide, layers: [part] });
  }
}

/** Text on layout and master shapes that are not placeholders. */
export async function paintInheritedLabels(slide: SlideContext) {
  const {
    layers,
    layoutPart,
    masterPart,
    hideLayoutShapes,
    hideMasterShapes,
    metrics,
    parseTextBody,
    elements,
    embeddedLineGrids,
  } = slide;
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
      // spAutoFit grows the shape, not the font. normAutofit has already
      // been applied by parseTextBody; do not fit inherited labels twice.
      const fontSize = declared;
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
          ...paragraph.runs,
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
        ...(label.rotation ? { rotation: label.rotation } : {}),
        ...(label.textFlow ? { textFlow: label.textFlow } : {}),
      });
    }
  }
}

/** A picture painted on the group itself sits behind the shapes in that group. */
export async function paintGroupPictures(slide: SlideContext) {
  const {
    zip,
    slideXml,
    slideRels,
    slidePath,
    recolor,
    parseTransform,
    elements,
    softEdgeOf,
  } = slide;
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
}
