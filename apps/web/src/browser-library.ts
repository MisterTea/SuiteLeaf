import Dexie, { type Table } from "dexie";
import {
  applyLibraryMarks,
  diffSlidePackage,
  driveLinkSchema,
  parseFile,
  readLibraryMarks,
  serializeFile,
  type DriveLink,
  type FileRecord,
  type SlidePackageManifest,
  type SlidePackageParts,
} from "@suiteleaf/core";
interface EncodedRecord {
  id: string;
  title: string;
  updatedAt: string;
  native?: Blob | string;
  count?: number;
  revision?: string;
  drive?: DriveLink;
  starred?: boolean;
  trashedAt?: string;
}
interface Chunk {
  key: string;
  id: string;
  data: string;
}
interface SlideSectionRow {
  key: string;
  id: string;
  hash: string;
  data: Uint8Array;
}
interface MediaBlobRow {
  hash: string;
  mime: string;
  data: Uint8Array;
}
/** Indexed metadata plus bounded native JSON chunks avoid browser object-graph
 * cloning and large-record IPC limits. Metadata/chunks commit in one transaction. */
export class Library extends Dexie {
  encoded!: Table<EncodedRecord, string>;
  chunks!: Table<Chunk, string>;
  slideSections!: Table<SlideSectionRow, string>;
  mediaBlobs!: Table<MediaBlobRow, string>;
  constructor(name = "SuiteLeaf") {
    super(name);
    this.version(1).stores({ files: "file.id,file.updatedAt,file.title" });
    this.version(2)
      .stores({
        files: "file.id,file.updatedAt,file.title",
        encoded: "id,title,updatedAt",
      })
      .upgrade(async (tx) => {
        for (const record of (await tx
          .table("files")
          .toArray()) as FileRecord[]) {
          await tx.table("encoded").put({
            id: record.file.id,
            title: record.file.title,
            updatedAt: record.file.updatedAt,
            native: serializeFile(record.file),
          });
        }
        await tx.table("files").clear();
      });
    this.version(3).stores({
      files: "file.id,file.updatedAt,file.title",
      encoded: "id,title,updatedAt",
      chunks: "key,id",
    });
    this.version(4).stores({
      files: "file.id,file.updatedAt,file.title",
      encoded: "id,title,updatedAt",
      chunks: "key,id",
      slideSections: "key,id",
      mediaBlobs: "hash",
    });
  }
  private async decode(row: EncodedRecord): Promise<FileRecord> {
    let text: string;
    if (row.native !== undefined)
      text =
        typeof row.native === "string" ? row.native : await row.native.text();
    else {
      const parts = await this.chunks.bulkGet(
        Array.from(
          { length: row.count ?? 0 },
          (_, i) => `${row.id}:${row.revision}:${i}`,
        ),
      );
      if (!parts.length || parts.some((p) => !p))
        throw new Error("A stored file is missing a data chunk.");
      text = parts.map((p) => p!.data).join("");
    }
    const drive = driveLinkSchema.safeParse(row.drive);
    const base: FileRecord = drive.success
      ? { file: parseFile(text), drive: drive.data }
      : { file: parseFile(text) };
    return applyLibraryMarks(base, readLibraryMarks(row));
  }
  async list(): Promise<FileRecord[]> {
    return Promise.all(
      (await this.encoded.toArray()).map((row) => this.decode(row)),
    );
  }
  async get(id: string): Promise<FileRecord | undefined> {
    const row = await this.encoded.get(id);
    return row ? this.decode(row) : undefined;
  }
  async save(record: FileRecord): Promise<FileRecord> {
    const native = serializeFile(record.file),
      id = record.file.id;
    await this.transaction("rw", this.encoded, this.chunks, async () => {
      await this.chunks.where("id").equals(id).delete();
      const meta = {
        id,
        title: record.file.title,
        updatedAt: record.file.updatedAt,
        drive: record.drive,
        ...readLibraryMarks(record),
      };
      if (native.length < 16 * 1024 * 1024)
        await this.encoded.put({ ...meta, native });
      else {
        const size = 4 * 1024 * 1024,
          revision = crypto.randomUUID(),
          count = Math.ceil(native.length / size);
        for (let i = 0; i < count; i++)
          await this.chunks.put({
            key: `${id}:${revision}:${i}`,
            id,
            data: native.slice(i * size, (i + 1) * size),
          });
        await this.encoded.put({ ...meta, revision, count });
      }
    });
    const saved: FileRecord = record.drive
      ? { file: record.file, drive: record.drive }
      : { file: record.file };
    return applyLibraryMarks(saved, readLibraryMarks(record));
  }
  async remove(id: string) {
    await this.transaction(
      "rw",
      this.encoded,
      this.chunks,
      this.slideSections,
      async () => {
        await this.chunks.where("id").equals(id).delete();
        await this.slideSections.where("id").equals(id).delete();
        await this.encoded.delete(id);
      },
    );
  }
  /** Persist only changed v2 slide sections & media blobs in IndexedDB. */
  async saveSlideDelta(
    fileId: string,
    parts: SlidePackageParts,
    previousManifest: SlidePackageManifest | null,
  ): Promise<void> {
    const delta = diffSlidePackage(previousManifest, parts);
    await this.transaction(
      "rw",
      this.slideSections,
      this.mediaBlobs,
      async () => {
        await this.slideSections.put({
          key: `${fileId}:manifest`,
          id: fileId,
          hash: parts.manifestHash,
          data: parts.manifestBytes,
        });
        if (delta.globalChanged) {
          await this.slideSections.put({
            key: `${fileId}:global`,
            id: fileId,
            hash: parts.manifest.global.hash,
            data: parts.globalBytes,
          });
        }
        for (const slideId of delta.changedSlideIds) {
          const bytes = parts.slideBytes[slideId];
          const summary = parts.manifest.slides[slideId];
          if (bytes && summary) {
            await this.slideSections.put({
              key: `${fileId}:slide:${slideId}`,
              id: fileId,
              hash: summary.hash,
              data: bytes,
            });
          }
        }
        for (const removedId of delta.removedSlideIds) {
          await this.slideSections.delete(`${fileId}:slide:${removedId}`);
        }
        if (delta.historyChanged && parts.historyBytes && parts.manifest.history) {
          await this.slideSections.put({
            key: `${fileId}:history`,
            id: fileId,
            hash: parts.manifest.history.hash,
            data: parts.historyBytes,
          });
        }
        for (const [hash, entry] of Object.entries(parts.manifest.media)) {
          if (!delta.changedBlobs.has(hash)) continue;
          const bytes = parts.blobs.get(hash);
          if (bytes) {
            await this.mediaBlobs.put({ hash, mime: entry.mime, data: bytes });
          }
        }
      },
    );
  }
  async getSlideSection(
    fileId: string,
    sectionKey: string,
  ): Promise<Uint8Array | null> {
    const row = await this.slideSections.get(`${fileId}:${sectionKey}`);
    return row?.data ?? null;
  }
  async getMediaBlob(hash: string): Promise<Uint8Array | null> {
    const row = await this.mediaBlobs.get(hash);
    return row?.data ?? null;
  }
  async getMediaBlobRecord(hash: string): Promise<{ mime: string; data: Uint8Array } | null> {
    const row = await this.mediaBlobs.get(hash);
    return row ? { mime: row.mime, data: row.data } : null;
  }
  async putMediaBlob(hash: string, mime: string, data: Uint8Array): Promise<void> {
    await this.mediaBlobs.put({ hash, mime, data });
  }
}
