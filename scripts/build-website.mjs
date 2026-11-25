#!/usr/bin/env node
/**
 * Builds the SuiteLeaf GitHub Pages website into website/dist/.
 *
 * - Copies static HTML, CSS, JS, JSON, and WebVTT captions from website/
 * - Copies SuiteLeaf icons from apps/web/public/
 * - Muxes each storyboard MP4 with its neural voiceover MP3 using ffmpeg (-c:v copy)
 * - Muxes the front-page account-setup.mp4 walkthrough with its dedicated narration
 * - Copies AI agent storyboard MP4s for side-by-side playback on features.html
 * - Optionally copies apps/web/dist/ into website/dist/demo/ when present
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { cpus } from "node:os";

const ROOT = resolve(import.meta.dirname, "..");
const WEBSITE_DIR = join(ROOT, "website");
const DIST_DIR = join(WEBSITE_DIR, "dist");
const VIDEOS_SRC = join(ROOT, "storyboards", "videos");
const NARRATION_DIR = join(WEBSITE_DIR, "narration");
const CATALOG_PATH = join(WEBSITE_DIR, "data", "storyboards.json");
const WEB_DIST = join(ROOT, "apps", "web", "dist");

function runFfmpeg(args) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
    proc.on("error", reject);
  });
}

async function muxVideo(videoIn, audioIn, videoOut) {
  if (!existsSync(audioIn)) {
    cpSync(videoIn, videoOut);
    return;
  }
  await runFfmpeg([
    "-y",
    "-i",
    videoIn,
    "-i",
    audioIn,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-movflags",
    "+faststart",
    videoOut,
  ]);
}

async function runPool(tasks, concurrency) {
  let idx = 0;
  let done = 0;
  const total = tasks.length;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < total) {
      const current = idx++;
      await tasks[current]();
      done++;
      if (done % 25 === 0 || done === total) {
        console.log(`Muxed ${done}/${total} videos...`);
      }
    }
  });
  await Promise.all(workers);
}

async function main() {
  if (!existsSync(CATALOG_PATH)) {
    throw new Error(`Missing ${CATALOG_PATH}. Run scripts/generate-website-narration.py first.`);
  }

  rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(join(DIST_DIR, "assets"), { recursive: true });
  mkdirSync(join(DIST_DIR, "data"), { recursive: true });
  mkdirSync(join(DIST_DIR, "narration"), { recursive: true });
  mkdirSync(join(DIST_DIR, "videos"), { recursive: true });

  // 1. Copy HTML pages
  for (const page of ["index.html", "features.html", "privacy.html", "terms.html"]) {
    cpSync(join(WEBSITE_DIR, page), join(DIST_DIR, page));
  }

  // 2. Copy static assets, icons, data, and VTT captions
  cpSync(join(WEBSITE_DIR, "assets"), join(DIST_DIR, "assets"), { recursive: true });
  cpSync(join(WEBSITE_DIR, "data"), join(DIST_DIR, "data"), { recursive: true });

  for (const icon of ["icon.svg", "icon-192.png", "apple-touch-icon.png"]) {
    const src = join(ROOT, "apps", "web", "public", icon);
    if (existsSync(src)) {
      cpSync(src, join(DIST_DIR, "assets", icon));
    }
  }

  // Copy VTT captions (skip raw MP3s since they are muxed into MP4s)
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
  const vttFiles = ["account-setup.vtt", ...catalog.storyboards.map((s) => `${s.id}.vtt`)];
  for (const vtt of vttFiles) {
    const src = join(NARRATION_DIR, vtt);
    if (existsSync(src)) {
      cpSync(src, join(DIST_DIR, "narration", vtt));
    }
  }

  // 3. Mux all narrated videos + copy AI videos
  const tasks = [];

  // Front-page account setup walkthrough
  tasks.push(() =>
    muxVideo(
      join(VIDEOS_SRC, "22-connect-to-your-team-server.mp4"),
      join(NARRATION_DIR, "account-setup.mp3"),
      join(DIST_DIR, "videos", "account-setup.mp4"),
    ),
  );

  for (const sb of catalog.storyboards) {
    const srcVid = join(VIDEOS_SRC, sb.videoFile);
    const audio = join(NARRATION_DIR, `${sb.id}.mp3`);
    const outVid = join(DIST_DIR, "videos", sb.videoFile);
    if (existsSync(srcVid)) {
      tasks.push(() => muxVideo(srcVid, audio, outVid));
    }

    if (sb.aiVideoFile) {
      const aiSrc = join(VIDEOS_SRC, sb.aiVideoFile);
      const aiOut = join(DIST_DIR, "videos", sb.aiVideoFile);
      if (existsSync(aiSrc)) {
        tasks.push(() => muxVideo(aiSrc, audio, aiOut));
      }
    }
  }

  const concurrency = Math.max(2, Math.min(8, cpus().length));
  console.log(`Building SuiteLeaf website with ${tasks.length} narrated videos (concurrency=${concurrency})...`);
  await runPool(tasks, concurrency);

  // 4. Bundle live web demo into website/dist/demo/ if built
  if (existsSync(WEB_DIST)) {
    console.log("Copying live demo from apps/web/dist into website/dist/demo...");
    cpSync(WEB_DIST, join(DIST_DIR, "demo"), { recursive: true });
  }

  console.log("SuiteLeaf website build complete:", DIST_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
