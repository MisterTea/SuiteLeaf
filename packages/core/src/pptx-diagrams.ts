import type JSZip from "jszip";
import type { SlideElement, TextRun } from "./index";
import { shapeArtwork, shapeIsHidden } from "./pptx-geometry";
import { themePaint } from "./pptx-theme";

type Metrics = {
  width: number;
  height: number;
  emuWidth: number;
  emuHeight: number;
};

type Paragraph = {
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
};

type Zip = Pick<JSZip, "file">;

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z0-9:]+)="([^"]*)"/g))
    out[match[1]] = match[2];
  return out;
}

function resolveZipPath(basePath: string, relativePath: string): string {
  if (relativePath.startsWith("/")) return relativePath.slice(1);
  const parts = basePath.split("/");
  parts.pop();
  for (const seg of relativePath.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

function boxOf(xfrm: string, metrics: Metrics, dx = 0, dy = 0) {
  const off = attrs(/<(?:a|p):off\b([^>]*)\/?>/.exec(xfrm)?.[1] || "");
  const ext = attrs(/<(?:a|p):ext\b([^>]*)\/?>/.exec(xfrm)?.[1] || "");
  const emuX = (Number(off.x) || 0) + dx;
  const emuY = (Number(off.y) || 0) + dy;
  const emuW = Number(ext.cx) || 0;
  const emuH = Number(ext.cy) || 0;
  if (!(emuW > 0 && emuH > 0)) return;
  return {
    x: (emuX / metrics.emuWidth) * metrics.width,
    y: (emuY / metrics.emuHeight) * metrics.height,
    width: (emuW / metrics.emuWidth) * metrics.width,
    height: (emuH / metrics.emuHeight) * metrics.height,
  };
}

/** Drawing coordinates are local to the graphic frame. */
function shiftOffs(xml: string, dx: number, dy: number): string {
  return xml.replace(/<a:off\b([^>]*)\/?>/g, (tag, body: string) => {
    const tagAttrs = attrs(body);
    const x = (Number(tagAttrs.x) || 0) + dx;
    const y = (Number(tagAttrs.y) || 0) + dy;
    return `<a:off x="${x}" y="${y}"/>`;
  });
}

function asSlideShape(dspXml: string, dx: number, dy: number): string {
  return shiftOffs(dspXml, dx, dy)
    .replace(/<dsp:/g, "<p:")
    .replace(/<\/dsp:/g, "</p:");
}

/**
 * SmartArt saved with a diagram drawing. The drawing is the picture PowerPoint
 * paints; an empty drawing has no shapes to place.
 */
export async function diagramElements(
  zip: Zip,
  slidePath: string,
  slideRels: Record<string, { target: string; type: string }>,
  frameXml: string,
  drawingIndex: number,
  metrics: Metrics,
  themeXml: string | undefined,
  mapXml: string | undefined,
  parseText: (
    txBody: string,
    inherited: string[],
    defaults?: { color?: string },
  ) => Paragraph[],
): Promise<Omit<SlideElement, "id">[]> {
  if (!/<dgm:relIds\b/.test(frameXml)) return [];
  const drawings = Object.values(slideRels).filter((rel) =>
    rel.type.endsWith("/diagramDrawing"),
  );
  const rel = drawings[drawingIndex];
  if (!rel) return [];
  const drawingPath = resolveZipPath(slidePath, rel.target);
  const drawing = await zip.file(drawingPath)?.async("string");
  if (!drawing) return [];
  const frameXfrm =
    /<(?:a|p):xfrm\b[\s\S]*?<\/(?:a|p):xfrm>/.exec(frameXml)?.[0] ?? "";
  const frameOff = attrs(/<(?:a|p):off\b([^>]*)\/?>/.exec(frameXfrm)?.[1] || "");
  const dx = Number(frameOff.x) || 0;
  const dy = Number(frameOff.y) || 0;
  const elements: Omit<SlideElement, "id">[] = [];
  for (const match of drawing.matchAll(/<dsp:sp\b[\s\S]*?<\/dsp:sp>/g)) {
    const xml = asSlideShape(match[0], dx, dy);
    if (shapeIsHidden(xml)) continue;
    const xfrm = /<p:spPr\b[\s\S]*?<a:xfrm\b[\s\S]*?<\/a:xfrm>/.exec(xml)?.[0] ?? "";
    const shapeXfrm = /<a:xfrm\b[\s\S]*?<\/a:xfrm>/.exec(xfrm)?.[0] ?? "";
    const box = boxOf(shapeXfrm, metrics);
    if (!box) continue;
    const paint = themePaint(themeXml, xml, mapXml);
    const art =
      paint.fill || paint.stroke
        ? shapeArtwork(xml, paint, box, metrics)
        : undefined;
    if (art) elements.push({ ...art, alt: "Diagram shape" });
    const tx = /<p:txBody\b[\s\S]*?<\/p:txBody>/.exec(xml)?.[0];
    if (!tx) continue;
    const paragraphs = parseText(tx, [], { color: paint.fontColor });
    if (!paragraphs.some((paragraph) => paragraph.text.trim())) continue;
    const textXfrm = /<p:txXfrm\b[\s\S]*?<\/p:txXfrm>/.exec(xml)?.[0] ?? shapeXfrm;
    const textBox = boxOf(textXfrm, metrics) ?? box;
    const body = attrs(/<a:bodyPr\b([^>]*)\/?>/.exec(tx)?.[1] || "");
    const inset = (name: string, fallback: number) =>
      ((Number(body[name] ?? fallback) || 0) / metrics.emuWidth) * metrics.width;
    const pad = /<a:bodyPr\b/.test(tx)
      ? {
          t: inset("tIns", 45720),
          r: inset("rIns", 91440),
          b: inset("bIns", 45720),
          l: inset("lIns", 91440),
        }
      : undefined;
    const first = paragraphs[0];
    const valign =
      body.anchor === "ctr" ? "middle" : body.anchor === "b" ? "bottom" : undefined;
    elements.push({
      type: "text",
      ...textBox,
      content: paragraphs.map((paragraph) => paragraph.text).join("\n"),
      runs: paragraphs.flatMap((paragraph, index) => [
        ...(index ? [{ text: "\n", paragraphBreak: true as const }] : []),
        ...paragraph.runs,
      ]),
      bold: first?.bold,
      italic: first?.italic,
      ...(first?.underline ? { underline: true } : {}),
      fontSize: first?.size || 18,
      fontFamily: first?.font || "Arial",
      color: first?.color || paint.fontColor || "#1e293b",
      align: first?.align || "left",
      bullet: paragraphs.some((paragraph) => paragraph.bullet),
      ...(valign ? { valign } : {}),
      ...(pad
        ? {
            inset: pad.t,
            padLeft: pad.l,
            ...(pad.r !== pad.l ? { padRight: pad.r } : {}),
            ...(pad.b !== pad.t ? { padBottom: pad.b } : {}),
          }
        : {}),
      ...(first?.lineHeight ? { lineHeight: first.lineHeight } : {}),
      ...(body.wrap === "none" ? { nowrap: true } : {}),
    });
  }
  return elements;
}
