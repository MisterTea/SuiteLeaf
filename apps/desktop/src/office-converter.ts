import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { unpackSharedMedia, type SuiteFile } from "@suiteleaf/core";

/** Pictures are shared, but a photo-heavy deck still needs room to parse. */
export const OFFICE_CONVERTER_HEAP_MB = 4096;

/** Keep individual conversions bounded and release the parser between files. */
export function convertOffice(
  bytes: Uint8Array,
  format: string,
  name: string,
): Promise<SuiteFile> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(import.meta.dirname, "office-worker.js"), {
      workerData: { bytes, format, name },
      resourceLimits: { maxOldGenerationSizeMb: OFFICE_CONVERTER_HEAP_MB },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Office import exceeded five minutes."));
    }, 300000);
    worker.once("message", (result) => {
      clearTimeout(timer);
      void worker.terminate();
      if (result.ok) resolve(unpackSharedMedia(result.file));
      else reject(new Error(result.error));
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", () => {
      clearTimeout(timer);
      reject(
        new Error("The Office converter exited before completing the import."),
      );
    });
  });
}
