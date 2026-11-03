import { describe, expect, it } from "vitest";
import type { JsonNode } from "../packages/core/src";
import { mergePdfBatch } from "../apps/web/src/editors/mail-merge";

function doc(text: string): JsonNode {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function pdfText(pdf: Uint8Array): string {
  return new TextDecoder().decode(pdf);
}

describe("merge pdf", () => {
  it("writes one PDF per letter and leaves a blank block out", () => {
    const template = doc("Hello {{Name}}. {{#Plot}}secret-value {{Plot}}.{{/Plot}}");
    const before = JSON.stringify(template);
    const result = mergePdfBatch(
      template,
      ["Name", "Plot"],
      [
        ["Ada", ""],
        ["Ada", "North"],
      ],
      "Name",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((file) => file.name)).toEqual(["Ada", "Ada 2"]);
    const first = pdfText(result.files[0].pdf);
    const second = pdfText(result.files[1].pdf);
    expect(first.startsWith("%PDF-1.4")).toBe(true);
    expect(first).toContain("Hello Ada.");
    expect(first).not.toContain("secret-value");
    expect(second).toContain("secret-value North.");
    expect(JSON.stringify(template)).toBe(before);

    const missing = mergePdfBatch(doc("{{Plot}}"), ["Name", "Plot"], [["Ada", ""]]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(JSON.stringify(missing.issues)).not.toContain("secret-value");
      expect(missing.issues[0]?.field).toBe("Plot");
    }
  });
});
