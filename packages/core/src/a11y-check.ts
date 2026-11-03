/**
 * Automatic notes about a document's structure.
 *
 * `automatic` means the check decided on its own. A finding with
 * `automatic: false` is a place a person still has to judge. This is not a
 * WCAG conformance claim.
 */
import type { JsonNode } from "./index";

export type A11yRule =
  | "missing-heading"
  | "empty-heading"
  | "heading-start"
  | "heading-skip"
  | "missing-alt"
  | "filename-alt"
  | "decorative-alt"
  | "empty-link"
  | "vague-link"
  | "table-header"
  | "color-meaning";

export type A11yFinding = {
  rule: A11yRule;
  /** Child indexes from the document root to the node this note is about. */
  path: number[];
  automatic: boolean;
  message: string;
};

const VAGUE_LINKS = new Set(["click here", "here", "link", "read more"]);

function headingLevel(node: JsonNode): number | undefined {
  const level = Number(node.attrs?.level);
  if (!Number.isInteger(level) || level < 1 || level > 6) return undefined;
  return level;
}

function linkText(node: JsonNode): { href: string; text: string } | undefined {
  const link = node.marks?.find((mark) => mark.type === "link");
  if (!link || node.type !== "text") return undefined;
  return {
    href: String(link.attrs?.href ?? ""),
    text: (node.text ?? "").trim(),
  };
}

export function checkDocument(doc: JsonNode): A11yFinding[] {
  const findings: A11yFinding[] = [];
  let lastLevel = 0;
  let sawHeading = false;

  const visit = (node: JsonNode, path: number[]) => {
    if (node.type === "heading") {
      const level = headingLevel(node);
      if (level) {
        if (!sawHeading && level > 1) {
          findings.push({
            rule: "heading-start",
            path,
            automatic: true,
            message: `The first heading is level ${level}. Start with level 1.`,
          });
        } else if (sawHeading && level > lastLevel + 1) {
          findings.push({
            rule: "heading-skip",
            path,
            automatic: true,
            message: `Heading jumps from level ${lastLevel} to level ${level}.`,
          });
        }
        lastLevel = level;
        sawHeading = true;
      }
      if (nodeText(node).trim() === "") {
        findings.push({
          rule: "empty-heading",
          path,
          automatic: true,
          message: "This heading has no text.",
        });
      }
    }
    if (node.type === "image" || node.type === "inlineImage") {
      const alt = node.attrs?.alt;
      if (typeof alt === "string" && /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(alt.trim())) {
        findings.push({
          rule: "filename-alt",
          path,
          automatic: true,
          message: "This image description is a file name. Write what the image shows.",
        });
      } else if (alt === "") {
        findings.push({
          rule: "decorative-alt",
          path,
          automatic: false,
          message:
            "This image has empty alternative text. Confirm it is decorative.",
        });
      } else if (typeof alt !== "string" || alt.trim() === "") {
        findings.push({
          rule: "missing-alt",
          path,
          automatic: true,
          message: "This image needs alternative text.",
        });
      }
    }
    if (node.type === "table") {
      const cells = node.content?.[0]?.content ?? [];
      const headers = cells.filter((cell) => cell.type === "tableHeader");
      if (cells.length > 0 && headers.length === 0) {
        findings.push({
          rule: "table-header",
          path,
          automatic: true,
          message: "This table has no header cells in its first row.",
        });
      } else if (headers.some((cell) => nodeText(cell).trim() === "")) {
        findings.push({
          rule: "table-header",
          path,
          automatic: true,
          message: "A header cell in the first row is empty.",
        });
      }
    }
    const link = linkText(node);
    if (link) {
      if (!link.text) {
        findings.push({
          rule: "empty-link",
          path,
          automatic: true,
          message: "This link has no text.",
        });
      } else if (
        VAGUE_LINKS.has(link.text.toLowerCase()) ||
        link.text === link.href
      ) {
        findings.push({
          rule: "vague-link",
          path,
          automatic: true,
          message: "This link text does not say where it goes.",
        });
      }
    }
    const colored = node.marks?.some(
      (mark) =>
        mark.type === "textStyle" && typeof mark.attrs?.color === "string",
    );
    if (node.type === "text" && colored) {
      findings.push({
        rule: "color-meaning",
        path,
        automatic: false,
        message:
          "Color is used. Confirm it is not the only way to understand this text.",
      });
    }
    node.content?.forEach((child, index) => visit(child, [...path, index]));
  };

  visit(doc, []);
  if (!sawHeading) {
    findings.unshift({
      rule: "missing-heading",
      path: [],
      automatic: true,
      message: "This document has no heading.",
    });
  }
  return findings;
}

function nodeText(node: JsonNode): string {
  const parts: string[] = [];
  const walk = (current: JsonNode) => {
    if (current.type === "text" && current.text) parts.push(current.text);
    current.content?.forEach(walk);
  };
  walk(node);
  return parts.join("");
}

/** The node a finding path names, or null when the path does not exist. */
export function nodeAtPath(
  doc: JsonNode,
  path: number[],
): { type: string; text: string } | null {
  let current: JsonNode | undefined = doc;
  for (const index of path) {
    current = current?.content?.[index];
    if (!current) return null;
  }
  if (!current) return null;
  return { type: current.type, text: nodeText(current) };
}

type PositionNode = {
  childCount: number;
  child: (index: number) => PositionNode;
  nodeSize: number;
};

/** The position inside the node a path names. The document itself is not entered. */
export function contentPosition(doc: PositionNode, path: number[]): number | null {
  let node = doc;
  let pos = 0;
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0 || index >= node.childCount) return null;
    for (let previous = 0; previous < index; previous += 1) pos += node.child(previous).nodeSize;
    pos += 1;
    node = node.child(index);
  }
  return pos;
}
