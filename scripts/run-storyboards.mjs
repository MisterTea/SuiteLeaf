#!/usr/bin/env node
/**
 * Run SuiteLeaf storyboards and produce MP4 recordings.
 *
 * Targets:
 *   - desktop: Standard desktop storyboards (project: "storyboards")
 *   - marp (or desktop+marp): Desktop MARP presentations (project: "marp")
 *   - mobile: Mobile phone storyboards, skipping MARP (project: "mobile")
 *   - all (default): Runs desktop, desktop+MARP, and mobile sequentially
 *
 * Usage:
 *   node scripts/run-storyboards.mjs [target] [--grep <regex>]
 *   npm run storyboards:all
 *   npm run storyboards:marp
 *   npm run storyboards:mobile
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const videosDir = join(root, "storyboards", "videos");

// Parse arguments
const args = process.argv.slice(2);
let target = "all";
const passthrough = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    console.log(`
SuiteLeaf Storyboard Runner
Runs storyboards and produces MP4 recordings.

Usage:
  node scripts/run-storyboards.mjs [target] [options]

Targets:
  all             Run desktop, desktop+MARP, and mobile (default)
  desktop         Run standard desktop storyboards
  marp            Run desktop MARP presentation storyboards
  desktop+marp    Alias for marp
  mobile          Run mobile phone storyboards (skipping MARP)

Options:
  --grep <pattern>    Filter tests matching pattern
  --slowmo <ms>       Slow-motion delay in ms (default: 60)
  --port <port>       Port for local static server (default: 4180)
`);
    process.exit(0);
  } else if (["all", "desktop", "marp", "desktop+marp", "mobile"].includes(arg.toLowerCase())) {
    target = arg.toLowerCase() === "desktop+marp" ? "marp" : arg.toLowerCase();
  } else {
    passthrough.push(arg);
  }
}

// 1. Verify ffmpeg is available
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  console.error("❌ ffmpeg not found on PATH. ffmpeg is required to encode storyboards into MP4s.");
  process.exit(1);
}

// 2. Ensure web build exists
const webDist = join(root, "apps", "web", "dist");
if (!existsSync(webDist)) {
  console.log("📦 apps/web/dist not found. Running npm run build:web...");
  const build = spawnSync("npm", ["run", "build:web"], { cwd: root, stdio: "inherit", shell: true });
  if (build.status !== 0) {
    console.error("❌ Failed to build web bundle.");
    process.exit(1);
  }
}

// 3. Determine project runs
const runs = [];
if (target === "all" || target === "desktop") {
  runs.push({ name: "Desktop", project: "storyboards" });
}
if (target === "all" || target === "marp") {
  runs.push({ name: "Desktop+MARP", project: "marp" });
}
if (target === "all" || target === "mobile") {
  runs.push({ name: "Mobile", project: "mobile" });
}

console.log(`🎬 Running SuiteLeaf Storyboards [target: ${target}]`);
console.log(`📹 Video output directory: ${videosDir}\n`);

const results = [];
let overallFailed = false;

for (const run of runs) {
  console.log(`────────────────────────────────────────────────────────────`);
  console.log(`▶ Starting ${run.name} Storyboards (Project: ${run.project})`);
  console.log(`────────────────────────────────────────────────────────────`);

  const cmdArgs = [
    "playwright",
    "test",
    "--config",
    "playwright.storyboards.config.ts",
    `--project=${run.project}`,
    ...passthrough,
  ];

  const startTime = Date.now();
  const res = spawnSync("npx", cmdArgs, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, STORYBOARD_PORT: process.env.STORYBOARD_PORT || "4180" },
  });

  const duration = Math.round((Date.now() - startTime) / 1000);
  const passed = res.status === 0;
  if (!passed) overallFailed = true;

  results.push({
    name: run.name,
    project: run.project,
    passed,
    duration,
  });
}

// 4. Scan and report generated MP4s
function getMp4s(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const item of readdirSync(dir)) {
    const full = join(dir, item);
    const st = statSync(full);
    if (st.isDirectory()) {
      files.push(...getMp4s(full, prefix ? `${prefix}/${item}` : item));
    } else if (item.endsWith(".mp4")) {
      files.push({
        relPath: prefix ? `${prefix}/${item}` : item,
        fullPath: full,
        sizeKb: Math.round(st.size / 1024),
        mtime: st.mtime,
      });
    }
  }
  return files;
}

const allMp4s = getMp4s(videosDir);

console.log("\n============================================================");
console.log("                     STORYBOARD SUMMARY                     ");
console.log("============================================================");

for (const res of results) {
  const icon = res.passed ? "✅" : "❌";
  console.log(`  ${icon} ${res.name.padEnd(16)} [${res.project}] - ${res.passed ? "PASSED" : "FAILED"} (${res.duration}s)`);
}

console.log("\n📹 Produced MP4 Recordings:");
if (allMp4s.length === 0) {
  console.log("  (No MP4 files found in storyboards/videos)");
} else {
  // Sort newest first
  allMp4s.sort((a, b) => b.mtime - a.mtime);
  for (const video of allMp4s.slice(0, 20)) {
    console.log(`  • ${video.relPath.padEnd(45)} (${video.sizeKb} KB)`);
  }
  if (allMp4s.length > 20) {
    console.log(`  ... and ${allMp4s.length - 20} older recordings`);
  }
}
console.log("============================================================\n");

process.exit(overallFailed ? 1 : 0);
