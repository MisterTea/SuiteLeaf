import { mkdir, readFile, rename, unlink, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseFile, serializeFile, type FileRecord } from "@suiteleaf/core";
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
  private records = new Map<string, FileRecord>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private async transaction<T>(fn: () => Promise<T>) {
    const next = this.tail.catch(() => {}).then(fn);
    this.tail = next;
    return next;
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    try {
      const raw = JSON.parse(
        await readFile(join(this.directory, "library.json"), "utf8"),
      );
      for (const r of raw) {
        try {
          const file = parseFile(JSON.stringify(r.file));
          this.records.set(file.id, {
            file,
            path: typeof r.path === "string" ? r.path : undefined,
            fingerprint:
              typeof r.fingerprint === "string" ? r.fingerprint : undefined,
            recovery: !!r.recovery,
          });
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
  }
  private async persist() {
    await atomicWrite(
      join(this.directory, "library.json"),
      JSON.stringify([...this.records.values()]),
    );
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
        file = parseFile(text);
      const existing = this.records.get(file.id);
      if (existing?.recovery && existing.path === full)
        return structuredClone(existing);
      const r = {
        file,
        path: full,
        fingerprint: fingerprint(text),
        recovery: false,
      };
      this.records.set(file.id, r);
      await this.persist();
      return structuredClone(r);
    });
  }
  /** Only main-process dialog paths are authorized; renderer-supplied paths are never trusted. */
  async save(input: FileRecord) {
    return this.transaction(async () => {
      const file = parseFile(serializeFile(input.file));
      const old = this.records.get(file.id);
      if (!old) {
        const draft = { file, recovery: true };
        this.records.set(file.id, draft);
        await this.persist();
        return structuredClone(draft);
      }
      const pending = { ...old, file, recovery: true };
      this.records.set(file.id, pending);
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
      if (fingerprint(disk) !== old.fingerprint) throw new FileConflict();
      const text = serializeFile(file);
      await atomicWrite(old.path, text);
      const saved = {
        file,
        path: old.path,
        fingerprint: fingerprint(text),
        recovery: false,
      };
      this.records.set(file.id, saved);
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
      const r = {
        file,
        path: full,
        fingerprint: fingerprint(text),
        recovery: false,
      };
      this.records.set(file.id, r);
      await this.persist();
      return structuredClone(r);
    });
  }
  async reload(id: string) {
    return this.transaction(async () => {
      const old = this.records.get(id);
      if (!old?.path) return structuredClone(old);
      const text = await readFile(old.path, "utf8");
      const r = {
        file: parseFile(text),
        path: old.path,
        fingerprint: fingerprint(text),
        recovery: false,
      };
      this.records.set(id, r);
      await this.persist();
      return structuredClone(r);
    });
  }
  async remove(id: string) {
    await this.transaction(async () => {
      this.records.delete(id);
      await this.persist();
    });
  }
}
