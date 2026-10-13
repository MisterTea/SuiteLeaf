import { Document, ImageRun, Packer, Paragraph, TextRun } from "docx";

export const description = "Fruit on a table.";
export const captionLine = "Saturday stall";
export const noonSentence = "We arrived at noon.";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function tinyPng(): Uint8Array {
  return Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
}

/**
 * A photo, then a Caption paragraph, then a normal sentence.
 * The sentence keeps a highlight, color, size, font, indent, line spacing,
 * and space before and after so those imports stay attached to it.
 */
export async function captionStoryDocx(
  image: Uint8Array = tinyPng(),
  order: "caption-then-sentence" | "sentence-then-caption" = "caption-then-sentence",
): Promise<Uint8Array> {
  const photo = new Paragraph({
    children: [
      new ImageRun({
        type: "png",
        data: image,
        transformation: { width: 280, height: 180 },
        altText: {
          title: description,
          description,
          name: "market",
        },
      }),
    ],
  });
  const caption = new Paragraph({
    style: "Caption",
    children: [new TextRun(captionLine)],
  });
  const sentence = new Paragraph({
    spacing: { before: 240, after: 120, line: 360, lineRule: "auto" },
    indent: { firstLine: 720 },
    children: [
      new TextRun("We arrived at "),
      new TextRun({
        text: "noon",
        font: "Georgia",
        size: 36,
        color: "C00000",
        highlight: "yellow",
      }),
      new TextRun("."),
    ],
  });
  const doc = new Document({
    styles: {
      paragraphStyles: [
        { id: "Caption", name: "Caption", basedOn: "Normal" },
      ],
    },
    sections: [
      {
        children:
          order === "caption-then-sentence"
            ? [photo, caption, sentence]
            : [photo, sentence, caption],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
