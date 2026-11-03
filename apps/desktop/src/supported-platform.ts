/** Floors for the packaged desktop app. Node matches package.json engines. macOS 13 and Windows 10 match Electron 44. */
export const SUPPORTED_PLATFORM = {
  node: "22.12.0",
  macOS: 13,
  windows: 10,
} as const;

function olderThan(version: string, floor: readonly [number, number, number]): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let index = 0; index < 3; index++) {
    if (parts[index]! < floor[index]!) return true;
    if (parts[index]! > floor[index]!) return false;
  }
  return false;
}

/** Whether this Node.js version can run the app. A value that is not major.minor.patch is not repeated. */
export function nodeRuntimeNotice(version: string): string {
  if (!/^(\d+)\.(\d+)\.(\d+)$/.test(version)) return "Name the runtime as major.minor.patch.";
  if (olderThan(version, [22, 12, 0])) return "This runtime is older than Node.js 22.12.0.";
  return "This runtime is supported.";
}

function major(version: string): number | null {
  const match = /^(\d+)(?:\.\d+)*$/.exec(version.trim());
  if (!match) return null;
  return Number(match[1]);
}

/**
 * Whether a desktop operating system is in the packaged Electron 44 range.
 * Linux has no recorded distribution floor. The version text is not repeated.
 */
export function desktopOsNotice(platform: string, version: string): string {
  if (platform === "darwin") {
    const mac = major(version);
    if (mac == null) return "Name the macOS version.";
    if (mac < SUPPORTED_PLATFORM.macOS) return "This Mac is older than macOS 13.";
    return "This Mac is supported.";
  }
  if (platform === "win32") {
    const windows = major(version);
    if (windows == null) return "Name the Windows version.";
    if (windows < SUPPORTED_PLATFORM.windows) return "This Windows version is older than Windows 10.";
    return "This Windows version is supported.";
  }
  if (platform === "linux") {
    return "Linux support follows the packaged Electron build. No minimum distribution is recorded.";
  }
  return "Name macOS, Windows, or Linux.";
}

/** A sentence when this computer is outside the packaged floor. Linux is allowed. */
export function desktopUpdateBlock(platform: string, osVersion: string): string | null {
  const notice = desktopOsNotice(platform, osVersion);
  if (
    notice === "This Mac is supported." ||
    notice === "This Windows version is supported." ||
    notice.startsWith("Linux support follows")
  ) {
    return null;
  }
  return notice;
}
