import { app, nativeImage, type NativeImage } from "electron";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Candidate paths for the SuiteLeaf icon across development and packaged builds. */
export function getAppIconCandidates(): string[] {
  const candidates: string[] = [];
  if (process.resourcesPath) {
    candidates.push(
      join(process.resourcesPath, "icon.icns"),
      join(process.resourcesPath, "icon.png"),
    );
  }
  try {
    const appPath = app.getAppPath?.();
    if (appPath) {
      candidates.push(
        join(appPath, "resources/icon.icns"),
        join(appPath, "resources/icon.png"),
      );
    }
  } catch {
    // getAppIconCandidates is safe if app is not yet ready
  }
  candidates.push(
    // Relative to src (e.g. In test runner or ts-node)
    resolve(import.meta.dirname, "../resources/icon.icns"),
    resolve(import.meta.dirname, "../resources/icon.png"),
    // Relative to out/main (bundled production/dev output)
    resolve(import.meta.dirname, "../../resources/icon.icns"),
    resolve(import.meta.dirname, "../../resources/icon.png"),
    // Bundled renderer web assets
    resolve(import.meta.dirname, "../renderer/icon-512.png"),
    resolve(import.meta.dirname, "../renderer/icon-192.png"),
  );
  return candidates;
}

/** Resolves the SuiteLeaf app icon as an Electron NativeImage. */
export function getAppIcon(): NativeImage | undefined {
  for (const candidate of getAppIconCandidates()) {
    try {
      if (candidate && existsSync(candidate)) {
        const image = nativeImage.createFromPath(candidate);
        if (!image.isEmpty()) return image;
      }
    } catch {
      // Continue to next candidate
    }
  }
  return undefined;
}

/** Sets the app dock icon on macOS and returns the app icon NativeImage for window creation. */
export function setupAppIcon(): NativeImage | undefined {
  const icon = getAppIcon();
  if (icon && process.platform === "darwin" && app.dock) {
    try {
      app.dock.setIcon(icon);
    } catch {
      // Ignore errors when running without a window server
    }
  }
  return icon;
}
