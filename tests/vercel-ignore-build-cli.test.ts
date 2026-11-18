import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("cloud build command", () => {
  it.each([
    ["preview", "29", false],
    ["production", "29", true],
    ["preview", "", true],
    ["preview", "invalid", true],
  ])("keeps exact-commit PR previews for %s / %s", async (environment, pr, ignored) => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: "tests/fixture.test.ts\0" } as never);
    const { ignoreBuild } = await import("../scripts/vercel-ignore-build.mjs");
    expect(ignoreBuild({
      VERCEL_ENV: environment,
      VERCEL_GIT_PULL_REQUEST_ID: pr,
      VERCEL_GIT_PREVIOUS_SHA: "a".repeat(40),
    })).toBe(ignored);
  });
  it.each([
    ["docs/guide.md\0", 0],
    ["packages/supermail\0", 1],
    [".gitmodules\0", 1],
    ["\0", 0],
  ])("handles git output %s", async (stdout, expected) => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout } as never);
    vi.stubEnv("VERCEL_GIT_PREVIOUS_SHA", "a".repeat(40));
    vi.stubEnv("VERCEL_FORCE_BUILD", "0");
    const fakeProcess = {
      ...process,
      argv: [process.execPath, resolve("scripts/vercel-ignore-build.mjs")],
      exitCode: undefined,
    };
    vi.stubGlobal("process", fakeProcess);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await import("../scripts/vercel-ignore-build.mjs");
    expect(fakeProcess.exitCode).toBe(expected);
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", "-z", "a".repeat(40), "HEAD", "--"],
      { encoding: "utf8" },
    );
  });
});
