import {
  assemblePresentation,
  slideGlobalSchema,
  slidePackageManifestSchema,
  type Slide,
  type SlideFile,
  type SlidePackageManifest,
} from "@suiteleaf/core";

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface OpenedSectionedSlide {
  file: SlideFile;
  manifest: SlidePackageManifest;
  versionId?: string;
}

const OLD_PER_SLIDE =
  "This presentation still uses the removed per-slide format. Re-save it as one global.json deck before opening it here.";

/**
 * Load a `.slslides` file from SuiteDrive. Slide bodies live in `global.json`.
 * Returns `null` for a legacy v1 file or a server without the sectioned endpoint.
 */
export async function openSectionedSlideFile(
  itemId: string,
  apiFetch: ApiFetch,
  signal?: AbortSignal,
): Promise<OpenedSectionedSlide | null> {
  let boot: {
    sectioned?: boolean;
    versionId?: string | null;
    manifest?: unknown;
    global?: unknown;
  };
  try {
    const res = await apiFetch(
      `/api/drive/items/${encodeURIComponent(itemId)}/sections/bootstrap`,
      signal ? { signal } : {},
    );
    boot = (await res.json()) as typeof boot;
  } catch (err) {
    if (signal?.aborted) throw err;
    const status =
      err && typeof err === "object" && "status" in err && typeof err.status === "number"
        ? err.status
        : undefined;
    if (status === 404 || status === 405) return null;
    throw err;
  }
  if (!boot?.sectioned || !boot.manifest || !boot.global) return null;

  const manifest = slidePackageManifestSchema.parse(boot.manifest);
  const global = slideGlobalSchema.parse(boot.global);
  const slides: Record<string, Slide> = {};
  if (global.slides) {
    for (const [id, slide] of Object.entries(global.slides)) {
      slides[id] = slide;
    }
  }
  const missing = manifest.slideOrder.filter((id) => !slides[id]);
  if (missing.length > 0) throw new Error(OLD_PER_SLIDE);

  const file = assemblePresentation(
    { manifest, global, slides, blobs: new Map() },
    { hydrateMedia: false },
  );
  return {
    file,
    manifest,
    versionId: boot.versionId ?? undefined,
  };
}
