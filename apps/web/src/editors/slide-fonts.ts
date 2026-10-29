import type { EmbeddedFont } from "@suiteleaf/core";

const loaded = new Set<string>();
const pending = new Set<string>();

function bytesFromDataUrl(data: string): ArrayBuffer | undefined {
  const comma = data.indexOf(",");
  if (!data.startsWith("data:font/") || comma < 0) return;
  const binary = atob(data.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Register PPTX-embedded faces so `font-family` resolves before text is drawn. */
export async function loadEmbeddedFonts(
  fonts: readonly EmbeddedFont[] | undefined,
): Promise<void> {
  if (!fonts?.length || typeof FontFace === "undefined" || !document.fonts)
    return;
  const jobs: Promise<unknown>[] = [];
  for (const font of fonts) {
    const key = `${font.family}\0${font.style}\0${font.weight}\0${font.data.length}\0${font.data.slice(0, 48)}`;
    if (loaded.has(key) || pending.has(key)) continue;
    const bytes = bytesFromDataUrl(font.data);
    if (!bytes) continue;
    pending.add(key);
    try {
      const face = new FontFace(font.family, bytes, {
        style: font.style,
        weight: String(font.weight),
      });
      document.fonts.add(face);
      jobs.push(
        face.load().then(
          () => {
            loaded.add(key);
            pending.delete(key);
          },
          () => pending.delete(key),
        ),
      );
    } catch {
      pending.delete(key);
    }
  }
  await Promise.all(jobs);
}
