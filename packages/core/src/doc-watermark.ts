import { Paragraph, type ParagraphChild } from "docx";
import { TextWatermark } from "docx/watermarks";
import { watermarkText } from "./document-layout";

/**
 * A Word text watermark for the page header, or null when none is set.
 * Word stores this as a shape behind the text, not as a body paragraph.
 */
export function docxWatermarkParagraph(text: string): Paragraph | null {
  const word = watermarkText(text);
  if (!word) return null;
  const shape = new TextWatermark({
    text: word,
    font: "Arial",
    color: "silver",
    opacity: 0.4,
    layout: "horizontal",
  });
  return new Paragraph({ children: [shape as ParagraphChild] });
}
