import { execFileSync } from "node:child_process";
import { join } from "node:path";

// With no signing identity, electron-builder leaves Electron's own signature, which
// no longer matches the renamed bundle. An ad-hoc signature lets the app, the DMG,
// and the ZIP pass `codesign --verify` and run on Apple silicon.
export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
}
