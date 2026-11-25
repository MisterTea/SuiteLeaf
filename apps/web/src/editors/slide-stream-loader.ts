import {
  slideGlobalSchema,
  slidePackageManifestSchema,
  slideSchema,
  type Slide,
  type SlideGlobal,
  type SlidePackageManifest,
} from "@suiteleaf/core";

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface SlideBootstrapResult {
  sectioned: true;
  versionId?: string;
  manifest: SlidePackageManifest;
  global: SlideGlobal;
  slides: Record<string, Slide>;
}

export interface SlideStreamChunk {
  id: string;
  hash: string;
  data: Slide;
}

/**
 * Coordinates fast partial presentation loading (manifest + global + active slide)
 * followed by prioritized background NDJSON streaming of remaining slides.
 */
export class SlideStreamLoader {
  private streamPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private loaded = new Set<string>();

  constructor(private apiFetch: ApiFetch) {}

  /** Fetch manifest + global + initial active slide in a single round-trip. */
  async bootstrap(
    itemId: string,
    activeSlideId?: string,
    versionId?: string,
  ): Promise<SlideBootstrapResult | { sectioned: false }> {
    const params = new URLSearchParams();
    if (activeSlideId) params.set("slide", activeSlideId);
    if (versionId) params.set("version", versionId);
    const qs = params.toString();
    const res = await this.apiFetch(
      `/api/drive/items/${encodeURIComponent(itemId)}/sections/bootstrap${qs ? `?${qs}` : ""}`,
    );
    const body = (await res.json()) as {
      sectioned?: boolean;
      versionId?: string;
      manifest?: unknown;
      global?: unknown;
      slides?: Record<string, unknown>;
    };
    if (!body.sectioned) return { sectioned: false };

    const manifest = slidePackageManifestSchema.parse(body.manifest);
    const global = slideGlobalSchema.parse(body.global);
    const slides: Record<string, Slide> = {};
    for (const [id, raw] of Object.entries(body.slides ?? {})) {
      slides[id] = slideSchema.parse(raw);
      this.loaded.add(id);
    }
    return {
      sectioned: true,
      versionId: body.versionId,
      manifest,
      global,
      slides,
    };
  }

  /**
   * Stream all remaining slides in the background as NDJSON, batching callbacks
   * so React updates smoothly without per-slide render thrashing.
   */
  startBackgroundStream(
    itemId: string,
    onBatch: (slides: Record<string, Slide>) => void,
    options: { versionId?: string; batchSize?: number } = {},
  ): Promise<void> {
    this.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const batchSize = options.batchSize ?? 4;

    const work = (async () => {
      const params = new URLSearchParams();
      if (this.loaded.size > 0) {
        params.set("exclude", [...this.loaded].join(","));
      }
      if (options.versionId) params.set("version", options.versionId);
      const qs = params.toString();
      const res = await this.apiFetch(
        `/api/drive/items/${encodeURIComponent(itemId)}/sections/stream${qs ? `?${qs}` : ""}`,
        { signal: controller.signal },
      );
      if (!res.body) {
        const text = await res.text();
        const batch: Record<string, Slide> = {};
        for (const line of text.split("\n")) {
          const parsed = this.parseLine(line);
          if (parsed && !this.loaded.has(parsed.id)) {
            this.loaded.add(parsed.id);
            batch[parsed.id] = parsed.data;
          }
        }
        if (Object.keys(batch).length) onBatch(batch);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let batch: Record<string, Slide> = {};
      let count = 0;

      const flush = () => {
        if (count === 0) return;
        const copy = batch;
        batch = {};
        count = 0;
        onBatch(copy);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          const parsed = this.parseLine(line);
          if (parsed && !this.loaded.has(parsed.id)) {
            this.loaded.add(parsed.id);
            batch[parsed.id] = parsed.data;
            count++;
            if (count >= batchSize) flush();
          }
          nl = buffer.indexOf("\n");
        }
      }
      if (buffer.trim()) {
        const parsed = this.parseLine(buffer);
        if (parsed && !this.loaded.has(parsed.id)) {
          this.loaded.add(parsed.id);
          batch[parsed.id] = parsed.data;
          count++;
        }
      }
      flush();
    })();

    this.streamPromise = work;
    return work;
  }

  /** Fetch a single slide immediately when the user clicks an unloaded thumbnail. */
  async prioritizeSlide(
    itemId: string,
    slideId: string,
    hash: string,
    versionId?: string,
  ): Promise<Slide | null> {
    const qs = versionId ? `?version=${encodeURIComponent(versionId)}` : "";
    const res = await this.apiFetch(
      `/api/drive/items/${encodeURIComponent(itemId)}/blobs/${encodeURIComponent(hash)}${qs}`,
    );
    if (!res.ok) return null;
    const slide = slideSchema.parse(await res.json());
    this.loaded.add(slideId);
    return slide;
  }

  /** Await completion of background streaming (e.g. before PPTX/PDF export). */
  async ensureAllLoaded(): Promise<void> {
    if (this.streamPromise) {
      await this.streamPromise;
    }
  }

  abort() {
    this.abortController?.abort();
    this.abortController = null;
  }

  private parseLine(line: string): SlideStreamChunk | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const raw = JSON.parse(trimmed) as {
        id?: unknown;
        hash?: unknown;
        data?: unknown;
      };
      if (typeof raw.id !== "string" || typeof raw.hash !== "string") return null;
      return {
        id: raw.id,
        hash: raw.hash,
        data: slideSchema.parse(raw.data),
      };
    } catch {
      return null;
    }
  }
}
