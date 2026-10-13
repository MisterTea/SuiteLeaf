import { createFile, serializeFile, type DocFile } from "../packages/core/src";

/**
 * One-line paragraphs, then a heading, then one line that stays with that
 * heading, then a three-line reminder. The counts are tuned so the reminder's
 * first line is the last line of page 1 and the other two start page 2.
 * The heading is not the block immediately before the reminder, so Keep with
 * next leaves the heading on page 1 when the reminder moves.
 */
export const keepLinesLeadIn = 41;

export const reminderLines = [
  "Bring gloves,",
  "a hat, and a trowel.",
  "Leave the gate closed.",
] as const;

export const keepLinesHeading = "What to bring";
export const keepLinesSpacer = "Meet at the gate.";
export const keepLinesLeftOff = "The board meets Monday.";

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

/** Nia's newsletter, with the reminder split across the page break. */
export function keepLinesNewsletter(leadIn = keepLinesLeadIn): DocFile {
  const file = createFile("doc", "Garden club news");
  if (file.kind !== "doc") throw new Error("expected a document");
  const reminder = reminderLines.flatMap((text, index) =>
    index === 0
      ? [{ type: "text", text }]
      : [{ type: "hardBreak" }, { type: "text", text }],
  );
  file.content = {
    type: "doc",
    content: [
      ...Array.from({ length: leadIn }, (_, index) =>
        paragraph(filler[index % filler.length]),
      ),
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: keepLinesHeading }],
      },
      paragraph(keepLinesSpacer),
      { type: "paragraph", content: reminder },
      paragraph(keepLinesLeftOff),
    ],
  };
  return file;
}

export function keepLinesRecord(leadIn = keepLinesLeadIn) {
  const file = keepLinesNewsletter(leadIn);
  return {
    id: file.id,
    title: file.title,
    updatedAt: file.updatedAt,
    native: serializeFile(file),
  };
}
