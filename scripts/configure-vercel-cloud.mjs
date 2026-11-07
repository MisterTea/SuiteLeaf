// Run from the linked checkout after reviewing the cloud implementation.
// Secret values travel only through stdin and ignored local files.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const file = resolve(".env.cloud.setup.local");
let setup;
if (existsSync(file)) setup = JSON.parse(readFileSync(file, "utf8"));
else {
  const binary = resolve(
    `target/debug/suiteleaf-node${process.platform === "win32" ? ".exe" : ""}`,
  );
  const generated = spawnSync(binary, ["setup-token"], { encoding: "utf8" });
  if (generated.status !== 0) throw new Error("Build the Rust backend first.");
  setup = {
    ...JSON.parse(generated.stdout),
    authSecret: randomBytes(32).toString("hex"),
  };
  writeFileSync(file, JSON.stringify(setup), { mode: 0o600 });
}
for (const [name, value] of Object.entries({
  SUITELEAF_CLOUD: "1",
  SUITELEAF_PUBLIC_URL: "https://suiteleaf.vercel.app",
  SUITELEAF_AUTH_SECRET: setup.authSecret,
  SUITELEAF_BOOTSTRAP_TOKEN_HASH: setup.hash,
  SUITELEAF_AI_GATEWAY_MODEL: "openai/gpt-5-mini",
})) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = [
    "--yes",
    "vercel@65.12.1",
    "env",
    "add",
    name,
    "--environment",
    "production",
    "--scope",
    "aquinas",
    "--project",
    "suiteleaf",
    "--force",
    "--yes",
    "--sensitive",
  ];
  const result = spawnSync(command, args, {
    input: value,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0)
    throw new Error(
      `Could not configure ${name}. Check Vercel project access.`,
    );
  console.log(`Configured ${name} for production.`);
}
console.log(
  "Administrator setup token is saved in .env.cloud.setup.local. Keep it private.",
);
