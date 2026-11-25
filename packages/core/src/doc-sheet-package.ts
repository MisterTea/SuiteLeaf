import JSZip from "jszip";
import { z } from "zod";
import type { DocFile, DocTab, JsonNode, SheetFile, SuiteFile } from "./file-schema";
import {
  BLAKE3_HEX_RE,
  blake3Hex,
  slideHistorySchema,
  slideMediaEntrySchema,
  slideSectionRefSchema,
  type SlideHistory,
  type SlideMediaEntry,
  type SlideSectionRef,
} from "./slide-package-schema";
import {
  DEFAULT_MEDIA_THRESHOLD_BYTES,
  isSlidePackageBytes,
  packSlidePackageZip,
  parseSlidePackageZip,
} from "./slide-package";
import {
  SLMEDIA_PREFIX,
  isSlmediaUri,
  slmediaHashFromUri,
  slmediaUri,
} from "./slide-package-schema";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** ZIP local file header magic bytes (`PK\x03\x04`). Shared by v2 `.slslides`, `.slsheet`, `.sldoc`. */
export const isSuitePackageBytes = isSlidePackageBytes;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

const COMPRESSIBLE_MIMES = new Set(["image/svg+xml", "application/json", "text/plain"]);

function extForMime(mime: string): string {
  return MIME_TO_EXT[mime.toLowerCase().split(";")[0].trim()] ?? "bin";
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
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
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
    return { mime: match[1].toLowerCase(), bytes: base64ToBytes(match[2]) };
  } catch {
    return null;
  }
}

function encodeDataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

function externalizeMedia<T>(
  value: T,
  threshold: number,
  media: Record<string, SlideMediaEntry>,
  blobs: Map<string, Uint8Array>,
): T {
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") {
      if (item.length < threshold || !item.startsWith("data:")) return item;
      const decoded = decodeDataUri(item);
      if (!decoded) return item;
      const hash = blake3Hex(decoded.bytes);
      if (!blobs.has(hash)) blobs.set(hash, decoded.bytes);
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
      for (const key of Object.keys(record)) out[key] = visit(record[key]);
      return out;
    }
    return item;
  };
  return visit(value) as T;
}

function hydrateMedia<T>(
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
      for (const key of Object.keys(record)) out[key] = visit(record[key]);
      return out;
    }
    return item;
  };
  return visit(value) as T;
}

// ============================================================================
// Doc v2 Sectioned Package (.sldoc)
// ============================================================================

export const DOC_MAIN_TAB_ID = "main";

export const docTabSummarySchema = z.object({
  hash: z.string().regex(BLAKE3_HEX_RE),
  size: z.number().int().nonnegative(),
  title: z.string().min(1).max(80),
});
export type DocTabSummary = z.infer<typeof docTabSummarySchema>;

export const docPackageManifestSchema = z.object({
  format: z.literal("suiteleaf"),
  version: z.literal(2),
  kind: z.literal("doc"),
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
  tabOrder: z.array(z.string().min(1)).min(1),
  tabs: z.record(z.string(), docTabSummarySchema),
  media: z.record(z.string(), slideMediaEntrySchema),
  history: slideSectionRefSchema.optional(),
});
export type DocPackageManifest = z.infer<typeof docPackageManifestSchema>;

export interface DocGlobal {
  properties?: DocFile["properties"];
  tabTitle?: string;
}

export interface DocPackageParts {
  manifest: DocPackageManifest;
  manifestBytes: Uint8Array;
  manifestHash: string;
  global: DocGlobal;
  globalBytes: Uint8Array;
  tabs: Record<string, JsonNode>;
  tabBytes: Record<string, Uint8Array>;
  history?: SlideHistory;
  historyBytes?: Uint8Array;
  blobs: Map<string, Uint8Array>;
}

export interface GenericPackageDelta<M> {
  manifest: M;
  manifestBytes: Uint8Array;
  manifestHash: string;
  globalChanged: boolean;
  historyChanged: boolean;
  changedSectionIds: string[];
  removedSectionIds: string[];
  changedBlobs: Map<string, Uint8Array>;
}

export function splitDoc(
  file: DocFile,
  options: { mediaThresholdBytes?: number } = {},
): DocPackageParts {
  const threshold = options.mediaThresholdBytes ?? DEFAULT_MEDIA_THRESHOLD_BYTES;
  const blobs = new Map<string, Uint8Array>();
  const media: Record<string, SlideMediaEntry> = {};

  const global: DocGlobal = {
    ...(file.properties ? { properties: file.properties } : {}),
    ...(file.tabTitle ? { tabTitle: file.tabTitle } : {}),
  };
  const globalBytes = textEncoder.encode(JSON.stringify(global));
  const globalHash = blake3Hex(globalBytes);
  blobs.set(globalHash, globalBytes);

  const tabOrder: string[] = [DOC_MAIN_TAB_ID];
  const tabs: Record<string, JsonNode> = {};
  const tabBytes: Record<string, Uint8Array> = {};
  const tabSummaries: Record<string, DocTabSummary> = {};

  const addTab = (id: string, title: string, content: JsonNode) => {
    const ext = externalizeMedia(content, threshold, media, blobs);
    const bytes = textEncoder.encode(JSON.stringify(ext));
    const hash = blake3Hex(bytes);
    tabs[id] = ext;
    tabBytes[id] = bytes;
    blobs.set(hash, bytes);
    tabSummaries[id] = { hash, size: bytes.byteLength, title };
  };

  addTab(DOC_MAIN_TAB_ID, file.tabTitle ?? "Document", file.content);
  for (const extra of file.tabs ?? []) {
    tabOrder.push(extra.id);
    addTab(extra.id, extra.title, extra.content);
  }

  let history: SlideHistory | undefined;
  let historyBytes: Uint8Array | undefined;
  let historyRef: SlideSectionRef | undefined;
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

  const manifest: DocPackageManifest = {
    format: "suiteleaf",
    version: 2,
    kind: "doc",
    id: file.id,
    title: file.title,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    ...(file.importInfo ? { importInfo: file.importInfo } : {}),
    global: { hash: globalHash, size: globalBytes.byteLength },
    tabOrder,
    tabs: tabSummaries,
    media,
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
    tabs,
    tabBytes,
    history,
    historyBytes,
    blobs,
  };
}

export function assembleDoc(
  parts: {
    manifest: DocPackageManifest;
    global: DocGlobal;
    tabs: Record<string, JsonNode>;
    history?: SlideHistory;
    blobs?: Map<string, Uint8Array>;
  },
  options: { hydrateMedia?: boolean } = {},
): DocFile {
  const hydrate = options.hydrateMedia ?? true;
  const blobs = parts.blobs ?? new Map<string, Uint8Array>();
  const mainId = parts.manifest.tabOrder[0] ?? DOC_MAIN_TAB_ID;
  const rawMain = parts.tabs[mainId];
  if (!rawMain) {
    throw new Error(`Document package is missing main tab "${mainId}".`);
  }
  const content = hydrate
    ? hydrateMedia(rawMain, parts.manifest.media, blobs)
    : rawMain;

  const extraTabs: DocTab[] = [];
  for (const tabId of parts.manifest.tabOrder.slice(1)) {
    const rawTab = parts.tabs[tabId];
    const summary = parts.manifest.tabs[tabId];
    if (!rawTab || !summary) {
      throw new Error(`Document package is missing tab "${tabId}".`);
    }
    extraTabs.push({
      id: tabId,
      title: summary.title,
      content: hydrate ? hydrateMedia(rawTab, parts.manifest.media, blobs) : rawTab,
    });
  }

  return {
    format: "suiteleaf",
    version: 1,
    kind: "doc",
    id: parts.manifest.id,
    title: parts.manifest.title,
    createdAt: parts.manifest.createdAt,
    updatedAt: parts.manifest.updatedAt,
    ...(parts.manifest.importInfo
      ? { importInfo: parts.manifest.importInfo as DocFile["importInfo"] }
      : {}),
    ...(parts.global.properties ? { properties: parts.global.properties } : {}),
    ...(parts.global.tabTitle ? { tabTitle: parts.global.tabTitle } : {}),
    ...(extraTabs.length ? { tabs: extraTabs } : {}),
    ...(parts.history?.edits?.length
      ? { edits: parts.history.edits as DocFile["edits"] }
      : {}),
    ...(parts.history?.versions?.length
      ? { versions: parts.history.versions as DocFile["versions"] }
      : {}),
    content,
  };
}

export async function packDocPackageZip(
  fileOrParts: DocFile | DocPackageParts,
): Promise<Uint8Array> {
  const parts = "manifest" in fileOrParts ? fileOrParts : splitDoc(fileOrParts);
  const zip = new JSZip();
  zip.file("manifest.json", parts.manifestBytes, { compression: "DEFLATE" });
  zip.file("global.json", parts.globalBytes, { compression: "DEFLATE" });
  for (const tabId of parts.manifest.tabOrder) {
    const bytes = parts.tabBytes[tabId];
    if (bytes) zip.file(`tabs/${tabId}.json`, bytes, { compression: "DEFLATE" });
  }
  for (const [hash, entry] of Object.entries(parts.manifest.media)) {
    const bytes = parts.blobs.get(hash);
    if (!bytes) continue;
    const ext = entry.ext || extForMime(entry.mime);
    const compression = COMPRESSIBLE_MIMES.has(entry.mime) ? "DEFLATE" : "STORE";
    zip.file(`media/${hash}.${ext}`, bytes, { compression });
  }
  if (parts.historyBytes && parts.manifest.history) {
    zip.file("history.json", parts.historyBytes, { compression: "DEFLATE" });
  }
  return zip.generateAsync({ type: "uint8array" });
}

export async function unpackDocPackageZip(
  bytes: Uint8Array,
): Promise<DocPackageParts> {
  const zip = await JSZip.loadAsync(bytes);
  const manifestEntry = zip.file("manifest.json");
  const globalEntry = zip.file("global.json");
  if (!manifestEntry || !globalEntry) {
    throw new Error("Document package is missing manifest.json or global.json.");
  }
  const manifestBytes = await manifestEntry.async("uint8array");
  const manifest = docPackageManifestSchema.parse(
    JSON.parse(textDecoder.decode(manifestBytes)),
  );
  const manifestHash = blake3Hex(manifestBytes);
  const globalBytes = await globalEntry.async("uint8array");
  const global = JSON.parse(textDecoder.decode(globalBytes)) as DocGlobal;

  const blobs = new Map<string, Uint8Array>();
  blobs.set(manifest.global.hash, globalBytes);

  const tabs: Record<string, JsonNode> = {};
  const tabBytes: Record<string, Uint8Array> = {};
  for (const tabId of manifest.tabOrder) {
    const entry = zip.file(`tabs/${tabId}.json`);
    if (!entry) throw new Error(`Document package is missing tabs/${tabId}.json.`);
    const raw = await entry.async("uint8array");
    tabs[tabId] = JSON.parse(textDecoder.decode(raw)) as JsonNode;
    tabBytes[tabId] = raw;
    const summary = manifest.tabs[tabId];
    if (summary) blobs.set(summary.hash, raw);
  }

  for (const [hash, entry] of Object.entries(manifest.media)) {
    const ext = entry.ext || extForMime(entry.mime);
    const file = zip.file(`media/${hash}.${ext}`) ?? zip.file(`media/${hash}`);
    if (file) blobs.set(hash, await file.async("uint8array"));
  }

  let history: SlideHistory | undefined;
  let historyBytes: Uint8Array | undefined;
  if (manifest.history) {
    const hf = zip.file("history.json");
    if (hf) {
      historyBytes = await hf.async("uint8array");
      history = slideHistorySchema.parse(JSON.parse(textDecoder.decode(historyBytes)));
      blobs.set(manifest.history.hash, historyBytes);
    }
  }

  return {
    manifest,
    manifestBytes,
    manifestHash,
    global,
    globalBytes,
    tabs,
    tabBytes,
    history,
    historyBytes,
    blobs,
  };
}

export function diffDocPackage(
  previous: DocPackageManifest | null,
  next: DocPackageParts,
): GenericPackageDelta<DocPackageManifest> {
  const changedBlobs = new Map<string, Uint8Array>();
  const globalChanged = !previous || previous.global.hash !== next.manifest.global.hash;
  if (globalChanged) changedBlobs.set(next.manifest.global.hash, next.globalBytes);

  const changedSectionIds: string[] = [];
  for (const tabId of next.manifest.tabOrder) {
    const nextSum = next.manifest.tabs[tabId];
    const prevSum = previous?.tabs[tabId];
    if (!nextSum) continue;
    if (!prevSum || prevSum.hash !== nextSum.hash) {
      changedSectionIds.push(tabId);
      const bytes = next.tabBytes[tabId];
      if (bytes) changedBlobs.set(nextSum.hash, bytes);
    }
  }
  const nextSet = new Set(next.manifest.tabOrder);
  const removedSectionIds = previous
    ? previous.tabOrder.filter((id) => !nextSet.has(id))
    : [];

  for (const hash of Object.keys(next.manifest.media)) {
    if (!previous?.media[hash]) {
      const bytes = next.blobs.get(hash);
      if (bytes) changedBlobs.set(hash, bytes);
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
    changedSectionIds,
    removedSectionIds,
    changedBlobs,
  };
}

// ============================================================================
// Sheet v2 Sectioned Package (.slsheet) — One Section Per Worksheet
// ============================================================================

export const sheetSummarySchema = z.object({
  hash: z.string().regex(BLAKE3_HEX_RE),
  size: z.number().int().nonnegative(),
  name: z.string().optional(),
  rowCount: z.number().int().nonnegative().optional(),
  columnCount: z.number().int().nonnegative().optional(),
  /** Other worksheet IDs referenced by formulas on this sheet. */
  deps: z.array(z.string().min(1)).optional(),
});
export type SheetSummary = z.infer<typeof sheetSummarySchema>;

export const sheetPackageManifestSchema = z.object({
  format: z.literal("suiteleaf"),
  version: z.literal(2),
  kind: z.literal("sheet"),
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
  sheetOrder: z.array(z.string().min(1)).min(1),
  sheets: z.record(z.string(), sheetSummarySchema),
  media: z.record(z.string(), slideMediaEntrySchema),
  history: slideSectionRefSchema.optional(),
});
export type SheetPackageManifest = z.infer<typeof sheetPackageManifestSchema>;

export interface SheetGlobal {
  workbookMeta: Record<string, unknown>;
  proofingLanguage?: SheetFile["content"]["proofingLanguage"];
  images?: SheetFile["content"]["images"];
  charts: SheetFile["content"]["charts"];
  pivots: SheetFile["content"]["pivots"];
  queries?: SheetFile["content"]["queries"];
  tables?: SheetFile["content"]["tables"];
  print?: SheetFile["content"]["print"];
}

export type WorksheetData = SheetFile["content"]["workbook"]["sheets"][string];

export interface SheetPackageParts {
  manifest: SheetPackageManifest;
  manifestBytes: Uint8Array;
  manifestHash: string;
  global: SheetGlobal;
  globalBytes: Uint8Array;
  sheets: Record<string, WorksheetData>;
  sheetBytes: Record<string, Uint8Array>;
  history?: SlideHistory;
  historyBytes?: Uint8Array;
  blobs: Map<string, Uint8Array>;
}

const CROSS_SHEET_REF_RE = /(?:'((?:[^']|'')+)'|([A-Za-z0-9_]+))!/g;

/** Extract target worksheet IDs referenced by formulas in `sheet`. */
function extractSheetDeps(
  sheet: WorksheetData,
  nameToId: Map<string, string>,
  selfId: string,
): string[] {
  const deps = new Set<string>();
  const cellData = (sheet as { cellData?: Record<string, Record<string, { f?: unknown }>> }).cellData;
  if (!cellData || typeof cellData !== "object") return [];
  for (const row of Object.values(cellData)) {
    if (!row || typeof row !== "object") continue;
    for (const cell of Object.values(row)) {
      const f = cell?.f;
      if (typeof f !== "string" || !f.includes("!")) continue;
      CROSS_SHEET_REF_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = CROSS_SHEET_REF_RE.exec(f)) !== null) {
        const rawName = (match[1]?.replace(/''/g, "'") ?? match[2] ?? "").toLowerCase();
        const targetId = nameToId.get(rawName);
        if (targetId && targetId !== selfId) deps.add(targetId);
      }
    }
  }
  return [...deps];
}

export function splitSheet(
  file: SheetFile,
  options: { mediaThresholdBytes?: number } = {},
): SheetPackageParts {
  const threshold = options.mediaThresholdBytes ?? DEFAULT_MEDIA_THRESHOLD_BYTES;
  const blobs = new Map<string, Uint8Array>();
  const media: Record<string, SlideMediaEntry> = {};

  const { sheets: rawSheets, sheetOrder, ...workbookMeta } = file.content.workbook;
  const rawGlobal: SheetGlobal = {
    workbookMeta,
    ...(file.content.proofingLanguage ? { proofingLanguage: file.content.proofingLanguage } : {}),
    ...(file.content.images ? { images: file.content.images } : {}),
    charts: file.content.charts,
    pivots: file.content.pivots,
    ...(file.content.queries ? { queries: file.content.queries } : {}),
    ...(file.content.tables ? { tables: file.content.tables } : {}),
    ...(file.content.print ? { print: file.content.print } : {}),
  };
  const global = externalizeMedia(rawGlobal, threshold, media, blobs);
  const globalBytes = textEncoder.encode(JSON.stringify(global));
  const globalHash = blake3Hex(globalBytes);
  blobs.set(globalHash, globalBytes);

  const nameToId = new Map<string, string>();
  for (const id of sheetOrder) {
    const ws = rawSheets[id];
    const name = (ws as { name?: unknown } | undefined)?.name;
    if (typeof name === "string" && name) nameToId.set(name.toLowerCase(), id);
  }

  const sheets: Record<string, WorksheetData> = {};
  const sheetBytes: Record<string, Uint8Array> = {};
  const sheetSummaries: Record<string, SheetSummary> = {};

  for (const sheetId of sheetOrder) {
    const ws = rawSheets[sheetId];
    if (!ws) continue;
    const extWs = externalizeMedia(ws, threshold, media, blobs);
    const bytes = textEncoder.encode(JSON.stringify(extWs));
    const hash = blake3Hex(bytes);
    sheets[sheetId] = extWs;
    sheetBytes[sheetId] = bytes;
    blobs.set(hash, bytes);

    const meta = extWs as { name?: string; rowCount?: number; columnCount?: number };
    const deps = extractSheetDeps(extWs, nameToId, sheetId);
    sheetSummaries[sheetId] = {
      hash,
      size: bytes.byteLength,
      ...(typeof meta.name === "string" ? { name: meta.name } : {}),
      ...(typeof meta.rowCount === "number" ? { rowCount: meta.rowCount } : {}),
      ...(typeof meta.columnCount === "number" ? { columnCount: meta.columnCount } : {}),
      ...(deps.length ? { deps } : {}),
    };
  }

  let history: SlideHistory | undefined;
  let historyBytes: Uint8Array | undefined;
  let historyRef: SlideSectionRef | undefined;
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

  const manifest: SheetPackageManifest = {
    format: "suiteleaf",
    version: 2,
    kind: "sheet",
    id: file.id,
    title: file.title,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    ...(file.importInfo ? { importInfo: file.importInfo } : {}),
    global: { hash: globalHash, size: globalBytes.byteLength },
    sheetOrder: [...sheetOrder],
    sheets: sheetSummaries,
    media,
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
    sheets,
    sheetBytes,
    history,
    historyBytes,
    blobs,
  };
}

export function assembleSheet(
  parts: {
    manifest: SheetPackageManifest;
    global: SheetGlobal;
    sheets: Record<string, WorksheetData>;
    history?: SlideHistory;
    blobs?: Map<string, Uint8Array>;
  },
  options: { hydrateMedia?: boolean } = {},
): SheetFile {
  const hydrate = options.hydrateMedia ?? true;
  const blobs = parts.blobs ?? new Map<string, Uint8Array>();
  const global = hydrate
    ? hydrateMedia(parts.global, parts.manifest.media, blobs)
    : parts.global;

  const sheets: Record<string, WorksheetData> = {};
  for (const sheetId of parts.manifest.sheetOrder) {
    const ws = parts.sheets[sheetId];
    if (!ws) throw new Error(`Workbook package is missing worksheet "${sheetId}".`);
    sheets[sheetId] = hydrate ? hydrateMedia(ws, parts.manifest.media, blobs) : ws;
  }

  return {
    format: "suiteleaf",
    version: 1,
    kind: "sheet",
    id: parts.manifest.id,
    title: parts.manifest.title,
    createdAt: parts.manifest.createdAt,
    updatedAt: parts.manifest.updatedAt,
    ...(parts.manifest.importInfo
      ? { importInfo: parts.manifest.importInfo as SheetFile["importInfo"] }
      : {}),
    ...(parts.history?.edits?.length
      ? { edits: parts.history.edits as SheetFile["edits"] }
      : {}),
    ...(parts.history?.versions?.length
      ? { versions: parts.history.versions as SheetFile["versions"] }
      : {}),
    content: {
      workbook: {
        ...global.workbookMeta,
        id: String(global.workbookMeta.id ?? parts.manifest.id),
        sheetOrder: [...parts.manifest.sheetOrder],
        sheets,
      },
      ...(global.proofingLanguage ? { proofingLanguage: global.proofingLanguage } : {}),
      ...(global.images ? { images: global.images } : {}),
      charts: global.charts,
      pivots: global.pivots,
      ...(global.queries ? { queries: global.queries } : {}),
      ...(global.tables ? { tables: global.tables } : {}),
      ...(global.print ? { print: global.print } : {}),
    },
  };
}

export async function packSheetPackageZip(
  fileOrParts: SheetFile | SheetPackageParts,
): Promise<Uint8Array> {
  const parts = "manifest" in fileOrParts ? fileOrParts : splitSheet(fileOrParts);
  const zip = new JSZip();
  zip.file("manifest.json", parts.manifestBytes, { compression: "DEFLATE" });
  zip.file("global.json", parts.globalBytes, { compression: "DEFLATE" });
  for (const sheetId of parts.manifest.sheetOrder) {
    const bytes = parts.sheetBytes[sheetId];
    if (bytes) zip.file(`sheets/${sheetId}.json`, bytes, { compression: "DEFLATE" });
  }
  for (const [hash, entry] of Object.entries(parts.manifest.media)) {
    const bytes = parts.blobs.get(hash);
    if (!bytes) continue;
    const ext = entry.ext || extForMime(entry.mime);
    const compression = COMPRESSIBLE_MIMES.has(entry.mime) ? "DEFLATE" : "STORE";
    zip.file(`media/${hash}.${ext}`, bytes, { compression });
  }
  if (parts.historyBytes && parts.manifest.history) {
    zip.file("history.json", parts.historyBytes, { compression: "DEFLATE" });
  }
  return zip.generateAsync({ type: "uint8array" });
}

export async function unpackSheetPackageZip(
  bytes: Uint8Array,
): Promise<SheetPackageParts> {
  const zip = await JSZip.loadAsync(bytes);
  const manifestEntry = zip.file("manifest.json");
  const globalEntry = zip.file("global.json");
  if (!manifestEntry || !globalEntry) {
    throw new Error("Workbook package is missing manifest.json or global.json.");
  }
  const manifestBytes = await manifestEntry.async("uint8array");
  const manifest = sheetPackageManifestSchema.parse(
    JSON.parse(textDecoder.decode(manifestBytes)),
  );
  const manifestHash = blake3Hex(manifestBytes);
  const globalBytes = await globalEntry.async("uint8array");
  const global = JSON.parse(textDecoder.decode(globalBytes)) as SheetGlobal;

  const blobs = new Map<string, Uint8Array>();
  blobs.set(manifest.global.hash, globalBytes);

  const sheets: Record<string, WorksheetData> = {};
  const sheetBytes: Record<string, Uint8Array> = {};
  for (const sheetId of manifest.sheetOrder) {
    const entry = zip.file(`sheets/${sheetId}.json`);
    if (!entry) throw new Error(`Workbook package is missing sheets/${sheetId}.json.`);
    const raw = await entry.async("uint8array");
    sheets[sheetId] = JSON.parse(textDecoder.decode(raw)) as WorksheetData;
    sheetBytes[sheetId] = raw;
    const summary = manifest.sheets[sheetId];
    if (summary) blobs.set(summary.hash, raw);
  }

  for (const [hash, entry] of Object.entries(manifest.media)) {
    const ext = entry.ext || extForMime(entry.mime);
    const file = zip.file(`media/${hash}.${ext}`) ?? zip.file(`media/${hash}`);
    if (file) blobs.set(hash, await file.async("uint8array"));
  }

  let history: SlideHistory | undefined;
  let historyBytes: Uint8Array | undefined;
  if (manifest.history) {
    const hf = zip.file("history.json");
    if (hf) {
      historyBytes = await hf.async("uint8array");
      history = slideHistorySchema.parse(JSON.parse(textDecoder.decode(historyBytes)));
      blobs.set(manifest.history.hash, historyBytes);
    }
  }

  return {
    manifest,
    manifestBytes,
    manifestHash,
    global,
    globalBytes,
    sheets,
    sheetBytes,
    history,
    historyBytes,
    blobs,
  };
}

export function diffSheetPackage(
  previous: SheetPackageManifest | null,
  next: SheetPackageParts,
): GenericPackageDelta<SheetPackageManifest> {
  const changedBlobs = new Map<string, Uint8Array>();
  const globalChanged = !previous || previous.global.hash !== next.manifest.global.hash;
  if (globalChanged) changedBlobs.set(next.manifest.global.hash, next.globalBytes);

  const changedSectionIds: string[] = [];
  for (const sheetId of next.manifest.sheetOrder) {
    const nextSum = next.manifest.sheets[sheetId];
    const prevSum = previous?.sheets[sheetId];
    if (!nextSum) continue;
    if (!prevSum || prevSum.hash !== nextSum.hash) {
      changedSectionIds.push(sheetId);
      const bytes = next.sheetBytes[sheetId];
      if (bytes) changedBlobs.set(nextSum.hash, bytes);
    }
  }
  const nextSet = new Set(next.manifest.sheetOrder);
  const removedSectionIds = previous
    ? previous.sheetOrder.filter((id) => !nextSet.has(id))
    : [];

  for (const hash of Object.keys(next.manifest.media)) {
    if (!previous?.media[hash]) {
      const bytes = next.blobs.get(hash);
      if (bytes) changedBlobs.set(hash, bytes);
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
    changedSectionIds,
    removedSectionIds,
    changedBlobs,
  };
}

// ============================================================================
// Unified v2 ZIP Dispatcher (slide | sheet | doc)
// ============================================================================

export async function parseSuitePackageZip(
  bytes: Uint8Array,
): Promise<SuiteFile> {
  const zip = await JSZip.loadAsync(bytes);
  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) {
    throw new Error("SuiteLeaf package is missing manifest.json.");
  }
  const header = JSON.parse(
    textDecoder.decode(await manifestEntry.async("uint8array")),
  ) as { format?: unknown; version?: unknown; kind?: unknown };
  if (header.format !== "suiteleaf" || header.version !== 2) {
    throw new Error("This SuiteLeaf package version is not supported.");
  }
  if (header.kind === "slide") {
    return parseSlidePackageZip(bytes);
  }
  if (header.kind === "sheet") {
    return assembleSheet(await unpackSheetPackageZip(bytes), { hydrateMedia: true });
  }
  if (header.kind === "doc") {
    return assembleDoc(await unpackDocPackageZip(bytes), { hydrateMedia: true });
  }
  throw new Error(`Unsupported SuiteLeaf package kind "${String(header.kind)}".`);
}

export async function packSuitePackageZip(
  file: Extract<SuiteFile, { kind: "slide" | "sheet" | "doc" }>,
): Promise<Uint8Array> {
  if (file.kind === "slide") return packSlidePackageZip(file);
  if (file.kind === "sheet") return packSheetPackageZip(file);
  return packDocPackageZip(file);
}
