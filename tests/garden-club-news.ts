import { createFile, serializeFile, type DocFile } from "../packages/core/src";

const line = "The beds along the fence are ready for winter.";
const closing = [
  "Saturday rain filled every water jar.",
  "The tool library has spare gloves again.",
  "The roses are cut and stored in the shed.",
  "The leaves turned warm after the last rain.",
  "New members can pick up a plot map.",
  "Questions go to the board before Friday.",
];

/** Body lines before "This week", tuned so the heading is the last line of page 1. */
export const gardenLeadIn = 43;

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

/** Nia's newsletter, with "This week" stranded above the three items. */
export function gardenClubNews(leadIn = gardenLeadIn): DocFile {
  const file = createFile("doc", "Garden club news");
  if (file.kind !== "doc") throw new Error("expected a document");
  const tail = closing.slice(0, Math.min(closing.length, leadIn));
  const filler = Array.from({ length: Math.max(0, leadIn - tail.length) }, () =>
    paragraph(line),
  );
  file.content = {
    type: "doc",
    content: [
      ...filler,
      ...tail.map(paragraph),
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "This week" }],
      },
      {
        type: "bulletList",
        content: [
          "Seed swap on Saturday",
          "Garden class at ten",
          "Work day for members",
        ].map((text) => ({
          type: "listItem",
          content: [paragraph(text)],
        })),
      },
      paragraph("Meet at the gate. Bring gloves and a mug."),
    ],
  };
  return file;
}

export function gardenClubRecord(leadIn = gardenLeadIn) {
  const file = gardenClubNews(leadIn);
  return {
    id: file.id,
    title: file.title,
    updatedAt: file.updatedAt,
    native: serializeFile(file),
  };
}
