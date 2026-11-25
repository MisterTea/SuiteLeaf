import type { DatabaseSync } from "node:sqlite";
import { packSharedMedia, parseFile, type SuiteFile } from "@suiteleaf/core";

/** Bodies stay in SQLite until a document is opened, including recovery drafts. */
export class LibraryBodies {
  constructor(private database: DatabaseSync) {}

  init() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS file_bodies (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS file_sections (
        file_id TEXT NOT NULL,
        section_key TEXT NOT NULL,
        hash TEXT NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY (file_id, section_key)
      );
    `);
    if (
      this.database
        .prepare("SELECT value FROM metadata WHERE key = 'separate-bodies'")
        .get()
    )
      return;
    // Keep migration in SQLite: do not materialize legacy recovery documents in JS.
    // The body and its compact catalog are committed together, preserving recovery data.
    this.database.exec(`
      BEGIN IMMEDIATE;
      INSERT OR IGNORE INTO file_bodies (id, body)
        SELECT id, json_extract(record, '$.file') FROM records
        WHERE json_valid(record) AND json_type(record, '$.file.content') IS NOT NULL
          AND (COALESCE(json_extract(record, '$.recovery'), 0) = 1 OR json_extract(record, '$.path') IS NULL);
      UPDATE records SET record = json_set(record, '$.file', json_object(
        'format', json_extract(record, '$.file.format'), 'version', json_extract(record, '$.file.version'),
        'id', json_extract(record, '$.file.id'), 'title', json_extract(record, '$.file.title'),
        'kind', json_extract(record, '$.file.kind'), 'createdAt', json_extract(record, '$.file.createdAt'),
        'updatedAt', json_extract(record, '$.file.updatedAt')))
        WHERE json_valid(record);
      INSERT INTO metadata (key, value) VALUES ('separate-bodies', '1');
      COMMIT;
    `);
  }

  put(file: SuiteFile) {
    let text: string;
    try {
      text = JSON.stringify(file);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      text = JSON.stringify(packSharedMedia(file));
    }
    this.database
      .prepare("INSERT OR REPLACE INTO file_bodies (id, body) VALUES (?, ?)")
      .run(file.id, text);
  }

  get(id: string) {
    const row = this.database
      .prepare("SELECT body FROM file_bodies WHERE id = ?")
      .get(id);
    if (!row) throw new Error("This recovery draft cannot be read.");
    return parseFile(String(row.body));
  }

  putSection(fileId: string, sectionKey: string, hash: string, data: Uint8Array) {
    this.database
      .prepare(
        "INSERT OR REPLACE INTO file_sections (file_id, section_key, hash, data) VALUES (?, ?, ?, ?)",
      )
      .run(fileId, sectionKey, hash, data);
  }

  getSection(fileId: string, sectionKey: string): Uint8Array | null {
    const row = this.database
      .prepare(
        "SELECT data FROM file_sections WHERE file_id = ? AND section_key = ?",
      )
      .get(fileId, sectionKey) as { data?: Uint8Array } | undefined;
    return row?.data ? new Uint8Array(row.data) : null;
  }

  prune() {
    this.database.exec(`DELETE FROM file_bodies WHERE id NOT IN
      (SELECT id FROM records WHERE COALESCE(json_extract(record, '$.recovery'), 0) = 1
        OR json_extract(record, '$.path') IS NULL)`);
    this.database.exec(`DELETE FROM file_sections WHERE file_id NOT IN
      (SELECT id FROM records)`);
  }
}
