// Puts the app that was just packaged into /Applications, so a local build is the one you open.
// Skipped off macOS, on CI, and when SUITELEAF_SKIP_INSTALL is set.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || process.env.CI || process.env.SUITELEAF_SKIP_INSTALL) process.exit(0);

const release = join(dirname(fileURLToPath(import.meta.url)), "..", "release");
const name = "SuiteLeaf.app";
const built = readdirSync(release)
  .filter((dir) => dir.startsWith("mac") && existsSync(join(release, dir, name)))
  .map((dir) => join(release, dir, name))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!built) {
  console.error(`No ${name} under ${release}.`);
  process.exit(1);
}

const target = join("/Applications", name);
const incoming = join("/Applications", `.${name}.installing`);
const previous = join("/Applications", `.${name}.previous`);
rmSync(incoming, { recursive: true, force: true });
rmSync(previous, { recursive: true, force: true });
execFileSync("ditto", [built, incoming]);
execFileSync("codesign", ["--verify", "--deep", "--strict", incoming]);
// Swapping by rename leaves a running copy's open files in place until it quits.
if (existsSync(target)) renameSync(target, previous);
renameSync(incoming, target);
rmSync(previous, { recursive: true, force: true });

const version = execFileSync("/usr/libexec/PlistBuddy", [
  "-c",
  "Print CFBundleShortVersionString",
  join(target, "Contents", "Info.plist"),
])
  .toString()
  .trim();
let running = false;
try {
  execFileSync("pgrep", ["-f", `${target}/Contents/MacOS/`], { stdio: "ignore" });
  running = true;
} catch {}
console.log(`Installed SuiteLeaf ${version} from ${built} to ${target}.`);
if (running) console.log("SuiteLeaf is open. Quit and reopen it to use the new version.");
