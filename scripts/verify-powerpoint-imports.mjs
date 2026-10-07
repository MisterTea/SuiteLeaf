import * as fs from "node:fs";
import * as path from "node:path";
import { parsePowerPoint, parseFile, serializeFile } from "../packages/core/src/index.ts";

const EXTENSIONS = new Set([".pptx", ".ppt", ".ppsx", ".pptm", ".potx", ".ppsm"]);

function collectFiles(dir) {
  const result = [];
  function walk(current) {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== "node_modules" && ent.name !== ".git" && ent.name !== ".venv") {
          walk(full);
        }
      } else {
        const ext = path.extname(ent.name).toLowerCase();
        if (EXTENSIONS.has(ext)) {
          result.push(full);
        }
      }
    }
  }
  walk(dir);
  return result;
}

async function main() {
  console.log("Scanning datasets for all PowerPoint files...");
  const allFiles = collectFiles("datasets");
  console.log(`Found ${allFiles.length} total PowerPoint files across datasets.`);

  // Group by dataset and format
  const byCategory = new Map();
  for (const f of allFiles) {
    const parts = f.split(path.sep);
    const dataset = parts[1] || "unknown";
    const subset = parts[3] || path.extname(f).slice(1);
    const key = `${dataset}/${subset}`;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(f);
  }

  console.log(`\nDataset categories identified:`);
  for (const [cat, files] of byCategory.entries()) {
    console.log(` - ${cat}: ${files.length} files`);
  }

  console.log(`\nTesting import across all categories...`);
  let totalTested = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  const failures = [];

  // Test up to 15 files from each category to ensure 100% category coverage
  for (const files of byCategory.values()) {
    const toTest = files.slice(0, 15);
    for (const file of toTest) {
      totalTested++;
      try {
        const buf = fs.readFileSync(file);
        const res = await parsePowerPoint(buf, path.basename(file));
        if (!res || res.kind !== "slide") {
          throw new Error("Returned invalid file kind");
        }
        // Roundtrip check against core zod schema
        const serialized = serializeFile(res);
        const parsed = parseFile(serialized);
        if (!parsed || parsed.kind !== "slide") {
          throw new Error("Failed schema re-validation");
        }
        totalPassed++;
      } catch (err) {
        totalFailed++;
        failures.push({ file, error: err.message });
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`Summary of PowerPoint Import Verification:`);
  console.log(`Total files tested: ${totalTested}`);
  console.log(`Total passed:       ${totalPassed}`);
  console.log(`Total failed:       ${totalFailed}`);
  console.log(`Success rate:       ${((totalPassed / totalTested) * 100).toFixed(1)}%`);
  console.log(`========================================`);

  if (failures.length > 0) {
    console.error("Failures:");
    for (const f of failures) {
      console.error(` - ${f.file}: ${f.error}`);
    }
    process.exit(1);
  } else {
    console.log("All tested PowerPoint files imported correctly!");
  }
}

main().catch((err) => {
  console.error("Verification script error:", err);
  process.exit(1);
});
