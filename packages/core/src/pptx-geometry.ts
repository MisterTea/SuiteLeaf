import type { SlideElement } from "./index";
import { composeRotation } from "./pptx-group-xform";
import { guideCustomPath } from "./pptx-custom-geometry";
import {
  compactDrawing,
  hairlinePath,
  lineTextBox,
  presetFillPath,
  presetTextBox,
  presetVector,
} from "./pptx-preset-geometry";
import { guide, presetPath } from "./pptx-preset-paths";
import { roundRectCornerRadius } from "./pptx-round-rect";
import { cssStrokeStyle, strokeDashArray } from "./pptx-line-dash";
import {
  collapsedStrokeDirection,
  diagonalStrokeDirection,
  freeformArrowMarkup,
  lineStrokeStyle,
  scalePathAxes,
  readLineEnd,
  readLineEndSize,
} from "./pptx-line-ends";
import {
  groupFillXml,
  insideHiddenGroup,
  placedBox,
  shapeIsHidden,
} from "./pptx-layout-inherit";

export { lineTextBox, presetTextBox };
export {
  drawingPose,
  fittedLabelSize,
  groupFillXml,
  inheritedLabels,
  insideFallback,
  insideHiddenGroup,
  placedBox,
  placeholderShape,
  readableTextRotation,
  repeatsSlideBackground,
  shapeIsHidden,
  verticalTextFlow,
  withInheritedFill,
  type InheritedLabel,
} from "./pptx-layout-inherit";
import { svgFillMarkup, themePaint, type ShapePaint } from "./pptx-theme";

/** How many drawing pixels equal one point on this slide. Standard 960pt decks stay at 1. */
export function slidePointScale(width?: number, pointWidth?: number) {
  const draw = width || 960;
  const points = pointWidth && pointWidth > 0 ? pointWidth : draw;
  return draw / points;
}

type Box = { x: number; y: number; width: number; height: number; rotation?: number; flipH?: boolean; flipV?: boolean };
type Metrics = {
  width: number;
  height: number;
  emuWidth: number;
  emuHeight: number;
};

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const rx = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(tag)) !== null) {
    out[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }
  return out;
}

function customPath(
  xml: string,
  shapeW = 0,
  shapeH = 0,
): { d: string; w: number; h: number; fillD: string; pen: boolean } | undefined {
  const paths = [...xml.matchAll(/<a:path\b([^>]*)>([\s\S]*?)<\/a:path>/g)];
  if (!paths.length) return undefined;
  // Edited freeforms keep the preset's guide formulas and arcTo corners.
  // Numeric lnTo paths stay on the direct reader below.
  const guided = paths.some(
    (path) =>
      /<a:arcTo\b/.test(path[2] || "") ||
      /<a:pt\b[^>]*\b(?:x|y)="(?!-?\d+(?:\.\d+)?")/.test(path[2] || ""),
  );
  if (guided) return guideCustomPath(xml, shapeW, shapeH);
  let w = 1;
  let h = 1;
  const stroke: string[] = [];
  const fill: string[] = [];
  for (const path of paths) {
    const size = attrs(path[1]);
    w = Number(size.w) || w;
    h = Number(size.h) || h;
    const commands: string[] = [];
    const token = /<a:(moveTo|lnTo|cubicBezTo|quadBezTo|close)\b[^>]*?(?:\/>|>([\s\S]*?)<\/a:\1>)/g;
    let step: RegExpExecArray | null;
    while ((step = token.exec(path[2]))) {
      if (step[1] === "close") {
        commands.push("Z");
        continue;
      }
      const points = [...(step[2] || "").matchAll(/<a:pt\b[^>]*\bx="(-?\d+(?:\.\d+)?)"[^>]*\by="(-?\d+(?:\.\d+)?)"/g)];
      const letter = step[1] === "moveTo" ? "M" : step[1] === "lnTo" ? "L" : step[1] === "quadBezTo" ? "Q" : "C";
      if (!points.length) continue;
      commands.push(`${letter} ${points.map((point) => `${point[1]} ${point[2]}`).join(" ")}`);
    }
    if (!commands.length) continue;
    const piece = commands.join(" ");
    // A path may decline the shape fill or the pen. fill="none" is an outline.
    if (size.fill !== "none") fill.push(piece);
    if (size.stroke !== "0" && size.stroke !== "false") stroke.push(piece);
  }
  const fillD = fill.join(" ");
  const strokeD = stroke.join(" ");
  if (!fillD && !strokeD) return undefined;
  return { d: strokeD || fillD, w, h, fillD, pen: stroke.length > 0 };
}

function svgData(
  d: string,
  w: number,
  h: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  evenOdd = false,
  dash?: string,
  fillD?: string,
  ends?: {
    head?: string;
    tail?: string;
    headSize?: "sm" | "lg";
    tailSize?: "sm" | "lg";
    cap?: string;
    join?: string;
    miterLimit?: number;
    boxW?: number;
    boxH?: number;
    strokePt?: number;
  },
) {
  const rule = evenOdd ? ` fill-rule="evenodd"` : "";
  const painted = svgFillMarkup(fillD === "" ? "none" : fill);
  const boxW = ends?.boxW || 0;
  const boxH = ends?.boxH || 0;
  if (boxW > 0 && boxH > 0 && w > 0 && h > 0) {
    const sx = boxW / w;
    const sy = boxH / h;
    // A square path stretched into a tall box makes the pen thick one way
    // and thin the other. Draw it in the box instead.
    if (Math.abs(sx - sy) > sx * 0.02) {
      d = scalePathAxes(d, sx, sy);
      if (fillD) fillD = scalePathAxes(fillD, sx, sy);
      if (dash) dash = dash.split(/\s+/).map((part) => String(Math.round(Number(part) * sx * 100) / 100)).join(" ");
      strokeWidth = ends?.strokePt || strokeWidth * sx;
      w = boxW;
      h = boxH;
    }
  }
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : "";
  const arrows =
    ends?.head || ends?.tail
      ? freeformArrowMarkup({
          d,
          viewW: w,
          viewH: h,
          boxW: ends.boxW || 0,
          boxH: ends.boxH || 0,
          strokePt: ends.strokePt || 0,
          head: ends.head,
          tail: ends.tail,
          headSize: ends.headSize,
          tailSize: ends.tailSize,
          fill: stroke,
        })
      : "";
  const cap = ends?.cap ?? "butt";
  const join = ends?.join ?? "miter";
  const miter = ends?.miterLimit ?? 8;
  const edge = ` stroke-linejoin="${join}" stroke-linecap="${cap}" stroke-miterlimit="${miter}"`;
  const split = fillD !== undefined && fillD !== d;
  const hairline = hairlinePath(d, stroke, strokeWidth, dash, edge);
  const body = split
    ? `${fillD ? `<path${rule} d="${fillD}" fill="${painted.value}" stroke="none"/>` : ""}<path${rule} d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr}${edge}/>${hairline}${arrows}`
    : `<path${rule} d="${d}" fill="${painted.value}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr}${edge}/>${hairline}${arrows}`;
  const fitted = compactDrawing(`${painted.defs}${body}`, w, h);
  // DrawingML stretches path units to the shape box. The default meet
  // alignment letterboxes a square path inside a tall or wide box.
  // Without width and height, Chromium rasterizes the SVG at 300×150 and a
  // short arrow disappears when that bitmap is squeezed into the shape.
  const rasterW = ends?.boxW && ends.boxW > 0 ? ends.boxW : fitted.width <= 2000 ? fitted.width : 0;
  const rasterH = ends?.boxH && ends.boxH > 0 ? ends.boxH : fitted.height <= 2000 ? fitted.height : 0;
  const dim = rasterW && rasterH ? ` width="${rasterW}" height="${rasterH}"` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"${dim} preserveAspectRatio="none" viewBox="0 0 ${fitted.width} ${fitted.height}">${fitted.body}</svg>`;
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function simpleKind(
  geom: string | undefined,
): "rect" | "roundRect" | "ellipse" | "line" | "arrow" | undefined {
  if (!geom) return undefined;
  if (geom === "line" || geom.startsWith("straightConnector")) return "line";
  if (geom === "roundRect") return "roundRect";
  if (geom === "ellipse" || geom === "circle") return "ellipse";
  if (geom === "rect" || geom === "flowChartProcess") return "rect";
  return undefined;
}

/**
 * A DrawingML shape as a slide rectangle, ellipse, line, or SVG outline.
 * The box is already in slide units. Absent when the shape has nothing to paint.
 */
/** Clip a picture to its preset. A rectangle, or a roundRect with no radius, stays a box. */
export function geometryClipPath(
  xml: string,
  w: number,
  h: number,
): string | undefined {
  const name = /<a:prstGeom\b[^>]*\bprst="([^"]+)"/.exec(xml)?.[1];
  if (!name || name === "rect" || name === "flowChartProcess" || !(w > 0) || !(h > 0))
    return undefined;
  if (name === "ellipse" || name === "circle") {
    const rx = w / 2;
    const ry = h / 2;
    return `M ${rx} 0 A ${rx} ${ry} 0 1 1 ${rx} ${h} A ${rx} ${ry} 0 1 1 ${rx} 0 Z`;
  }
  if (name === "roundRect" && guide(xml, "adj", 16667) === 0) return undefined;
  const local = presetPath(name, xml, w, h);
  const d = local || presetFillPath(xml, w, h);
  if (!d || d.length > 20000) return undefined;
  return d;
}

export function shapeArtwork(
  xml: string,
  paint: ShapePaint,
  box: Box,
  slide: { width: number; emuWidth: number },
): Omit<SlideElement, "id"> | undefined {
  if (!paint.fill && !paint.stroke) return undefined;
  const xfrm = attrs(/<(?:a|p):xfrm\b([^>]*)>/.exec(xml)?.[1] || "");
  const geom = /<a:prstGeom\s+prst="([^"]+)"/.exec(xml)?.[1];
  const arrow = /<a:(?:head|tail)End\b[^>]*\btype="(?!none)[^"]*"/.test(xml);
  const ownTurn = Number(xfrm.rot) ? Number(xfrm.rot) / 60000 : undefined;
  const rotation = composeRotation(box.rotation, ownTurn);
  const kind = simpleKind(geom);
  const customGeom = /<a:custGeom\b/.test(xml);
  // A freeform whose box is only a point tall or wide is still a stroke.
  // An SVG in that box has no pixels, so it becomes the line the pen draws.
  const collapsed = collapsedStrokeDirection(xml, box);
  const diagonal = collapsed ? undefined : diagonalStrokeDirection(xml);
  let flipH = !!box.flipH !== (xfrm.flipH === "1" || xfrm.flipH === "true");
  let flipV = !!box.flipV !== (xfrm.flipV === "1" || xfrm.flipV === "true");
  if (collapsed?.axis === "h" && collapsed.flip) flipH = !flipH;
  if (collapsed?.axis === "v" && collapsed.flip) flipV = !flipV;
  if (diagonal?.flipH) flipH = !flipH;
  if (diagonal?.flipV) flipV = !flipV;
  const line = kind === "line" || (!geom && !customGeom && arrow) || !!collapsed || !!diagonal;
  const plain = !geom && !customGeom;
  if (line || kind || plain) {
    const corner = geom === "roundRect" ? roundRectCornerRadius(xml, box.width, box.height) : undefined;
    const shapeType = line
      ? arrow
        ? "arrow"
        : "line"
      : corner === 0
        ? "rect"
        : kind === "ellipse" || kind === "roundRect"
          ? kind
          : "rect";
    const strokeStyle = cssStrokeStyle(paint.dash);
    const lineHead = line ? readLineEnd(xml, "head") : undefined;
    const lineTail = line ? readLineEnd(xml, "tail") : undefined;
    const lineHeadSize = line ? readLineEndSize(xml, "head") : undefined;
    const lineTailSize = line ? readLineEndSize(xml, "tail") : undefined;
    return {
      type: "shape",
      ...box,
      shapeType,
      ...(corner ? { radius: corner } : {}),
      fill: line ? "transparent" : paint.fill || "transparent",
      ...(paint.stroke
        ? {
            stroke: paint.stroke,
            strokeWidth: paint.strokeEmu
              ? (paint.strokeEmu / slide.emuWidth) * slide.width
              : 1,
            ...(strokeStyle ? { strokeStyle } : {}),
          }
        : {}),
      ...(lineHead ? { lineHead } : {}),
      ...(lineTail ? { lineTail } : {}),
      ...(lineHeadSize ? { lineHeadSize } : {}),
      ...(lineTailSize ? { lineTailSize } : {}),
      ...(flipH ? { flipH: true } : box.flipH ? { flipH: undefined } : {}),
      ...(flipV ? { flipV: true } : box.flipV ? { flipV: undefined } : {}),
      ...(rotation ? { rotation } : { rotation: undefined }),
    };
  }
  // cNvPr/extLst also uses a:ext, and that node has no cx/cy. The transform's
  // extent is the shape size; using the extension list made strokes EMU-thick
  // in a point-sized viewBox and flooded the slide.
  const xfrmBody = /<(?:a|p):xfrm\b[\s\S]*?<\/(?:a|p):xfrm>/.exec(xml)?.[0] || "";
  const ext = attrs(/<(?:a|p):ext\b([^>]*)\/?>/.exec(xfrmBody)?.[1] || "");
  const emuW = Number(ext.cx) || box.width || 1;
  const emuH = Number(ext.cy) || box.height || 1;
  const custom = /<a:custGeom\b/.test(xml) ? customPath(xml, emuW, emuH) : undefined;
  const d = custom?.d || (geom ? presetPath(geom, xml, custom?.w || emuW, custom?.h || emuH) : undefined);
  // Path units are the shape's own EMUs. A group may scale that space, but
  // a:ln w stays in slide EMUs. Passing the raw width pads the viewBox by
  // thousands of local units and paints the preset across the slide.
  const shapeEmu =
    slide.width > 0 && box.width > 0
      ? (box.width / slide.width) * slide.emuWidth
      : emuW;
  const presetStroke =
    paint.strokeEmu && shapeEmu > 0 ? (paint.strokeEmu * emuW) / shapeEmu : 0;
  const vector =
    d || !geom
      ? undefined
      : presetVector(
          geom,
          xml,
          emuW,
          emuH,
          paint.fill || "none",
          paint.stroke || "none",
          presetStroke,
          emuW > 0 && emuH > 0 ? { x: box.width / emuW, y: box.height / emuH } : undefined,
        );
  if (vector) {
    const scaleX = box.width / emuW;
    const scaleY = box.height / emuH;
    return {
      type: "image",
      x: box.x + vector.minX * scaleX,
      y: box.y + vector.minY * scaleY,
      width: Math.max(0, vector.width * scaleX),
      height: Math.max(0, vector.height * scaleY),
      src: vector.src,
      alt: "Slide shape",
      ...(flipH ? { flipH: true } : box.flipH ? { flipH: undefined } : {}),
      ...(flipV ? { flipV: true } : box.flipV ? { flipV: undefined } : {}),
      ...(rotation ? { rotation } : { rotation: undefined }),
    };
  }
  // An unlisted preset still occupies its box. Rotation is about that box's center,
  // which is how a tall round2SameRect becomes a horizontal bar.
  if (!d) {
    return {
      type: "shape",
      ...box,
      shapeType: "rect",
      fill: paint.fill || "transparent",
      ...(paint.stroke
        ? {
            stroke: paint.stroke,
            strokeWidth: paint.strokeEmu
              ? (paint.strokeEmu / slide.emuWidth) * slide.width
              : 1,
          }
        : {}),
      ...(flipH ? { flipH: true } : box.flipH ? { flipH: undefined } : {}),
      ...(flipV ? { flipV: true } : box.flipV ? { flipV: undefined } : {}),
      ...(rotation ? { rotation } : { rotation: undefined }),
    };
  }
  const viewW = custom?.w || emuW;
  const viewH = custom?.h || emuH;
  // The box is already in slide space. Path coordinates stay local, so an unscaled EMU stroke floods it.
  const strokeWidth =
    paint.strokeEmu && shapeEmu > 0 ? (paint.strokeEmu * viewW) / shapeEmu : 0;
  return {
    type: "image",
    ...box,
    src: svgData(
      d,
      viewW,
      viewH,
      paint.fill || "none",
      custom && !custom.pen ? "none" : paint.stroke || "none",
      strokeWidth,
      geom === "donut",
      strokeDashArray(paint.dash, strokeWidth),
      custom?.fillD,
      {
        head: readLineEnd(xml, "head"),
        tail: readLineEnd(xml, "tail"),
        headSize: readLineEndSize(xml, "head"),
        tailSize: readLineEndSize(xml, "tail"),
        ...lineStrokeStyle(xml),
        boxW: box.width,
        boxH: box.height,
        strokePt: paint.strokeEmu ? (paint.strokeEmu / slide.emuWidth) * slide.width : 0,
      },
    ),
    alt: "Slide shape",
    ...(flipH ? { flipH: true } : box.flipH ? { flipH: undefined } : {}),
    ...(flipV ? { flipV: true } : box.flipV ? { flipV: undefined } : {}),
    ...(rotation ? { rotation } : { rotation: undefined }),
  };
}

/**
 * A horizontal or vertical connector with no thickness still has to occupy its
 * stroke, or the line collapses to nothing when the page is scaled.
 */
export function lineFrame(box: {
  x: number;
  y: number;
  width: number;
  height: number;
  strokeWidth?: number;
}) {
  const stroke = Math.max(box.strokeWidth || 1, 1);
  let { x, y, width, height } = box;
  if (width < stroke) {
    x -= (stroke - width) / 2;
    width = stroke;
  }
  if (height < stroke) {
    y -= (stroke - height) / 2;
    height = stroke;
  }
  return { x, y, width, height };
}

/** Non-placeholder shapes on a layout or master, in document order. */
export function inheritedShapes(
  partXml: string,
  themeXml: string | undefined,
  metrics: Metrics,
  mapXml?: string,
  background?: string,
): { at: number; element: Omit<SlideElement, "id"> }[] {
  const drawn: { at: number; element: Omit<SlideElement, "id"> }[] = [];
  for (const match of partXml.matchAll(
    /<p:sp\b[\s\S]*?<\/p:sp>|<p:cxnSp\b[\s\S]*?<\/p:cxnSp>/g,
  )) {
    if (shapeIsHidden(match[0]) || insideHiddenGroup(partXml, match.index ?? 0))
      continue;
    if (/<p:ph\b/.test(match[0]) || /<a:blip\b/.test(match[0])) continue;
    const box = placedBox(partXml, match.index, match[0], metrics);
    if (!box) continue;
    const groupFill = /<a:grpFill\b/.test(match[0])
      ? groupFillXml(partXml, match.index ?? 0)
      : "";
    const paintXml = groupFill
      ? match[0].replace(/<a:grpFill\b[^>]*\/>/, groupFill)
      : match[0];
    const art = shapeArtwork(
      paintXml,
      themePaint(themeXml, paintXml, mapXml, background),
      box,
      metrics,
    );
    if (art)
      drawn.push({
        at: match.index ?? 0,
        element: { ...art, alt: art.alt || "Inherited slide artwork" },
      });
  }
  return drawn;
}
