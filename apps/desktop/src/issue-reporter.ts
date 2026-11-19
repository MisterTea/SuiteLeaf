import type { BrowserWindow, WebContents } from "electron";

/** Captures the active page as a PNG data URL, or "" if it cannot. */
export async function captureScreenshot(
  win?: BrowserWindow | null,
  contents?: WebContents | null,
): Promise<string> {
  const target = contents ?? win?.webContents;
  if (!target) return "";
  try {
    return (await target.capturePage()).toDataURL();
  } catch (err) {
    console.warn("capturePage failed:", err);
    return "";
  }
}

/** Registers the screenshot IPC handler. Reports are filed by the Bugcatcher service. */
export function registerIssueReporter(
  register: (channel: string, handler: (...args: any[]) => unknown) => void,
  getWindow: () => BrowserWindow | null,
  getContents?: () => WebContents | null | undefined,
) {
  register("screenshot:capture", () => captureScreenshot(getWindow(), getContents?.()));
}
