import type { JsonNode } from "./file-schema";

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
function textBoxWords(xml: string): string {
  return [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXmlText(match[1]))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
/** Pull floating text boxes out of the body mammoth reads, and leave a token for each one. */
export function extractWordTextBoxes(xml: string): { xml: string; boxes: string[] } {
  const boxes: string[] = [];
  let next = xml.replace(/<w:txbxContent\b[^>]*>([\s\S]*?)<\/w:txbxContent>/g, (_all, inner: string) => {
    boxes.push(textBoxWords(inner));
    return "<w:txbxContent/>";
  });
  if (!boxes.length && /<wps:wsp\b/.test(xml)) {
    const shapes = [...xml.matchAll(/<wps:wsp\b[\s\S]*?<\/wps:wsp>/g)];
    for (const shape of shapes) {
      const text = [...shape[0].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
        .map((match) => decodeXmlText(match[1]))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      boxes.push(text);
    }
    if (!boxes.length) boxes.push("");
  }
  if (!boxes.length) return { xml, boxes };
  const tokens = boxes
    .map((_, index) => `<w:p><w:r><w:t>SLTBXTOKEN${index}END</w:t></w:r></w:p>`)
    .join("");
  next = next.includes("</w:body>") ? next.replace("</w:body>", `${tokens}</w:body>`) : `${next}${tokens}`;
  return { xml: next, boxes };
}
/** Swap each text-box token for a text box node. */
export function spliceTextBoxTokens(node: JsonNode, boxes: string[]): JsonNode {
  const visit = (current: JsonNode): JsonNode[] => {
    const joined = (current.content ?? []).map((child) => child.text ?? "").join("");
    const only = /^SLTBXTOKEN(\d+)END$/.exec(joined.trim());
    if ((current.type === "paragraph" || current.type === "heading") && only) {
      return [{ type: "textBox", attrs: { text: boxes[Number(only[1])] ?? "" } }];
    }
    if (current.type === "text" && current.text?.includes("SLTBXTOKEN")) {
      const parts: JsonNode[] = [];
      let last = 0;
      for (const match of current.text.matchAll(/SLTBXTOKEN(\d+)END/g)) {
        const at = match.index ?? 0;
        if (at > last) parts.push({ ...current, text: current.text.slice(last, at) });
        parts.push({ type: "textBox", attrs: { text: boxes[Number(match[1])] ?? "" } });
        last = at + match[0].length;
      }
      if (last < current.text.length) parts.push({ ...current, text: current.text.slice(last) });
      return parts;
    }
    if (!current.content) return [current];
    return [{ ...current, content: current.content.flatMap(visit) }];
  };
  return visit(node)[0] ?? node;
}
