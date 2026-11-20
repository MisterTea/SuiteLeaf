import { BrowserWindow, type NativeImage } from "electron";

/** Run a provider's sign-in on the node's own origin in a child window, and
 * resolve with the one-time token it redirects back with. */
export function authWindow(
  startUrl: string,
  options?: { parent?: BrowserWindow; icon?: NativeImage },
): Promise<string | null> {
  const start = new URL(startUrl);
  if (start.protocol !== "https:" && start.protocol !== "http:")
    throw new Error("Invalid sign-in address.");
  return new Promise((done) => {
    const child = new BrowserWindow({
      parent: options?.parent,
      modal: true,
      width: 520,
      height: 720,
      title: "Sign in",
      icon: options?.icon,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: "persist:suiteleaf-auth",
      },
    });
    let finished = false;
    const finish = (token: string | null) => {
      if (finished) return;
      finished = true;
      done(token);
      if (!child.isDestroyed()) child.close();
    };
    const intercept = (event: Electron.Event, url: string) => {
      const match = /#\/auth-complete\?token=([^&]+)/.exec(url);
      if (match) {
        event.preventDefault();
        finish(decodeURIComponent(match[1]));
      }
    };
    child.webContents.on("will-redirect", intercept);
    child.webContents.on("will-navigate", intercept);
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    child.on("closed", () => finish(null));
    void child.loadURL(start.toString());
  });
}
