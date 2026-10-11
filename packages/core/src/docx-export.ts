import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import type { DocFile, JsonNode } from "./index";

import { documentPageSettings } from "./document-layout";

const color = (v: unknown) =>
  typeof v === "string" && /^#[\da-f]{6}$/i.test(v) ? v.slice(1) : undefined;
const alignment = (v: unknown) =>
  ({
    left: AlignmentType.LEFT,
    right: AlignmentType.RIGHT,
    center: AlignmentType.CENTER,
    justify: AlignmentType.JUSTIFIED,
  })[String(v) as "left"];
function imageSize(data: Uint8Array, type: string): [number, number] {
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
function runs(node: JsonNode): ParagraphChild[] {
  return (node.content ?? []).flatMap((n): ParagraphChild[] => {
    if (n.type === "hardBreak") return [new TextRun({ break: 1 })];
    if (n.type === "image") {
      const match = /^data:image\/(png|jpeg|gif);base64,(.*)$/i.exec(
        String(n.attrs?.src),
      );
      if (!match) return [new TextRun(String(n.attrs?.alt ?? "[Image]"))];
      const data = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
      const [naturalWidth, naturalHeight] = imageSize(data, match[1]);
      const requestedWidth = Number(n.attrs?.width) || naturalWidth;
      const requestedHeight =
        Number(n.attrs?.height) ||
        (naturalHeight * requestedWidth) / naturalWidth;
      const scale = Math.min(1, 600 / requestedWidth, 800 / requestedHeight);
      return [
        new ImageRun({
          type: match[1] === "jpeg" ? "jpg" : (match[1] as "png" | "gif"),
          data,
          transformation: {
            width: requestedWidth * scale,
            height: requestedHeight * scale,
          },
          altText: {
            title: String(n.attrs?.alt ?? ""),
            description: String(n.attrs?.alt ?? ""),
            name: "Image",
          },
        }),
      ];
    }
    if (n.type !== "text") return runs(n);
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
            ? m.attrs.fontFamily
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
    if (link && /^(https?:|mailto:|tel:)/i.test(String(link.attrs?.href)))
      return [
        new ExternalHyperlink({
          link: String(link.attrs?.href),
          children: [run],
        }),
      ];
    return [run];
  });
}
function blocks(
  nodes: JsonNode[],
  list?: { ordered: boolean; level: number },
): (Paragraph | Table)[] {
  return nodes.flatMap((n): (Paragraph | Table)[] => {
    if (n.type === "bulletList" || n.type === "orderedList")
      return blocks(n.content ?? [], {
        ordered: n.type === "orderedList",
        level: list ? Math.min(8, list.level + 1) : 0,
      });
    if (n.type === "listItem" || n.type === "blockquote")
      return blocks(n.content ?? [], list);
    if (n.type === "table")
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: (n.content ?? []).map(
            (row) =>
              new TableRow({
                children: (row.content ?? []).map(
                  (cell) =>
                    new TableCell({
                      columnSpan: Number(cell.attrs?.colspan) || 1,
                      rowSpan: Number(cell.attrs?.rowspan) || 1,
                      verticalAlign: VerticalAlign.TOP,
                      children: blocks(cell.content ?? []),
                    }),
                ),
              }),
          ),
        }),
      ];
    if (n.type === "pageBreak")
      return [new Paragraph({ pageBreakBefore: true })];
    if (n.type === "horizontalRule")
      return [
        new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "808080" },
          },
        }),
      ];
    const children =
      n.type === "image" ? runs({ type: "paragraph", content: [n] }) : runs(n);
    return [
      new Paragraph({
        children,
        alignment: alignment(n.attrs?.textAlign),
        heading:
          n.type === "heading"
            ? ([
                HeadingLevel.HEADING_1,
                HeadingLevel.HEADING_2,
                HeadingLevel.HEADING_3,
                HeadingLevel.HEADING_4,
                HeadingLevel.HEADING_5,
                HeadingLevel.HEADING_6,
              ][Number(n.attrs?.level) - 1] ?? HeadingLevel.HEADING_1)
            : undefined,
        ...(list
          ? list.ordered
            ? { numbering: { reference: "suiteleaf-list", level: list.level } }
            : { bullet: { level: list.level } }
          : {}),
      }),
    ];
  });
}
export async function exportDocx(
  file: Pick<DocFile, "title" | "content">,
): Promise<Uint8Array> {
  const content = structuredClone(file.content);
  const prepareImages = async (node: JsonNode): Promise<void> => {
    if (
      node.type === "image" &&
      String(node.attrs?.src).startsWith("data:image/webp")
    ) {
      if (typeof document === "undefined")
        throw new Error(
          "WebP images need the browser image converter for DOCX export.",
        );
      const img = document.createElement("img");
      img.src = String(node.attrs?.src);
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not convert the image for DOCX export.");
      ctx.drawImage(img, 0, 0);
      node.attrs = { ...node.attrs, src: canvas.toDataURL("image/png") };
    }
    await Promise.all((node.content ?? []).map(prepareImages));
  };
  await prepareImages(content);
  const settings = documentPageSettings(content);
  const [width, height] =
    settings.size === "a4" ? [11906, 16838] : [12240, 15840];
  const doc = new Document({
    title: file.title,
    creator: "SuiteLeaf",
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
    numbering: {
      config: [
        {
          reference: "suiteleaf-list",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: "decimal" as const,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } },
            },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: settings.landscape ? height : width,
              height: settings.landscape ? width : height,
            },
            margin: {
              top: settings.margin * 15,
              bottom: settings.margin * 15,
              left: settings.margin * 15,
              right: settings.margin * 15,
              header: 360,
              footer: 360,
            },
          },
        },
        headers: {
          default: new Header({ children: [new Paragraph(settings.header)] }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun(settings.footer),
                  ...(settings.pageNumbers
                    ? [
                        new TextRun({
                          children: [
                            "  ",
                            PageNumber.CURRENT,
                            " / ",
                            PageNumber.TOTAL_PAGES,
                          ],
                        }),
                      ]
                    : []),
                ],
              }),
            ],
          }),
        },
        children: blocks(content.content ?? []),
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}
