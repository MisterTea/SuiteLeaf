import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkSecrets,
  credentialLines,
  runSecretCheck,
} from "../scripts/check-secrets.mjs";

const roots: string[] = [];
const password = "npg_" + "aVeryFakeTestPassword12345";
const connection =
  "postgres" +
  "ql://owner:fake-test-password@ep-example.neon.tech/db?sslmode=require";
function repository() {
  const root = mkdtempSync(join(tmpdir(), "suiteleaf-secret-check-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("Neon credential guard", () => {
  it("finds password literals and credentialed Neon URLs without returning values", () => {
    expect(
      credentialLines(
        `safe\nconst password = "${password}";\r\nconst url = "${connection}";`,
      ),
    ).toEqual([2, 3]);
    expect(credentialLines("const url = process.env.DATABASE_URL;")).toEqual(
      [],
    );
    expect(
      credentialLines("postgres" + "://owner:password@ep-example.neon.tech/db"),
    ).toEqual([1]);
    expect(
      credentialLines("postgres" + "://owner@ep-example.neon.tech/db"),
    ).toEqual([]);
    expect(credentialLines("postgres" + "://user:pass@localhost/db")).toEqual(
      [],
    );
    expect(
      credentialLines("postgres" + "://owner:${password}@${host}/db"),
    ).toEqual([]);
    expect(credentialLines("postgres" + "://bad%zz/db")).toEqual([]);
    expect(credentialLines("postgres" + "://owner:password@[::bad/db")).toEqual(
      [],
    );
  });
  it("checks tracked and new files, skips ignored env and binary files, and tolerates deletions", () => {
    const root = repository();
    writeFileSync(join(root, ".gitignore"), ".env*\n");
    writeFileSync(join(root, ".env.local"), `DATABASE_URL=${connection}`);
    writeFileSync(join(root, "source.mjs"), `const url = "${connection}";`);
    writeFileSync(
      join(root, "new-script.mjs"),
      `const password = "${password}";`,
    );
    writeFileSync(join(root, "gone.mjs"), "safe");
    writeFileSync(join(root, "binary.bin"), Buffer.from(`\0${password}`));
    execFileSync("git", ["add", "source.mjs", "gone.mjs"], { cwd: root });
    rmSync(join(root, "gone.mjs"));
    expect(checkSecrets(root).sort()).toEqual([
      "new-script.mjs:1",
      "source.mjs:1",
    ]);
    execFileSync("git", ["add", "-f", ".env.local"], { cwd: root });
    expect(checkSecrets(root)).toContain(".env.local:1");
  });
  it("ignores tracked directory paths and reports file-read failures", () => {
    const root = repository();
    writeFileSync(join(root, "folder"), "safe");
    execFileSync("git", ["add", "folder"], { cwd: root });
    rmSync(join(root, "folder"));
    mkdirSync(join(root, "folder"));
    expect(checkSecrets(root)).toEqual([]);
    expect(() => checkSecrets(join(root, "missing"))).toThrow();
  });
  it("fails CI without echoing credentials and succeeds when source uses environment variables", () => {
    const root = repository();
    const script = resolve("scripts/check-secrets.mjs");
    writeFileSync(join(root, "unsafe.mjs"), `const url = "${connection}";`);
    const output = { error: vi.fn(), log: vi.fn() };
    expect(runSecretCheck(root, output)).toBe(1);
    expect(output.error).toHaveBeenLastCalledWith("unsafe.mjs:1");
    const unsafe = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
    });
    expect(unsafe.status).toBe(1);
    expect(unsafe.stderr).toContain("unsafe.mjs:1");
    expect(unsafe.stderr).not.toContain(connection);
    expect(unsafe.stderr).not.toContain("fake-test-password");
    writeFileSync(
      join(root, "unsafe.mjs"),
      "const url = process.env.DATABASE_URL;",
    );
    expect(runSecretCheck(root, output)).toBe(0);
    expect(output.log).toHaveBeenCalledWith(
      "No hardcoded Neon credentials found in repository files.",
    );
    const safe = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
    });
    expect(safe.status).toBe(0);
    expect(safe.stdout).toContain("No hardcoded Neon credentials");
  });
});
