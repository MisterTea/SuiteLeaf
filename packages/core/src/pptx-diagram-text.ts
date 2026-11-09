import type { SlideElement, TextRun } from "./index";
import { presentationLineHeight, presentationParagraphRuns } from "./pptx-line-spacing";

export type DiagramParagraph = {
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
  lineHeightPt?: number;
  spaceBefore?: number;
  exactLine?: boolean;
};

export function diagramTextElement(
  tx: string,
  paragraphs: DiagramParagraph[],
  textBox: { x: number; y: number; width: number; height: number },
  metrics: { emuWidth: number; width: number },
  fontColor?: string,
): Omit<SlideElement, "id"> {
  const body: Record<string, string> = {};
  const opening = /<a:bodyPr\b([^>]*)\/?>/.exec(tx)?.[1] || "";
  for (const match of opening.matchAll(/([A-Za-z0-9:]+)="([^"]*)"/g))
    body[match[1]] = match[2];
  const inset = (name: string, fallback: number) =>
    (Math.max(0, Number(body[name] ?? fallback) || 0) / metrics.emuWidth) *
    metrics.width;
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
    body.anchor === "ctr"
      ? "middle"
      : body.anchor === "b"
        ? "bottom"
        : undefined;
  return {
    type: "text",
    ...textBox,
    content: paragraphs.map((paragraph) => paragraph.text).join("\n"),
    runs: presentationParagraphRuns(paragraphs),
    bold: first?.bold,
    italic: first?.italic,
    ...(first?.underline ? { underline: true } : {}),
    fontSize: first?.size || 18,
    fontFamily: first?.font || "Arial",
    color: first?.color || fontColor || "#1e293b",
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
    lineHeight: presentationLineHeight(first?.lineHeight, first?.exactLine),
    ...(first?.lineHeightPt ? { lineHeightPt: first.lineHeightPt } : {}),
    ...(body.wrap === "none" ? { nowrap: true } : {}),
    ...(/^(?:1|true)$/.test(body.spcFirstLastPara) ? { paragraphEdgeSpacing: true } : {}),
  };
}
