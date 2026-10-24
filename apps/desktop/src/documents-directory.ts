import { watch, type FSWatcher } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { FileStore } from "./store";

/** Native notifications plus reconciliation for cloud clients that drop events. */
export class DocumentsDirectory {
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;
  private directory?: string;
  constructor(
    private store: FileStore,
    private changed: () => void,
  ) {}
  async set(directory: string) {
    const next = resolve(directory);
    await mkdir(next, { recursive: true });
    let watcher: FSWatcher | undefined;
    try {
      watcher = watch(next, { recursive: true }, () => this.schedule());
      watcher.on("error", () => this.schedule());
    } catch {
      // Cloud and network filesystems may not support native notifications.
      // Initial indexing and periodic reconciliation must still work.
      watcher?.close();
      watcher = undefined;
    }
    try {
      const changed = await this.store.syncFolder(next, this.directory);
      this.close();
      this.directory = next;
      this.watcher = watcher;
      this.poll = setInterval(() => this.schedule(), 15000);
      this.poll.unref();
      if (changed) this.changed();
      // Catch changes made while the initial snapshot was being read.
      this.schedule();
    } catch (error) {
      watcher?.close();
      throw error;
    }
  }
  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.directory)
        void this.store
          .syncFolder(this.directory)
          .then((changed) => {
            if (changed) this.changed();
          })
          .catch(() => {
            /* Keep the last registry while the folder is unavailable. */
          });
    }, 250);
    this.timer.unref();
  }
  close() {
    this.watcher?.close();
    clearTimeout(this.timer);
    clearInterval(this.poll);
    this.directory = undefined;
  }
}
