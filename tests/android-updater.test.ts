import { describe, expect, it, vi } from "vitest";
import { createAndroidUpdaterBridge } from "../apps/web/src/android/android-updater";
import type { AndroidUpdaterNativePlugin } from "../apps/web/src/android/native-plugin";

describe("createAndroidUpdaterBridge", () => {
  it("runs an automatic startup check and notifies subscribers when a release is available", async () => {
    const check = vi.fn(async () => ({
      value: { version: "0.2.0", body: "New Android companion features" },
    }));
    const install = vi.fn(async () => {});
    const plugin: AndroidUpdaterNativePlugin = { check, install };

    const updater = createAndroidUpdaterBridge(plugin, { autoStart: false });
    const seen: Array<string | null> = [];
    updater.onAvailable((u) => seen.push(u?.version ?? null));

    await updater.checkAutomatically();
    expect(check).toHaveBeenCalledWith({ manual: false, startup: true });
    expect(updater.getAvailable()).toEqual({
      version: "0.2.0",
      body: "New Android companion features",
    });
    expect(seen).toEqual(["0.2.0"]);

    // Subsequent automatic checks pass startup: false
    await updater.checkAutomatically();
    expect(check).toHaveBeenLastCalledWith({ manual: false, startup: false });

    await updater.install();
    expect(install).toHaveBeenCalledTimes(1);
    updater.stop();
  });

  it("deduplicates concurrent checks and rejects install when no update is available", async () => {
    let resolveCheck!: (v: { value: null }) => void;
    const check = vi.fn(
      () => new Promise<{ value: null }>((resolve) => (resolveCheck = resolve)),
    );
    const plugin: AndroidUpdaterNativePlugin = {
      check,
      install: vi.fn(async () => {}),
    };

    const updater = createAndroidUpdaterBridge(plugin, { autoStart: false });
    const p1 = updater.check({ manual: true });
    const p2 = updater.check({ manual: true });
    expect(check).toHaveBeenCalledTimes(1);

    resolveCheck({ value: null });
    expect(await p1).toBeNull();
    expect(await p2).toBeNull();
    await expect(updater.install()).rejects.toThrow(/No update available/i);
    updater.stop();
  });
});
