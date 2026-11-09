import { officePngSamples } from "./pptx-png-color";
import { gatherNativeDrawing } from "./pptx-native-objects";
import { composeRotation } from "./pptx-group-xform";
import {
  drawingPose,
  insideFallback,
  insideHiddenGroup,
  placeholderShape,
  shapeIsHidden,
} from "./pptx-geometry";
import { withInheritedGeometry } from "./pptx-placeholder-outline";
import type { SlideElement } from "./index";
import { hostedPictureClip, pictureBackdrop, pictureOutline } from "./pptx-picture-clip";
import {
  blipOpacity,
  applyBlipLuminance,
  jpegWithoutOrientation,
  paintableImage,
  pictureTile,
  pictureTileSource,
  sourceCrop,
  stretchFill,
  uprightQuarterTurn,
} from "./pptx-pictures";
import { pictureAlt, parseXmlAttrs, resolveZipPath } from "./pptx-package";
import {
  INLINE_MEDIA_LIMIT,
  detectImageMime,
  playableClip,
  uint8ToBase64,
} from "./pptx-media";
import type { SlideContext } from "./pptx-slide-context";

/** The slide's `p:pic` pictures, clips, and OLE previews. */
export async function paintSlidePictures(slide: SlideContext) {
  const {
    zip,
    width,
    emuWidth,
    slideXml,
    slideRels,
    slidePath,
    layoutPart,
    masterPart,
    themePart,
    colorMap,
    elements,
    shapeIndex,
    rememberShape,
    parseTransform,
    nativeOleFrame,
    recolor,
    softEdgeOf,
    runHyperlink,
  } = slide;
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
          // The preview's inline limit must not discard an editable Office
          // clip. Preserve its native picture and reachable package assets.
          ...(!src ? { nativeDrawing: await gatherNativeDrawing(zip, slidePath, picXml) } : {}),
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
          : mime === "image/png" ? officePngSamples(imgBytes) : imgBytes;
      // An EMF the browser cannot paint keeps its bytes so export writes the same picture.
      const preview = paintableImage(pictureBytes, mime);
      const src =
        recolor(applyBlipLuminance(preview, picXml), picXml) ??
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
        ...(mime === "image/emf" &&
        src === preview &&
        !svgSrc &&
        placed.rotation === (rotation || undefined)
          ? { emfSrc: `data:image/emf;base64,${uint8ToBase64(imgBytes)}` }
          : {}),
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
}
