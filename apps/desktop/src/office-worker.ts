import { parentPort, workerData } from "node:worker_threads";
import { importOffice } from "@suiteleaf/core/office";
try {
  const result = await importOffice(
    new Uint8Array(workerData.bytes),
    workerData.format,
    workerData.name,
  );
  parentPort!.postMessage({ ok: true, file: result.file });
} catch (e) {
  parentPort!.postMessage({
    ok: false,
    error: e instanceof Error ? e.message : String(e),
  });
}
