import { describe, expect, it } from "vitest";
import { readReview, writeReview } from "../packages/core/src/review-store";
import type { JsonNode } from "../packages/core/src/index";

const doc: JsonNode = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "North" }] }],
};

describe("stored review", () => {
  it("reads a saved review without the block text", () => {
    const before = JSON.stringify(doc);
    const written = writeReview(doc, {
      decisions: [
        { block: 1, note: "Block 1 needs a choice. Maya and Sam both changed it." },
        { block: 2, note: "secret-value" },
        { block: 0, note: "Block 0 needs a choice." },
      ],
      choices: [
        { block: 1, side: "left" },
        { block: 2, side: "middle" as "left" },
      ],
      approvedVersion: "rev-1",
    });
    expect("reason" in written).toBe(false);
    if ("reason" in written) return;
    const saved = JSON.parse(JSON.stringify(written)) as JsonNode;
    const read = readReview(saved);
    expect(read).toEqual({
      decisions: [
        { block: 1, note: "Block 1 needs a choice. Maya and Sam both changed it." },
        { block: 2, note: "Block 2 needs a choice." },
      ],
      choices: [{ block: 1, side: "left" }],
      approvedVersion: "rev-1",
    });
    expect(JSON.stringify(saved)).not.toContain("secret-value");
    expect(saved.content?.[0]?.content?.[0]?.text).toBe("North");
    expect(writeReview({ type: "paragraph" }, { decisions: [], choices: [] })).toEqual({
      reason: "Review is stored on a document.",
    });
    expect(readReview(doc)).toEqual({ reason: "This document has no stored review." });
    const broken = writeReview(doc, { decisions: [], choices: [] });
    if ("reason" in broken) return;
    broken.attrs = { review: { decisions: "secret-value" } };
    expect(readReview(broken)).toEqual({ reason: "The stored review cannot be read." });
    expect(JSON.stringify(readReview(broken))).not.toContain("secret-value");
    const hidden = writeReview(doc, { decisions: [], choices: [], approvedVersion: "secret-value" });
    if ("reason" in hidden) return;
    expect(readReview(hidden)).toEqual({ decisions: [], choices: [] });
    expect(JSON.stringify(hidden)).not.toContain("secret-value");
    expect(JSON.stringify(doc)).toBe(before);
  });
});
