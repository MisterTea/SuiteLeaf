import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const source =
  process.env.SUITELEAF_OFFICE_CONVERTER ?? resolve("packages/core/src");
const { importOffice } = await import(
  pathToFileURL(`${source}/office.ts`).href
);
const { serializeFile, parseFile } = await import(
  pathToFileURL(`${source}/index.ts`).href
);
process.on("message", async (row) => {
  const start = performance.now();
  try {
    const bytes = await readFile(`datasets/${row.path}`);
    const result = await importOffice(
      bytes,
      row.format,
      row.path.split("/").pop(),
    );
    const native = serializeFile(result.file);
    const restored = parseFile(native);
    if (restored.kind !== result.file.kind)
      throw new Error("Native round trip changed file kind.");
    process.send({
      path: row.path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      format: row.format,
      sourceStatus: row.status,
      outcome: "imported",
      nativeBytes: Buffer.byteLength(native),
      durationMs: Math.round(performance.now() - start),
      ...result.report,
    });
  } catch (e) {
    process.send({
      path: row.path,
      format: row.format,
      sourceStatus: row.status,
      outcome: "rejected",
      code: e.code ?? "conversion-error",
      error: e.message,
      durationMs: Math.round(performance.now() - start),
    });
  }
  global.gc?.();
});
