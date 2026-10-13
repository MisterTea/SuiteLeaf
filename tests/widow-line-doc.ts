import { createFile, serializeFile, type DocFile } from "../packages/core/src";

/**
 * One-line paragraphs before the heading, then a short paragraph whose last
 * line is "See you Saturday." The counts are tuned so that line is alone at
 * the top of page 2 and the heading stays on page 1.
 */
export const widowLeadIn = 35;
export const widowLineCount = 9;

const filler = [
  "The beds along the fence are ready for winter.",
  "Saturday rain filled every water jar.",
  "The tool library has spare gloves again.",
  "The leaves turned warm after the last rain.",
  "New members can pick up a plot map.",
  "Questions go to the board before Friday.",
];

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

/** Nia's newsletter, with the closing line left alone at the top of page 2. */
export function widowNewsletter(
  lineCount = widowLineCount,
  leadIn = widowLeadIn,
): DocFile {
  const file = createFile("doc", "Garden club news");
  if (file.kind !== "doc") throw new Error("expected a document");
  const lines = Array.from({ length: lineCount }, (_, index) => {
    if (index === lineCount - 1) return "See you Saturday.";
    if (index === lineCount - 2) return "Bring a chair if you can.";
    if (index === lineCount - 3) return "Roses stay on this page.";
    return filler[index % filler.length];
  });
  const content: { type: string; text?: string }[] = [];
  lines.forEach((text, index) => {
    if (index) content.push({ type: "hardBreak" });
    content.push({ type: "text", text });
  });
  file.content = {
    type: "doc",
    content: [
      ...Array.from({ length: leadIn }, (_, index) =>
        paragraph(filler[index % filler.length]),
      ),
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "This month" }],
      },
      { type: "paragraph", content },
      paragraph("The board meets Monday."),
    ],
  };
  return file;
}

export function widowNewsletterRecord(
  lineCount = widowLineCount,
  leadIn = widowLeadIn,
) {
  const file = widowNewsletter(lineCount, leadIn);
  return {
    id: file.id,
    title: file.title,
    updatedAt: file.updatedAt,
    native: serializeFile(file),
  };
}
