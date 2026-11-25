import type { ExternalMediaBlobs } from "@suiteleaf/core";
import { OfficeImportError } from "@suiteleaf/core/office";
import { openOfficeFile } from "@suiteleaf/core/open-office";
self.onmessage = async (
  event: MessageEvent<{
    bytes: ArrayBuffer;
    format: string;
    name: string;
    password?: string;
    externalizeMedia?: boolean;
  }>,
) => {
  try {
    self.postMessage({ started: true });
    const mediaBlobs: ExternalMediaBlobs | undefined = event.data.externalizeMedia
      ? new Map()
      : undefined;
    const file = await openOfficeFile(
      event.data.bytes,
      event.data.format,
      event.data.name,
      {
        password: event.data.password,
        onProgress: (completed, total) => self.postMessage({ progress: { completed, total } }),
        mediaBlobs,
      },
    );
    if (mediaBlobs && mediaBlobs.size > 0) {
      const seen = new Set<ArrayBuffer>();
      const transferables: Transferable[] = [];
      const payload = new Map<string, { mime: string; bytes: Uint8Array }>();
      for (const [hash, entry] of mediaBlobs) {
        let bytes = entry.bytes;
        const isWholeBuffer =
          bytes.buffer instanceof ArrayBuffer &&
          bytes.byteOffset === 0 &&
          bytes.byteLength === bytes.buffer.byteLength;
        if (!isWholeBuffer || seen.has(bytes.buffer as ArrayBuffer)) {
          bytes = new Uint8Array(bytes);
        }
        seen.add(bytes.buffer as ArrayBuffer);
        transferables.push(bytes.buffer as ArrayBuffer);
        payload.set(hash, { mime: entry.mime, bytes });
      }
      self.postMessage({ ok: true, file, mediaBlobs: payload }, transferables);
    } else {
      self.postMessage({ ok: true, file });
    }
  } catch (e) {
    self.postMessage({
      ok: false,
      code: e instanceof OfficeImportError ? e.code : "conversion-failed",
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
