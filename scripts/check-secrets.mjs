// Scan repository files, including any force-added env files, but not ignored
// local files, Git history, or dependency trees.
// Report only paths and line numbers so CI logs cannot repeat a credential.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function credentialLines(source) {
  const lines = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const neonPassword = /\bnpg_[A-Za-z0-9]{12,}\b/.test(line);
    const databaseUrls = line.match(/postgres(?:ql)?:\/\/[^\s"'`]+/gi) ?? [];
    const neonUrl = databaseUrls.some((value) => {
      try {
        const url = new URL(value);
        return (
          url.hostname.endsWith(".neon.tech") &&
          !!url.password &&
          !/[${}<>]/.test(url.password)
        );
      } catch {
        return false;
      }
    });
    if (neonPassword || neonUrl) lines.push(index + 1);
  }
  return lines;
}

export function checkSecrets(root = process.cwd()) {
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);
  const findings = [];
  for (const path of new Set(paths)) {
    // Ignored developer env files are not returned by Git. A tracked env file
    // must still be scanned, including if someone force-adds an ignored file.
    let bytes;
    try {
      const absolute = resolve(root, path);
      if (!statSync(absolute).isFile()) continue;
      bytes = readFileSync(absolute);
    } catch (error) {
      if (error.code === "ENOENT") continue; // An unstaged deletion.
      throw error;
    }
    if (bytes.includes(0)) continue;
    for (const line of credentialLines(bytes.toString("utf8")))
      findings.push(`${path}:${line}`);
  }
  return findings;
}

export function runSecretCheck(root = process.cwd(), output = console) {
  const findings = checkSecrets(root);
  if (findings.length) {
    output.error(
      "Hardcoded Neon credentials found. Use server-side environment variables:",
    );
    output.error(findings.join("\n"));
    return 1;
  } else {
    output.log("No hardcoded Neon credentials found in repository files.");
    return 0;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = runSecretCheck();
}
