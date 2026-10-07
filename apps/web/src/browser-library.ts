import Dexie, { type Table } from "dexie";
import { parseFile, serializeFile, type FileRecord } from "@suiteleaf/core";
interface EncodedRecord {
  id: string;
  title: string;
  updatedAt: string;
  native?: Blob | string;
  count?: number;
  revision?: string;
}
interface Chunk {
  key: string;
  id: string;
  data: string;
}
/** Indexed metadata plus bounded native JSON chunks avoid browser object-graph
 * cloning and large-record IPC limits. Metadata/chunks commit in one transaction. */
export class Library extends Dexie {
  encoded!: Table<EncodedRecord, string>;
  chunks!: Table<Chunk, string>;
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
    return { file: parseFile(text) };
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
    return { file: record.file };
  }
  async remove(id: string) {
    await this.transaction("rw", this.encoded, this.chunks, async () => {
      await this.chunks.where("id").equals(id).delete();
      await this.encoded.delete(id);
    });
  }
}
