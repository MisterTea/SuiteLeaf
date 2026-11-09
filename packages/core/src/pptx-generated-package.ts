import JSZip from "jszip";

/** Normalize generator bookkeeping before SuiteLeaf writes object references. */
export async function normalizeGeneratedPptx(
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  for (const path of Object.keys(zip.files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(path)) continue;
    let xml = await zip.file(path)!.async("string");
    let id = 0;
    // PptxGenJS uses the relationship counter as the media shape id, which
    // collides with preceding text shapes. Object order supplies unique ids.
    xml = xml.replace(
      /(<p:cNvPr\b[^>]*\bid=")\d+("[^>]*>)/g,
      (_, before, after) => `${before}${++id}${after}`,
    );
    xml = xml.replace(/<a:p>[\s\S]*?<\/a:p>/g, (paragraph) => {
      let seen = false;
      return paragraph.replace(
        /<a:pPr\b(?:[^>]*?\/>|[^>]*>[\s\S]*?<\/a:pPr>)/g,
        (properties) => {
          if (seen) return "";
          seen = true;
          return properties;
        },
      );
    });
    zip.file(path, xml);
  }
  const path = "[Content_Types].xml";
  const types = await zip.file(path)!.async("string");
  zip.file(
    path,
    types.replace(/<Override\b[^>]*PartName="([^"]+)"[^>]*\/>/g, (tag, part) =>
      zip.file(part.replace(/^\//, "")) ? tag : "",
    ),
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
