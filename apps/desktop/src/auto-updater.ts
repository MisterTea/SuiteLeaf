import { app, dialog, type BrowserWindow } from "electron";
import { autoUpdater, type AppUpdater, type UpdateInfo } from "electron-updater";

export interface AutoUpdaterOptions {
  updater?: AppUpdater;
  appInstance?: typeof app;
  dialogInstance?: typeof dialog;
  owner?: string;
  repo?: string;
  checkIntervalMs?: number;
  isPackaged?: boolean;
  getWindow?: () => BrowserWindow | null | undefined;
}

const DEFAULT_OWNER = "MisterTea";
const DEFAULT_REPO = "SuiteLeaf";
const DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export class DesktopAutoUpdater {
  private updater?: AppUpdater;
  private appInstance: typeof app;
  private dialogInstance: typeof dialog;
  private owner: string;
  private repo: string;
  private isPackaged: boolean;
  private getWindow?: () => BrowserWindow | null | undefined;
  private manualCheck = false;
  private intervalTimer?: ReturnType<typeof setInterval>;

  constructor(options: AutoUpdaterOptions = {}) {
    this.appInstance = options.appInstance ?? app;
    this.dialogInstance = options.dialogInstance ?? dialog;
    this.owner = options.owner ?? process.env.SUITELEAF_GITHUB_OWNER ?? DEFAULT_OWNER;
    this.repo = options.repo ?? process.env.SUITELEAF_GITHUB_REPO ?? DEFAULT_REPO;
    this.isPackaged = options.isPackaged ?? (this.appInstance?.isPackaged ?? false);
    this.getWindow = options.getWindow;

    if (options.updater) {
      this.updater = options.updater;
    } else {
      try {
        this.updater = autoUpdater;
      } catch {
        // Updater may not be available in non-standard runtimes or unit test environments
      }
    }

    if (this.updater) {
      this.configure();
      this.registerEvents();
    }

    if (options.checkIntervalMs !== 0 && (this.isPackaged || process.env.SUITELEAF_UPDATE_DEV)) {
      const interval = options.checkIntervalMs ?? DEFAULT_INTERVAL_MS;
      this.intervalTimer = setInterval(() => {
        void this.checkForUpdates(false);
      }, interval);
    }
  }

  private configure(): void {
    if (!this.updater) return;
    try {
      this.updater.autoDownload = true;
      this.updater.autoInstallOnAppQuit = true;
      this.updater.setFeedURL({
        provider: "github",
        owner: this.owner,
        repo: this.repo,
      });
    } catch {
      // Configuration failure in test environment
    }
  }

  private registerEvents(): void {
    if (!this.updater) return;
    this.updater.on("update-available", (info: UpdateInfo) => {
      if (this.manualCheck) {
        this.manualCheck = false;
        const window = this.getWindow?.() ?? null;
        void this.dialogInstance.showMessageBox(window as never, {
          type: "info",
          title: "Update Available",
          message: `A new version of SuiteLeaf (${info.version}) is available. Downloading in the background…`,
          buttons: ["OK"],
        });
      }
    });

    this.updater.on("update-not-available", () => {
      if (this.manualCheck) {
        this.manualCheck = false;
        const window = this.getWindow?.() ?? null;
        const version = this.appInstance?.getVersion?.() ?? "";
        void this.dialogInstance.showMessageBox(window as never, {
          type: "info",
          title: "No Updates Available",
          message: version
            ? `SuiteLeaf is up to date (version ${version}).`
            : "SuiteLeaf is up to date.",
          buttons: ["OK"],
        });
      }
    });

    this.updater.on("error", (err: Error) => {
      if (this.manualCheck) {
        this.manualCheck = false;
        const window = this.getWindow?.() ?? null;
        void this.dialogInstance.showMessageBox(window as never, {
          type: "error",
          title: "Update Check Failed",
          message: `Unable to check for updates: ${err?.message || "Unknown error"}`,
          buttons: ["OK"],
        });
      }
    });

    this.updater.on("update-downloaded", (info: UpdateInfo) => {
      const window = this.getWindow?.() ?? null;
      void this.dialogInstance
        .showMessageBox(window as never, {
          type: "info",
          title: "Update Ready",
          message: `SuiteLeaf version ${info.version} has been downloaded. Restart now to install the update?`,
          buttons: ["Restart Now", "Later"],
          defaultId: 0,
          cancelId: 1,
        })
        .then((response) => {
          if (response.response === 0) {
            this.updater?.quitAndInstall();
          }
        });
    });
  }

  public async checkForUpdates(manual = false): Promise<void> {
    const isDev = !this.isPackaged && !process.env.SUITELEAF_UPDATE_DEV;
    if (isDev) {
      if (manual) {
        const window = this.getWindow?.() ?? null;
        await this.dialogInstance.showMessageBox(window as never, {
          type: "info",
          title: "Check for Updates",
          message: "Automatic updates are only available in packaged releases of SuiteLeaf.",
          buttons: ["OK"],
        });
      }
      return;
    }

    if (!this.updater) return;

    this.manualCheck = manual;
    try {
      await this.updater.checkForUpdates();
    } catch (err) {
      if (manual) {
        this.manualCheck = false;
        const window = this.getWindow?.() ?? null;
        await this.dialogInstance.showMessageBox(window as never, {
          type: "error",
          title: "Update Check Failed",
          message: `Unable to check for updates: ${(err as Error)?.message || "Unknown error"}`,
          buttons: ["OK"],
        });
      }
    }
  }

  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
  }
}

let instance: DesktopAutoUpdater | undefined;

export function initDesktopAutoUpdater(options?: AutoUpdaterOptions): DesktopAutoUpdater {
  if (!instance) {
    instance = new DesktopAutoUpdater(options);
  }
  return instance;
}

export function getDesktopAutoUpdater(): DesktopAutoUpdater | undefined {
  return instance;
}
