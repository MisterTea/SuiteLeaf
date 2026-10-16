import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { converterRevision } from "./office-roundtrip-report.mjs";

const root = resolve(import.meta.dirname, "..");
const { roundTripOffice } = await import(
  pathToFileURL(resolve(root, "packages/core/src/roundtrip.ts")).href
);
const revision = await converterRevision(root);
const list = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const pathsFlag = process.argv.find((arg) => arg.startsWith("--paths="));
const paths = pathsFlag
  ? JSON.parse(await readFile(pathsFlag.slice("--paths=".length), "utf8"))
  : list;
if (!Array.isArray(paths) || paths.length === 0 || paths.length > 10)
  throw new Error("Pass 1 to 10 inventory paths.");
const results = [];
for (const path of paths) {
  const row = typeof path === "string" ? { path, format: path.split(".").pop() } : path;
  try {
    const bytes = await readFile(resolve(root, "datasets", row.path));
    const result = await roundTripOffice(bytes, row.format, row.path);
    results.push({ ...result, converterRevision: revision });
  } catch (error) {
    results.push({
      path: row.path,
      sha256: "",
      format: row.format,
      converterRevision: revision,
      outcome: "rejected",
      expectedRejection: false,
      code: "conversion-error",
      differences: [],
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
process.stdout.write(JSON.stringify(results));
