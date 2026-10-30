import { parentPort, workerData } from "node:worker_threads";
import { packSharedMedia } from "@suiteleaf/core";
import { openOfficeFile } from "@suiteleaf/core/open-office";
try {
  const file = await openOfficeFile(
    new Uint8Array(workerData.bytes),
    workerData.format,
    workerData.name,
    { password: workerData.password },
  );
  parentPort!.postMessage({ ok: true, file: packSharedMedia(file) });
} catch (e) {
  parentPort!.postMessage({
    ok: false,
    error: e instanceof Error ? e.message : String(e),
  });
}
