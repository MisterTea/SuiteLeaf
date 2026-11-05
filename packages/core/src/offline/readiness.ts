import type { Kind, SuiteFile, SlideFile, DocFile, SheetFile } from "../file-schema";

export interface OfflinePin {
  fileId: string;
  title: string;
  kind: Kind;
  pinnedAt: string;
  pinScope: "file" | "folder";
  folderId?: string;
}

export type AssetType = "media" | "font" | "app-shell" | "model";
export type AssetStatus = "embedded" | "cached" | "missing";

export interface AssetDependency {
  id: string;
  type: AssetType;
  uri: string;
  status: AssetStatus;
  estimatedBytes: number;
  required: boolean;
  remedy?: string;
}

export interface EvictionRisk {
  level: "low" | "medium" | "high";
  persisted: boolean;
  reason: string;
  recommendation: string;
}

export interface OfflineReadinessReport {
  fileId: string;
  title: string;
  kind: Kind;
  isReady: boolean;
  status: "ready" | "partial" | "missing";
  diskBytes: number;
  assets: AssetDependency[];
  missingAssets: AssetDependency[];
  remedies: string[];
  evictionRisk: EvictionRisk;
  lastVerifiedAt: string;
}

export interface ReadinessCheckOptions {
  localCacheUrls?: Set<string> | string[];
  installedFonts?: Set<string> | string[];
  isStoragePersisted?: boolean;
  modelRequired?: boolean;
  lastVerifiedAt?: string;
}

/** Standard fonts shipped or metric-compatible with SuiteLeaf */
const STANDARD_FONTS = new Set([
  "suiteleaf willow",
  "willow",
  "arial",
  "calibri",
  "times new roman",
  "courier new",
  "helvetica",
  "georgia",
  "segoe ui",
  "verdana",
  "tahoma",
  "trebuchet ms",
  "cambria",
  "roboto",
]);

/**
 * Scan slide deck elements for media and fonts.
 */
function scanSlideDependencies(
  file: SlideFile,
  cacheUrls: Set<string>,
  knownFonts: Set<string>,
): AssetDependency[] {
  const assets: AssetDependency[] = [];
  const slides = file.content?.slides ?? {};

  for (const slide of Object.values(slides)) {
    for (const el of slide.elements ?? []) {
      // Media dependency
      if (el.type === "image" && el.src) {
        const isDataUri = el.src.startsWith("data:");
        const isLocalCached = cacheUrls.has(el.src);
        const status: AssetStatus = isDataUri ? "embedded" : isLocalCached ? "cached" : "missing";
        const estimatedBytes = isDataUri ? Math.round(el.src.length * 0.75) : 100_000;

        assets.push({
          id: `media-${el.id}`,
          type: "media",
          uri: isDataUri ? `data:image/...[${el.id}]` : el.src,
          status,
          estimatedBytes,
          required: true,
          remedy:
            status === "missing"
              ? `Remote image '${el.src}' is not cached. Reopen while online or embed image into slide.`
              : undefined,
        });
      }

      // Font dependency
      if (el.fontFamily) {
        const fontName = el.fontFamily.trim().toLowerCase();
        const isKnown = STANDARD_FONTS.has(fontName) || knownFonts.has(fontName);
        const status: AssetStatus = isKnown ? "cached" : "missing";

        assets.push({
          id: `font-${el.id}-${fontName}`,
          type: "font",
          uri: el.fontFamily,
          status,
          estimatedBytes: 40_000,
          required: false,
          remedy:
            status === "missing"
              ? `Font '${el.fontFamily}' is not installed locally. SuiteLeaf metric font will substitute, or install font on host.`
              : undefined,
        });
      }
    }
  }

  return assets;
}

/**
 * Scan document content for media and fonts.
 */
function scanDocDependencies(
  file: DocFile,
  cacheUrls: Set<string>,
  knownFonts: Set<string>,
): AssetDependency[] {
  const assets: AssetDependency[] = [];
  const content = (file.content as any)?.nodes ?? [];

  function walkNodes(nodes: any[]) {
    for (const node of nodes) {
      if (node.type === "image" && node.attrs?.src) {
        const src = node.attrs.src;
        const isDataUri = typeof src === "string" && src.startsWith("data:");
        const isLocalCached = cacheUrls.has(src);
        const status: AssetStatus = isDataUri ? "embedded" : isLocalCached ? "cached" : "missing";
        const estimatedBytes = isDataUri ? Math.round(src.length * 0.75) : 150_000;

        assets.push({
          id: `media-doc-${node.attrs.id || Math.random().toString(36).slice(2, 7)}`,
          type: "media",
          uri: isDataUri ? "data:image/..." : src,
          status,
          estimatedBytes,
          required: true,
          remedy:
            status === "missing"
              ? `Document image '${src}' is not cached. Reopen while online to cache or embed locally.`
              : undefined,
        });
      }

      if (node.marks) {
        for (const mark of node.marks) {
          if (mark.attrs?.fontFamily) {
            const fontName = String(mark.attrs.fontFamily).trim().toLowerCase();
            const isKnown = STANDARD_FONTS.has(fontName) || knownFonts.has(fontName);
            const status: AssetStatus = isKnown ? "cached" : "missing";
            assets.push({
              id: `font-doc-${fontName}`,
              type: "font",
              uri: mark.attrs.fontFamily,
              status,
              estimatedBytes: 40_000,
              required: false,
              remedy:
                status === "missing"
                  ? `Font '${mark.attrs.fontFamily}' is missing locally. SuiteLeaf layout-compatible font will be used.`
                  : undefined,
            });
          }
        }
      }

      if (Array.isArray(node.content)) walkNodes(node.content);
    }
  }

  walkNodes(content);
  return assets;
}

/**
 * Scan spreadsheet content for media and drawings.
 */
function scanSheetDependencies(
  file: SheetFile,
  cacheUrls: Set<string>,
): AssetDependency[] {
  const assets: AssetDependency[] = [];
  const resources = file.content?.workbook?.resources as any;
  if (Array.isArray(resources)) {
    for (const res of resources) {
      if (res?.src) {
        const isDataUri = typeof res.src === "string" && res.src.startsWith("data:");
        const isCached = cacheUrls.has(res.src);
        const status: AssetStatus = isDataUri ? "embedded" : isCached ? "cached" : "missing";
        assets.push({
          id: `sheet-res-${res.id || Math.random().toString(36).slice(2, 7)}`,
          type: "media",
          uri: isDataUri ? "data:resource/..." : res.src,
          status,
          estimatedBytes: isDataUri ? Math.round(res.src.length * 0.75) : 80_000,
          required: true,
          remedy:
            status === "missing"
              ? `Spreadsheet resource '${res.src}' is not cached. Save offline while online.`
              : undefined,
        });
      }
    }
  }
  return assets;
}

/**
 * Evaluate browser eviction risk.
 */
export function evaluateEvictionRisk(isStoragePersisted?: boolean): EvictionRisk {
  if (isStoragePersisted === true) {
    return {
      level: "low",
      persisted: true,
      reason: "Storage is marked persistent by browser. Automatic eviction is disabled.",
      recommendation: "Keep regular backups; browser will not delete pinned data under pressure.",
    };
  }

  if (isStoragePersisted === false) {
    return {
      level: "high",
      persisted: false,
      reason: "Browser storage is ephemeral. Data may be cleared if host storage runs low or browser cache is pruned.",
      recommendation:
        "Request persistent browser storage via Settings, or export/download copies to host disk to guarantee offline safety.",
    };
  }

  // Unknown / default (e.g. Node / desktop environment)
  return {
    level: "low",
    persisted: true,
    reason: "Desktop environment with direct filesystem storage; browser eviction does not apply.",
    recommendation: "Standard filesystem storage active.",
  };
}

/**
 * Check whether a file has all dependencies cached and ready for offline editing.
 * Never labels a file as "ready" if required assets are missing.
 */
export function checkOfflineReadiness(
  file: SuiteFile,
  options: ReadinessCheckOptions = {},
): OfflineReadinessReport {
  const cacheUrls = new Set(options.localCacheUrls ?? []);
  const knownFonts = new Set(
    Array.from(options.installedFonts ?? []).map((f) => f.trim().toLowerCase()),
  );

  const assets: AssetDependency[] = [
    {
      id: "app-shell-core",
      type: "app-shell",
      uri: "./sw.js",
      status: "cached",
      estimatedBytes: 500_000,
      required: true,
    },
  ];

  if (file.kind === "slide") {
    assets.push(...scanSlideDependencies(file as SlideFile, cacheUrls, knownFonts));
  } else if (file.kind === "doc") {
    assets.push(...scanDocDependencies(file as DocFile, cacheUrls, knownFonts));
  } else if (file.kind === "sheet") {
    assets.push(...scanSheetDependencies(file as SheetFile, cacheUrls));
  }

  // Optional AI model asset
  if (options.modelRequired) {
    const isModelCached = cacheUrls.has("web-model.onnx");
    assets.push({
      id: "optional-ai-model",
      type: "model",
      uri: "web-model.onnx",
      status: isModelCached ? "cached" : "missing",
      estimatedBytes: 45_000_000,
      required: false,
      remedy: isModelCached
        ? undefined
        : "Optional offline AI model not downloaded. Basic editing works; download model in AI Settings for local suggestions.",
    });
  }

  const missingAssets = assets.filter((a) => a.status === "missing");
  const missingRequired = missingAssets.filter((a) => a.required);

  const remedies = missingAssets
    .map((a) => a.remedy)
    .filter((r): r is string => Boolean(r));

  const totalBytes = assets.reduce((sum, a) => sum + a.estimatedBytes, 0);

  let status: "ready" | "partial" | "missing" = "ready";
  if (missingRequired.length > 0) {
    status = "missing";
  } else if (missingAssets.length > 0) {
    status = "partial";
  }

  const isReady = status === "ready";
  const evictionRisk = evaluateEvictionRisk(options.isStoragePersisted);

  return {
    fileId: file.id,
    title: file.title,
    kind: file.kind,
    isReady,
    status,
    diskBytes: totalBytes,
    assets,
    missingAssets,
    remedies,
    evictionRisk,
    lastVerifiedAt: options.lastVerifiedAt ?? new Date().toISOString(),
  };
}

/**
 * Manage offline pins in-memory or persisted storage adapter.
 */
export class OfflinePinManager {
  private pins = new Map<string, OfflinePin>();

  pinFile(file: SuiteFile, scope: "file" | "folder" = "file", folderId?: string): OfflinePin {
    const pin: OfflinePin = {
      fileId: file.id,
      title: file.title,
      kind: file.kind,
      pinnedAt: new Date().toISOString(),
      pinScope: scope,
      folderId,
    };
    this.pins.set(file.id, pin);
    return pin;
  }

  unpinFile(fileId: string): boolean {
    return this.pins.delete(fileId);
  }

  isPinned(fileId: string): boolean {
    return this.pins.has(fileId);
  }

  listPins(): OfflinePin[] {
    return Array.from(this.pins.values());
  }

  clear(): void {
    this.pins.clear();
  }
}
