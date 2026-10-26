import JSZip from "jszip";
import type { Slide } from "./index";
export const nativeLayerMarker = (id: string) => `SuiteLeaf image layer ${id}`;
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
/** Retain the editable original behind Office's processed raster image. */
export async function stampImageLayers(
  bytes: Uint8Array,
  slides: Slide[],
): Promise<Uint8Array> {
  if (!slides.some((s) => s.elements.some((e) => e.imageLayer))) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  for (let i = 0; i < slides.length; i++) {
    const part = `ppt/slides/slide${i + 1}.xml`,
      relsPart = `ppt/slides/_rels/slide${i + 1}.xml.rels`;
    const sf = zip.file(part),
      rf = zip.file(relsPart);
    if (!sf || !rf) continue;
    let xml = await sf.async("string"),
      rels = await rf.async("string");
    for (let j = 0; j < slides[i].elements.length; j++) {
      const el = slides[i].elements[j],
        layer = el.imageLayer;
      if (!layer || el.type !== "image") continue;
      const data = /^data:image\/wdp;base64,([\s\S]+)$/i.exec(layer.src);
      if (!data) continue;
      let id = `rIdSuiteLeafLayer${j}`;
      while (rels.includes(`Id="${id}"`)) id += "x";
      let name = `suiteleaf-original-${i + 1}-${j}.wdp`;
      while (zip.file(`ppt/media/${name}`)) name = "x-" + name;
      const bg = layer.backgroundRemoval;
      const mark = (
        kind: string,
        m: { x1: number; y1: number; x2: number; y2: number },
      ) =>
        `<a14:${kind}Mark x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}"/>`;
      const effect = bg
        ? `<a14:imgEffect><a14:backgroundRemoval t="${bg.t}" b="${bg.b}" l="${bg.l}" r="${bg.r}">${bg.foregroundMarks.map((m) => mark("foreground", m)).join("")}${bg.backgroundMarks.map((m) => mark("background", m)).join("")}</a14:backgroundRemoval></a14:imgEffect>`
        : "";
      const ext = `<a:ext uri="{BEBA8EAE-BF5A-486C-A8C5-ECC9F3942E4B}"><a14:imgProps xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><a14:imgLayer r:embed="${id}">${effect}</a14:imgLayer></a14:imgProps></a:ext>`;
      const marker = esc(nativeLayerMarker(el.id));
      let changed = false;
      xml = xml.replace(/<p:pic\b[\s\S]*?<\/p:pic>/g, (pic) => {
        if (!pic.includes(`descr="${marker}"`)) return pic;
        changed = true;
        return pic
          .replace(/<a:blip\b[^>]*(?:\/>|>[\s\S]*?<\/a:blip>)/, (blip) =>
            blip.endsWith("/>")
              ? `${blip.slice(0, -2)}><a:extLst>${ext}</a:extLst></a:blip>`
              : blip.includes("</a:extLst>")
                ? blip.replace("</a:extLst>", ext + "</a:extLst>")
                : blip.replace(
                    "</a:blip>",
                    `<a:extLst>${ext}</a:extLst></a:blip>`,
                  ),
          )
          .replace(`descr="${marker}"`, `descr="${esc(el.alt || "")}"`);
      });
      if (!changed)
        throw new Error(
          `Original image layer missing from exported slide ${i + 1}`,
        );
      zip.file(`ppt/media/${name}`, data[1], { base64: true });
      rels = rels.replace(
        "</Relationships>",
        `<Relationship Id="${id}" Type="http://schemas.microsoft.com/office/2007/relationships/hdphoto" Target="../media/${name}"/></Relationships>`,
      );
    }
    zip.file(part, xml);
    zip.file(relsPart, rels);
  }
  const tf = zip.file("[Content_Types].xml");
  if (tf) {
    let x = await tf.async("string");
    if (!/<Default\b[^>]*Extension="wdp"/i.test(x))
      x = x.replace(
        "</Types>",
        '<Default Extension="wdp" ContentType="image/vnd.ms-photo"/></Types>',
      );
    zip.file("[Content_Types].xml", x);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
