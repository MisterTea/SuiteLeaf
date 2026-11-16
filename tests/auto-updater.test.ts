import { describe, expect, it, vi, beforeEach } from "vitest";
import { DesktopAutoUpdater, initDesktopAutoUpdater, getDesktopAutoUpdater } from "../apps/desktop/src/auto-updater";
import { Emitter } from "./desktop-electron-fake";
import type { AppUpdater, UpdateInfo } from "electron-updater";

class FakeUpdater extends Emitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  feedUrl: unknown;
  checkForUpdates = vi.fn(async () => null);
  quitAndInstall = vi.fn();
  setFeedURL(options: unknown) {
    this.feedUrl = options;
  }
}

describe("DesktopAutoUpdater", () => {
  let fakeUpdater: FakeUpdater;
  let fakeApp: { isPackaged: boolean; getVersion: () => string };
  let fakeDialog: { showMessageBox: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    fakeUpdater = new FakeUpdater();
    fakeApp = {
      isPackaged: true,
      getVersion: () => "0.1.0",
    };
    fakeDialog = {
      showMessageBox: vi.fn(async () => ({ response: 0 })),
    };
  });

  it("configures feed URL and update settings for GitHub", () => {
    const updater = new DesktopAutoUpdater({
      updater: fakeUpdater as unknown as AppUpdater,
      appInstance: fakeApp as never,
      dialogInstance: fakeDialog as never,
      owner: "MisterTea",
      repo: "SuiteLeaf",
      checkIntervalMs: 0,
    });

    expect(fakeUpdater.autoDownload).toBe(true);
    expect(fakeUpdater.autoInstallOnAppQuit).toBe(true);
    expect(fakeUpdater.feedUrl).toEqual({
      provider: "github",
      owner: "MisterTea",
      repo: "SuiteLeaf",
    });
    updater.stop();
  });

  it("respects environment variables for owner and repo", () => {
    process.env.SUITELEAF_GITHUB_OWNER = "CustomOwner";
    process.env.SUITELEAF_GITHUB_REPO = "CustomRepo";

    const updater = new DesktopAutoUpdater({
      updater: fakeUpdater as unknown as AppUpdater,
      appInstance: fakeApp as never,
      dialogInstance: fakeDialog as never,
      checkIntervalMs: 0,
    });

    expect(fakeUpdater.feedUrl).toEqual({
      provider: "github",
      owner: "CustomOwner",
      repo: "CustomRepo",
    });

    delete process.env.SUITELEAF_GITHUB_OWNER;
    delete process.env.SUITELEAF_GITHUB_REPO;
    updater.stop();
  });

  it("informs user that updates require packaged build when in dev mode", async () => {
    fakeApp.isPackaged = false;
    const updater = new DesktopAutoUpdater({
      updater: fakeUpdater as unknown as AppUpdater,
      appInstance: fakeApp as never,
      dialogInstance: fakeDialog as never,
      checkIntervalMs: 0,
    });

    await updater.checkForUpdates(true);

    expect(fakeUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(fakeDialog.showMessageBox).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        type: "info",
        title: "Check for Updates",
        message: expect.stringContaining("packaged releases"),
      }),
    );
    updater.stop();
  });

  it("checks for updates when packaged", async () => {
    const updater = new DesktopAutoUpdater({
      updater: fakeUpdater as unknown as AppUpdater,
      appInstance: fakeApp as never,
      dialogInstance: fakeDialog as never,
      checkIntervalMs: 0,
    });

    await updater.checkForUpdates(false);
    expect(fakeUpdater.checkForUpdates).toHaveBeenCalled();
    updater.stop();
  });

  it("notifies when update is available on manual check", async () => {
    const updater = new DesktopAutoUpdater({
      updater: fakeUpdater as unknown as AppUpdater,
      appInstance: fakeApp as never,
      dialogInstance: fakeDialog as never,
      checkIntervalMs: 0,
    });

    await updater.checkForUpdates(true);
    fakeUpdater.emit("update-available", { version: "0.2.0" } as UpdateInfo);

    expect(fakeDialog.showMessageBox).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        title: "Update Available",
        message: expect.stringContaining("0.2.0"),
      }),
    );
    updater.stop();
  });

  it("notifies when no update is available on manual check", async () => {
    const updater = new DesktopAutoUpdater({
      updater: fakeUpdater as unknown as AppUpdater,
      appInstance: fakeApp as never,
      dialogInstance: fakeDialog as never,
      checkIntervalMs: 0,
    });

    await updater.checkForUpdates(true);
    fakeUpdater.emit("update-not-available");

    expect(fakeDialog.showMessageBox).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        title: "No Updates Available",
        message: expect.stringContaining("0.1.0"),
      }),
    );
    updater.stop();
  });

  it("notifies when update check fails on manual check", async () => {
    const updater = new DesktopAutoUpdater({
      updater: fakeUpdater as unknown as AppUpdater,
      appInstance: fakeApp as never,
      dialogInstance: fakeDialog as never,
      checkIntervalMs: 0,
    });

    await updater.checkForUpdates(true);
    fakeUpdater.emit("error", new Error("Network unreachable"));

    expect(fakeDialog.showMessageBox).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        title: "Update Check Failed",
        message: expect.stringContaining("Network unreachable"),
      }),
    );
    updater.stop();
  });

  it("prompts to restart on update-downloaded and restarts when confirmed", async () => {
    fakeDialog.showMessageBox.mockResolvedValueOnce({ response: 0 }); // "Restart Now"

    const updater = new DesktopAutoUpdater({
      updater: fakeUpdater as unknown as AppUpdater,
      appInstance: fakeApp as never,
      dialogInstance: fakeDialog as never,
      checkIntervalMs: 0,
    });

    fakeUpdater.emit("update-downloaded", { version: "0.2.0" } as UpdateInfo);

    await Promise.resolve(); // wait for microtasks

    expect(fakeDialog.showMessageBox).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        title: "Update Ready",
        message: expect.stringContaining("0.2.0"),
        buttons: ["Restart Now", "Later"],
      }),
    );
    expect(fakeUpdater.quitAndInstall).toHaveBeenCalled();
    updater.stop();
  });

  it("does not restart when user chooses Later", async () => {
    fakeDialog.showMessageBox.mockResolvedValueOnce({ response: 1 }); // "Later"

    const updater = new DesktopAutoUpdater({
      updater: fakeUpdater as unknown as AppUpdater,
      appInstance: fakeApp as never,
      dialogInstance: fakeDialog as never,
      checkIntervalMs: 0,
    });

    fakeUpdater.emit("update-downloaded", { version: "0.2.0" } as UpdateInfo);

    await Promise.resolve();

    expect(fakeUpdater.quitAndInstall).not.toHaveBeenCalled();
    updater.stop();
  });

  it("supports periodic polling and can be stopped", () => {
    vi.useFakeTimers();
    try {
      const updater = new DesktopAutoUpdater({
        updater: fakeUpdater as unknown as AppUpdater,
        appInstance: fakeApp as never,
        dialogInstance: fakeDialog as never,
        checkIntervalMs: 1000,
      });

      vi.advanceTimersByTime(1000);
      expect(fakeUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(fakeUpdater.checkForUpdates).toHaveBeenCalledTimes(2);

      updater.stop();
      vi.advanceTimersByTime(1000);
      expect(fakeUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles exception thrown by checkForUpdates during manual check", async () => {
    fakeUpdater.checkForUpdates.mockRejectedValueOnce(new Error("Immediate network drop"));
    const updater = new DesktopAutoUpdater({
      updater: fakeUpdater as unknown as AppUpdater,
      appInstance: fakeApp as never,
      dialogInstance: fakeDialog as never,
      checkIntervalMs: 0,
    });

    await updater.checkForUpdates(true);

    expect(fakeDialog.showMessageBox).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        title: "Update Check Failed",
        message: expect.stringContaining("Immediate network drop"),
      }),
    );
    updater.stop();
  });

  it("initializes singleton via initDesktopAutoUpdater and getDesktopAutoUpdater", () => {
    const updater = initDesktopAutoUpdater({
      updater: fakeUpdater as unknown as AppUpdater,
      appInstance: fakeApp as never,
      dialogInstance: fakeDialog as never,
      checkIntervalMs: 0,
    });

    expect(getDesktopAutoUpdater()).toBe(updater);
    // calling it again returns existing instance
    expect(initDesktopAutoUpdater()).toBe(updater);
    updater.stop();
  });
});
