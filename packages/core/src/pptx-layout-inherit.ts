import { composeRotation, mapThroughGroups, readGroups } from "./pptx-group-xform";
import { presetTextBox } from "./pptx-preset-geometry";
import { plainWordArt } from "./pptx-word-art";

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

function mapGrouped(
  partXml: string,
  at: number,
  emuX: number,
  emuY: number,
  emuW: number,
  emuH: number,
) {
  return mapThroughGroups(readGroups(partXml), at, emuX, emuY, emuW, emuH);
}

/**
 * Fill a child inherits with `a:grpFill`. The nearest ancestor group that has
 * its own fill wins. A group that only forwards `grpFill` is skipped.
 */
export function groupFillXml(partXml: string, at: number): string {
  const chain = readGroups(partXml)
    .filter((group) => at >= group.childStart && at < group.end)
    .sort((a, b) => b.childStart - a.childStart);
  for (const group of chain) {
    const pr = group.pr;
    if (/<a:grpFill\b/.test(pr)) continue;
    if (/<a:noFill\b/.test(pr)) return "<a:noFill/>";
    const paint = /<a:(solidFill|gradFill)\b[\s\S]*?<\/a:\1>/.exec(pr)?.[0];
    if (paint) return paint;
  }
  return "";
}

/** Child coordinates of a layout or master shape, mapped onto the slide. */
export function placedBox(
  partXml: string,
  at: number,
  shapeXml: string,
  metrics: Metrics,
): Box | undefined {
  const xfrm = /<(?:a|p):xfrm\b[\s\S]*?<\/(?:a|p):xfrm>/.exec(shapeXml)?.[0];
  if (!xfrm) return undefined;
  const off = attrs(/<(?:a|p):off\b([^>]*)\/?>/.exec(xfrm)?.[1] || "");
  const ext = attrs(/<(?:a|p):ext\b([^>]*)\/?>/.exec(xfrm)?.[1] || "");
  if (!off.x && !off.y && !ext.cx && !ext.cy) return undefined;
  const mapped = mapGrouped(
    partXml,
    at,
    Number(off.x) || 0,
    Number(off.y) || 0,
    Number(ext.cx) || 1,
    Number(ext.cy) || 1,
  );
  return {
    x: (mapped.emuX / metrics.emuWidth) * metrics.width,
    y: (mapped.emuY / metrics.emuHeight) * metrics.height,
    width: Math.max(0, (mapped.emuW / metrics.emuWidth) * metrics.width),
    height: Math.max(0, (mapped.emuH / metrics.emuHeight) * metrics.height),
    ...(mapped.rotation ? { rotation: mapped.rotation } : {}),
    ...(mapped.flipH ? { flipH: true } : {}),
    ...(mapped.flipV ? { flipV: true } : {}),
  };
}

/** Date, footer, and slide number are one each. Layouts often renumber their idx. */
const SINGLE_PLACEHOLDERS = new Set(["dt", "ftr", "sldNum", "hdr"]);

/** Some producers write idx="-1" as an unsigned 32-bit sentinel. It matches no layout. */
function placeholderIdxUnset(idx: string) {
  return idx === "4294967295" || idx === "-1";
}

function placeholderIdentity(tag: string): { idx: string; type: string } | undefined {
  const parsed = attrs(tag);
  return { idx: parsed.idx || "0", type: parsed.type || "body" };
}

function samePlaceholderType(got: string, want: string) {
  const family = (type: string) =>
    type === "title" || type === "ctrTitle"
      ? "title"
      : type === "body" || type === "subTitle"
        ? "body"
        : type;
  return got === want || family(got) === family(want);
}

/** Layout or master shape that supplies a placeholder's missing transform. */
export function placeholderShape(partXml: string | undefined, shapeXml: string): string {
  if (!partXml) return "";
  const ph = /<p:ph\b([^>]*)\/?>/.exec(shapeXml);
  if (!ph) return "";
  const want = placeholderIdentity(ph[1]);
  if (!want) return "";
  const shapes = [
    ...partXml.matchAll(/<p:(sp|pic)\b[\s\S]*?<\/p:\1>/g),
  ].map((match) => match[0]);
  const typed = shapes.filter((candidate) => {
    const tag = /<p:ph\b([^>]*)\/?>/.exec(candidate);
    if (!tag) return false;
    const got = placeholderIdentity(tag[1]);
    return !!got && samePlaceholderType(got.type, want.type);
  });
  const exact = typed.find((candidate) => {
    const tag = /<p:ph\b([^>]*)\/?>/.exec(candidate);
    const got = tag ? placeholderIdentity(tag[1]) : undefined;
    return got?.idx === want.idx;
  });
  if (exact) return exact;
  // A sentinel idx, or the one date/footer/number, still inherits the only shape of that type.
  if (
    typed.length === 1 &&
    (placeholderIdxUnset(want.idx) || SINGLE_PLACEHOLDERS.has(want.type))
  )
    return typed[0];
  return "";
}

/**
 * Letters stay upright when a half turn is only there to cancel one flip.
 * PowerPoint mirrors the outline. `flipV` plus 180°, or `flipH` plus 180°,
 * is how a flipped title is stored, and the words still read left to right.
 * Any other rotation is kept. A flip with no half turn does not turn the text.
 */
export function readableTextRotation(
  rotation?: number,
  flipH?: boolean,
  flipV?: boolean,
): number | undefined {
  let turn = (((rotation || 0) % 360) + 360) % 360;
  const oneFlip = !!flipH !== !!flipV;
  if (oneFlip && Math.abs(turn - 180) < 0.05) turn = 0;
  if (turn < 0.05 || turn > 359.95) return undefined;
  return turn;
}

/** Rotation and flips from a DrawingML transform. Positive rotation is clockwise. */
export function drawingPose(xml: string): {
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
} {
  const xfrm = attrs(/<(?:a|p):xfrm\b([^>]*)>/.exec(xml)?.[1] || "");
  const rotation = Number(xfrm.rot) ? Number(xfrm.rot) / 60000 : undefined;
  return {
    ...(rotation ? { rotation } : {}),
    ...(xfrm.flipH === "1" || xfrm.flipH === "true" ? { flipH: true } : {}),
    ...(xfrm.flipV === "1" || xfrm.flipV === "true" ? { flipV: true } : {}),
  };
}

export type InheritedLabel = {
  txBody: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  valign?: "middle" | "bottom";
  inset?: number;
  padLeft?: number;
  padRight?: number;
  padBottom?: number;
  nowrap?: boolean;
  /** WordArt textPlain fills this box instead of using the stored point size. */
  stretchText?: boolean;
  textFlow?: "up" | "down" | "upright";
};

/** `vert270` reads upward. `vert` and `eaVert` are sideways, top to bottom. `wordArtVert` stacks upright letters. */
export function verticalTextFlow(vert: string | undefined): "up" | "down" | "upright" | undefined {
  return vert === "vert270"
    ? "up"
    : vert === "vert" || vert === "eaVert"
      ? "down"
      : vert === "wordArtVert"
        ? "upright"
        : undefined;
}

/**
 * A single-line label whose declared size does not fit its box.
 * PowerPoint's spAutoFit scales the type; the stored size is the unfitted one.
 */
export function fittedLabelSize(
  text: string,
  fontSize: number,
  width: number,
  height: number,
  nowrap: boolean,
): number {
  if (!nowrap || !(fontSize > 0) || !(width > 0) || !(height > 0)) return fontSize;
  const longest = Math.max(text.replace(/\n/g, "").length, 1);
  const byWidth = (width * 1.8) / longest;
  const byHeight = height / 1.15;
  return Math.max(6, Math.min(fontSize, byWidth, byHeight));
}

/**
 * Text drawn on a layout or master shape that is not a placeholder.
 * A noFill text box still has to paint; only its rectangle is absent.
 */
export function inheritedLabels(
  partXml: string,
  metrics: Metrics,
): InheritedLabel[] {
  const labels: InheritedLabel[] = [];
  for (const match of partXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    if (
      shapeIsHidden(match[0]) ||
      insideHiddenGroup(partXml, match.index ?? 0) ||
      /<p:ph\b/.test(match[0])
    )
      continue;
    const txBody = /<p:txBody\b[\s\S]*?<\/p:txBody>/.exec(match[0])?.[0];
    if (!txBody || !/<a:t\b[^>]*>[^<\s]/.test(txBody)) continue;
    const placed = placedBox(partXml, match.index ?? 0, match[0], metrics);
    if (!placed || !(placed.width > 0 && placed.height > 0)) continue;
    const box = presetTextBox(match[0], placed) ?? placed;
    const pose = drawingPose(match[0]);
    const rotation = composeRotation(
      placed.rotation,
      readableTextRotation(pose.rotation, pose.flipH, pose.flipV),
    );
    const bodyAttrs = attrs(/<a:bodyPr\b([^>]*)\/?>/.exec(txBody)?.[1] || "");
    const hasBody = /<a:bodyPr\b/.test(txBody);
    const insetDefault = (name: string) =>
      name === "tIns" || name === "bIns" ? 45720 : 91440;
    const insetOf = (name: string) =>
      (Math.max(0, Number(bodyAttrs[name] ?? insetDefault(name)) || 0) /
        metrics.emuWidth) *
      metrics.width;
    const top = insetOf("tIns");
    const right = insetOf("rIns");
    const bottom = insetOf("bIns");
    const left = insetOf("lIns");
    const textFlow = verticalTextFlow(bodyAttrs.vert);
    const stretchText = plainWordArt(txBody);
    labels.push({
      txBody,
      ...box,
      ...pose,
      ...(rotation ? { rotation } : { rotation: undefined }),
      ...(bodyAttrs.anchor === "ctr"
        ? { valign: "middle" }
        : bodyAttrs.anchor === "b"
          ? { valign: "bottom" }
          : {}),
      ...(hasBody
        ? stretchText
          ? { inset: 0, padLeft: 0, padRight: 0, padBottom: 0 }
          : {
              inset: top,
              padLeft: left,
              ...(right !== left ? { padRight: right } : {}),
              ...(bottom !== top ? { padBottom: bottom } : {}),
            }
        : {}),
      ...(bodyAttrs.wrap === "none" || stretchText ? { nowrap: true } : {}),
      ...(stretchText ? { stretchText: true } : {}),
      ...(textFlow ? { textFlow } : {}),
    });
  }
  return labels;
}

/** A drawing inside mc:Fallback is the copy for older apps. The Choice is the one to paint. */
export function insideFallback(xml: string, index: number): boolean {
  const start = xml.lastIndexOf("<mc:Fallback", index);
  if (start < 0) return false;
  const end = xml.indexOf("</mc:Fallback>", start);
  return end >= index;
}

/** `cNvPr hidden="1"` is omitted from the slideshow and from print. */
export function shapeIsHidden(xml: string) {
  return /<p:cNvPr\b[^>]*\bhidden="(?:1|true)"/.test(xml);
}

/**
 * A hidden group stays out of the slideshow, including every shape inside it.
 * The flag sits on the group's own `cNvPr`, not on the children.
 */
export function insideHiddenGroup(xml: string, index: number): boolean {
  const token = /<p:grpSp\b|<\/p:grpSp>/g;
  const stack: boolean[] = [];
  let match: RegExpExecArray | null;
  while ((match = token.exec(xml))) {
    if (match.index >= index) break;
    if (match[0].startsWith("</")) {
      stack.pop();
      continue;
    }
    const nvEnd = xml.indexOf("</p:nvGrpSpPr>", match.index);
    const head = nvEnd > match.index ? xml.slice(match.index, nvEnd) : "";
    stack.push(/<p:cNvPr\b[^>]*\bhidden="(?:1|true)"/.test(head));
  }
  return stack.some(Boolean);
}

function spPrOf(xml: string) {
  return (
    /<p:spPr\b[^>]*\/>/.exec(xml)?.[0] ||
    /<p:spPr\b[\s\S]*?<\/p:spPr>/.exec(xml)?.[0] ||
    ""
  );
}

function fillState(xml: string): "fill" | "none" | "inherit" {
  const host = spPrOf(xml).replace(/<a:ln\b[^>]*\/>|<a:ln\b[\s\S]*?<\/a:ln>/g, "");
  if (/<a:noFill\b/.test(host)) return "none";
  if (/<a:(?:solidFill|gradFill|blipFill|pattFill|grpFill)\b/.test(host)) return "fill";
  return "inherit";
}

/**
 * A placeholder that does not set its own fill uses the layout or master
 * placeholder fill, including a translucent band over a picture.
 */
export function withInheritedFill(
  shapeXml: string,
  layoutXml: string,
  masterXml: string,
) {
  if (fillState(shapeXml) !== "inherit") return shapeXml;
  const inherited = [layoutXml, masterXml].find((xml) => xml && fillState(xml) === "fill");
  const fill = inherited
    ? /<a:(solidFill|gradFill)\b[\s\S]*?<\/a:\1>/.exec(spPrOf(inherited))?.[0]
    : undefined;
  if (fill) {
    if (/<p:spPr\b[^>]*\/>/.test(shapeXml))
      return shapeXml.replace(/<p:spPr\b[^>]*\/>/, `<p:spPr>${fill}</p:spPr>`);
    if (/<p:spPr\b/.test(shapeXml))
      return shapeXml.replace(/<p:spPr\b([^>]*)>/, `<p:spPr$1>${fill}`);
    return `<p:spPr>${fill}</p:spPr>${shapeXml}`;
  }
  // A placeholder style fillRef is the box colour when spPr has no paint.
  if (/<p:style\b/.test(shapeXml)) return shapeXml;
  const style = [layoutXml, masterXml]
    .map((xml) => /<p:style\b[\s\S]*?<\/p:style>/.exec(xml || "")?.[0])
    .find(Boolean);
  return style ? `${shapeXml}${style}` : shapeXml;
}

function stopColor(token: string) {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(token);
  if (hex) {
    return [
      parseInt(hex[1].slice(0, 2), 16),
      parseInt(hex[1].slice(2, 4), 16),
      parseInt(hex[1].slice(4, 6), 16),
      1,
    ];
  }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(token);
  if (!rgba) return undefined;
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
}

/** Scheme colours and the sRGB copy of the same stop can differ by a byte. */
function sameGradient(a: string, b: string) {
  const angle = (fill: string) => Number(/([-\d.]+)deg/.exec(fill)?.[1] ?? NaN);
  if (Math.abs(angle(a) - angle(b)) > 0.05) return false;
  const stops = (fill: string) =>
    [...fill.matchAll(/(#[0-9a-fA-F]{6}|rgba\([^)]*\))\s+([\d.]+)%/g)].map((match) => ({
      color: stopColor(match[1]),
      pos: Number(match[2]),
    }));
  const left = stops(a);
  const right = stops(b);
  if (!left.length || left.length !== right.length) return false;
  return left.every((stop, index) => {
    const other = right[index];
    if (!stop.color || !other.color || Math.abs(stop.pos - other.pos) > 0.5) return false;
    return stop.color.every((channel, channelIndex) => {
      const limit = channelIndex === 3 ? 0.02 : 2;
      return Math.abs(channel - other.color![channelIndex]) <= limit;
    });
  });
}

/**
 * Google Slides writes the slide background a second time as a full-width
 * rectangle. Painting that rectangle on top of `p:bg` stacks the fade.
 */
export function repeatsSlideBackground(
  element: {
    type?: string;
    shapeType?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fill?: string;
  },
  background: string | undefined,
  slide: { width: number; height: number },
) {
  if (!background || !background.includes("gradient(")) return false;
  if (element.type !== "shape" || (element.shapeType && element.shapeType !== "rect"))
    return false;
  if (!element.fill || !sameGradient(element.fill, background)) return false;
  if (element.x > 1 || element.y > 1) return false;
  if (element.width < slide.width * 0.95) return false;
  if (element.height < slide.height * 0.5) return false;
  return true;
}
