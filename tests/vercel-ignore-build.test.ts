import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error Deployment script is plain ESM.
import { affectsCloud, ignoreBuild } from "../scripts/vercel-ignore-build.mjs";

describe("cloud build inputs", () => {
  it("compares all commits since deployment and skips a subsequent docs-only change", () => {
    const repo = mkdtempSync(join(tmpdir(), "suiteleaf-build-inputs-"));
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    const commit = () => {
      git("add", ".");
      git(
        "-c",
        "user.name=Tests",
        "-c",
        "user.email=tests@example.test",
        "commit",
        "-m",
        "fixture",
      );
      return git("rev-parse", "HEAD");
    };
    const check = (previous: string) =>
      spawnSync(
        process.execPath,
        [resolve("scripts/vercel-ignore-build.mjs")],
        {
          cwd: repo,
          env: {
            ...process.env,
            VERCEL_GIT_PREVIOUS_SHA: previous,
            VERCEL_FORCE_BUILD: "0",
          },
          encoding: "utf8",
        },
      ).status;
    try {
      git("init");
      writeFileSync(join(repo, "README.md"), "initial");
      const initial = commit();
      writeFileSync(join(repo, "Dockerfile.vercel"), "changed runtime");
      const runtime = commit();
      writeFileSync(join(repo, "README.md"), "docs only");
      commit();
      expect(check(initial)).toBe(1);
      expect(check(runtime)).toBe(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
  it.each([
    "docs/guide.md",
    "README.md",
    "tests/ui/drive.test.tsx",
    "apps/desktop/src/main.ts",
    ".github/workflows/pages.yml",
  ])("skips non-runtime change %s", (path) => {
    expect(affectsCloud(path)).toBe(false);
  });
  it.each([
    "apps/web/src/App.tsx",
    "crates/suitedb/src/lib.rs",
    "apps/desktop/package.json",
    "Dockerfile.vercel",
    "vercel.json",
    "package-lock.json",
    "scripts/new-build-step.mjs",
    "new-input",
  ])("builds cloud or unknown input %s", (path) => {
    expect(affectsCloud(path)).toBe(true);
  });
  it("builds first deployments, missing history and explicit forced builds", () => {
    expect(ignoreBuild({})).toBe(false);
    expect(ignoreBuild({ VERCEL_GIT_PREVIOUS_SHA: "invalid" })).toBe(false);
    expect(ignoreBuild({ VERCEL_GIT_PREVIOUS_SHA: "0".repeat(40) })).toBe(
      false,
    );
    expect(
      ignoreBuild({
        VERCEL_FORCE_BUILD: "1",
        VERCEL_GIT_PREVIOUS_SHA: "a".repeat(40),
      }),
    ).toBe(false);
  });
});
