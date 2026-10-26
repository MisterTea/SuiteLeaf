import JSZip from "jszip";

/** JPEG XR uses an Office-specific media type, rather than image/wdp. */
export async function stampNativeImageTypes(
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const types = zip.file("[Content_Types].xml");
  if (!types) return bytes;
  const xml = await types.async("string");
  const normalized = xml.replace(
    /ContentType="image\/wdp"/g,
    'ContentType="image/vnd.ms-photo"',
  );
  if (normalized === xml) return bytes;
  zip.file("[Content_Types].xml", normalized);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
