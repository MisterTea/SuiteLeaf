import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
if (process.argv[2]) process.loadEnvFile(process.argv[2]);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const binary =
  process.env.SUITELEAF_NODE_BINARY ??
  resolve(
    `target/debug/suiteleaf-node${process.platform === "win32" ? ".exe" : ""}`,
  );
const result = spawnSync(binary, ["migrate-cloud"], {
  stdio: "inherit",
  env: process.env,
});
process.exitCode = result.status ?? 1;
