import { describe, expect, it } from "vitest";
import {
  documentText,
  finishDocumentEdit,
  keepText,
  lineChanges,
  stageDocumentEdit,
} from "../apps/web/src/ai/edit-proposal";

describe("edit proposal", () => {
  it("names the changed line and keeps the other paragraph when rejected", () => {
    const before = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Beds stay." }] },
        { type: "paragraph", content: [{ type: "text", text: "Old harvest." }] },
      ],
    };
    const after = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Beds stay." }] },
        { type: "paragraph", content: [{ type: "text", text: "New harvest." }] },
      ],
    };
    const earlier = documentText(before);
    const next = documentText(after);
    const preview = lineChanges(earlier, next);
    expect(preview).toEqual({ removed: ["Old harvest."], added: ["New harvest."] });
    expect(preview.removed.join(" ")).not.toContain("Beds stay");
    expect(keepText(earlier, next, false)).toBe(earlier);
    expect(keepText(earlier, next, true)).toContain("New harvest.");
    expect(keepText(earlier, next, true)).toContain("Beds stay.");
  });

  it("keeps the open document until the proposal is accepted", () => {
    const current = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Beds stay." }] }],
    };
    const proposed = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "secret-value" }] }],
    };
    const staged = stageDocumentEdit(current, proposed);
    expect(staged.document).toBe(current);
    expect(staged.proposal).toBe(proposed);
    expect(finishDocumentEdit(staged, false)).toBe(current);
    expect(JSON.stringify(finishDocumentEdit(staged, false))).not.toContain("secret-value");
    expect(finishDocumentEdit(staged, true)).toBe(proposed);
    expect(current.content[0].content[0].text).toBe("Beds stay.");
  });
});
