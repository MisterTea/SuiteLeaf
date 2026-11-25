import { open, stat } from "node:fs/promises";
import {
  readZipCentralDirectory,
  readZipEntry,
  slideGlobalSchema,
  slidePackageManifestSchema,
  slideSchema,
  type Slide,
  type SlideGlobal,
  type SlidePackageManifest,
  type ZipCentralEntry,
} from "@suiteleaf/core";

const decoder = new TextDecoder();

/**
 * Random-access reader for on-disk v2 `.slslides` ZIP files using Node's
 * `FileHandle.read()`. Reads only the ZIP Central Directory once, then
 * extracts `manifest.json`, `global.json`, individual slides, and media
 * blobs on demand without reading the entire presentation into memory.
 */
export class DesktopSlidePackageReader {
  private entries: Map<string, ZipCentralEntry> | null = null;
  private manifestCache: SlidePackageManifest | null = null;

  constructor(private filePath: string) {}

  private async withRange<T>(
    work: (
      fileSize: number,
      readRange: (offset: number, length: number) => Promise<Uint8Array>,
    ) => Promise<T>,
  ): Promise<T> {
    const info = await stat(this.filePath);
    const handle = await open(this.filePath, "r");
    try {
      const readRange = async (offset: number, length: number) => {
        const buf = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buf, 0, length, offset);
        return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
      };
      return await work(info.size, readRange);
    } finally {
      await handle.close();
    }
  }

  /** Bootstrap: reads manifest.json + global.json + active slide in O(1) I/O. */
  async bootstrap(activeSlideId?: string): Promise<{
    manifest: SlidePackageManifest;
    global: SlideGlobal;
    slides: Record<string, Slide>;
  }> {
    return this.withRange(async (size, readRange) => {
      if (!this.entries) {
        this.entries = await readZipCentralDirectory(size, readRange);
      }
      const manifestEntry = this.entries.get("manifest.json");
      const globalEntry = this.entries.get("global.json");
      if (!manifestEntry || !globalEntry) {
        throw new Error("Slide package is missing manifest.json or global.json.");
      }
      const [manifestBytes, globalBytes] = await Promise.all([
        readZipEntry(manifestEntry, readRange),
        readZipEntry(globalEntry, readRange),
      ]);
      const manifest = slidePackageManifestSchema.parse(
        JSON.parse(decoder.decode(manifestBytes)),
      );
      const global = slideGlobalSchema.parse(
        JSON.parse(decoder.decode(globalBytes)),
      );
      this.manifestCache = manifest;

      const targetId =
        activeSlideId && manifest.slides[activeSlideId]
          ? activeSlideId
          : manifest.slideOrder[0];
      const slides: Record<string, Slide> = {};
      if (targetId) {
        const slideEntry = this.entries.get(`slides/${targetId}.json`);
        if (slideEntry) {
          const slideBytes = await readZipEntry(slideEntry, readRange);
          slides[targetId] = slideSchema.parse(
            JSON.parse(decoder.decode(slideBytes)),
          );
        }
      }
      return { manifest, global, slides };
    });
  }

  /** Extract a single slide JSON on demand. */
  async readSlide(slideId: string): Promise<Slide | null> {
    return this.withRange(async (size, readRange) => {
      if (!this.entries) {
        this.entries = await readZipCentralDirectory(size, readRange);
      }
      const entry = this.entries.get(`slides/${slideId}.json`);
      if (!entry) return null;
      const bytes = await readZipEntry(entry, readRange);
      return slideSchema.parse(JSON.parse(decoder.decode(bytes)));
    });
  }

  /** Extract a single binary media or thumbnail blob by BLAKE3 hash. */
  async readMedia(hash: string): Promise<Uint8Array | null> {
    return this.withRange(async (size, readRange) => {
      if (!this.entries) {
        this.entries = await readZipCentralDirectory(size, readRange);
      }
      const ext = this.manifestCache?.media[hash]?.ext;
      const entry =
        (ext ? this.entries.get(`media/${hash}.${ext}`) : undefined) ??
        this.entries.get(`media/${hash}`) ??
        [...this.entries.values()].find((e) =>
          e.name.startsWith(`media/${hash}.`),
        );
      if (!entry) return null;
      return readZipEntry(entry, readRange);
    });
  }
}
