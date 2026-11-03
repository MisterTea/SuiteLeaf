import JSZip from "jszip";
import type { Slide } from "./index";

const MARKER = "SuiteLeaf id ";
const ID_CHARS = "[A-Za-z0-9_-]{1,80}";
const SAFE_ID = new RegExp(`^${ID_CHARS}$`);

/** A shape name PptxGenJS can write, for an id the stamp can find. */
export function readingOrderMarker(id: string): string | undefined {
  return SAFE_ID.test(id) ? `${MARKER}${id}` : undefined;
}

/**
 * Write the slide's reading order as its own list in the slide XML.
 * The list uses the shape ids from the file, not the speaker notes.
 * Shape names used only to find those ids are put back.
 */
export async function stampReadingOrder(
  bytes: Uint8Array,
  slides: Slide[],
): Promise<Uint8Array> {
  if (!slides.some((slide) => slide.readingOrder?.length)) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  for (let index = 0; index < slides.length; index++) {
    const order = slides[index].readingOrder;
    if (!order?.length) continue;
    const part = `ppt/slides/slide${index + 1}.xml`;
    const file = zip.file(part);
    if (!file) continue;
    let xml = await file.async("string");
    const shapeIds = new Map<string, string>();
    xml = xml.replace(/<p:cNvPr\b([^>]*?)(\/?>)/g, (tag, attrs: string) => {
      const named = new RegExp(`name="${MARKER}(${ID_CHARS})"`).exec(attrs);
      const kern = /name="SuiteLeaf kern ([A-Za-z0-9_-]+)"/.exec(attrs);
      const objectId = named?.[1] ?? kern?.[1];
      const numeric = /\bid="(\d+)"/.exec(attrs)?.[1];
      if (objectId && numeric) shapeIds.set(objectId, numeric);
      if (!named) return tag;
      return tag.replace(`name="${MARKER}${named[1]}"`, `name="Object ${named[1]}"`);
    });
    const listed = order.filter((id) => shapeIds.has(id));
    if (listed.length) {
      const items = listed
        .map((id) => `<sl:item id="${shapeIds.get(id)}"/>`)
        .join("");
      const block =
        `<p:ext uri="{B8E2C3A1-5F04-4C1E-9A77-6D0E5F1A2B3C}">` +
        `<sl:readingOrder xmlns:sl="https://suiteleaf.dev/ns/slide">${items}</sl:readingOrder>` +
        `</p:ext>`;
      const end = xml.lastIndexOf("</p:extLst>");
      xml =
        end >= 0
          ? xml.slice(0, end) + block + xml.slice(end)
          : xml.replace("</p:sld>", `<p:extLst>${block}</p:extLst></p:sld>`);
    }
    zip.file(part, xml);
  }
  return zip.generateAsync({ type: "uint8array" });
}

/** Element ids in the stored reading order. Shape ids the slide no longer has are left out. */
export function readingOrderIds(
  slideXml: string,
  shapeIndex: Map<string, number>,
  elements: { id: string }[],
): string[] {
  const block = /<sl:readingOrder\b[^>]*>([\s\S]*?)<\/sl:readingOrder>/.exec(slideXml)?.[1];
  if (!block) return [];
  const ids: string[] = [];
  for (const match of block.matchAll(/<sl:item\b[^>]*\bid="(\d+)"/g)) {
    const index = shapeIndex.get(match[1]);
    const element = index == null ? undefined : elements[index];
    if (element && !ids.includes(element.id)) ids.push(element.id);
  }
  return ids;
}
