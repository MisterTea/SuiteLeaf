import { composeRotation } from "./pptx-group-xform";
import {
  drawingPose,
  readableTextRotation,
  groupFillXml,
  insideFallback,
  insideHiddenGroup,
  placeholderShape,
  lineTextBox,
  presetTextBox,
  shapeArtwork,
  shapeIsHidden,
  verticalTextFlow,
  withInheritedFill,
} from "./pptx-geometry";
import { normAutofitFactors } from "./pptx-autofit";
import { withInheritedGeometry, withInheritedOutline } from "./pptx-placeholder-outline";
import { hidesTitleSpecialPlaceholders } from "./pptx-title-placeholders";
import { layoutListRuns } from "./pptx-lists";
import { presentationLineHeight } from "./pptx-line-spacing";
import { lineIsArrowhead, readLineEnd, readLineEndSize } from "./pptx-line-ends";
import { cssStrokeStyle } from "./pptx-line-dash";
import { styleBlipElement } from "./pptx-style-blip";
import { plainWordArt } from "./pptx-word-art";
import { hostedPictureClip, pictureOutline } from "./pptx-picture-clip";
import {
  blipOpacity,
  applyBlipLuminance,
  jpegWithoutOrientation,
  paintableImage,
  pictureTile,
  sourceCrop,
  stretchFill,
  uprightQuarterTurn,
} from "./pptx-pictures";
import {
  paintSlideBackgroundWindow,
  defaultSlideNumberBox,
  themePaint,
} from "./pptx-theme";
import { parseXmlAttrs, resolveZipPath } from "./pptx-package";
import { detectImageMime } from "./pptx-media";
import type { SlideContext } from "./pptx-slide-context";
import type { ChartExPainter } from "./pptx-slide-frames";

/** The slide's own `p:sp` shapes: outlines, picture fills, and text. */
export async function paintSlideShapes(
  slide: SlideContext,
  paintChartExThrough: ChartExPainter,
) {
  const {
    zip,
    idx,
    presXml,
    width,
    height,
    emuWidth,
    slideXml,
    slideRels,
    slidePath,
    layoutPart,
    masterPart,
    themePart,
    colorMap,
    bgColor,
    backgroundPicture,
    elements,
    rememberShape,
    parseTransform,
    parseTextBody,
    recolor,
    softEdgeOf,
    paintedSlideNumber,
  } = slide;
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
  // A master can draw its page field as ordinary artwork, with no ph tag.
  // An empty local placeholder must not create a second, default-sized copy.
  const inheritedNumberLabel = [masterPart?.xml, layoutPart?.xml].some((xml) =>
    [...(xml || "").matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].some(
      (shape) => !/<p:ph\b/.test(shape[0]) && /<a:fld\b[^>]*\btype="slidenum"/.test(shape[0]),
    ),
  );
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
        (wantsNumber && !inheritedNumberLabel)
      ) {
        // A slide-number field is already the page number. Keep the date and
        // other runs that share its placeholder instead of dropping them.
        const synthesized =
          wantsNumber && paragraphs.every((paragraph) => !paragraph.text.trim());
        const fullText = synthesized
          ? paintedSlideNumber
          : paragraphs.map((p) => p.text).join("\n");
        if (
          !slide.slideTitle &&
          (phType === "title" ||
            phType === "ctrTitle" ||
            (idx === 0 && at.y < height * 0.35))
        ) {
          slide.slideTitle = fullText;
        }

        const first =
          paragraphs.find((paragraph) => paragraph.text.trim()) ?? paragraphs[0];
        const fit = normAutofitFactors(txBodyMatch[0]);
        const fallbackSize =
          phType === "title" || phType === "ctrTitle" ? 36 : wantsNumber ? 12 : 18;
        // A paragraph that no style sizes is drawn at the default size, not at
        // the size an earlier paragraph in the box set for itself.
        if (paragraphs.some((paragraph) => paragraph.size)) {
          for (const paragraph of paragraphs) {
            if (paragraph.size) continue;
            paragraph.size = fallbackSize * fit.font;
            for (const run of paragraph.runs) run.fontSize ??= paragraph.size;
          }
        }
        // The paragraph sets its own font size, and a unitless line-height is
        // multiplied by that size. Scaling by the box size as well makes a
        // smaller paragraph a second time too short.
        const cssLineOf = (paragraph: (typeof paragraphs)[number]) => {
          return presentationLineHeight(paragraph.lineHeight, paragraph.exactLine);
        };
        const cssLines = paragraphs.map(cssLineOf);
        const mixedLines =
          cssLines.length > 1 &&
          cssLines.some(
            (line) =>
              line != null &&
              cssLines[0] != null &&
              Math.abs(line - cssLines[0]) > 0.02,
          );
        const laid = layoutListRuns(
          (mixedLines || paragraphs.some(paragraph => paragraph.lineHeightPt))
            ? paragraphs.map((paragraph, index) => ({
                ...paragraph,
                ...(cssLines[index] != null ? { cssLine: cssLines[index] } : {}),
                ...(paragraph.lineHeightPt ? { cssLinePt: paragraph.lineHeightPt } : {}),
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
        const textAt =
          lineTextBox(spXml, at, first?.align, valign) ?? presetTextBox(spXml, at) ?? at;
        const declared = first?.size || fallbackSize;
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
                ...(pad.r !== pad.l || listMargin ? { padRight: pad.r } : {}),
                ...(pad.b !== pad.t ? { padBottom: pad.b } : {}),
              }
            : listMargin
              ? { padLeft: listMargin }
              : {}),
          ...(hang ? { hang } : {}),
          lineHeight: presentationLineHeight(first?.lineHeight ?? fit.line, first?.exactLine),
          ...(first?.lineHeightPt ? { lineHeightPt: first.lineHeightPt } : {}),
          ...(bodyAttrs.wrap === "none" || stretchText ? { nowrap: true } : {}),
          ...(stretchText ? { stretchText: true } : {}),
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
          // The outline is centered on the edge. A white frame uses it to
          // cover the hairline between two boxes; dropping it shows the
          // picture underneath.
          ...(paint.stroke
            ? {
                stroke: paint.stroke,
                strokeWidth: paint.strokeEmu
                  ? (paint.strokeEmu / emuWidth) * width
                  : 1,
                ...(cssStrokeStyle(paint.dash)
                  ? { strokeStyle: cssStrokeStyle(paint.dash) }
                  : {}),
              }
            : {}),
        });
      }
    }
  }
}

export function paintConnectors(slide: SlideContext) {
  const {
    width,
    height,
    emuWidth,
    slideXml,
    themePart,
    colorMap,
    bgColor,
    backgroundPicture,
    elements,
    rememberShape,
    parseTransform,
  } = slide;
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
}
