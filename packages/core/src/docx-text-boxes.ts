import JSZip from "jszip";
import type { JsonNode } from "./index";

function hexToText(hex: string): string {
  if (hex.length % 2) return "";
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}
export function textBoxPlain(node: JsonNode): string {
  const parts: string[] = [];
  const walk = (current: JsonNode) => {
    if (current.type === "text" && current.text) parts.push(current.text);
    if (current.type === "hardBreak") parts.push("\n");
    for (const child of current.content ?? []) walk(child);
  };
  walk(node);
  return parts.join("") || String(node.attrs?.text ?? "");
}
function textBoxParagraph(text: string): string {
  const runs = text
    .split("\n")
    .map((line, index) => {
      const escaped = line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const breakBefore = index > 0 ? "<w:r><w:br/></w:r>" : "";
      return `${breakBefore}<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r>`;
    })
    .join("");
  return `<w:p><w:r><w:pict><v:shape style="width:180pt;height:48pt" filled="f" stroked="t"><v:textbox><w:txbxContent><w:p>${runs}</w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
}
/** Turns text-box tokens into Word text boxes. */
export async function stampDocxTextBoxes(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file("word/document.xml");
  if (!file) return bytes;
  let xml = await file.async("string");
  if (!xml.includes("SLTBXEXPORT")) return bytes;
  xml = xml.replace(
    /<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*SLTBXEXPORT([0-9a-f]*)END(?:(?!<\/w:p>)[\s\S])*<\/w:p>/g,
    (_paragraph, hex: string) => textBoxParagraph(hexToText(hex)),
  );
  if (!xml.includes('xmlns:v="urn:schemas-microsoft-com:vml"'))
    xml = xml.replace(/<w:document\b/, '<w:document xmlns:v="urn:schemas-microsoft-com:vml"');
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "uint8array" });
}
