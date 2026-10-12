import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { describe, it } from "vitest";
import type { BetterAuthOptions } from "better-auth";
import {
  authFlowTestSuite,
  caseInsensitiveTestSuite,
  normalTestSuite,
  testAdapter,
} from "@better-auth/test-utils/adapter";
import { suitedbAdapter } from "../src/adapter";
import {
  AUTH_SCHEMA_VERSION,
  suitedbTables,
  type TableDef,
} from "../src/schema";

const binary = new URL("../../../target/debug/suiteleaf-node", import.meta.url)
  .pathname;
const token = "adapter-test-token";
let node: ChildProcess | undefined;
let internalUrl = "";
const dir = mkdtempSync(join(tmpdir(), "suitedb-adapter-"));
const tables = new Map<string, TableDef>();

/** Like SQL migrations, each run only adds tables and columns: the node
 * restarts on the same database with the union of every schema so far. */
async function migrate(options: BetterAuthOptions) {
  for (const table of suitedbTables(options)) {
    const known = tables.get(table.name);
    if (!known) {
      tables.set(table.name, table);
      continue;
    }
    for (const column of table.columns)
      if (!known.columns.some((c) => c.name === column.name))
        known.columns.push(column);
    known.unique = [...new Set([...known.unique, ...table.unique])];
    known.indexes = [...new Set([...known.indexes, ...table.indexes])];
  }
  node?.kill();
  await new Promise((resolve) =>
    node ? node.once("exit", resolve) : resolve(0),
  );
  const schema = join(dir, "auth-schema.json");
  writeFileSync(
    schema,
    JSON.stringify({
      version: AUTH_SCHEMA_VERSION,
      tables: [...tables.values()],
    }),
  );
  const child = spawn(
    binary,
    [
      "run",
      "--init",
      "--no-auth",
      "--data-dir",
      dir,
      "--http",
      "127.0.0.1:0",
      "--listen",
      "/ip4/127.0.0.1/tcp/0",
      "--auth-schema",
      schema,
    ],
    {
      env: {
        ...process.env,
        SUITELEAF_INTERNAL_TOKEN: token,
        RUST_LOG: "warn",
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  node = child;
  internalUrl = await new Promise<string>((resolve, reject) => {
    child.once("exit", (code) => reject(new Error(`node exited (${code})`)));
    createInterface({ input: child.stdout! }).on("line", (line) => {
      if (line.startsWith("SUITELEAF_NODE_READY "))
        resolve(JSON.parse(line.slice(21)).internal);
    });
  });
}

if (existsSync(binary)) {
  const { execute } = await testAdapter({
    adapter: () => suitedbAdapter({ url: () => internalUrl, token }),
    runMigrations: migrate,
    tests: [normalTestSuite(), caseInsensitiveTestSuite(), authFlowTestSuite()],
    onFinish: () => {
      node?.kill();
    },
  });
  execute();
} else {
  describe("SuiteDB better-auth adapter", () => {
    it.skip("needs `cargo build -p suiteleaf-node`", () => {});
  });
}
