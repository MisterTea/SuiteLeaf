import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_FILES = [
  "packages/core/src/roundtrip.ts",
  "packages/core/src/roundtrip-digest.ts",
  "packages/core/src/roundtrip-scan.ts",
  "packages/core/src/open-office.ts",
  "packages/core/src/foreign-import.ts",
  "packages/core/src/doc-binary.ts",
  "packages/core/src/docx-export.ts",
  "packages/core/src/xlsx-export.ts",
  "packages/core/src/pptx-export.ts",
  "packages/core/src/slide-motion.ts",
  "packages/core/src/word.ts",
  "packages/core/src/suggestions.ts",
  "packages/core/src/image-inline.ts",
  "packages/core/src/image-extent.ts",
  "packages/core/src/excel.ts",
  "packages/core/src/excel-images.ts",
  "packages/core/src/pptx.ts",
  "packages/core/src/office.ts",
];

export async function converterRevision(root = process.cwd()) {
  const hash = createHash("sha256");
  for (const file of SOURCE_FILES) hash.update(await readFile(resolve(root, file)));
  return hash.digest("hex").slice(0, 16);
}

export function parseReport(text) {
  const records = [];
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A crash can leave the last line truncated. That path stays unfinished.
    }
  }
  return records;
}

export function latestRecords(records) {
  const byPath = new Map();
  for (const record of records) if (record?.path) byPath.set(record.path, record);
  return [...byPath.values()];
}

export function finishedPaths(records, revision) {
  const done = new Set();
  for (const record of latestRecords(records)) {
    if (record.converterRevision === revision && record.sha256 && record.outcome)
      done.add(record.path);
  }
  return done;
}

export async function nextPaths(inventoryText, reportText, revision, limit = 10, start = 0) {
  const latest = new Map(latestRecords(parseReport(reportText)).map((record) => [record.path, record]));
  const paths = [];
  let index = 0;
  for (const line of inventoryText.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const position = index;
    index += 1;
    if (position < start) continue;
    const saved = latest.get(row.path);
    if (
      saved &&
      saved.converterRevision === revision &&
      saved.sha256 &&
      saved.sha256 === row.sha256 &&
      saved.outcome
    )
      continue;
    if (!row.path) continue;
    paths.push(row.path);
    if (paths.length >= limit) break;
  }
  return paths;
}

export function summarize(records, revision, inventoryCount) {
  const latest = latestRecords(records).filter(
    (record) => record.converterRevision === revision,
  );
  const features = new Map();
  const owners = { suiteleaf: 0, "third-party": 0, "model-limit": 0 };
  let match = 0;
  let diff = 0;
  let rejected = 0;
  let expectedRejection = 0;
  for (const record of latest) {
    if (record.outcome === "match") match += 1;
    else if (record.outcome === "diff") diff += 1;
    else rejected += 1;
    if (record.expectedRejection) expectedRejection += 1;
    for (const difference of record.differences ?? []) {
      const key = `${difference.owner}\t${difference.feature}`;
      features.set(key, (features.get(key) ?? 0) + 1);
      if (difference.owner in owners) owners[difference.owner] += 1;
    }
  }
  return {
    revision,
    finished: latest.length,
    unfinished: Math.max(0, inventoryCount - latest.length),
    match,
    diff,
    rejected,
    expectedRejection,
    owners,
    features: [...features.entries()]
      .map(([key, count]) => {
        const [owner, feature] = key.split("\t");
        return { feature, owner, count };
      })
      .sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature)),
  };
}

async function withLock(directory, work) {
  await mkdir(directory, { recursive: true });
  const lock = resolve(directory, "report.lock");
  try {
    await writeFile(lock, String(process.pid), { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const holder = Number(await readFile(lock, "utf8").catch(() => ""));
    let alive = false;
    if (holder) {
      try {
        process.kill(holder, 0);
        alive = true;
      } catch {
        alive = false;
      }
    }
    if (alive) throw new Error("Another round-trip report writer is already running.");
    await unlink(lock).catch(() => {});
    await writeFile(lock, String(process.pid), { flag: "wx" });
  }
  try {
    return await work();
  } finally {
    await unlink(lock).catch(() => {});
  }
}

export async function appendResults(directory, incoming, revision, inventoryCount) {
  return withLock(directory, async () => {
    const file = resolve(directory, "results.jsonl");
    let existing = "";
    try {
      existing = await readFile(file, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const lines = incoming.map((record) =>
      JSON.stringify({ ...record, converterRevision: revision }),
    );
    const prefix = existing.length && !existing.endsWith("\n") ? "\n" : "";
    if (lines.length) await appendFile(file, `${prefix}${lines.join("\n")}\n`);
    const records = parseReport(`${existing}${prefix}${lines.join("\n")}\n`);
    const summary = summarize(records, revision, inventoryCount);
    await writeFile(resolve(directory, "summary.json"), JSON.stringify(summary, null, 2));
    return summary;
  });
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const root = resolve(import.meta.dirname, "..");
  const directory = resolve(root, "datasets/validation/office-roundtrip");
  const revision = await converterRevision(root);
  const inventory = await readFile(resolve(root, "datasets/inventory.jsonl"), "utf8");
  const inventoryCount = inventory.split("\n").filter((line) => line.trim()).length;
  let report = "";
  try {
    report = await readFile(resolve(directory, "results.jsonl"), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const nextFlag = process.argv.indexOf("--next");
  if (nextFlag !== -1) {
    const limitArg = process.argv[nextFlag + 1];
    const limit = limitArg && !limitArg.startsWith("--") ? Number(limitArg) : 10;
    const startEq = process.argv.find((arg) => arg.startsWith("--start="));
    const startFlag = process.argv.indexOf("--start");
    const startArg = startFlag === -1 ? undefined : process.argv[startFlag + 1];
    const start = startEq
      ? Number(startEq.slice("--start=".length))
      : startArg && !startArg.startsWith("--")
        ? Number(startArg)
        : 0;
    process.stdout.write(
      JSON.stringify(await nextPaths(inventory, report, revision, limit, start)),
    );
  }
  const appendFlag = process.argv.find((arg) => arg.startsWith("--append="));
  if (appendFlag) {
    const incoming = JSON.parse(await readFile(appendFlag.slice("--append=".length), "utf8"));
    const summary = await appendResults(directory, incoming, revision, inventoryCount);
    process.stdout.write(JSON.stringify(summary));
  }
}
