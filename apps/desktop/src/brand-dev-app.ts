// Brands the local dev electron binary (node_modules/electron/dist/Electron.app) as SuiteLeaf
// so the macOS Dock tooltip and application name show "SuiteLeaf" instead of "Electron".
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function brandDevApp(): void {
  if (process.platform !== "darwin") return;

  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = resolve(desktopRoot, "../..");

  const electronDirs = [
    join(repoRoot, "node_modules/electron"),
    join(desktopRoot, "node_modules/electron"),
  ];

  for (const electronDir of electronDirs) {
    if (!existsSync(electronDir)) continue;

    const distDir = join(electronDir, "dist");
    const oldApp = join(distDir, "Electron.app");
    const newApp = join(distDir, "SuiteLeaf.app");

    if (existsSync(oldApp) && !existsSync(newApp)) {
      try {
        renameSync(oldApp, newApp);
      } catch {}
    }

    const appPath = existsSync(newApp) ? newApp : existsSync(oldApp) ? oldApp : null;
    if (!appPath) continue;

    const macosDir = join(appPath, "Contents/MacOS");
    const oldExec = join(macosDir, "Electron");
    const newExec = join(macosDir, "SuiteLeaf");

    if (existsSync(oldExec) && !existsSync(newExec)) {
      try {
        renameSync(oldExec, newExec);
      } catch {}
    }

    const execName = existsSync(newExec) ? "SuiteLeaf" : "Electron";
    const appBaseName = appPath.endsWith("SuiteLeaf.app") ? "SuiteLeaf.app" : "Electron.app";

    // Update path.txt so require('electron') resolves to the branded binary
    const pathTxt = join(electronDir, "path.txt");
    try {
      writeFileSync(pathTxt, `${appBaseName}/Contents/MacOS/${execName}`, "utf8");
    } catch {}

    const infoPlist = join(appPath, "Contents/Info.plist");
    if (existsSync(infoPlist)) {
      try {
        execFileSync("plutil", ["-replace", "CFBundleDisplayName", "-string", "SuiteLeaf", infoPlist]);
        execFileSync("plutil", ["-replace", "CFBundleName", "-string", "SuiteLeaf", infoPlist]);
        execFileSync("plutil", ["-replace", "CFBundleExecutable", "-string", execName, infoPlist]);
      } catch {}
    }

    const sourceIcon = join(desktopRoot, "resources/icon.icns");
    const targetIcon = join(appPath, "Contents/Resources/electron.icns");
    if (existsSync(sourceIcon)) {
      try {
        copyFileSync(sourceIcon, targetIcon);
      } catch {}
    }

    try {
      execFileSync("touch", [appPath]);
      execFileSync(
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
        ["-f", appPath],
      );
    } catch {}
  }
}
