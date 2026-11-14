#!/usr/bin/env node
// Runner for a single Zenodo10K pptx. Runs the pipeline and prints a status line.
// Usage: node scripts/zenodo-run-one.mjs <pptx-path> <output-dir>
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const [,, pptx, outDir] = process.argv;
const script = new URL("./zenodo-pipeline.py", import.meta.url).pathname;
const summary = execFileSync("python3", [script, pptx, outDir], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
writeFileSync(`${outDir}/summary.txt`, summary.trimEnd() + "\n");
process.stdout.write(summary.trimEnd() + "\n");
