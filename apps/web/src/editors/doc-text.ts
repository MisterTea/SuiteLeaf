import type { JsonNode } from "@suiteleaf/core";
const newline = "\r\n";
function text(node: JsonNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return newline;
  if (node.type === "image") return "";
  if (node.type === "table") {
    // Google Docs TXT serializes the paragraphs in each successive table cell
    // with a tab separator, including the boundary between rows.
    return (node.content ?? [])
      .flatMap((row) => row.content ?? [])
      .map((cell) => (cell.content ?? []).map(text).join(newline))
      .join(newline + "\t");
  }
  if (node.type === "doc") {
    return (node.content ?? [])
      .map(
        (child, index) =>
          (child.type === "table" && index > 0 ? newline.repeat(2) : "") +
          text(child),
      )
      .join(newline);
  }
  const block = [
    "doc",
    "bulletList",
    "orderedList",
    "listItem",
    "blockquote",
    "tableCell",
    "tableHeader",
  ].includes(node.type);
  return (node.content ?? []).map(text).join(block ? newline : "");
}
export function documentPlainText(doc: JsonNode): string {
  return "\ufeff" + text(doc).replace(/(?:\r\n)+$/, "");
}
