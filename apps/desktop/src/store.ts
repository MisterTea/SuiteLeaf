import { DatabaseSync } from "node:sqlite";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  open,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  applyLibraryMarks,
  driveLinkSchema,
  isNativeName,
  kindFromName,
  parseFile,
  readLibraryMarks,
  serializeFile,
  type DriveLink,
  type FileRecord,
} from "@suiteleaf/core";
/** A valid SuiteDrive link, or nothing. */
export function driveLink(value: unknown): DriveLink | undefined {
  const parsed = driveLinkSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
export class FileConflict extends Error {
  constructor() {
    super(
      "This file changed outside SuiteLeaf. Reload the saved file or use Save As to keep your edits.",
    );
  }
}
export async function atomicWrite(path: string, text: string | Uint8Array) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
const fingerprint = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export class FileStore {
  private database!: DatabaseSync;
  private initialized = false;
  private records = new Map<string, FileRecord>();
  /** Paths removed from the library, keyed to the file contents at that time. */
  private dismissed = new Map<string, string>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private async transaction<T>(fn: () => Promise<T>) {
    const next = this.tail.catch(() => {}).then(fn);
    this.tail = next;
    return next;
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    this.database = new DatabaseSync(join(this.directory, "library.sqlite"));
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dismissed (path TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.initialized = !!this.database
      .prepare("SELECT value FROM metadata WHERE key = 'initialized'")
      .get();
    try {
      const raw = this.initialized
        ? this.database
            .prepare("SELECT record FROM records ORDER BY rowid")
            .all()
            .map((row) => JSON.parse(String(row.record)))
        : JSON.parse(
            await readFile(join(this.directory, "library.json"), "utf8"),
          );
      for (const r of raw) {
        try {
          const file = parseFile(JSON.stringify(r.file));
          this.records.set(
            file.id,
            applyLibraryMarks(
              {
                file,
                path: typeof r.path === "string" ? r.path : undefined,
                fingerprint:
                  typeof r.fingerprint === "string" ? r.fingerprint : undefined,
                recovery: !!r.recovery,
                drive: driveLink(r.drive),
              },
              readLibraryMarks(r),
            ),
          );
        } catch {
          /* Ignore a corrupt individual recent entry. */
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "Could not read the local library. Your saved files remain on disk.",
        );
    }
    await this.loadDismissed();
    if (!this.initialized) {
      await this.persist();
      await this.persistDismissed();
      this.database
        .prepare(
          "INSERT INTO metadata (key, value) VALUES ('initialized', '1')",
        )
        .run();
      this.initialized = true;
    }
  }
  close() {
    this.database?.close();
  }
  private async loadDismissed() {
    try {
      const raw = this.initialized
        ? Object.fromEntries(
            this.database
              .prepare("SELECT path, fingerprint FROM dismissed")
              .all()
              .map((row) => [String(row.path), String(row.fingerprint)]),
          )
        : JSON.parse(
            await readFile(join(this.directory, "dismissed.json"), "utf8"),
          );
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      for (const [path, hash] of Object.entries(raw)) {
        if (typeof path === "string" && typeof hash === "string")
          this.dismissed.set(resolve(path), hash);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        /* A corrupt dismissal list must not hide the library. */
      }
    }
  }
  private async persistDismissed() {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.exec("DELETE FROM dismissed");
      const insert = this.database.prepare(
        "INSERT INTO dismissed (path, fingerprint) VALUES (?, ?)",
      );
      for (const [path, hash] of this.dismissed) insert.run(path, hash);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  private async remember(path: string) {
    if (!this.dismissed.delete(resolve(path))) return;
    await this.persistDismissed();
  }
  /**
   * Create a documents folder and add SuiteLeaf files that are not already
   * in the library. A file removed from the library stays out until its
   * contents change or the person opens it again.
   */
  async importFolder(directory: string) {
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      if (!isNativeName(entry.name)) continue;
      const full = resolve(directory, entry.name);
      if (
        [...this.records.values()].some(
          (r) => r.path && resolve(r.path) === full,
        )
      )
        continue;
      let text: string;
      try {
        text = await readFile(full, "utf8");
      } catch {
        continue;
      }
      if (this.dismissed.get(full) === fingerprint(text)) continue;
      try {
        await this.openPath(full);
      } catch {
        /* Skip a file that is not a readable SuiteLeaf document. */
      }
    }
  }
  /** Reconcile a complete directory snapshot without overwriting recovery drafts. */
  async syncFolder(directory: string, previousDirectory?: string) {
    return this.transaction(async () => {
      const root = resolve(directory);
      const seen = new Set<string>();
      const found = new Map<
        string,
        { file: FileRecord["file"]; hash: string }
      >();
      const visit = async (folder: string) => {
        for (const entry of await readdir(folder, { withFileTypes: true })) {
          if (entry.name.startsWith(".")) continue;
          const path = resolve(folder, entry.name);
          if (entry.isDirectory()) await visit(path);
          else if (entry.isFile() && isNativeName(entry.name)) {
            seen.add(path);
            try {
              const text = await readFile(path, "utf8");
              found.set(path, {
                file: parseFile(text, kindFromName(path)),
                hash: fingerprint(text),
              });
            } catch {
              // Partial cloud downloads and corrupt files are retried on the next scan.
            }
          }
        }
      };
      // Do not prune anything unless the directory could be read completely.
      await visit(root);
      const previous = new Map(this.records);
      const before = JSON.stringify([...this.records.values()]);
      const inFolder = (path: string, folder: string) =>
        resolve(path).startsWith(resolve(folder) + sep);
      for (const [id, record] of this.records) {
        if (!record.path || record.recovery || record.drive) continue;
        if (
          (inFolder(record.path, root) &&
            (!seen.has(resolve(record.path)) ||
              (found.has(resolve(record.path)) &&
                found.get(resolve(record.path))!.file.id !== id))) ||
          (previousDirectory &&
            resolve(previousDirectory) !== root &&
            inFolder(record.path, previousDirectory))
        )
          this.records.delete(id);
      }
      for (const [path, { file, hash }] of found) {
        if (this.dismissed.get(path) === hash) continue;
        const old = this.records.get(file.id);
        if (old?.recovery || old?.drive) continue;
        if (
          old?.path &&
          resolve(old.path) !== path &&
          found.get(resolve(old.path))?.file.id === file.id
        )
          continue;
        // Duplicate IDs with different contents must not replace a file elsewhere.
        if (
          old?.path &&
          resolve(old.path) !== path &&
          !inFolder(old.path, root) &&
          serializeFile(old.file) !== serializeFile(file)
        )
          continue;
        this.records.set(
          file.id,
          applyLibraryMarks(
            { file, path, fingerprint: hash, recovery: false },
            readLibraryMarks(old ?? previous.get(file.id) ?? {}),
          ),
        );
      }
      const changed = before !== JSON.stringify([...this.records.values()]);
      if (changed) await this.persist();
      return changed;
    });
  }
  private async persist() {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.exec("DELETE FROM records");
      const insert = this.database.prepare(
        "INSERT INTO records (id, record) VALUES (?, ?)",
      );
      for (const record of this.records.values())
        insert.run(record.file.id, JSON.stringify(record));
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  async list() {
    return structuredClone([...this.records.values()]);
  }
  async get(id: string) {
    const record = this.records.get(id);
    if (!record) return;
    const r = structuredClone(record);
    if (r.path && !r.recovery) {
      const text = await readFile(r.path, "utf8");
      r.file = parseFile(text);
      r.fingerprint = fingerprint(text);
      this.records.set(id, r);
    }
    return r;
  }
  async openPath(path: string) {
    return this.transaction(async () => {
      const full = resolve(path),
        text = await readFile(full, "utf8"),
        file = parseFile(text, kindFromName(full));
      const existing = this.records.get(file.id);
      if (existing?.recovery && existing.path === full)
        return structuredClone(existing);
      // A different version of this file is already in the library (a draft,
      // or saved elsewhere): return it unsaved, so the user chooses which to keep.
      if (
        existing &&
        !existing.drive &&
        existing.path !== full &&
        serializeFile(existing.file) !== serializeFile(file)
      )
        return structuredClone({
          file,
          path: full,
          fingerprint: fingerprint(text),
          recovery: false,
        });
      const r = applyLibraryMarks(
        {
          file,
          path: full,
          fingerprint: fingerprint(text),
          recovery: false,
        },
        { starred: existing?.starred === true ? true : undefined },
      );
      this.records.set(file.id, r);
      await this.persist();
      await this.remember(full);
      return structuredClone(r);
    });
  }
  /** Only main-process dialog paths are authorized; renderer-supplied paths are never trusted. */
  async save(input: FileRecord) {
    return this.transaction(async () => {
      const file = parseFile(serializeFile(input.file));
      const old = this.records.get(file.id);
      const drive = input.drive ?? old?.drive;
      const marks = readLibraryMarks(input);
      const keep = (r: FileRecord) => {
        const next = applyLibraryMarks(r, marks);
        this.records.set(file.id, next);
        return next;
      };
      if (!old) {
        const draft = keep({ file, recovery: true, drive });
        await this.persist();
        return structuredClone(draft);
      }
      const pending = keep({ ...old, file, recovery: true, drive });
      await this.persist();
      if (!old.path) return structuredClone(pending);
      let disk: string;
      try {
        disk = await readFile(old.path, "utf8");
      } catch {
        throw new Error(
          "The saved file is missing or inaccessible. Use Save As; your recovery draft is safe.",
        );
      }
      if (fingerprint(disk) !== (input.fingerprint ?? old.fingerprint))
        throw new FileConflict();
      const text = serializeFile(file);
      await atomicWrite(old.path, text);
      const saved = keep({
        file,
        path: old.path,
        fingerprint: fingerprint(text),
        recovery: false,
        drive,
      });
      await this.persist();
      return structuredClone(saved);
    });
  }
  async saveAs(input: FileRecord, path: string) {
    return this.transaction(async () => {
      const file = parseFile(serializeFile(input.file)),
        text = serializeFile(file),
        full = resolve(path);
      await atomicWrite(full, text);
      const r = applyLibraryMarks(
        {
          file,
          path: full,
          fingerprint: fingerprint(text),
          recovery: false,
          drive: input.drive ?? this.records.get(file.id)?.drive,
        },
        readLibraryMarks(input),
      );
      this.records.set(file.id, r);
      await this.persist();
      await this.remember(full);
      return structuredClone(r);
    });
  }
  async reload(id: string) {
    return this.transaction(async () => {
      const old = this.records.get(id);
      if (!old?.path) return structuredClone(old);
      const text = await readFile(old.path, "utf8");
      const r = applyLibraryMarks(
        {
          file: parseFile(text),
          path: old.path,
          fingerprint: fingerprint(text),
          recovery: false,
          drive: old.drive,
        },
        readLibraryMarks(old),
      );
      this.records.set(id, r);
      await this.persist();
      return structuredClone(r);
    });
  }
  async remove(id: string) {
    await this.transaction(async () => {
      const old = this.records.get(id);
      this.records.delete(id);
      await this.persist();
      if (!old?.path) return;
      this.dismissed.set(
        resolve(old.path),
        old.fingerprint ?? fingerprint(serializeFile(old.file)),
      );
      await this.persistDismissed();
    });
  }
}
