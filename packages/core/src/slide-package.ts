import JSZip from "jszip";
import pako from "pako";
import type { SlideFile } from "./file-schema";
import type { EmbeddedFont, Slide } from "./slide-schema";
import {
  SLMEDIA_PREFIX,
  blake3Hex,
  isSlmediaUri,
  renderSlideThumbnailSvg,
  slideGlobalSchema,
  slideHistorySchema,
  slidePackageManifestSchema,
  slideSchema,
  slmediaHashFromUri,
  slmediaUri,
  type SlideFontEntry,
  type SlideGlobal,
  type SlideHistory,
  type SlideMediaEntry,
  type SlidePackageDelta,
  type SlidePackageManifest,
  type SlideSummary,
} from "./slide-package-schema";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Default minimum string length to externalize a data: URI into a binary blob (4 MB). */
export const DEFAULT_MEDIA_THRESHOLD_BYTES = 4 * 1024 * 1024;

/** ZIP local file header magic bytes (`PK\x03\x04`). */
export function isSlidePackageBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
  "image/emf": "emf",
  "image/wmf": "wmf",
  "image/wdp": "wdp",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/mpeg": "mpeg",
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "application/font-woff": "woff",
  "application/font-woff2": "woff2",
};

const COMPRESSIBLE_MIMES = new Set([
  "application/json",
  "image/svg+xml",
  "text/plain",
  "text/xml",
]);

function extForMime(mime: string): string {
  const normalized = mime.toLowerCase().split(";")[0].trim();
  return MIME_TO_EXT[normalized] ?? "bin";
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
      "base64",
    );
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const DATA_URI_RE = /^data:([^;,]+);base64,([\s\S]+)$/i;

function decodeDataUri(uri: string): { mime: string; bytes: Uint8Array } | null {
  const match = DATA_URI_RE.exec(uri);
  if (!match) return null;
  try {
    return {
      mime: match[1].toLowerCase(),
      bytes: base64ToBytes(match[2]),
    };
  } catch {
    return null;
  }
}

function encodeDataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** Walk an object graph and externalize data: URIs >= threshold into binary blobs. */
function externalizeMedia<T>(
  value: T,
  threshold: number,
  media: Record<string, SlideMediaEntry>,
  blobs: Map<string, Uint8Array>,
  externalBlobs?: ReadonlyMap<string, { mime: string; bytes: Uint8Array }>,
): T {
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") {
      if (item.startsWith(SLMEDIA_PREFIX) && isSlmediaUri(item)) {
        const hash = slmediaHashFromUri(item);
        const ext = hash ? externalBlobs?.get(hash) : undefined;
        if (hash && ext) {
          if (!blobs.has(hash)) blobs.set(hash, ext.bytes);
          if (!media[hash]) {
            media[hash] = {
              mime: ext.mime,
              size: ext.bytes.byteLength,
              ext: extForMime(ext.mime),
            };
          }
        }
        return item;
      }
      if (item.length < threshold || !item.startsWith("data:")) return item;
      const decoded = decodeDataUri(item);
      if (!decoded) return item;
      const hash = blake3Hex(decoded.bytes);
      if (!blobs.has(hash)) {
        blobs.set(hash, decoded.bytes);
      }
      if (!media[hash]) {
        media[hash] = {
          mime: decoded.mime,
          size: decoded.bytes.byteLength,
          ext: extForMime(decoded.mime),
        };
      }
      return slmediaUri(hash);
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(record)) {
        out[key] = visit(record[key]);
      }
      return out;
    }
    return item;
  };
  return visit(value) as T;
}

/** Collect every unique BLAKE3 hash referenced via `slmedia://<hash>` inside `value`. */
export function collectSlmediaHashes(value: unknown): string[] {
  const hashes = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === "string") {
      if (item.startsWith(SLMEDIA_PREFIX)) {
        const hash = slmediaHashFromUri(item);
        if (hash) hashes.add(hash);
      }
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (item && typeof item === "object") {
      for (const child of Object.values(item as Record<string, unknown>)) {
        visit(child);
      }
    }
  };
  visit(value);
  return [...hashes];
}

/** Walk an object graph and replace slmedia://<hash> with data:<mime>;base64,... */
export function hydrateMediaRefs<T>(
  value: T,
  media: Record<string, SlideMediaEntry>,
  blobs: Map<string, Uint8Array>,
): T {
  const cache = new Map<string, string>();
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") {
      if (!item.startsWith(SLMEDIA_PREFIX) || !isSlmediaUri(item)) return item;
      const hash = slmediaHashFromUri(item);
      if (!hash) return item;
      const cached = cache.get(hash);
      if (cached) return cached;
      const bytes = blobs.get(hash);
      const entry = media[hash];
      if (!bytes || !entry) return item;
      const uri = encodeDataUri(entry.mime, bytes);
      cache.set(hash, uri);
      return uri;
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(record)) {
        out[key] = visit(record[key]);
      }
      return out;
    }
    return item;
  };
  return visit(value) as T;
}

export interface SlidePackageParts {
  manifest: SlidePackageManifest;
  manifestBytes: Uint8Array;
  manifestHash: string;
  global: SlideGlobal;
  globalBytes: Uint8Array;
  slides: Record<string, Slide>;
  slideBytes: Record<string, Uint8Array>;
  history?: SlideHistory;
  historyBytes?: Uint8Array;
  /** Content-addressed store of ALL section + media + font + thumbnail blobs by BLAKE3 hex hash. */
  blobs: Map<string, Uint8Array>;
}

export interface SplitPresentationOptions {
  mediaThresholdBytes?: number;
  generateThumbnails?: boolean;
  /** Binary media blobs already externalized as `slmedia://<hash>` in the in-memory SlideFile. */
  externalBlobs?: ReadonlyMap<string, { mime: string; bytes: Uint8Array }>;
}

/**
 * Splits a v1 or in-memory SlideFile into v2 content-addressed sections:
 * manifest.json, global.json, slides/<id>.json, binary media/*, fonts/*, and history.json.
 */
export function splitPresentation(
  file: SlideFile,
  options: SplitPresentationOptions = {},
): SlidePackageParts {
  const threshold = options.mediaThresholdBytes ?? DEFAULT_MEDIA_THRESHOLD_BYTES;
  const generateThumbnails = options.generateThumbnails ?? true;
  const externalBlobs = options.externalBlobs;
  const blobs = new Map<string, Uint8Array>();
  const media: Record<string, SlideMediaEntry> = {};
  const fonts: Record<string, SlideFontEntry> = {};

  // 1. Extract embedded fonts into binary blobs
  for (const font of file.content.fonts ?? []) {
    const decoded = decodeDataUri(font.data);
    if (decoded) {
      const hash = blake3Hex(decoded.bytes);
      if (!blobs.has(hash)) blobs.set(hash, decoded.bytes);
      fonts[hash] = {
        family: font.family,
        style: font.style,
        weight: font.weight,
        mime: decoded.mime,
        size: decoded.bytes.byteLength,
      };
    }
  }

  // 2. Build global section (everything except slides, slideOrder, fonts)
  const { slides: rawSlides, slideOrder, fonts: _fonts, ...rawGlobal } = file.content;
  const global = externalizeMedia(rawGlobal, threshold, media, blobs, externalBlobs) as SlideGlobal;
  const globalBytes = textEncoder.encode(JSON.stringify(global));
  const globalHash = blake3Hex(globalBytes);
  blobs.set(globalHash, globalBytes);

  // 3. Build per-slide sections + optional SVG thumbnails
  const slides: Record<string, Slide> = {};
  const slideBytes: Record<string, Uint8Array> = {};
  const slideSummaries: Record<string, SlideSummary> = {};

  for (const slideId of slideOrder) {
    const rawSlide = rawSlides[slideId];
    if (!rawSlide) continue;
    const extSlide = externalizeMedia(rawSlide, threshold, media, blobs, externalBlobs) as Slide;
    const bytes = textEncoder.encode(JSON.stringify(extSlide));
    const hash = blake3Hex(bytes);
    slides[slideId] = extSlide;
    slideBytes[slideId] = bytes;
    blobs.set(hash, bytes);

    const thumbSvg = generateThumbnails
      ? renderSlideThumbnailSvg(extSlide, global)
      : undefined;

    const summary: SlideSummary = {
      hash,
      size: bytes.byteLength,
      ...(extSlide.title !== undefined ? { title: extSlide.title } : {}),
      ...(extSlide.layout !== undefined ? { layout: extSlide.layout } : {}),
      ...(extSlide.hidden !== undefined ? { hidden: extSlide.hidden } : {}),
      ...(extSlide.masterId !== undefined ? { masterId: extSlide.masterId } : {}),
      ...(thumbSvg ? { thumbSvg } : {}),
    };
    slideSummaries[slideId] = summary;
  }

  // 4. Optional history section
  let history: SlideHistory | undefined;
  let historyBytes: Uint8Array | undefined;
  let historyRef: { hash: string; size: number } | undefined;
  if (file.edits?.length || file.versions?.length) {
    history = {
      ...(file.edits?.length ? { edits: file.edits } : {}),
      ...(file.versions?.length ? { versions: file.versions } : {}),
    };
    historyBytes = textEncoder.encode(JSON.stringify(history));
    const historyHash = blake3Hex(historyBytes);
    blobs.set(historyHash, historyBytes);
    historyRef = { hash: historyHash, size: historyBytes.byteLength };
  }

  // 5. Build manifest.json
  const manifest: SlidePackageManifest = {
    format: "suiteleaf",
    version: 2,
    kind: "slide",
    id: file.id,
    title: file.title,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    ...(file.importInfo ? { importInfo: file.importInfo } : {}),
    global: { hash: globalHash, size: globalBytes.byteLength },
    slideOrder: [...slideOrder],
    slides: slideSummaries,
    media,
    ...(Object.keys(fonts).length ? { fonts } : {}),
    ...(historyRef ? { history: historyRef } : {}),
  };

  const manifestBytes = textEncoder.encode(JSON.stringify(manifest));
  const manifestHash = blake3Hex(manifestBytes);

  return {
    manifest,
    manifestBytes,
    manifestHash,
    global,
    globalBytes,
    slides,
    slideBytes,
    history,
    historyBytes,
    blobs,
  };
}

/** Reassembles a complete SlideFile from v2 sections. */
export function assemblePresentation(
  parts: {
    manifest: SlidePackageManifest;
    global: SlideGlobal;
    slides: Record<string, Slide>;
    history?: SlideHistory;
    blobs?: Map<string, Uint8Array>;
  },
  options: { hydrateMedia?: boolean } = {},
): SlideFile {
  const hydrate = options.hydrateMedia ?? true;
  const blobs = parts.blobs ?? new Map<string, Uint8Array>();

  const global = hydrate
    ? hydrateMediaRefs(parts.global, parts.manifest.media, blobs)
    : parts.global;

  const slides: Record<string, Slide> = {};
  for (const id of parts.manifest.slideOrder) {
    const slide = parts.slides[id];
    if (!slide) {
      throw new Error(`Presentation is missing slide "${id}".`);
    }
    slides[id] = hydrate
      ? hydrateMediaRefs(slide, parts.manifest.media, blobs)
      : slide;
  }

  const fonts: EmbeddedFont[] = [];
  if (parts.manifest.fonts) {
    for (const [hash, entry] of Object.entries(parts.manifest.fonts)) {
      const bytes = blobs.get(hash);
      if (bytes) {
        fonts.push({
          family: entry.family,
          style: entry.style,
          weight: entry.weight,
          data: encodeDataUri(entry.mime, bytes),
        });
      }
    }
  }

  return {
    format: "suiteleaf",
    version: 1,
    kind: "slide",
    id: parts.manifest.id,
    title: parts.manifest.title,
    createdAt: parts.manifest.createdAt,
    updatedAt: parts.manifest.updatedAt,
    ...(parts.manifest.importInfo
      ? { importInfo: parts.manifest.importInfo as SlideFile["importInfo"] }
      : {}),
    ...(parts.history?.edits?.length
      ? { edits: parts.history.edits as SlideFile["edits"] }
      : {}),
    ...(parts.history?.versions?.length
      ? { versions: parts.history.versions as SlideFile["versions"] }
      : {}),
    content: {
      ...global,
      slideOrder: [...parts.manifest.slideOrder],
      slides,
      ...(fonts.length ? { fonts } : {}),
    },
  };
}

/**
 * Packs a SlideFile or pre-split SlidePackageParts into a v2 `.slslides` ZIP archive.
 * Entries are written in priority order: manifest -> global -> slides -> media -> fonts -> history.
 */
export async function packSlidePackageZip(
  fileOrParts: SlideFile | SlidePackageParts,
  options?: SplitPresentationOptions,
): Promise<Uint8Array> {
  const parts =
    "manifest" in fileOrParts
      ? fileOrParts
      : splitPresentation(fileOrParts, options);

  const zip = new JSZip();
  zip.file("manifest.json", parts.manifestBytes, { compression: "DEFLATE" });
  zip.file("global.json", parts.globalBytes, { compression: "DEFLATE" });

  for (const slideId of parts.manifest.slideOrder) {
    const bytes = parts.slideBytes[slideId];
    if (bytes) {
      zip.file(`slides/${slideId}.json`, bytes, { compression: "DEFLATE" });
    }
  }

  for (const [hash, entry] of Object.entries(parts.manifest.media)) {
    const bytes = parts.blobs.get(hash);
    if (!bytes) continue;
    const ext = entry.ext || extForMime(entry.mime);
    const compression = COMPRESSIBLE_MIMES.has(entry.mime) ? "DEFLATE" : "STORE";
    zip.file(`media/${hash}.${ext}`, bytes, { compression });
  }

  if (parts.manifest.fonts) {
    for (const [hash, entry] of Object.entries(parts.manifest.fonts)) {
      const bytes = parts.blobs.get(hash);
      if (!bytes) continue;
      const ext = extForMime(entry.mime);
      zip.file(`fonts/${hash}.${ext}`, bytes, { compression: "STORE" });
    }
  }

  if (parts.historyBytes && parts.manifest.history) {
    zip.file("history.json", parts.historyBytes, { compression: "DEFLATE" });
  }

  return zip.generateAsync({ type: "uint8array" });
}

/** Unpacks a full v2 `.slslides` ZIP buffer into its component sections. */
export async function unpackSlidePackageZip(
  bytes: Uint8Array,
): Promise<SlidePackageParts> {
  const zip = await JSZip.loadAsync(bytes);
  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) {
    throw new Error("Slide package is missing manifest.json.");
  }
  const manifestBytes = await manifestEntry.async("uint8array");
  const manifest = slidePackageManifestSchema.parse(
    JSON.parse(textDecoder.decode(manifestBytes)),
  );
  const manifestHash = blake3Hex(manifestBytes);

  const globalEntry = zip.file("global.json");
  if (!globalEntry) {
    throw new Error("Slide package is missing global.json.");
  }
  const globalBytes = await globalEntry.async("uint8array");
  const global = slideGlobalSchema.parse(
    JSON.parse(textDecoder.decode(globalBytes)),
  );

  const blobs = new Map<string, Uint8Array>();
  blobs.set(manifest.global.hash, globalBytes);

  const slides: Record<string, Slide> = {};
  const slideBytes: Record<string, Uint8Array> = {};
  for (const slideId of manifest.slideOrder) {
    const entry = zip.file(`slides/${slideId}.json`);
    if (!entry) {
      throw new Error(`Slide package is missing slides/${slideId}.json.`);
    }
    const raw = await entry.async("uint8array");
    const parsed = slideSchema.parse(JSON.parse(textDecoder.decode(raw)));
    slides[slideId] = parsed;
    slideBytes[slideId] = raw;
    const summary = manifest.slides[slideId];
    if (summary) blobs.set(summary.hash, raw);
  }

  for (const [hash, entry] of Object.entries(manifest.media)) {
    const ext = entry.ext || extForMime(entry.mime);
    const file = zip.file(`media/${hash}.${ext}`) ?? zip.file(`media/${hash}`);
    if (file) {
      blobs.set(hash, await file.async("uint8array"));
    }
  }

  if (manifest.fonts) {
    for (const [hash, entry] of Object.entries(manifest.fonts)) {
      const ext = extForMime(entry.mime);
      const file = zip.file(`fonts/${hash}.${ext}`) ?? zip.file(`fonts/${hash}`);
      if (file) {
        blobs.set(hash, await file.async("uint8array"));
      }
    }
  }

  let history: SlideHistory | undefined;
  let historyBytes: Uint8Array | undefined;
  if (manifest.history) {
    const historyFile = zip.file("history.json");
    if (historyFile) {
      historyBytes = await historyFile.async("uint8array");
      history = slideHistorySchema.parse(
        JSON.parse(textDecoder.decode(historyBytes)),
      );
      blobs.set(manifest.history.hash, historyBytes);
    }
  }

  return {
    manifest,
    manifestBytes,
    manifestHash,
    global,
    globalBytes,
    slides,
    slideBytes,
    history,
    historyBytes,
    blobs,
  };
}

/** Parses a v2 `.slslides` ZIP buffer into a full hydrated SlideFile. */
export async function parseSlidePackageZip(bytes: Uint8Array): Promise<SlideFile> {
  const parts = await unpackSlidePackageZip(bytes);
  return assemblePresentation(parts, { hydrateMedia: true });
}

/**
 * Computes the minimal delta between a previous manifest and a new SlidePackageParts.
 * Only changed section/media/font/history blobs are included in `changedBlobs`.
 */
export function diffSlidePackage(
  previous: SlidePackageManifest | null,
  next: SlidePackageParts,
): SlidePackageDelta {
  const changedBlobs = new Map<string, Uint8Array>();

  const globalChanged = !previous || previous.global.hash !== next.manifest.global.hash;
  if (globalChanged) {
    changedBlobs.set(next.manifest.global.hash, next.globalBytes);
  }

  const changedSlideIds: string[] = [];
  for (const slideId of next.manifest.slideOrder) {
    const nextSummary = next.manifest.slides[slideId];
    const prevSummary = previous?.slides[slideId];
    if (!nextSummary) continue;
    if (!prevSummary || prevSummary.hash !== nextSummary.hash) {
      changedSlideIds.push(slideId);
      const bytes = next.slideBytes[slideId];
      if (bytes) changedBlobs.set(nextSummary.hash, bytes);
    }
    if (
      nextSummary.thumbHash &&
      (!prevSummary || prevSummary.thumbHash !== nextSummary.thumbHash)
    ) {
      const thumbBytes = next.blobs.get(nextSummary.thumbHash);
      if (thumbBytes) changedBlobs.set(nextSummary.thumbHash, thumbBytes);
    }
  }

  const nextSlideSet = new Set(next.manifest.slideOrder);
  const removedSlideIds = previous
    ? previous.slideOrder.filter((id) => !nextSlideSet.has(id))
    : [];

  for (const hash of Object.keys(next.manifest.media)) {
    if (!previous?.media[hash]) {
      const bytes = next.blobs.get(hash);
      if (bytes) changedBlobs.set(hash, bytes);
    }
  }

  if (next.manifest.fonts) {
    for (const hash of Object.keys(next.manifest.fonts)) {
      if (!previous?.fonts?.[hash]) {
        const bytes = next.blobs.get(hash);
        if (bytes) changedBlobs.set(hash, bytes);
      }
    }
  }

  const historyChanged =
    !!next.manifest.history &&
    (!previous?.history || previous.history.hash !== next.manifest.history.hash);
  if (historyChanged && next.manifest.history && next.historyBytes) {
    changedBlobs.set(next.manifest.history.hash, next.historyBytes);
  }

  return {
    manifest: next.manifest,
    manifestBytes: next.manifestBytes,
    manifestHash: next.manifestHash,
    globalChanged,
    historyChanged,
    changedSlideIds,
    removedSlideIds,
    changedBlobs,
  };
}

// ---------------------------------------------------------------------------
// Random-Access ZIP Reader (O(1) entry extraction without reading full file)
// ---------------------------------------------------------------------------

export interface ZipCentralEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export type ZipRangeReader = (
  offset: number,
  length: number,
) => Promise<Uint8Array>;

/**
 * Reads only the ZIP End-of-Central-Directory and Central Directory using
 * bounded byte-range reads. Allows Desktop/Browser to open a 200 MB `.slslides`
 * and extract only `manifest.json`, `global.json`, and the active slide.
 */
export async function readZipCentralDirectory(
  fileSize: number,
  readRange: ZipRangeReader,
): Promise<Map<string, ZipCentralEntry>> {
  const tailSize = Math.min(fileSize, 65557);
  if (tailSize < 22) {
    throw new Error("Invalid ZIP archive: file too small.");
  }
  const tailOffset = fileSize - tailSize;
  const tail = await readRange(tailOffset, tailSize);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  let eocdPos = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) {
    throw new Error("Invalid ZIP archive: End of Central Directory not found.");
  }

  const cdSize = view.getUint32(eocdPos + 12, true);
  const cdOffset = view.getUint32(eocdPos + 16, true);
  const cdBytes =
    cdOffset >= tailOffset && cdOffset + cdSize <= fileSize
      ? tail.subarray(cdOffset - tailOffset, cdOffset - tailOffset + cdSize)
      : await readRange(cdOffset, cdSize);

  const cdView = new DataView(
    cdBytes.buffer,
    cdBytes.byteOffset,
    cdBytes.byteLength,
  );
  const entries = new Map<string, ZipCentralEntry>();
  let pos = 0;
  while (pos + 46 <= cdBytes.byteLength) {
    if (cdView.getUint32(pos, true) !== 0x02014b50) break;
    const compressionMethod = cdView.getUint16(pos + 10, true);
    const compressedSize = cdView.getUint32(pos + 20, true);
    const uncompressedSize = cdView.getUint32(pos + 24, true);
    const nameLen = cdView.getUint16(pos + 28, true);
    const extraLen = cdView.getUint16(pos + 30, true);
    const commentLen = cdView.getUint16(pos + 32, true);
    const localHeaderOffset = cdView.getUint32(pos + 42, true);
    const name = textDecoder.decode(cdBytes.subarray(pos + 46, pos + 46 + nameLen));
    entries.set(name, {
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Extracts a single entry from a ZIP archive using bounded byte-range reads. */
export async function readZipEntry(
  entry: ZipCentralEntry,
  readRange: ZipRangeReader,
): Promise<Uint8Array> {
  const localHeader = await readRange(entry.localHeaderOffset, 30);
  const view = new DataView(
    localHeader.buffer,
    localHeader.byteOffset,
    localHeader.byteLength,
  );
  if (view.getUint32(0, true) !== 0x04034b50) {
    throw new Error(`Invalid local file header for "${entry.name}".`);
  }
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const dataOffset = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const compressed = await readRange(dataOffset, entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return compressed;
  }
  if (entry.compressionMethod === 8) {
    return pako.inflateRaw(compressed);
  }
  throw new Error(
    `Unsupported ZIP compression method ${entry.compressionMethod} for "${entry.name}".`,
  );
}
