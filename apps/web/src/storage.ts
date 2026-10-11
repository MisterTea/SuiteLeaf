import { Library } from "./browser-library";
export { Library } from "./browser-library";
import {
  serializeFile,
  filename,
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
    download(filename(record.file.title), serializeFile(record.file));
    return record;
  },
};
export const storage: StorageAdapter = window.suiteleaf ?? browserStorage;
export async function exportText(
  name: string,
  text: string,
  type = "text/plain",
) {
  if (window.suiteleaf) await window.suiteleaf.exportFile(name, text);
  else download(name, text, type);
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
    this.tail = next;
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
  if (window.suiteleaf) await window.suiteleaf.exportFile(name, bytes);
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
