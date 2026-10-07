import { readFile, mkdir, writeFile, cp, symlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { fork } from "node:child_process";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const args = process.argv.slice(2),
  limit =
    Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1]) ||
    Infinity;
const output =
  args.find((a) => a.startsWith("--output="))?.slice(9) ??
  "datasets/validation/office-imports";
const parallel = Math.max(
  1,
  Math.min(
    4,
    Number(args.find((a) => a.startsWith("--workers="))?.split("=")[1]) || 2,
  ),
);
let rows = (await readFile("datasets/inventory.jsonl", "utf8"))
  .trim()
  .split("\n")
  .map(JSON.parse)
  .filter((r) => ["docx", "xlsx"].includes(r.format));
const only = args.find((a) => a.startsWith("--paths="));
if (only) {
  const selected = new Set(JSON.parse(await readFile(only.slice(8), "utf8")));
  rows = rows.filter((r) => selected.has(r.path));
}
rows = rows.slice(0, limit);
await mkdir(output, { recursive: true });
const snapshot = resolve(output, ".converter");
await cp("packages/core/src", snapshot, { recursive: true });
await symlink(
  resolve("packages/core/node_modules"),
  `${snapshot}/node_modules`,
  "dir",
).catch((e) => {
  if (e.code !== "EEXIST") throw e;
});
const revision = createHash("sha256");
for (const p of [
  "office.ts",
  "word.ts",
  "excel.ts",
  "index.ts",
  "zip-inflater.ts",
])
  revision.update(await readFile(`${snapshot}/${p}`));
const converterRevision = revision.digest("hex");
const stream = createWriteStream(`${output}/results.jsonl`),
  results = [];
let cursor = 0,
  finished = 0;
const rejectionCodes = new Set([
  "encrypted",
  "wrong-format",
  "invalid-container",
  "missing-part",
  "invalid-xml",
  "unsafe-xml",
]);
function record(row, result) {
  result.converterRevision = converterRevision;
  result.expectedRejection =
    result.outcome === "rejected" && rejectionCodes.has(result.code);
  result.capacityRejection = [
    "input-limit",
    "expanded-limit",
    "content-limit",
    "cell-limit",
    "native-limit",
    "memory-limit",
  ].includes(result.code);
  if (result.outcome === "imported" && result.textPreserved === false)
    result.outcome = "text-audit-failed";
  if (result.sha256 && result.sha256 !== row.sha256)
    result.outcome = "source-hash-mismatch";
  results.push(result);
  stream.write(JSON.stringify(result) + "\n");
  finished++;
  if (finished % 100 === 0 || finished === rows.length)
    console.log(
      `${finished}/${rows.length}: ${results.filter((r) => r.outcome === "imported").length} imported, ${results.filter((r) => r.expectedRejection).length} encrypted/invalid, ${results.filter((r) => r.capacityRejection).length} capacity limits, ${results.filter((r) => r.outcome !== "imported" && !r.expectedRejection && !r.capacityRejection).length} unresolved`,
    );
}
async function worker() {
  let child,
    uses = 0,
    diagnostic = "";
  const stop = () => {
    child?.kill();
    child = undefined;
  };
  try {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      if (!child || !child.connected || child.exitCode !== null || uses >= 35) {
        stop();
        child = fork(resolve("scripts/office-corpus-worker.mjs"), [], {
          env: { ...process.env, SUITELEAF_OFFICE_CONVERTER: snapshot },
          execArgv: [
            "--import",
            "tsx",
            "--max-old-space-size=2048",
            "--expose-gc",
          ],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        });
        diagnostic = "";
        child.stderr.on("data", (chunk) => {
          diagnostic = (diagnostic + chunk.toString()).slice(0,16000);
        });
        uses = 0;
      }
      const target = child;
      const result = await new Promise((done) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          target.off("message", onMessage);
          target.off("exit", onExit);
          target.off("error", onError);
          done(value);
        };
        const failed = (error) => ({
          path: row.path,
          format: row.format,
          sourceStatus: row.status,
          outcome: "rejected",
          code: "worker-failed",
          error,
        });
        const onMessage = (value) => finish(value),
          onExit = (code, signal) =>
            finish({
              ...failed(`Converter worker exited (${code ?? signal}).`),
              code: /heap out of memory|Allocation failed/.test(diagnostic)
                ? "memory-limit"
                : "worker-failed",
            }),
          onError = (error) => finish(failed(error.message));
        const timeout = setTimeout(() => {
          finish({
            ...failed("Import exceeded 120 seconds."),
            code: "timeout",
          });
          stop();
        }, 120000);
        target.once("message", onMessage);
        target.once("exit", onExit);
        target.once("error", onError);
        target.send(row, (error) => {
          if (error) onError(error);
        });
      });
      uses++;
      if (target.exitCode !== null || !target.connected) stop();
      record(row, result);
    }
  } finally {
    stop();
  }
}
console.log(
  `Importing ${rows.length} DOCX/XLSX inputs through an immutable converter snapshot (${converterRevision.slice(0, 12)}) with ${parallel} isolated workers.`,
);
await Promise.all(Array.from({ length: parallel }, () => worker()));
await new Promise((done) => stream.end(done));
const counts = {};
for (const r of results) {
  const key =
    r.outcome === "imported"
      ? r.warnings?.length
        ? "imported_with_notes"
        : "imported"
      : r.expectedRejection
        ? "encrypted_or_invalid"
        : r.capacityRejection
          ? "capacity_limit"
          : "unresolved";
  counts[key] = (counts[key] ?? 0) + 1;
}
const failures = results.filter(
  (r) => r.outcome !== "imported" && !r.expectedRejection,
);
const summary = {
  generatedAt: new Date().toISOString(),
  converterRevision,
  scope:
    "Every selected DOCX/XLSX file in the dataset inventory; no sample substitution",
  total: rows.length,
  counts,
  formats: Object.fromEntries(
    ["docx", "xlsx"].map((f) => [
      f,
      {
        total: results.filter((r) => r.format === f).length,
        imported: results.filter(
          (r) => r.format === f && r.outcome === "imported",
        ).length,
        encryptedOrInvalid: results.filter(
          (r) => r.format === f && r.expectedRejection,
        ).length,
        capacityLimited: results.filter(
          (r) => r.format === f && r.capacityRejection,
        ).length,
        unresolved: results.filter(
          (r) =>
            r.format === f &&
            r.outcome !== "imported" &&
            !r.expectedRejection &&
            !r.capacityRejection,
        ).length,
      },
    ]),
  ),
  failures: failures.map((r) => ({
    path: r.path,
    code: r.code,
    error: r.error,
  })),
};
await writeFile(`${output}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary.counts));
if (failures.length) process.exitCode = 1;
