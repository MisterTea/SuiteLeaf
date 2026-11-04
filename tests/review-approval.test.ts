import { describe, expect, it } from "vitest";
import { approveDocument, editApproved, isApproved, readApproved } from "../packages/core/src/review-approval";
import type { JsonNode } from "../packages/core/src/index";

function doc(text: string): JsonNode {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

describe("document approval", () => {
  it("keeps the approved revision when the document is edited", () => {
    const original = doc("North");
    const before = JSON.stringify(original);
    const approved = approveDocument(original, "rev-1");
    expect("reason" in approved).toBe(false);
    if ("reason" in approved) return;
    expect(isApproved(approved)).toBe(true);
    const stored = readApproved(approved);
    expect("reason" in stored).toBe(false);
    if ("reason" in stored) return;
    if (stored.content?.[0]?.content?.[0]) stored.content[0].content[0].text = "secret-value";
    expect(readApproved(approved)).toMatchObject({ content: [{ content: [{ text: "North" }] }] });
    const edited = editApproved(approved, doc("Beds"), "rev-2");
    expect("reason" in edited).toBe(false);
    if ("reason" in edited) return;
    expect(isApproved(edited)).toBe(false);
    expect(edited.version).toBe("rev-2");
    expect(readApproved(edited)).toMatchObject({ content: [{ content: [{ text: "North" }] }] });
    expect(edited.current).toMatchObject({ content: [{ content: [{ text: "Beds" }] }] });
    const same = editApproved(approved, doc("North"), "rev-9");
    expect("reason" in same).toBe(false);
    if ("reason" in same) return;
    expect(isApproved(same)).toBe(true);
    expect(same.version).toBe("rev-1");
    expect(approveDocument(original, "secret-value")).toEqual({ reason: "Name a revision." });
    expect(approveDocument(original, "  ")).toEqual({ reason: "Name a revision." });
    expect(approveDocument({ type: "paragraph" }, "rev-1")).toEqual({ reason: "Approval applies to a document." });
    expect(editApproved(approved, { type: "paragraph" }, "rev-2")).toEqual({ reason: "Approval applies to a document." });
    expect(editApproved(approved, doc("Beds"), "token")).toEqual({ reason: "Name a revision." });
    const open = { current: doc("North"), version: "rev-1" };
    expect(readApproved(open)).toEqual({ reason: "This document is not approved." });
    expect(isApproved(open)).toBe(false);
    const started = editApproved(open, doc("Beds"), "rev-2");
    expect("reason" in started).toBe(false);
    if ("reason" in started) return;
    expect(started.approved).toBeUndefined();
    expect(isApproved(started)).toBe(false);
    expect(JSON.stringify(original)).toBe(before);
    expect(JSON.stringify({ approved, open })).not.toContain("secret-value");
  });
});
