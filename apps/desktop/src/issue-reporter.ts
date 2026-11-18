import type { BrowserWindow } from "electron";

/** Captures the app window as a PNG data URL, or "" if it cannot. */
export async function captureScreenshot(win?: BrowserWindow | null): Promise<string> {
  if (!win) return "";
  try {
    return (await win.webContents.capturePage()).toDataURL();
  } catch (err) {
    console.warn("capturePage failed:", err);
    return "";
  }
}

/** Registers the screenshot IPC handler. Reports are filed by the Bugcatcher service. */
export function registerIssueReporter(
  register: (channel: string, handler: (...args: any[]) => unknown) => void,
  getWindow: () => BrowserWindow | null,
) {
  register("screenshot:capture", () => captureScreenshot(getWindow()));
}
