import { readFile, writeFile, mkdir } from "node:fs/promises";
const primary = "datasets/validation/office-final-results";
const sources = [
  primary,
  "datasets/validation/office-rechecked",
  "datasets/validation/office-memory-rechecked",
];
const records = new Map();
for (const source of sources) {
  for (const line of (await readFile(`${source}/results.jsonl`, "utf8"))
    .trim()
    .split("\n")) {
    const r = JSON.parse(line);
    records.set(r.path, r);
  }
}
const all = [...records.values()].sort((a, b) => a.path.localeCompare(b.path));
const expected = (await readFile("datasets/inventory.jsonl", "utf8"))
  .trim()
  .split("\n")
  .map(JSON.parse)
  .filter((r) => ["docx", "xlsx"].includes(r.format));
if (
  expected.some((r) => !records.has(r.path)) ||
  all.length !== expected.length
)
  throw new Error("The corpus report does not cover every DOCX/XLSX input.");
const count = (rows) => ({
  tested: rows.length,
  imported: rows.filter((r) => r.outcome === "imported").length,
  encryptedOrInvalid: rows.filter((r) => r.expectedRejection).length,
  capacityLimited: rows.filter((r) => r.capacityRejection).length,
  unexpectedFailures: rows.filter(
    (r) =>
      r.outcome !== "imported" && !r.expectedRejection && !r.capacityRejection,
  ).length,
});
const summary = {
  generatedAt: new Date().toISOString(),
  scope:
    "All inventoried DOCX/XLSX files; every original imported or explicitly rejected through the shared converter",
  ...count(all),
  formats: Object.fromEntries(
    ["docx", "xlsx"].map((format) => [
      format,
      count(all.filter((r) => r.format === format)),
    ]),
  ),
  warnings:
    "Import success and native round-trip validity do not establish pixel-perfect Word/Excel fidelity. Import compatibility notes describe simplified or unsupported features.",
  sourceHashesVerified: all.filter((r) => r.sha256).length,
  converterRevisions: [...new Set(all.map((r) => r.converterRevision))],
  rechecks:
    "Corrupt secondary ZIP part and two heap-limit failures were rechecked with bounded diagnostics; the per-file records retain the snapshot revision used for each result.",
  limits: all
    .filter((r) => r.capacityRejection)
    .map((r) => ({ path: r.path, code: r.code, reason: r.error })),
  unexpected: all.filter(
    (r) =>
      r.outcome !== "imported" && !r.expectedRejection && !r.capacityRejection,
  ),
  perFileReport:
    "datasets/validation/office-final-results/complete-results.jsonl",
};
await writeFile(
  `${primary}/complete-results.jsonl`,
  all.map((r) => JSON.stringify(r)).join("\n") + "\n",
);
await writeFile(
  `${primary}/complete-summary.json`,
  JSON.stringify(summary, null, 2) + "\n",
);
await mkdir("docs", { recursive: true });
await writeFile(
  "docs/office-validation-summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
if (summary.unexpectedFailures) process.exitCode = 1;
