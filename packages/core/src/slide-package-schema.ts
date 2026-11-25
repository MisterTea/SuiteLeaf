import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";
import {
  presentationSchema,
  slideSchema,
  type Presentation,
  type Slide,
} from "./slide-schema";

export const SLMEDIA_PREFIX = "slmedia://";
export const BLAKE3_HEX_RE = /^[a-f0-9]{64}$/;
export const SLMEDIA_URI_RE = /^slmedia:\/\/[a-f0-9]{64}$/;

const textEncoder = new TextEncoder();

export function blake3Hex(bytes: Uint8Array): string {
  return bytesToHex(blake3(bytes));
}

export function blake3Text(text: string): string {
  return blake3Hex(textEncoder.encode(text));
}

export function isSlmediaUri(value: string): boolean {
  return SLMEDIA_URI_RE.test(value);
}

export function slmediaHashFromUri(uri: string): string | null {
  if (!SLMEDIA_URI_RE.test(uri)) return null;
  return uri.slice(SLMEDIA_PREFIX.length);
}

export function slmediaUri(hash: string): string {
  return `${SLMEDIA_PREFIX}${hash}`;
}

export const slideSectionRefSchema = z.object({
  hash: z.string().regex(BLAKE3_HEX_RE),
  size: z.number().int().nonnegative(),
});
export type SlideSectionRef = z.infer<typeof slideSectionRefSchema>;

export const slideSummarySchema = z.object({
  hash: z.string().regex(BLAKE3_HEX_RE),
  size: z.number().int().nonnegative(),
  title: z.string().optional(),
  layout: z
    .enum([
      "title",
      "title-body",
      "section",
      "two-column",
      "three-column",
      "blank",
    ])
    .optional(),
  hidden: z.boolean().optional(),
  masterId: z.string().min(1).max(80).optional(),
  thumbHash: z.string().regex(BLAKE3_HEX_RE).optional(),
  thumbMime: z.string().min(1).max(80).optional(),
});
export type SlideSummary = z.infer<typeof slideSummarySchema>;

export const slideMediaEntrySchema = z.object({
  mime: z.string().min(1).max(120),
  size: z.number().int().nonnegative(),
  ext: z.string().max(16).optional(),
});
export type SlideMediaEntry = z.infer<typeof slideMediaEntrySchema>;

export const slideFontEntrySchema = z.object({
  family: z.string().min(1).max(80),
  style: z.enum(["normal", "italic"]),
  weight: z.union([z.literal(400), z.literal(700)]),
  mime: z.string().min(1).max(120),
  size: z.number().int().nonnegative(),
});
export type SlideFontEntry = z.infer<typeof slideFontEntrySchema>;

export const slideGlobalSchema = presentationSchema.omit({
  slides: true,
  slideOrder: true,
  fonts: true,
});
export type SlideGlobal = z.infer<typeof slideGlobalSchema>;

export const slideHistorySchema = z.object({
  edits: z.array(z.unknown()).optional(),
  versions: z.array(z.unknown()).optional(),
});
export type SlideHistory = z.infer<typeof slideHistorySchema>;

export const slidePackageManifestSchema = z.object({
  format: z.literal("suiteleaf"),
  version: z.literal(2),
  kind: z.literal("slide"),
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  importInfo: z
    .object({
      sourceFormat: z.string(),
      sourceName: z.string(),
      warnings: z.array(z.string()),
      features: z.array(z.string()),
    })
    .optional(),
  global: slideSectionRefSchema,
  slideOrder: z.array(z.string().min(1)).min(1),
  slides: z.record(z.string(), slideSummarySchema),
  media: z.record(z.string(), slideMediaEntrySchema),
  fonts: z.record(z.string(), slideFontEntrySchema).optional(),
  history: slideSectionRefSchema.optional(),
});
export type SlidePackageManifest = z.infer<typeof slidePackageManifestSchema>;

/**
 * In-memory presentation state that supports partial loading:
 * `slides[id]` may be undefined while background streaming is in progress,
 * while `slideSummaries[id]` (from manifest.json) is always available immediately.
 */
export interface PartialPresentation extends Omit<Presentation, "slides"> {
  slides: Record<string, Slide | undefined>;
  slideSummaries?: Record<string, SlideSummary>;
  loadedSlideIds?: Set<string>;
}

/** Minimal delta produced when comparing two versions of a sectioned presentation. */
export interface SlidePackageDelta {
  manifest: SlidePackageManifest;
  manifestBytes: Uint8Array;
  manifestHash: string;
  globalChanged: boolean;
  historyChanged: boolean;
  changedSlideIds: string[];
  removedSlideIds: string[];
  /** Hashes of all new or modified blobs (global, slides, media, fonts, history). */
  changedBlobs: Map<string, Uint8Array>;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeColor(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  const trimmed = color.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/i.test(trimmed)) return trimmed;
  if (/^[a-zA-Z]{3,24}$/.test(trimmed)) return trimmed;
  return fallback;
}

/**
 * Generates a lightweight (~1-2 KB) SVG thumbnail for a slide so manifest.json
 * can provide instant filmstrip previews before full slide JSONs finish streaming.
 */
export function renderSlideThumbnailSvg(
  slide: Slide,
  global: Pick<SlideGlobal, "width" | "height" | "theme">,
): string {
  const w = Math.max(1, Math.round(global.width || 960));
  const h = Math.max(1, Math.round(global.height || 540));
  const bg = safeColor(
    slide.background?.color ?? global.theme?.background,
    "#ffffff",
  );
  const defaultInk = safeColor(global.theme?.bodyColor, "#1e293b");
  const accent = safeColor(global.theme?.accent, "#3b82f6");

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="240" height="${Math.round((240 * h) / w)}">`,
    `<rect width="${w}" height="${h}" fill="${bg}"/>`,
  ];

  // Limit to 24 elements so thumbnails stay tiny (< 2 KB)
  const elements = slide.elements.slice(0, 24);
  for (const el of elements) {
    const x = Math.round(el.x);
    const y = Math.round(el.y);
    const ew = Math.max(1, Math.round(el.width));
    const eh = Math.max(1, Math.round(el.height));

    if (el.type === "shape") {
      const fill = safeColor(el.fill, accent);
      const stroke = el.stroke ? ` stroke="${safeColor(el.stroke, defaultInk)}" stroke-width="${Math.max(1, Math.round(el.strokeWidth ?? 2))}"` : "";
      if (el.shapeType === "ellipse") {
        parts.push(
          `<ellipse cx="${x + Math.round(ew / 2)}" cy="${y + Math.round(eh / 2)}" rx="${Math.round(ew / 2)}" ry="${Math.round(eh / 2)}" fill="${fill}"${stroke}/>`,
        );
      } else {
        const rx = el.shapeType === "roundRect" ? Math.round(el.radius ?? 12) : 0;
        parts.push(
          `<rect x="${x}" y="${y}" width="${ew}" height="${eh}"${rx ? ` rx="${rx}"` : ""} fill="${fill}"${stroke}/>`,
        );
      }
    } else if (el.type === "image" || el.type === "video") {
      parts.push(
        `<rect x="${x}" y="${y}" width="${ew}" height="${eh}" rx="6" fill="#cbd5e1" opacity="0.65"/>`,
      );
    } else if (el.type === "table") {
      parts.push(
        `<rect x="${x}" y="${y}" width="${ew}" height="${eh}" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2"/>`,
      );
    } else if (el.type === "text") {
      if (el.fill) {
        parts.push(
          `<rect x="${x}" y="${y}" width="${ew}" height="${eh}" fill="${safeColor(el.fill, "transparent")}"/>`,
        );
      }
      const rawText = (el.content ?? "").trim().replace(/\s+/g, " ");
      if (rawText) {
        const snippet = escapeXml(rawText.slice(0, 48));
        const fontSize = Math.max(12, Math.min(72, Math.round(el.fontSize ?? 24)));
        const ink = safeColor(el.color, defaultInk);
        const anchor =
          el.align === "center"
            ? "middle"
            : el.align === "right"
              ? "end"
              : "start";
        const tx =
          el.align === "center"
            ? x + Math.round(ew / 2)
            : el.align === "right"
              ? x + ew - 8
              : x + 8;
        const ty = y + Math.min(eh - 4, fontSize + 8);
        parts.push(
          `<text x="${tx}" y="${ty}" font-family="sans-serif" font-size="${fontSize}"${el.bold ? ' font-weight="700"' : ""} fill="${ink}" text-anchor="${anchor}">${snippet}</text>`,
        );
      }
    }
  }

  parts.push("</svg>");
  return parts.join("");
}

export { slideSchema };
