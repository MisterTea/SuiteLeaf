import { Document, ImageRun, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";

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

/**
 * The market photo turned 90 degrees, its caption, the noon sentence, and a
 * second photo with no rot. `rot` "1000000" is not a quarter turn.
 */
export async function rotationStoryDocx(
  image: Uint8Array = tinyPng(),
  second: Uint8Array = tinyPng(),
  rot: "5400000" | "1000000" | null = "5400000",
): Promise<Uint8Array> {
  const picture = (
    data: Uint8Array,
    width: number,
    height: number,
    name: string,
    alt: string,
    rotation?: number,
  ) =>
    new Paragraph({
      children: [
        new ImageRun({
          type: "png",
          data,
          transformation: {
            width,
            height,
            ...(rotation ? { rotation } : {}),
          },
          altText: { title: alt, description: alt, name },
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
        children: [
          picture(
            image,
            280,
            160,
            "market",
            description,
            rot == null ? undefined : 90,
          ),
          caption,
          sentence,
          picture(second, 200, 120, "seedlings", "Seedlings.", undefined),
        ],
      },
    ],
  });
  const bytes = new Uint8Array(await Packer.toBuffer(doc));
  if (rot !== "1000000") return bytes;
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  zip.file("word/document.xml", xml.replace('rot="5400000"', 'rot="1000000"'));
  return zip.generateAsync({ type: "uint8array" });
}
