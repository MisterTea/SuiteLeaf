/**
 * Whether an unattended install or uninstall is allowed.
 * This does not replace the app or delete a file.
 */

export type UnattendedPlan =
  | { action: "refuse"; reason: string }
  | { action: "ready"; reason: string; remove?: string };

const UNSIGNED = "This build is not signed. It is not an unattended install.";
const HASH = "The installer hash does not match. The app is not replaced.";
const DOCUMENT = "An unattended install does not replace a document.";
const READY = "This build is signed for an unattended install. The app is not replaced by this check.";
const KEEP = "An unattended uninstall does not remove a document.";
const APP = "An unattended uninstall only names the SuiteLeaf app.";
const INSTALLER = "The installer name is not a SuiteLeaf installer.";
const APP_PATH = "The app path is not a SuiteLeaf app path.";
const REMOVE = "The app can be removed. Documents stay.";

export function unattendedInstallPlan(input: {
  identity: string | null;
  installerName: string;
  sha256: string;
  expectedSha256: string;
}): UnattendedPlan {
  const identity = input.identity?.trim() ?? "";
  if (!identity || identity === "null") return { action: "refuse", reason: UNSIGNED };
  const name = input.installerName.trim();
  if (name.includes("..") || /[\r\n]/.test(name)) return { action: "refuse", reason: INSTALLER };
  if (!name || /\.(sldoc|slsheet|slslides|sldraw)$/i.test(name)) {
    return { action: "refuse", reason: DOCUMENT };
  }
  const sha = input.sha256.trim().toLowerCase();
  const expected = input.expectedSha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha) || sha !== expected) {
    return { action: "refuse", reason: HASH };
  }
  return { action: "ready", reason: READY };
}

export function unattendedUninstallPlan(input: { appPath: string; keep: string[] }): UnattendedPlan {
  const app = input.appPath.trim();
  if (app.includes("..") || /[\r\n]/.test(app)) return { action: "refuse", reason: APP_PATH };
  const keep = input.keep.map((path) => path.trim()).filter((path) => path.length > 0);
  const insideDocument = keep.some((path) => app === path || app.startsWith(path.endsWith("/") ? path : `${path}/`));
  if (!app || insideDocument || /\.(sldoc|slsheet|slslides|sldraw)$/i.test(app)) {
    return { action: "refuse", reason: KEEP };
  }
  if (!app.endsWith("SuiteLeaf.app") && !app.endsWith("SuiteLeaf.exe")) {
    return { action: "refuse", reason: APP };
  }
  return { action: "ready", reason: REMOVE, remove: app };
}
