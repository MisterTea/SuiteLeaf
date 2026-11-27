import type { AndroidUpdateInfo, AndroidUpdaterBridge } from "@suiteleaf/core";
import type { AndroidUpdaterNativePlugin } from "./native-plugin";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/**
 * In-app Android updater controller mirroring SuiteMail's updateManager:
 * - Deduplicates concurrent update checks
 * - Runs an automatic startup check + periodic 4-hour foreground check
 * - Supports manual checks and in-app APK installation from Settings or Home banner
 */
export function createAndroidUpdaterBridge(
  plugin: AndroidUpdaterNativePlugin,
  options?: { autoStart?: boolean },
): AndroidUpdaterBridge & { checkAutomatically: () => Promise<void>; stop: () => void } {
  let available: AndroidUpdateInfo | null = null;
  let pendingCheck: Promise<AndroidUpdateInfo | null> | null = null;
  let startupCheckPending = true;
  const listeners = new Set<(update: AndroidUpdateInfo | null) => void>();

  const setAvailable = (next: AndroidUpdateInfo | null) => {
    available = next;
    listeners.forEach((cb) => cb(next));
  };

  const performCheck = async (
    manual: boolean,
    startup: boolean,
  ): Promise<AndroidUpdateInfo | null> => {
    const res = await plugin.check({ manual, startup });
    const value = res?.value;
    if (value?.version) {
      const info: AndroidUpdateInfo = {
        version: value.version,
        body: value.body ?? null,
      };
      setAvailable(info);
      return info;
    }
    setAvailable(null);
    return null;
  };

  const check = (opts?: { manual?: boolean; startup?: boolean }) => {
    const manual = opts?.manual === true;
    const startup = opts?.startup === true;
    if (!pendingCheck) {
      pendingCheck = performCheck(manual, startup).finally(() => {
        pendingCheck = null;
      });
    }
    return pendingCheck;
  };

  const checkAutomatically = async () => {
    const startup = startupCheckPending;
    startupCheckPending = false;
    try {
      await check({ manual: false, startup });
    } catch {
      // Automatic background/startup checks never surface disruptive errors.
    }
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  if (options?.autoStart !== false) {
    // Startup check once the app finishes mounting.
    void checkAutomatically();
    if (typeof setInterval === "function") {
      timer = setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") {
          void checkAutomatically();
        }
      }, FOUR_HOURS_MS);
    }
  }

  return {
    check,
    async install(): Promise<void> {
      if (!available) throw new Error("No update available.");
      await plugin.install();
    },
    getAvailable: () => available,
    onAvailable(callback) {
      listeners.add(callback);
      return () => void listeners.delete(callback);
    },
    checkAutomatically,
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
