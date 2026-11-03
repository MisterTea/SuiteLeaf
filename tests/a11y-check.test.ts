import { describe, expect, it } from "vitest";
import { checkDocument, contentPosition, nodeAtPath, type JsonNode } from "../packages/core/src";

const doc = (content: JsonNode[]): JsonNode => ({ type: "doc", content });

describe("document accessibility notes", () => {
  it("points at a skipped heading, a missing alt, an empty link, and a table", () => {
    const findings = checkDocument(
      doc([
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Beds" }],
        },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "North" }],
        },
        { type: "image", attrs: { src: "data:image/png;base64,aa" } },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: " ",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [{ type: "text", text: "Tomato" }],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(findings.find((item) => item.rule === "heading-skip")?.path).toEqual(
      [1],
    );
    expect(findings.find((item) => item.rule === "missing-alt")).toMatchObject({
      path: [2],
      automatic: true,
    });
    expect(findings.find((item) => item.rule === "empty-link")?.path).toEqual([
      3, 0,
    ]);
    expect(findings.find((item) => item.rule === "table-header")?.path).toEqual(
      [4],
    );
    expect(findings.every((item) => item.rule !== "missing-heading")).toBe(
      true,
    );
  });

  it("asks a person to judge an empty alt and a colored run", () => {
    const findings = checkDocument(
      doc([
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Beds" }],
        },
        { type: "image", attrs: { alt: "" } },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "ripe",
              marks: [{ type: "textStyle", attrs: { color: "#c62828" } }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click here",
              marks: [
                { type: "link", attrs: { href: "https://example.com/beds" } },
              ],
            },
          ],
        },
      ]),
    );
    expect(
      findings.find((item) => item.rule === "decorative-alt")?.automatic,
    ).toBe(false);
    expect(
      findings.find((item) => item.rule === "color-meaning"),
    ).toMatchObject({
      path: [2, 0],
      automatic: false,
    });
    expect(findings.find((item) => item.rule === "vague-link")?.automatic).toBe(
      true,
    );
  });

  it("notes every colored phrase and leaves the address out of the message", () => {
    const findings = checkDocument(
      doc([
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Beds" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "ripe",
              marks: [{ type: "textStyle", attrs: { color: "#c62828" } }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "late",
              marks: [{ type: "textStyle", attrs: { color: "secret-value" } }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click here",
              marks: [{ type: "link", attrs: { href: "https://secret-value.example" } }],
            },
          ],
        },
      ]),
    );
    expect(findings.filter((item) => item.rule === "color-meaning").map((item) => item.path)).toEqual([
      [1, 0],
      [2, 0],
    ]);
    expect(JSON.stringify(findings)).not.toContain("secret-value");
  });

  it("notes an empty header cell and leaves the other cell out of the note", () => {
    const findings = checkDocument(
      doc([
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Beds" }],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "text", text: "Crop" }] },
                { type: "tableHeader", content: [{ type: "text", text: " " }] },
                { type: "tableCell", content: [{ type: "text", text: "secret-value" }] },
              ],
            },
          ],
        },
      ]),
    );
    const header = findings.find((item) => item.rule === "table-header");
    expect(header).toMatchObject({
      path: [1],
      automatic: true,
      message: "A header cell in the first row is empty.",
    });
    expect(JSON.stringify(findings)).not.toContain("secret-value");
  });

  it("notes a heading with no text and leaves the paragraph out of the note", () => {
    const findings = checkDocument(
      doc([
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "  " }] },
        { type: "paragraph", content: [{ type: "text", text: "secret-value" }] },
      ]),
    );
    expect(findings.find((item) => item.rule === "empty-heading")).toEqual({
      rule: "empty-heading",
      path: [0],
      automatic: true,
      message: "This heading has no text.",
    });
    expect(JSON.stringify(findings)).not.toContain("secret-value");
    const titled = checkDocument(
      doc([{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Beds" }] }]),
    );
    expect(titled.some((item) => item.rule === "empty-heading")).toBe(false);
  });

  it("notes a document that never uses a heading", () => {
    const findings = checkDocument(
      doc([{ type: "paragraph", content: [{ type: "text", text: "Water" }] }]),
    );
    expect(findings).toEqual([
      {
        rule: "missing-heading",
        path: [],
        automatic: true,
        message: "This document has no heading.",
      },
    ]);
  });

  it("starts the outline at level 1", () => {
    const findings = checkDocument(
      doc([{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "North" }] }]),
    );
    expect(findings.find((item) => item.rule === "heading-start")?.path).toEqual([0]);
    expect(nodeAtPath(doc([{ type: "heading", content: [{ type: "text", text: "North" }] }]), [0])).toEqual({
      type: "heading",
      text: "North",
    });
    const tree = {
      childCount: 2,
      child(index: number) {
        return { childCount: 0, child: () => tree, nodeSize: index === 0 ? 7 : 3 };
      },
      nodeSize: 10,
    };
    expect(contentPosition(tree, [0])).toBe(1);
    expect(contentPosition(tree, [1])).toBe(8);
    expect(contentPosition(tree, [2])).toBeNull();
  });

  it("notes an image description that is a file name and does not repeat it", () => {
    const findings = checkDocument(
      doc([
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Beds" }],
        },
        { type: "image", attrs: { alt: "secret-value.png" } },
        { type: "image", attrs: { alt: "Tomato beds" } },
      ]),
    );
    const named = findings.filter((item) => item.rule === "filename-alt");
    expect(named).toEqual([
      {
        rule: "filename-alt",
        path: [1],
        automatic: true,
        message: "This image description is a file name. Write what the image shows.",
      },
    ]);
    expect(JSON.stringify(named)).not.toContain("secret-value");
  });
});
