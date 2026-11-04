import {
  AlignmentType,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  EndnoteReferenceRun,
  ExternalHyperlink,
  FootnoteReferenceRun,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  ImageRun,
  Math as OfficeMath,
  MathFraction,
  MathRun,
  MathSubScript,
  MathSuperScript,
  SimpleField,
  Tab,
  TextRun,
  TextWrappingSide,
  TextWrappingType,
  UnderlineType,
  VerticalPositionAlign,
  VerticalPositionRelativeFrom,
  type IRunOptions,
  type MathComponent,
  type ParagraphChild,
} from "docx";
import type { JsonNode } from "./index";
import { asEquation, type EqNode } from "./equations";
import { officeFont } from "./office-fonts";
import type { DocxCommentPlan } from "./doc-comments";
import { inText, type CitationLibrary } from "./citations";
import { croppedFrame, docxImageCrop, imageCrop } from "./image-crop";
import { imageWrap } from "./image-wrap";

const color = (v: unknown) =>
  typeof v === "string" && /^#[\da-f]{6}$/i.test(v) ? v.slice(1) : undefined;
export const alignment = (v: unknown) =>
  ({
    left: AlignmentType.LEFT,
    right: AlignmentType.RIGHT,
    center: AlignmentType.CENTER,
    justify: AlignmentType.JUSTIFIED,
  })[String(v) as "left"];
/**
 * Word announces `descr` and can fall back to the required drawing `name`.
 * Both are the description someone wrote, never the file name or "Image".
 */
export function docxImageAlt(alt: unknown): {
  title: string;
  description: string;
  name: string;
} {
  const description = typeof alt === "string" ? alt : "";
  return { title: description, description, name: description || "photo" };
}
export function imageSize(data: Uint8Array, type: string): [number, number] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (type === "png" && data.length >= 24)
    return [view.getUint32(16), view.getUint32(20)];
  if (type === "gif" && data.length >= 10)
    return [view.getUint16(6, true), view.getUint16(8, true)];
  if (type === "jpeg")
    for (let offset = 2; offset + 9 < data.length;) {
      if (data[offset] !== 255) break;
      const marker = data[offset + 1],
        length = view.getUint16(offset + 2);
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      )
        return [view.getUint16(offset + 7), view.getUint16(offset + 5)];
      if (length < 2) break;
      offset += length + 2;
    }
  return [480, 320];
}
function marked(
  plan: DocxCommentPlan,
  index: number,
  edge: "starts" | "ends",
): ParagraphChild[] {
  return (plan[edge].get(index) ?? []).flatMap((id) =>
    edge === "starts"
      ? [new CommentRangeStart(id)]
      : [new CommentRangeEnd(id), new CommentReference(id)],
  );
}
export type NoteSlot = { kind: "footnote" | "endnote"; num: number };
function exprToMath(node: EqNode): MathComponent[] {
  switch (node.kind) {
    case "text":
      return node.text ? [new MathRun(node.text)] : [];
    case "sup":
      return [
        new MathSuperScript({
          children: exprToMath(node.base),
          superScript: exprToMath(node.exp),
        }),
      ];
    case "sub":
      return [
        new MathSubScript({
          children: exprToMath(node.base),
          subScript: exprToMath(node.sub),
        }),
      ];
    case "frac":
      return [
        new MathFraction({
          numerator: exprToMath(node.num),
          denominator: exprToMath(node.den),
          type: "stacked",
        }),
      ];
    case "row":
      return node.items.flatMap(exprToMath);
  }
}
function equationChildren(node: JsonNode): ParagraphChild[] {
  const children = exprToMath(asEquation(node.attrs?.expr));
  if (!children.length) return [new TextRun(String(node.attrs?.plain ?? ""))];
  return [new OfficeMath({ children })];
}
export function runs(
  node: JsonNode,
  plan: DocxCommentPlan,
  notes: Map<string, NoteSlot>,
  library: CitationLibrary,
): ParagraphChild[] {
  return (node.content ?? []).flatMap((n): ParagraphChild[] => {
    if (n.type === "citation") {
      const source = library.sources.find(
        (item) => item.id === String(n.attrs?.sourceId ?? ""),
      );
      if (!source) return [];
      return [
        new SimpleField(
          ` CITATION ${source.tag} \\l 1033 `,
          inText(source, library.style),
        ),
      ];
    }
    if (n.type === "noteReference") {
      const slot = notes.get(String(n.attrs?.id ?? ""));
      if (!slot) return [];
      return [
        slot.kind === "endnote"
          ? new EndnoteReferenceRun(slot.num)
          : new FootnoteReferenceRun(slot.num),
      ];
    }
    if (n.type === "hardBreak") return [new TextRun({ break: 1 })];
    if (n.type === "tab") return [new TextRun({ children: [new Tab()] })];
    if (n.type === "image" || n.type === "inlineImage") {
      const match = /^data:image\/(png|jpeg|gif);base64,(.*)$/i.exec(
        String(n.attrs?.src),
      );
      if (!match) return [new TextRun(String(n.attrs?.alt ?? "[Image]"))];
      const data = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
      const [naturalWidth, naturalHeight] = imageSize(data, match[1]);
      const explicitWidth = Number(n.attrs?.width);
      const explicitHeight = Number(n.attrs?.height);
      const sized = explicitWidth > 0 && explicitHeight > 0;
      const requestedWidth = sized ? explicitWidth : naturalWidth;
      const requestedHeight = sized
        ? explicitHeight
        : (naturalHeight * requestedWidth) / naturalWidth;
      const scale = sized
        ? 1
        : Math.min(1, 600 / requestedWidth, 800 / requestedHeight);
      const crop = imageCrop(n.attrs);
      // The frame is the cropped region at the same scale as the full picture.
      // `data` stays the whole image so Word's crop reset can reveal it.
      const frame = croppedFrame(
        { width: requestedWidth * scale, height: requestedHeight * scale },
        crop,
      );
      const docxCrop = docxImageCrop(crop);
      const wrap = n.type === "image" ? imageWrap(n.attrs) : null;
      const beside = wrap === "left" || wrap === "right";
      return [
        new ImageRun({
          type: match[1] === "jpeg" ? "jpg" : (match[1] as "png" | "gif"),
          data,
          transformation: {
            width: Math.max(1, frame.width),
            height: Math.max(1, frame.height),
          },
          ...(docxCrop ? { crop: docxCrop } : {}),
          ...(beside
            ? {
                floating: {
                  horizontalPosition: {
                    relative: HorizontalPositionRelativeFrom.COLUMN,
                    align:
                      wrap === "right"
                        ? HorizontalPositionAlign.RIGHT
                        : HorizontalPositionAlign.LEFT,
                  },
                  verticalPosition: {
                    relative: VerticalPositionRelativeFrom.PARAGRAPH,
                    align: VerticalPositionAlign.TOP,
                  },
                  wrap: {
                    type: TextWrappingType.SQUARE,
                    side: TextWrappingSide.BOTH_SIDES,
                  },
                },
              }
            : {}),
          altText: docxImageAlt(n.attrs?.alt),
        }),
      ];
    }
    if (n.type === "note") return [];
    if (n.type === "equation") return equationChildren(n);
    if (n.type !== "text") return runs(n, plan, notes, library);
    const index = plan.index;
    plan.index += 1;
    const opts: { -readonly [K in keyof IRunOptions]: IRunOptions[K] } = {
      text: n.text ?? "",
    };
    for (const m of n.marks ?? []) {
      if (m.type === "bold") opts.bold = true;
      if (m.type === "italic") opts.italics = true;
      if (m.type === "strike") opts.strike = true;
      if (m.type === "underline")
        opts.underline = { type: UnderlineType.SINGLE };
      if (m.type === "superscript") opts.superScript = true;
      if (m.type === "subscript") opts.subScript = true;
      if (m.type === "code") opts.font = "Courier New";
      if (m.type === "textStyle") {
        opts.font =
          typeof m.attrs?.fontFamily === "string"
            ? officeFont(m.attrs.fontFamily)
            : undefined;
        opts.color = color(m.attrs?.color);
        const size = parseFloat(String(m.attrs?.fontSize));
        if (size > 0)
          opts.size =
            size * (String(m.attrs?.fontSize).endsWith("px") ? 1.5 : 2);
      }
      if (m.type === "highlight")
        opts.shading = { fill: color(m.attrs?.color) ?? "FFFF00" };
    }
    const run = new TextRun(opts);
    const link = n.marks?.find((m) => m.type === "link");
    const body: ParagraphChild =
      link && /^(https?:|mailto:|tel:)/i.test(String(link.attrs?.href))
        ? new ExternalHyperlink({
            link: String(link.attrs?.href),
            children: [run],
          })
        : run;
    return [...marked(plan, index, "starts"), body, ...marked(plan, index, "ends")];
  });
}
