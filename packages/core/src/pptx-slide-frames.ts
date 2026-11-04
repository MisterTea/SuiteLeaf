import { gatherNativeDrawing } from "./pptx-native-objects";
import { placeGroupedBox } from "./pptx-group-xform";
import { insideFallback } from "./pptx-geometry";
import { chartSvg } from "./pptx-chart-svg";
import { scatterSvg } from "./pptx-scatter-svg";
import { chartExSvg } from "./pptx-chart-ex";
import { diagramElements } from "./pptx-diagrams";
import { vmlOleImageRels } from "./pptx-ole-vml";
import { paintableImage } from "./pptx-pictures";
import { readRelatedPart, resolveZipPath } from "./pptx-package";
import { detectImageMime } from "./pptx-media";
import { paintSlideTable } from "./pptx-slide-table";
import type { SlideContext } from "./pptx-slide-context";

export type ChartExPainter = ReturnType<typeof chartExPainter>;

export function chartExPainter(slide: SlideContext) {
  const {
    zip,
    slideXml,
    slideRels,
    slidePath,
    themePart,
    colorMap,
    elements,
    parseTransform,
    rememberShape,
  } = slide;
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
  return paintChartExThrough;
}

async function paintNativeChart(
  slide: SlideContext,
  gfXml: string,
  gfMatch: RegExpExecArray,
) {
  const {
    zip,
    slidePath,
    slideRels,
    themePart,
    colorMap,
    width,
    pointWidth,
    elements,
    parseTransform,
    rememberShape,
  } = slide;
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
  const chartScale = width / (pointWidth || width);
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
}

/** Diagrams, charts, tables, and OLE previews, each in its graphic frame. */
export async function paintGraphicFrames(
  slide: SlideContext,
  paintChartExThrough: ChartExPainter,
) {
  const {
    zip,
    slideXml,
    slideRels,
    slidePath,
    width,
    height,
    emuWidth,
    emuHeight,
    metrics,
    themePart,
    colorMap,
    elements,
    slideGroups,
    parseTransform,
    parseTextBody,
    rememberShape,
  } = slide;
  const vmlPart = await readRelatedPart(zip, slidePath, slideRels, "vmlDrawing");
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
      await paintNativeChart(slide, gfXml, gfMatch);
      continue;
    }
    const tblMatch = /<a:tbl\b[\s\S]*?<\/a:tbl>/.exec(gfXml);
    if (tblMatch) await paintSlideTable(slide, gfXml, gfMatch, tblMatch);
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
}
