import { slmediaHashFromUri } from "@suiteleaf/core";

export type BlobFetcher = (hash: string) => Promise<Uint8Array | null>;

/**
 * Resolves `slmedia://<blake3-hash>` URIs and manifest thumbnail hashes to
 * browser `blob:` Object URLs with in-memory memoization and deduplicated
 * in-flight fetches. Call `dispose()` on editor unmount to revoke URLs.
 */
export class SlideMediaRegistry {
  private urls = new Map<string, string>();
  private inflight = new Map<string, Promise<string | null>>();

  constructor(private fetchBlob: BlobFetcher) {}

  /** Register raw bytes already in memory (e.g. newly pasted image or cached blob). */
  register(hash: string, mime: string, bytes: Uint8Array): string {
    const existing = this.urls.get(hash);
    if (existing) return existing;
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const url = URL.createObjectURL(new Blob([copy], { type: mime }));
    this.urls.set(hash, url);
    return url;
  }

  /** Synchronously return a cached Object URL if already resolved. */
  peek(uriOrHash: string): string | null {
    const hash = slmediaHashFromUri(uriOrHash) ?? uriOrHash;
    return this.urls.get(hash) ?? null;
  }

  /** Resolve a `slmedia://<hash>` URI or raw BLAKE3 hex hash to an Object URL. */
  async resolve(uriOrHash: string, mime = "application/octet-stream"): Promise<string | null> {
    const hash = slmediaHashFromUri(uriOrHash) ?? uriOrHash;
    const existing = this.urls.get(hash);
    if (existing) return existing;

    const pending = this.inflight.get(hash);
    if (pending) return pending;

    const work = (async () => {
      try {
        const bytes = await this.fetchBlob(hash);
        if (!bytes) return null;
        return this.register(hash, mime, bytes);
      } finally {
        this.inflight.delete(hash);
      }
    })();
    this.inflight.set(hash, work);
    return work;
  }

  /** Revoke all created Object URLs to free browser memory. */
  dispose() {
    for (const url of this.urls.values()) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
    this.inflight.clear();
  }
}
