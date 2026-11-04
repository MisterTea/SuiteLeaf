import { describe, expect, it } from "vitest";
import { reviewView } from "../packages/core/src/review-view";
import type { JsonNode } from "../packages/core/src/index";

function paragraph(text: string, attrs?: Record<string, unknown>): JsonNode {
  return { type: "paragraph", attrs, content: [{ type: "text", text }] };
}

function doc(blocks: JsonNode[]): JsonNode {
  return { type: "doc", content: blocks };
}

describe("review views", () => {
  it("shows the baseline, the current text, or the changed blocks", () => {
    const base = doc([paragraph("North"), paragraph("Beds")]);
    const current = doc([paragraph("secret-value"), paragraph("Beds")]);
    const before = JSON.stringify({ base, current });
    expect(reviewView(base, current, "original")).toEqual(base);
    expect(reviewView(base, current, "final")).toEqual(current);
    const marked = reviewView(base, current, "markup");
    expect("reason" in marked).toBe(false);
    if ("reason" in marked) return;
    expect(marked.content?.[0]?.attrs?.reviewMark).toBe("changed");
    expect(marked.content?.[0]?.content?.[0]?.text).toBe("secret-value");
    expect(marked.content?.[1]?.attrs?.reviewMark).toBeUndefined();
    expect(marked.content?.[1]?.content?.[0]?.text).toBe("Beds");
    const added = reviewView(doc([paragraph("North")]), doc([paragraph("North"), paragraph("Paths")]), "markup");
    if ("reason" in added) return;
    expect(added.content?.[1]?.attrs?.reviewMark).toBe("changed");
    const removed = reviewView(doc([paragraph("North"), paragraph("secret-value")]), doc([paragraph("North")]), "markup");
    if ("reason" in removed) return;
    expect(removed.content?.[1]).toEqual({ type: "paragraph", attrs: { reviewMark: "removed" } });
    expect(JSON.stringify(removed.content?.[1])).not.toContain("secret-value");
    expect(reviewView({ type: "paragraph" }, current, "original")).toEqual({
      reason: "Selective review applies to a document.",
    });
    expect(reviewView(base, { type: "paragraph" }, "final")).toEqual({
      reason: "Selective review applies to a document.",
    });
    const empty = reviewView({ type: "doc" }, { type: "doc" }, "markup");
    expect("content" in empty && empty.content).toEqual([]);
    const hole = reviewView(
      { type: "doc", content: [paragraph("North"), undefined as unknown as JsonNode] },
      { type: "doc", content: [paragraph("North")] },
      "markup",
    );
    if (!("reason" in hole)) expect(hole.content).toHaveLength(1);
    expect(JSON.stringify({ base, current })).toBe(before);
  });
});
