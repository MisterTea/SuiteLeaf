import { describe, expect, it } from "vitest";
import { documentPlainText } from "../apps/web/src/editors/doc-text";
import type { JsonNode } from "@suiteleaf/core";
const paragraph = (value: string): JsonNode => ({
  type: "paragraph",
  content: [{ type: "text", text: value }],
});
describe("Google Docs reference plain-text export", () => {
  it("uses one CRLF between paragraphs, preserves internal blank paragraphs and emits a BOM", () => {
    expect(
      documentPlainText({
        type: "doc",
        content: [
          paragraph("Quarterly Report"),
          paragraph("Cedar café"),
          paragraph(""),
          paragraph("Actions"),
          paragraph(""),
        ],
      }),
    ).toBe("\ufeffQuarterly Report\r\nCedar café\r\n\r\nActions");
  });
  it("matches reference table cell separators without nested block gaps", () => {
    const cell = (value: string): JsonNode => ({
      type: "tableCell",
      content: [paragraph(value)],
    });
    expect(
      documentPlainText({
        type: "doc",
        content: [
          paragraph("Report"),
          {
            type: "table",
            content: [
              { type: "tableRow", content: [cell("A"), cell("B")] },
              { type: "tableRow", content: [cell("1"), cell("2")] },
            ],
          },
        ],
      }),
    ).toBe("\ufeffReport\r\n\r\n\r\nA\r\n\tB\r\n\t1\r\n\t2");
  });
  it("retains explicit line breaks and treats replacement-like text literally", () => {
    expect(
      documentPlainText({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "<cedar>" },
              { type: "hardBreak" },
              { type: "text", text: "Maple", marks: [{ type: "bold" }] },
            ],
          },
        ],
      }),
    ).toBe("\ufeff<cedar>\r\nMaple");
  });
});
