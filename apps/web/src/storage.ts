import { Library } from "./browser-library";
export { Library } from "./browser-library";
import {
  packSlidePackageZip,
  serializeFile,
  serializeFileBytes,
  nativeFilename,
  mimeFor,
  type StorageAdapter,
  type DesktopBridge,
} from "@suiteleaf/core";
declare global {
  interface Window {
    suiteleaf?: DesktopBridge;
  }
}
export const library = new Library();
export function download(
  name: string,
  text: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const browserStorage: StorageAdapter = {
  list: () => library.list(),
  get: (id) => library.get(id),
  reload: (id) => library.get(id),
  save: (record) => library.save(record),
  remove: (id) => library.remove(id),
  async open() {
    return null;
  },
  async saveAs(record) {
    if (
      record.file.kind === "slide" ||
      record.file.kind === "sheet" ||
      record.file.kind === "doc"
    ) {
      let bytes: Uint8Array;
      if (record.file.kind === "slide") {
        const { mediaBlobStore } = await import("./media-blob-store");
        const externalBlobs = await mediaBlobStore.collectFor(
          record.file.content,
          record.drive ? { itemId: record.drive.itemId } : undefined,
        );
        bytes = await packSlidePackageZip(record.file, { externalBlobs });
      } else {
        bytes = await serializeFileBytes(record.file);
      }
      const zipMime =
        record.file.kind === "slide"
          ? "application/vnd.suiteleaf.slides+zip"
          : record.file.kind === "sheet"
            ? "application/vnd.suiteleaf.sheet+zip"
            : "application/vnd.suiteleaf.doc+zip";
      await exportBinary(nativeFilename(record.file), bytes, zipMime);
      return record;
    }
    download(
      nativeFilename(record.file),
      serializeFile(record.file),
      mimeFor(record.file.kind),
    );
    return record;
  },
};
export const storage: StorageAdapter = (typeof window !== "undefined" ? window.suiteleaf : undefined) ?? browserStorage;
/**
 * Export a file: a download in the browser (resolves to undefined); on the
 * desktop, the saved path, or null if the person cancelled the save dialog.
 */
export async function exportText(
  name: string,
  text: string,
  type = "text/plain",
) {
  if (window.suiteleaf) return window.suiteleaf.exportFile(name, text);
  download(name, text, type);
}
export async function printDocument(title?: string) {
  if (window.suiteleaf) await window.suiteleaf.print(title);
  else window.print();
}
/** Preserve write order without allowing one failed write to poison later retries. */
export class SaveQueue {
  private tail: Promise<unknown> = Promise.resolve();
  enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(work);
    // Holding `next` itself would keep its result alive as long as the queue.
    this.tail = next.then(() => {});
    this.tail.catch(() => {});
    return next;
  }
  async flush() {
    await this.tail;
  }
}

export async function exportBinary(
  name: string,
  bytes: Uint8Array,
  type: string,
) {
  if (window.suiteleaf) return window.suiteleaf.exportFile(name, bytes);
  else {
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
