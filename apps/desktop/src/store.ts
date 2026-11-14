import { DatabaseSync } from "node:sqlite";
import { LibraryBodies } from "./library-bodies";
import { catalogFile, fileSignature, readCatalogFile } from "./library-catalog";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  open,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readDraftBackup, writeDraftBackup } from "./draft-backup";
import {
  applyLibraryMarks,
  driveLinkSchema,
  isNativeName,
  kindFromName,
  nativeFilename,
  parseFile,
  readLibraryMarks,
  serializeFile,
  type DocumentScanProgress,
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
/** An on-disk file is read from its path; all other bodies live in SQLite. */
function onDisk(record: FileRecord) {
  return !!record.path && !record.recovery;
}
function catalog(record: FileRecord): FileRecord {
  return { ...record, file: catalogFile(record.file) };
}
const exists = (path: string) => stat(path).then(() => true, () => false);
/** `name` in `folder`, or "name (2).ext" and so on when that is taken. */
async function freePath(folder: string, name: string) {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; ; n++) {
    const path = join(folder, n === 1 ? name : `${stem} (${n})${ext}`);
    if (!(await exists(path))) return path;
  }
}
/** Whether `path` is `folder` or lies inside it. */
const within = (path: string, folder: string) =>
  resolve(path) === resolve(folder) || resolve(path).startsWith(resolve(folder) + sep);
export class FileStore {
  private database!: DatabaseSync;
  private initialized = false;
  private bodies!: LibraryBodies;
  private scanned = new Map<string, { signature: string; file: FileRecord["file"]; hash: string }>();
  private records = new Map<string, FileRecord>();
  /** Paths removed from the library, keyed to the file contents at that time. */
  private dismissed = new Map<string, string>();
  /** Every folder under the documents folder at the last scan, as absolute paths. */
  private folders: string[] = [];
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
    this.bodies = new LibraryBodies(this.database);
    this.bodies.init();
    this.database.exec("CREATE TABLE IF NOT EXISTS scanned_files (path TEXT PRIMARY KEY, signature TEXT NOT NULL, file TEXT NOT NULL, hash TEXT NOT NULL)");
    for (const row of this.database.prepare("SELECT * FROM scanned_files").iterate()) {
      try {
        this.scanned.set(String(row.path), { signature: String(row.signature), file: JSON.parse(String(row.file)), hash: String(row.hash) });
      } catch { /* Re-index a corrupt cache entry. */ }
    }
    this.initialized = !!this.database
      .prepare("SELECT value FROM metadata WHERE key = 'initialized'")
      .get();
    try {
      // One row at a time. Holding every document object at once exhausts the process.
      let compact = false;
      const take = (text: string) => {
        try {
          if (this.rememberStored(text)) compact = true;
        } catch {
          /* Ignore a corrupt individual recent entry. */
        }
      };
      if (this.initialized) {
        for (const row of this.database
          .prepare("SELECT record FROM records ORDER BY rowid")
          .iterate())
          take(String(row.record));
      } else {
        const legacy = JSON.parse(
          await readFile(join(this.directory, "library.json"), "utf8"),
        );
        if (Array.isArray(legacy))
          for (const row of legacy) take(JSON.stringify(row));
      }
      if (compact) {
        await this.persist();
        this.database.exec("VACUUM");
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
  /**
   * Keep one stored library row. Legacy JSON bodies move to SQLite before
   * the catalog is rewritten without them.
   */
  private rememberStored(text: string) {
    const stored = JSON.parse(text) as {
      file?: { id?: unknown; kind?: unknown; title?: unknown; content?: unknown };
      path?: unknown;
      fingerprint?: unknown;
      recovery?: unknown;
      drive?: unknown;
      starred?: unknown;
      trashedAt?: unknown;
    };
    const fileValue = stored.file;
    if (!fileValue || typeof fileValue !== "object") return false;
    const hadBody = fileValue.content !== undefined;
    const file =
      hadBody
        ? parseFile(JSON.stringify(fileValue))
        : fileValue.id && fileValue.kind && fileValue.title
          ? (fileValue as FileRecord["file"])
          : null;
    if (!file) return false;
    if (hadBody && (!stored.path || stored.recovery)) this.bodies.put(file);
    const record = catalog(
      applyLibraryMarks(
        {
          file,
          path: typeof stored.path === "string" ? stored.path : undefined,
          fingerprint:
            typeof stored.fingerprint === "string" ? stored.fingerprint : undefined,
          recovery: !!stored.recovery,
          drive: driveLink(stored.drive),
        },
        readLibraryMarks(stored),
      ),
    );
    this.records.set(file.id, record);
    return hadBody;
  }
  /** Folders under `root` from the last scan, as "/"-separated paths relative to it. */
  folderPaths(root: string) {
    return this.folders
      .filter((folder) => within(folder, root) && resolve(folder) !== resolve(root))
      .map((folder) => relative(root, folder).split(sep).join("/"));
  }
  async createFolder(parent: string, name: string) {
    return this.transaction(async () => {
      const path = join(parent, name);
      if (await exists(path)) throw new Error(`There is already something named “${name}” here.`);
      await mkdir(path);
      this.folders = [...this.folders, path].sort();
      return path;
    });
  }
  /** The OS Trash owns restoration of folder bytes, including unindexed files. */
  async trashFolder(folder: string, trash: (path: string) => Promise<void>) {
    return this.transaction(async () => {
      await trash(folder);
      for (const [id, record] of this.records) {
        if (!record.path || !within(record.path, folder)) continue;
        if (record.recovery) {
          this.records.set(id, { ...record, path: undefined, fingerprint: undefined, trashedAt: new Date().toISOString() });
        } else this.records.delete(id);
      }
      this.folders = this.folders.filter((path) => !within(path, folder));
      await this.persist();
    });
  }
  /** Move or rename a folder on disk, and keep the library's files in it. */
  async moveFolder(folder: string, parent: string, name = basename(folder)) {
    return this.transaction(async () => {
      const target = join(parent, name);
      if (resolve(target) === resolve(folder)) return target;
      if (within(parent, folder)) throw new Error("A folder cannot go inside itself.");
      // On a case-insensitive disk, "notes" exists when renaming it to "Notes".
      const recased = resolve(target).toLowerCase() === resolve(folder).toLowerCase();
      if (!recased && (await exists(target)))
        throw new Error(`There is already something named “${name}” there.`);
      await rename(folder, target);
      const moved = (path: string) =>
        within(path, folder) ? join(target, relative(folder, path)) : path;
      for (const [id, record] of this.records)
        if (record.path && within(record.path, folder))
          this.records.set(id, { ...record, path: moved(record.path) });
      this.dismissed = new Map([...this.dismissed].map(([path, hash]) => [moved(path), hash]));
      this.folders = this.folders.map(moved).sort();
      await this.persist();
      await this.persistDismissed();
      return target;
    });
  }
  /**
   * Move a file into `folder`, keeping its file name unless that is taken.
   * A file that is not on disk yet is written there, so it starts life in that folder.
   */
  async moveFile(id: string, folder: string) {
    return this.transaction(async () => {
      const entry = this.records.get(id);
      if (!entry) throw new Error("This file is no longer in the library.");
      const record = onDisk(entry) ? entry : this.hydrate(entry);
      if (!(await stat(folder).then((s) => s.isDirectory(), () => false)))
        throw new Error("That folder is no longer there.");
      let next: FileRecord;
      if (!record.path) {
        const path = await freePath(folder, nativeFilename(record.file));
        const text = serializeFile(record.file);
        await atomicWrite(path, text);
        next = { ...record, path, fingerprint: fingerprint(text), recovery: false };
      } else {
        if (resolve(dirname(record.path)) === resolve(folder)) {
          if (record.recovery) return structuredClone(record);
          const text = await readFile(record.path, "utf8");
          return structuredClone({
            ...record,
            file: parseFile(text),
            fingerprint: fingerprint(text),
          });
        }
        const path = await freePath(folder, basename(record.path));
        await rename(record.path, path);
        next = { ...record, path };
      }
      const stored = catalog(next);
      this.records.set(id, stored);
      await this.persist();
      if (stored.path && !stored.recovery) {
        const text = await readFile(stored.path, "utf8");
        return structuredClone({
          ...stored,
          file: parseFile(text),
          fingerprint: fingerprint(text),
        });
      }
      return structuredClone(next);
    });
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
  /**
   * Reconcile a complete directory snapshot without overwriting recovery drafts.
   * `onProgress` is for a folder change: list the tree first, then read each document.
   */
  async syncFolder(
    directory: string,
    previousDirectory?: string,
    onProgress?: (progress: DocumentScanProgress) => void,
    options?: { rebuild?: boolean },
  ) {
    return this.transaction(async () => {
      const root = resolve(directory);
      const rebuild = options?.rebuild === true;
      const seen = new Set<string>();
      const dirs: string[] = [];
      const files: string[] = [];
      const found = new Map<string, { file: FileRecord["file"]; hash: string }>();
      // A rebuild re-reads every document and forgets catalog entries from other folders.
      const cache = rebuild ? new Map() : new Map(this.scanned);
      const report = (progress: DocumentScanProgress) => onProgress?.(progress);
      if (onProgress) report({ files: 0, folders: 0 });
      const visit = async (folder: string) => {
        if (onProgress) report({ files: files.length, folders: dirs.length + 1 });
        for (const entry of await readdir(folder, { withFileTypes: true })) {
          if (entry.name.startsWith(".")) continue;
          const path = resolve(folder, entry.name);
          if (entry.isDirectory()) {
            dirs.push(path);
            await visit(path);
          } else if (entry.isFile() && isNativeName(entry.name)) {
            files.push(path);
            if (onProgress) report({ files: files.length, folders: dirs.length + 1 });
          }
        }
      };
      // Do not prune anything unless the directory could be read completely.
      await visit(root);
      const folders = dirs.length + 1;
      if (onProgress) report({ files: 0, folders, total: files.length });
      for (const path of files) {
        seen.add(path);
        try {
          const signature = await fileSignature(path);
          const cached = cache.get(path);
          if (cached?.signature === signature) {
            found.set(path, cached);
          } else {
            const item = await readCatalogFile(path);
            // Never cache a partial read while a cloud client is replacing bytes.
            if ((await fileSignature(path)) === signature) {
              cache.set(path, { ...item, signature });
              found.set(path, item);
            }
          }
        } catch {
          cache.delete(path);
          // Partial cloud downloads and corrupt files are retried on the next scan.
        }
        if (onProgress)
          report({ files: seen.size, folders, total: files.length });
      }
      for (const path of cache.keys())
        if (within(path, root) && !seen.has(path)) cache.delete(path);
      const previous = new Map(this.records);
      let recordsChanged = false;
      const inFolder = (path: string, folder: string) =>
        resolve(path).startsWith(resolve(folder) + sep);
      for (const [id, record] of this.records) {
        if (!record.path || record.recovery || record.drive) continue;
        if (
          (rebuild && !inFolder(record.path, root)) ||
          (inFolder(record.path, root) &&
            (!seen.has(resolve(record.path)) ||
              (found.has(resolve(record.path)) &&
                found.get(resolve(record.path))!.file.id !== id))) ||
          (previousDirectory &&
            resolve(previousDirectory) !== root &&
            inFolder(record.path, previousDirectory))
        ) {
          this.records.delete(id);
          recordsChanged = true;
        }
      }
      for (const [path, item] of found) {
        if (this.dismissed.get(path) === item.hash) continue;
        const old = this.records.get(item.file.id);
        if (old?.recovery || old?.drive) continue;
        if (
          old?.path &&
          resolve(old.path) !== path &&
          found.get(resolve(old.path))?.file.id === item.file.id
        )
          continue;
        // The same id outside this folder, with different bytes, is left alone.
        if (
          old?.path &&
          resolve(old.path) !== path &&
          !inFolder(old.path, root) &&
          old.fingerprint !== item.hash
        )
          continue;
        const next = catalog(applyLibraryMarks(
          { file: item.file, path, fingerprint: item.hash, recovery: false },
          readLibraryMarks(old ?? previous.get(item.file.id) ?? {}),
        ));
        if (JSON.stringify(old) !== JSON.stringify(next)) {
          this.records.set(item.file.id, next);
          recordsChanged = true;
        }
      }
      if (recordsChanged) await this.persist();
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const put = this.database.prepare("INSERT OR REPLACE INTO scanned_files (path, signature, file, hash) VALUES (?, ?, ?, ?)");
        for (const [path, item] of cache)
          if (this.scanned.get(path) !== item) put.run(path, item.signature, JSON.stringify(item.file), item.hash);
        const remove = this.database.prepare("DELETE FROM scanned_files WHERE path = ?");
        for (const path of this.scanned.keys()) if (!cache.has(path)) remove.run(path);
        this.database.exec("COMMIT");
        this.scanned = cache;
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
      dirs.sort();
      const foldersChanged = dirs.join("\0") !== this.folders.join("\0");
      this.folders = dirs;
      return recordsChanged || foldersChanged;
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
      this.bodies.prune();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  /** Update catalog marks without reading or writing any document files. */
  async setTrashed(ids: string[], trashed: boolean) {
    return this.transaction(async () => {
      const changed = new Map<string, FileRecord>();
      const trashedAt = trashed ? new Date().toISOString() : undefined;
      for (const id of new Set(ids)) {
        const record = this.records.get(id);
        if (!record || record.drive || Boolean(record.trashedAt) === trashed) continue;
        changed.set(id, applyLibraryMarks(record, { ...readLibraryMarks(record), trashedAt }));
      }
      if (!changed.size) return [];

      const update = this.database.prepare("UPDATE records SET record = ? WHERE id = ?");
      this.database.exec("BEGIN IMMEDIATE");
      try {
        for (const [id, record] of changed) update.run(JSON.stringify(record), id);
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
      for (const [id, record] of changed) this.records.set(id, record);
      return [...changed.keys()];
    });
  }
  async list() {
    return structuredClone([...this.records.values()]);
  }
  private hydrate(record: FileRecord): FileRecord {
    return { ...record, file: this.bodies.get(record.file.id) };
  }
  async get(id: string) {
    const record = this.records.get(id);
    if (!record) return;
    if (record.path && !record.recovery) {
      const text = await readFile(record.path, "utf8");
      const full = applyLibraryMarks(
        {
          ...record,
          file: parseFile(text),
          fingerprint: fingerprint(text),
        },
        readLibraryMarks(record),
      );
      // A concurrent catalog change may have occurred while reading the file.
      if (this.records.get(id) === record) this.records.set(id, catalog(full));
      return full;
    }
    return this.hydrate(record);
  }
  async openPath(path: string) {
    return this.transaction(async () => {
      const full = resolve(path),
        text = await readFile(full, "utf8"),
        file = parseFile(text, kindFromName(full));
      const existing = this.records.get(file.id);
      if (existing?.recovery && existing.path === full)
        return this.hydrate(existing);
      // A different version of this file is already in the library (a draft,
      // or saved elsewhere): return it unsaved, so the user chooses which to keep.
      const sameBytes = existing?.fingerprint
        ? existing.fingerprint === fingerprint(text)
        : existing && !onDisk(existing) &&
          serializeFile(this.hydrate(existing).file) === serializeFile(file);
      if (existing && !existing.drive && existing.path !== full && !sameBytes)
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
      this.records.set(file.id, catalog(r));
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
        if (!onDisk(next)) this.bodies.put(file);
        this.records.set(file.id, catalog(next));
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
      this.records.set(file.id, catalog(r));
      await this.persist();
      await this.remember(full);
      return structuredClone(r);
    });
  }
  async reload(id: string) {
    return this.transaction(async () => {
      const old = this.records.get(id);
      if (!old?.path) return old ? this.hydrate(old) : undefined;
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
      this.records.set(id, catalog(r));
      await this.persist();
      return structuredClone(r);
    });
  }
  /** Copy recovery drafts only. A file that already lives on disk is left out. */
  async exportRecoveryDrafts(folder: string) {
    return writeDraftBackup(await this.list(), folder, (record) => this.hydrate(record));
  }

  /** Read those drafts back. A file already saved on disk is not replaced. */
  async importRecoveryDrafts(folder: string) {
    const drafts = await readDraftBackup(folder);
    let imported = 0;
    for (const draft of drafts) {
      const existing = this.records.get(draft.file.id);
      if (existing && !existing.recovery) continue;
      await this.save({ file: draft.file, recovery: true });
      imported += 1;
    }
    return imported;
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
