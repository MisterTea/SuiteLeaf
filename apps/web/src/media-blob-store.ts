import {
  collectSlmediaHashes,
  slmediaHashFromUri,
  type ExternalMediaBlob,
  type ExternalMediaBlobs,
  type SlideFile,
} from "@suiteleaf/core";
import { library } from "./storage";
import { api } from "./node-client";

export type MediaApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface RemoteBlobSource {
  itemId: string;
  apiFetch?: MediaApiFetch;
  signal?: AbortSignal;
}

export interface PrefetchResult {
  total: number;
  cached: number;
  downloaded: number;
  failed: number;
}

function toHash(uriOrHash: string): string | null {
  return slmediaHashFromUri(uriOrHash) ?? (/^[a-f0-9]{64}$/.test(uriOrHash) ? uriOrHash : null);
}

/**
 * Client-side binary media store for `slmedia://<blake3>` assets.
 * Keeps large videos/audio out of JS base64 strings by storing raw `Uint8Array`
 * blobs in memory and IndexedDB (`library.mediaBlobs`), and resolving them to
 * browser `blob:` Object URLs for playback.
 */
export class MediaBlobStore {
  private memory = new Map<string, ExternalMediaBlob>();
  private urls = new Map<string, string>();
  private inflight = new Map<string, Promise<ExternalMediaBlob | null>>();

  /** Synchronously store a blob in memory and asynchronously persist it to IndexedDB. */
  put(hash: string, mime: string, bytes: Uint8Array): Promise<void> {
    this.memory.set(hash, { mime, bytes });
    return library.putMediaBlob(hash, mime, bytes).catch(() => {});
  }

  /** Synchronously store a batch of blobs in memory and persist them to IndexedDB. */
  async putMany(blobs: ReadonlyMap<string, ExternalMediaBlob>): Promise<void> {
    const writes: Promise<void>[] = [];
    for (const [hash, blob] of blobs) {
      this.memory.set(hash, blob);
      writes.push(library.putMediaBlob(hash, blob.mime, blob.bytes).catch(() => {}));
    }
    await Promise.all(writes);
  }

  /** Synchronously read a blob from memory if present. */
  getMemory(uriOrHash: string): ExternalMediaBlob | undefined {
    const hash = toHash(uriOrHash);
    return hash ? this.memory.get(hash) : undefined;
  }

  /** Return a snapshot of all currently in-memory blobs for `splitPresentation`. */
  snapshotMemory(): ExternalMediaBlobs {
    return new Map(this.memory);
  }

  /**
   * Look up a blob in memory, then IndexedDB, and finally SuiteDrive if `remote` is given.
   * Any blob fetched from SuiteDrive is persisted to IndexedDB for offline playback.
   */
  async get(
    uriOrHash: string,
    remote?: RemoteBlobSource,
    fallbackMime = "application/octet-stream",
  ): Promise<ExternalMediaBlob | null> {
    const hash = toHash(uriOrHash);
    if (!hash) return null;

    const mem = this.memory.get(hash);
    if (mem) return mem;

    const pending = this.inflight.get(hash);
    if (pending) return pending;

    const work = (async (): Promise<ExternalMediaBlob | null> => {
      try {
        const stored = await library.getMediaBlobRecord(hash).catch(() => null);
        if (stored) {
          const entry: ExternalMediaBlob = { mime: stored.mime, bytes: stored.data };
          this.memory.set(hash, entry);
          return entry;
        }
        if (!remote?.itemId) return null;
        const fetcher = remote.apiFetch ?? api;
        const res = await fetcher(
          `/api/drive/items/${encodeURIComponent(remote.itemId)}/blobs/${encodeURIComponent(hash)}`,
          remote.signal ? { signal: remote.signal } : undefined,
        );
        if (!res.ok) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        const headerMime = res.headers.get("content-type")?.split(";")[0]?.trim();
        const mime =
          headerMime && headerMime !== "application/octet-stream" ? headerMime : fallbackMime;
        const entry: ExternalMediaBlob = { mime, bytes };
        this.memory.set(hash, entry);
        await library.putMediaBlob(hash, mime, bytes).catch(() => {});
        return entry;
      } catch {
        return null;
      } finally {
        this.inflight.delete(hash);
      }
    })();

    this.inflight.set(hash, work);
    return work;
  }

  /** Load all referenced `slmedia://` blobs into a Map (memory + IndexedDB + optional remote). */
  async collectFor(
    value: unknown,
    remote?: RemoteBlobSource,
  ): Promise<ExternalMediaBlobs> {
    const hashes = collectSlmediaHashes(value);
    const out: ExternalMediaBlobs = new Map();
    if (!hashes.length) return out;
    await Promise.all(
      hashes.map(async (hash) => {
        const blob = await this.get(hash, remote);
        if (blob) out.set(hash, blob);
      }),
    );
    return out;
  }

  /** Synchronously return a cached `blob:` Object URL if already created. */
  peekObjectUrl(uriOrHash: string): string | null {
    const hash = toHash(uriOrHash);
    if (!hash) return null;
    const existing = this.urls.get(hash);
    if (existing) return existing;
    const mem = this.memory.get(hash);
    if (!mem || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      return null;
    }
    const copy = new Uint8Array(mem.bytes.byteLength);
    copy.set(mem.bytes);
    const url = URL.createObjectURL(new Blob([copy], { type: mem.mime }));
    this.urls.set(hash, url);
    return url;
  }

  /** Resolve a `slmedia://<hash>` URI to a playable `blob:` Object URL. */
  async resolveObjectUrl(
    uriOrHash: string,
    options?: { mime?: string; remote?: RemoteBlobSource },
  ): Promise<string | null> {
    const cached = this.peekObjectUrl(uriOrHash);
    if (cached) return cached;
    const hash = toHash(uriOrHash);
    if (!hash) return null;
    const blob = await this.get(hash, options?.remote, options?.mime);
    if (!blob || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      return null;
    }
    const existing = this.urls.get(hash);
    if (existing) return existing;
    const copy = new Uint8Array(blob.bytes.byteLength);
    copy.set(blob.bytes);
    const url = URL.createObjectURL(
      new Blob([copy], { type: options?.mime ?? blob.mime }),
    );
    this.urls.set(hash, url);
    return url;
  }

  /**
   * Queue every `slmedia://` asset across all slides in `file` to download to local
   * IndexedDB storage and pre-warm Object URLs (e.g. when entering presentation mode)
   * so slides and videos play reliably even if Wi-Fi drops mid-talk.
   */
  async prefetchDeck(
    file: Pick<SlideFile, "content">,
    options: {
      itemId?: string;
      apiFetch?: MediaApiFetch;
      signal?: AbortSignal;
      concurrency?: number;
      onProgress?: (completed: number, total: number) => void;
    } = {},
  ): Promise<PrefetchResult> {
    const hashes = collectSlmediaHashes(file.content);
    const total = hashes.length;
    if (total === 0) {
      options.onProgress?.(0, 0);
      return { total: 0, cached: 0, downloaded: 0, failed: 0 };
    }
    options.onProgress?.(0, total);
    let cached = 0;
    let downloaded = 0;
    let failed = 0;
    let completed = 0;
    const concurrency = Math.max(1, options.concurrency ?? 3);
    const remote: RemoteBlobSource | undefined = options.itemId
      ? { itemId: options.itemId, apiFetch: options.apiFetch, signal: options.signal }
      : undefined;

    let cursor = 0;
    const worker = async () => {
      while (cursor < hashes.length) {
        if (options.signal?.aborted) return;
        const hash = hashes[cursor++];
        const hadLocal =
          this.memory.has(hash) ||
          (await library.getMediaBlobRecord(hash).catch(() => null)) !== null;
        const blob = await this.get(hash, remote);
        if (blob) {
          this.peekObjectUrl(hash);
          if (hadLocal) cached++;
          else downloaded++;
        } else {
          failed++;
        }
        completed++;
        options.onProgress?.(completed, total);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, hashes.length) }, () => worker()),
    );
    return { total, cached, downloaded, failed };
  }

  /** Clear in-memory caches and revoke Object URLs (mainly for tests). */
  clear() {
    if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      for (const url of this.urls.values()) URL.revokeObjectURL(url);
    }
    this.urls.clear();
    this.memory.clear();
    this.inflight.clear();
  }
}

export const mediaBlobStore = new MediaBlobStore();
