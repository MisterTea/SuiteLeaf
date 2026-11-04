import { describe, expect, it } from "vitest";
import { applyReviewChoice, reviewCombine, undoReviewChoice } from "../packages/core/src/review-combine";
import type { JsonNode } from "../packages/core/src/index";

function paragraph(text: string): JsonNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function doc(texts: string[]): JsonNode {
  return { type: "doc", content: texts.map(paragraph) };
}

describe("review combine", () => {
  it("keeps edits that do not overlap and asks for a choice when they do", () => {
    const base = doc(["North", "Beds", "Paths"]);
    const left = doc(["Tomatoes", "Beds", "Paths"]);
    const right = doc(["North", "Plots", "Paths"]);
    const before = JSON.stringify({ base, left, right });
    const result = reviewCombine(base, { reviewer: "Maya", doc: left }, { reviewer: "Sam", doc: right });
    expect(result.decisions).toEqual([]);
    expect(result.merged?.content?.map((block) => block.content?.[0]?.text)).toEqual(["Tomatoes", "Plots", "Paths"]);
    const overlap = reviewCombine(
      base,
      { reviewer: "Maya", doc: doc(["Tomatoes", "Beds", "Paths"]) },
      { reviewer: "Sam", doc: doc(["secret-value", "Beds", "West"]) },
    );
    expect(overlap.decisions).toEqual([
      { block: 1, note: "Block 1 needs a choice. Maya and Sam both changed it." },
    ]);
    expect(overlap.merged?.content?.map((block) => block.content?.[0]?.text)).toEqual(["North", "Beds", "West"]);
    expect(JSON.stringify(overlap.decisions)).not.toContain("secret-value");
    expect(overlap.kept.right.content?.[0]?.content?.[0]?.text).toBe("secret-value");
    const hidden = reviewCombine(
      base,
      { reviewer: "secret-value", doc: doc(["Tomatoes", "Beds", "Paths"]) },
      { reviewer: "Sam", doc: doc(["Beans", "Beds", "Paths"]) },
    );
    expect(hidden.decisions[0]?.note).toBe("Block 1 needs a choice. a reviewer and Sam both changed it.");
    expect(JSON.stringify(hidden.decisions)).not.toContain("secret-value");
    const agreed = reviewCombine(
      base,
      { reviewer: "Maya", doc: doc(["Tomatoes", "Beds", "Paths"]) },
      { reviewer: "Maya", doc: doc(["Tomatoes", "Beds", "Paths"]) },
    );
    expect(agreed.decisions).toEqual([]);
    expect(agreed.merged?.content?.[0]?.content?.[0]?.text).toBe("Tomatoes");
    const removed = reviewCombine(base, { reviewer: "Maya", doc: doc(["North", "Beds"]) }, { reviewer: "Sam", doc: base });
    expect(removed.decisions).toEqual([]);
    expect(removed.merged?.content).toHaveLength(2);
    const notDoc = reviewCombine(
      { type: "paragraph" },
      { reviewer: "Maya", doc: left },
      { reviewer: "Sam", doc: right },
    );
    expect(notDoc.reason).toBe("Selective review applies to a document.");
    expect(notDoc.merged).toBeUndefined();
    const sameName = reviewCombine(
      base,
      { reviewer: "Maya", doc: doc(["Tomatoes", "Beds", "Paths"]) },
      { reviewer: "Maya", doc: doc(["Beans", "Beds", "Paths"]) },
    );
    expect(sameName.decisions[0]?.note).toBe("Block 1 needs a choice.");
    const blank = reviewCombine(
      base,
      { reviewer: "  ", doc: doc(["Tomatoes", "Beds", "Paths"]) },
      { reviewer: "Sam", doc: doc(["Beans", "Beds", "Paths"]) },
    );
    expect(blank.decisions[0]?.note).toBe("Block 1 needs a choice. a reviewer and Sam both changed it.");
    const inserted = reviewCombine(
      doc(["North"]),
      { reviewer: "Maya", doc: doc(["North", "Beds"]) },
      { reviewer: "Sam", doc: doc(["North", "Beds"]) },
    );
    expect(inserted.decisions).toEqual([]);
    expect(inserted.merged?.content).toHaveLength(2);
    const differentInsert = reviewCombine(
      doc(["North"]),
      { reviewer: "Maya", doc: doc(["North", "Beds"]) },
      { reviewer: "Sam", doc: doc(["North", "Paths"]) },
    );
    expect(differentInsert.decisions[0]?.block).toBe(2);
    expect(differentInsert.merged?.content).toHaveLength(1);
    const rightDeletes = reviewCombine(base, { reviewer: "Maya", doc: base }, { reviewer: "Sam", doc: doc(["North", "Beds"]) });
    expect(rightDeletes.merged?.content).toHaveLength(2);
    const bothDelete = reviewCombine(
      base,
      { reviewer: "Maya", doc: doc(["North", "Beds"]) },
      { reviewer: "Sam", doc: doc(["North", "Beds"]) },
    );
    expect(bothDelete.decisions).toEqual([]);
    expect(bothDelete.merged?.content).toHaveLength(2);
    const empty = reviewCombine(
      { type: "doc" },
      { reviewer: "Maya", doc: { type: "doc" } },
      { reviewer: "Sam", doc: { type: "doc" } },
    );
    expect(empty.merged?.content).toEqual([]);
    expect(JSON.stringify({ base, left, right })).toBe(before);
  });

  it("uses the chosen reviewer's text for one block", () => {
    const base = doc(["North", "Beds"]);
    const left = doc(["Tomatoes", "Plots"]);
    const right = doc(["secret-value", "Rows"]);
    const before = JSON.stringify({ base, left, right });
    const chosen = applyReviewChoice(base, { reviewer: "Maya", doc: left }, { reviewer: "Sam", doc: right }, 1, "left");
    expect(chosen.decisions.map((item) => item.block)).toEqual([2]);
    expect(chosen.merged?.content?.map((block) => block.content?.[0]?.text)).toEqual(["Tomatoes", "Beds"]);
    expect(JSON.stringify(chosen.decisions)).not.toContain("secret-value");
    const other = applyReviewChoice(base, { reviewer: "Maya", doc: left }, { reviewer: "Sam", doc: right }, 1, "right");
    expect(other.merged?.content?.[0]?.content?.[0]?.text).toBe("secret-value");
    expect(other.decisions).toHaveLength(1);
    const skipped = applyReviewChoice(base, { reviewer: "Maya", doc: left }, { reviewer: "Sam", doc: right }, 3, "left");
    expect(skipped.reason).toBe("That block does not need a choice.");
    expect(skipped.merged?.content?.[0]?.content?.[0]?.text).toBe("North");
    expect(applyReviewChoice(base, { reviewer: "Maya", doc: left }, { reviewer: "Sam", doc: right }, 0, "left").reason).toBe(
      "Name a block number.",
    );
    const removed = applyReviewChoice(
      base,
      { reviewer: "Maya", doc: doc(["North", "Plots"]) },
      { reviewer: "Sam", doc: doc(["North"]) },
      2,
      "right",
    );
    expect(removed.merged?.content?.map((block) => block.content?.[0]?.text)).toEqual(["North"]);
    expect(removed.decisions).toEqual([]);
    expect(JSON.stringify({ base, left, right })).toBe(before);
  });

  it("undoes the latest choice and keeps the earlier one", () => {
    const base = doc(["North", "Beds"]);
    const left = doc(["Tomatoes", "Plots"]);
    const right = doc(["Beans", "Rows"]);
    const before = JSON.stringify({ base, left, right });
    const reviewers = { left: { reviewer: "Maya", doc: left }, right: { reviewer: "Sam", doc: right } };
    const choices = [
      { block: 1, side: "left" as const },
      { block: 2, side: "right" as const },
    ];
    const both = reviewCombine(base, reviewers.left, reviewers.right, choices);
    expect(both.decisions).toEqual([]);
    expect(both.merged?.content?.map((block) => block.content?.[0]?.text)).toEqual(["Tomatoes", "Rows"]);
    const undone = undoReviewChoice(base, reviewers.left, reviewers.right, choices);
    expect(undone.merged?.content?.map((block) => block.content?.[0]?.text)).toEqual(["Tomatoes", "Beds"]);
    expect(undone.decisions.map((item) => item.block)).toEqual([2]);
    expect(undone.decisions[0]?.note).toContain("Maya and Sam");
    const cleared = undoReviewChoice(base, reviewers.left, reviewers.right, choices.slice(0, 1));
    expect(cleared.merged?.content?.map((block) => block.content?.[0]?.text)).toEqual(["North", "Beds"]);
    expect(cleared.decisions).toHaveLength(2);
    expect(undoReviewChoice(base, reviewers.left, reviewers.right, []).reason).toBe("There is no choice to undo.");
    expect(JSON.stringify({ base, left, right })).toBe(before);
  });
});
