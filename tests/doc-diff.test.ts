import { describe, expect, it } from "vitest";
import { diffDocuments, type JsonNode } from "@suiteleaf/core";

function doc(paragraphs: string[]): JsonNode {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Watering rota" }],
      },
      ...paragraphs.map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    ],
  };
}

const monday = [
  "Monday — Rosa, greenhouse, 7am",
  "Tuesday — Sam, raised beds, 7am",
  "Wednesday — Priya, compost, 6pm",
  "Thursday — Leo, north fence, 7am",
];
const tuesday = [
  "Monday — Sam, greenhouse, 6am",
  "Tuesday — Sam, all the beds, 7am",
  "Thursday — Leo, north fence, 7am",
  "Friday — Rosa, seed library, 8am",
];

describe("document version diff", () => {
  it("marks Sam's additions and deletions against the current version as 4 paragraphs", () => {
    const diff = diffDocuments(doc(monday), doc(tuesday));
    expect(diff.changedParagraphs).toBe(4);
    const text = JSON.stringify(diff.content);
    expect(text).toContain("Wednesday — Priya, compost, 6pm");
    expect(text).toContain("Friday — Rosa, seed library, 8am");
    expect(text).toContain('"type":"strike"');
    expect(text).toContain('"type":"underline"');
    expect(text).toContain("#c5221f");
    expect(text).toContain("#137333");
    expect(text).toContain("Thursday — Leo, north fence, 7am");
  });

  it("leaves an unchanged document unmarked", () => {
    const diff = diffDocuments(doc(monday), doc(monday));
    expect(diff.changedParagraphs).toBe(0);
    expect(JSON.stringify(diff.content)).not.toContain("strike");
  });
});
