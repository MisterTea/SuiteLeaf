import { describe, expect, it } from "vitest";
import { plainMergeNumber, sameWritten } from "../apps/web/src/editors/mail-merge-match";
import type { JsonNode } from "../packages/core/src";
import { mergeBatch, mergeLetters, previewMerge } from "../apps/web/src/editors/mail-merge";

function doc(text: string): JsonNode {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

describe("conditional merge", () => {
  it("keeps a block only when the column has text and repeats the parts", () => {
    const template = doc(
      "Hello {{Name}}. {{#Plot}}secret-value {{Plot}}.{{/Plot}}{{#each Crop}}{{.}} {{/each}}",
    );
    const before = JSON.stringify(template);
    const result = mergeLetters(
      template,
      ["Name", "Plot", "Crop"],
      [
        ["Ada", "", "Tomato; ;Bean"],
        ["Ada", "North", ""],
      ],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = JSON.stringify(result.content);
    expect(text).toContain("Hello Ada.");
    expect(text).toContain("Tomato Bean");
    expect(text).toContain("secret-value North.");
    expect(text).not.toContain("secret-value Ada");
    const letters = text.split("secret-value");
    expect(letters[0]).not.toContain("secret-value");
    expect(JSON.stringify(template)).toBe(before);

    const missing = mergeLetters(doc("{{#Gone}}x{{/Gone}}"), ["Name"], [["Ada"]]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.missing).toEqual(["Gone"]);

    const issues = previewMerge(template, ["Name", "Plot", "Crop"], [
      ["Ada", "", "Tomato; ;Bean"],
      ["Ada", "North", ""],
    ]);
    expect(issues).toEqual([]);
    const batch = mergeBatch(template, ["Name", "Plot", "Crop"], [
      ["Ada", "", "Tomato; ;Bean"],
      ["Ada", "North", ""],
    ], "Name");
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    expect(JSON.stringify(batch.letters[0].content)).not.toContain("secret-value");
    expect(JSON.stringify(batch.letters[1].content)).toContain("secret-value North.");
    expect(JSON.stringify(template)).toBe(before);
  });

  it("uses the other text when the column is blank", () => {
    const template = doc("{{Name}}: {{#Paid}}Thanks{{else}}Please pay{{/Paid}}");
    const before = JSON.stringify(template);
    const result = mergeLetters(template, ["Name", "Paid"], [
      ["Ada", "secret-value"],
      ["Sam", ""],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = JSON.stringify(result.content);
    expect(text).toContain("Ada: Thanks");
    expect(text).toContain("Sam: Please pay");
    expect(text).not.toContain("{{else}}");
    expect(text).not.toContain("secret-value");
    expect(JSON.stringify(template)).toBe(before);
  });

  it("matches only plain numbers written two ways", () => {
    expect(sameWritten("10", "10.0")).toBe(true);
    expect(sameWritten("10", "10")).toBe(true);
    expect(sameWritten("North", "north")).toBe(false);
    expect(sameWritten("10 beds", "10")).toBe(false);
    expect(sameWritten("-2", "-2.0")).toBe(true);
    expect(plainMergeNumber(" 10.0 ")).toBe(10);
    expect(plainMergeNumber("1e2")).toBeNull();
    expect(plainMergeNumber("10 beds")).toBeNull();
    expect(plainMergeNumber("9".repeat(400))).toBeNull();
  });

  it("treats a plain number written two ways as the same plot", () => {
    const template = doc("{{#Plot == 10}}Beds{{else}}Other{{/Plot}}");
    const before = JSON.stringify(template);
    const rows = [["10"], ["10.0"], ["North"], ["10 beds"]];
    const result = mergeLetters(template, ["Plot"], rows);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = JSON.stringify(result.content);
    expect(text).toContain("Beds");
    expect(text).toContain("Other");
    const unequal = mergeLetters(doc("{{#Plot != 10}}Beds{{else}}Same{{/Plot}}"), ["Plot"], [["10.0"], ["North"]]);
    expect(unequal.ok).toBe(true);
    if (!unequal.ok) return;
    const other = JSON.stringify(unequal.content);
    expect(other).toContain("Same");
    expect(other).toContain("Beds");
    expect(JSON.stringify(template)).toBe(before);
    expect(rows[1]?.[0]).toBe("10.0");
  });

  it("keeps the block when the column matches the named text", () => {
    const template = doc("{{#Plot == North}}Beds{{else}}Other{{/Plot}}");
    const before = JSON.stringify(template);
    const result = mergeLetters(template, ["Plot"], [["North"], ["secret-value"]]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = JSON.stringify(result.content);
    expect(text).toContain("Beds");
    expect(text).toContain("Other");
    expect(text).not.toContain("secret-value");
    expect(text).not.toContain("North");
    expect(JSON.stringify(template)).toBe(before);
  });

  it("matches a closing tag with different capitalization and drops the unused text", () => {
    const template = doc("{{#Plot}}Beds{{else}}secret-value{{/plot}}");
    const before = JSON.stringify(template);
    const result = mergeLetters(template, ["Plot"], [["North"]]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = JSON.stringify(result.content);
    expect(text).toContain("Beds");
    expect(text).not.toContain("secret-value");
    expect(text).not.toContain("{{else}}");
    expect(JSON.stringify(template)).toBe(before);
  });

  it("keeps the other text when the column is not the named text", () => {
    const template = doc("{{#Plot != North}}Beds{{else}}Path{{/plot}}");
    const before = JSON.stringify(template);
    const result = mergeLetters(template, ["Plot"], [["North"], ["South"], ["north"]]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = JSON.stringify(result.content);
    expect(text).toContain("Path");
    expect(text).toContain("Beds");
    const lower = mergeLetters(template, ["Plot"], [["north"]]);
    expect(lower.ok).toBe(true);
    if (!lower.ok) return;
    expect(JSON.stringify(lower.content)).toContain("Beds");
    expect(JSON.stringify(lower.content)).not.toContain("Path");
    const letter = doc("{{#Plot != North}}Beds{{else}}secret-value{{/plot}}");
    const dropped = mergeLetters(letter, ["Plot"], [["South"]]);
    expect(dropped.ok).toBe(true);
    if (!dropped.ok) return;
    expect(JSON.stringify(dropped.content)).toContain("Beds");
    expect(JSON.stringify(dropped.content)).not.toContain("secret-value");
    expect(JSON.stringify(letter)).toContain("secret-value");
    expect(JSON.stringify(template)).toBe(before);
  });
});