import type { Presentation } from "@suiteleaf/core";
import { masterForSlide } from "./slide-master";
import type { ShowCursor } from "./slide-fade-in";
import type { MarpPage, MarpPages } from "./slide-marp-render";

export const CAST_NAMESPACE = "urn:x-cast:com.suiteleaf.slides";
const CHUNK_SIZE = 48_000;
const MAX_CHUNKS = 1024;

export type CastFrame = {
  version: 1;
  deck: Presentation;
  index: number;
  cursor: ShowCursor;
  blank: string | null;
  page?: MarpPage;
};

/** Only the current slide's visual data leaves the sender. */
export function castFrame(deck: Presentation, index: number, cursor: ShowCursor, blank: string | null, pages?: MarpPages | null): CastFrame {
  const slide = deck.slides[deck.slideOrder[index]];
  const page = pages?.pages[index];
  const slideMaster = masterForSlide(deck, slide);
  const sources = new Set([...(slide?.elements ?? []), ...slideMaster.elements].map((el) => el.src));
  return {
    version: 1, index, cursor, blank,
    deck: {
      id: "cast",
      width: deck.width, height: deck.height, pointWidth: deck.pointWidth,
      master: { background: slideMaster.background, elements: slideMaster.elements, layouts: slideMaster.layouts },
      fonts: deck.fonts, slideNumbers: deck.slideNumbers,
      marp: deck.marp, marpFit: deck.marpFit || (!!deck.marp && deck.marpSource !== undefined),
      marpAssets: Object.fromEntries(Object.entries(deck.marpAssets ?? {}).filter(([path]) => sources.has(path))),
      slideOrder: deck.slideOrder.map((id, n) => n === index ? id : ""),
      slides: slide ? { [slide.id]: { id: slide.id, elements: slide.elements, background: slide.background, transition: slide.transition } } : {},
    },
    ...(page ? { page: { width: page.width, height: page.height, document: page.plain, plain: page.plain } } : {}),
  };
}

/** Blob URLs belong to this browser; embed their bytes for the TV. */
export async function portableFrame(frame: CastFrame): Promise<string> {
  let json = JSON.stringify(frame);
  const urls = [...new Set(json.match(/blob:https?:[^"'\s<>\\)]+/g) ?? [])];
  const replacements = await Promise.all(urls.map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("A slide asset could not be read for casting.");
    const blob = await response.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("A slide asset could not be read for casting."));
      reader.readAsDataURL(blob);
    });
    return [url, data] as const;
  }));
  for (const [url, data] of replacements) json = json.split(url).join(data);
  return json;
}

export type CastChunk = { id: string; part: number; total: number; data: string };

/** Base64 keeps even heavily escaped Unicode messages below Cast's 64 KiB limit. */
export function frameChunks(json: string, id: string): CastChunk[] {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  const data = btoa(binary);
  const total = Math.ceil(data.length / CHUNK_SIZE);
  if (total > MAX_CHUNKS) throw new Error("This slide is too large to cast. Try reducing its image or media sizes.");
  return Array.from({ length: total }, (_, part) => ({ id, part, total, data: data.slice(part * CHUNK_SIZE, (part + 1) * CHUNK_SIZE) }));
}

/** One bounded, ordered transfer per sender; a partial frame is never displayed. */
export function frameAssembler(onFrame: (frame: CastFrame) => void) {
  let pending: { id: string; total: number; parts: string[] } | undefined;
  return (message: unknown) => {
    if (!message || typeof message !== "object") return;
    const { id, part, total, data } = message as CastChunk;
    if (typeof id !== "string" || id.length > 100 || !Number.isInteger(part) || !Number.isInteger(total) || total < 1 || total > MAX_CHUNKS || part < 0 || part >= total || typeof data !== "string" || data.length > CHUNK_SIZE) return;
    if (part === 0) pending = { id, total, parts: [] };
    if (!pending || pending.id !== id || pending.total !== total || pending.parts.length !== part) return;
    pending.parts.push(data);
    if (pending.parts.length !== total) return;
    const encoded = pending.parts.join("");
    pending = undefined;
    try {
      const json = new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
      const frame = JSON.parse(json) as CastFrame;
      if (frame.version === 1 && frame.deck?.slides && Array.isArray(frame.deck.slideOrder) && Number.isInteger(frame.index) && frame.index >= 0 && frame.index < frame.deck.slideOrder.length && frame.cursor && (frame.blank === null || /^#[0-9a-f]{6}$/i.test(frame.blank))) onFrame(frame);
    } catch { /* Ignore incomplete or incompatible senders. */ }
  };
}
