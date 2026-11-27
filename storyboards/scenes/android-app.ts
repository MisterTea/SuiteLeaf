import { _android as android, type AndroidDevice, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveAdbBinary } from "./android-emulator";

export const ANDROID_APP_PACKAGE = "app.suiteleaf.android";
export const ANDROID_APP_ACTIVITY = "app.suiteleaf.android/.MainActivity";
const DEFAULT_APK_PATH = resolve(
  import.meta.dirname,
  "../../apps/android/android/app/build/outputs/apk/debug/app-debug.apk",
);

const installedOnSerials = new Set<string>();

function adbExec(adb: string, serial: string, args: string[], ignoreError = false) {
  try {
    return execFileSync(adb, ["-s", serial, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    if (ignoreError) return "";
    throw err;
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolveWait) => {
    const timer = setTimeout(resolveWait, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveWait();
    });
  });
}

export interface AndroidAppStoryboardSession {
  page: Page;
  device: AndroidDevice;
  /** Stop recording, pull the raw MP4 from the emulator (if recorded), and close app/device cleanly. */
  close: () => Promise<string | null>;
}

/**
 * Install (once per run) and launch the real Capacitor Android APK (`app.suiteleaf.android`)
 * on a running Android emulator/device, attach Playwright to its native WebView via CDP,
 * inject the touch cursor overlay, and record the real Android screen via `adb shell screenrecord`.
 */
export async function openAndroidAppPage(options: {
  dir: string;
  cursorScript: string;
  recordVideo: boolean;
}): Promise<AndroidAppStoryboardSession> {
  const adb = resolveAdbBinary();
  const apkPath = process.env.SUITELEAF_ANDROID_APK ?? DEFAULT_APK_PATH;
  if (!existsSync(apkPath)) {
    throw new Error(
      `Android debug APK not found at ${apkPath}. Run 'npm run build:android' (or gradlew assembleDebug) first.`,
    );
  }

  const devices = await android.devices();
  const preferredSerial = process.env.ANDROID_SERIAL;
  const device = preferredSerial
    ? devices.find((d) => d.serial() === preferredSerial)
    : devices[0];
  if (!device) {
    throw new Error(
      preferredSerial
        ? `Android device ${preferredSerial} not found. Run 'adb devices' to verify the emulator is booted.`
        : "No Android emulator/device found. Start an Android AVD first (e.g. emulator -avd Pixel_4_API_33) and retry.",
    );
  }

  const serial = device.serial();

  // Install the debug APK once per worker process unless forced.
  if (!installedOnSerials.has(serial) || process.env.SUITELEAF_ANDROID_REINSTALL === "1") {
    adbExec(adb, serial, ["install", "-r", "-t", apkPath]);
    installedOnSerials.add(serial);
  }

  // Clear app state so every storyboard starts with clean IndexedDB / localStorage.
  adbExec(adb, serial, ["shell", "am", "force-stop", ANDROID_APP_PACKAGE], true);
  await new Promise((r) => setTimeout(r, 300));
  adbExec(adb, serial, ["shell", "pm", "clear", ANDROID_APP_PACKAGE], true);
  // Dismiss any lock screen, keep screen awake, and suppress Android heads-up notifications.
  adbExec(adb, serial, ["shell", "input", "keyevent", "82"], true);
  adbExec(adb, serial, ["shell", "svc", "power", "stayon", "true"], true);
  adbExec(adb, serial, ["shell", "cmd", "notification", "set_dnd", "on"], true);

  // Launch the real SuiteLeaf Android app.
  adbExec(adb, serial, ["shell", "am", "start", "-W", "-n", ANDROID_APP_ACTIVITY]);

  // Attach Playwright to the Capacitor WebView inside app.suiteleaf.android.
  const webview = await device.webView({ pkg: ANDROID_APP_PACKAGE });
  const page = await webview.page();
  page.setDefaultTimeout(20000);

  // Wait for the Capacitor app bundle to finish booting at https://localhost/.
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page
    .waitForFunction(() => (document.getElementById("root")?.children.length ?? 0) > 0, null, {
      timeout: 20000,
    })
    .catch(() => {});

  // Inject touch pointer dot (and re-inject after any reload).
  const installCursor = async () => {
    await page.evaluate(options.cursorScript).catch(() => {});
  };
  await installCursor();
  page.on("load", () => {
    void installCursor();
  });

  // Capture blob downloads so storyboards using `page.waitForEvent("download")` work.
  type CapturedDownload = {
    suggestedFilename: () => string;
    path: () => Promise<string>;
    saveAs: (dest: string) => Promise<void>;
    failure: () => Promise<null>;
  };
  const pendingDownloads: Array<(d: CapturedDownload) => void> = [];
  const queuedDownloads: CapturedDownload[] = [];
  let downloadSeq = 0;
  await page.exposeFunction("__androidAppCaptureDownload", (filename: string, base64: string) => {
    const localPath = join(
      options.dir,
      `download-${++downloadSeq}-${filename.replace(/[^\w.-]/g, "_")}`,
    );
    writeFileSync(localPath, Buffer.from(base64, "base64"));
    const captured: CapturedDownload = {
      suggestedFilename: () => filename,
      path: async () => localPath,
      saveAs: async (dest: string) => copyFileSync(localPath, dest),
      failure: async () => null,
    };
    const waiter = pendingDownloads.shift();
    if (waiter) waiter(captured);
    else queuedDownloads.push(captured);
  });

  const downloadShim = `(() => {
    if (window.__suiteleafDownloadShimmed) return;
    window.__suiteleafDownloadShimmed = true;
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && typeof this.href === "string" && this.href.startsWith("blob:")) {
        const name = this.download;
        const href = this.href;
        fetch(href)
          .then((r) => r.arrayBuffer())
          .then((buf) => {
            const bytes = new Uint8Array(buf);
            let bin = "";
            for (let i = 0; i < bytes.length; i += 0x8000) {
              bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
            }
            return window.__androidAppCaptureDownload(name, btoa(bin));
          })
          .catch(() => {});
        return;
      }
      return origClick.apply(this, arguments);
    };
  })();`;
  await page.evaluate(downloadShim).catch(() => {});
  page.on("load", () => {
    void page.evaluate(downloadShim).catch(() => {});
  });

  const origWaitForEvent = page.waitForEvent.bind(page);
  page.waitForEvent = ((event: string, optionsOrPredicate?: unknown) => {
    if (event === "download") {
      const queued = queuedDownloads.shift();
      if (queued) return Promise.resolve(queued);
      const timeout =
        typeof optionsOrPredicate === "object" &&
        optionsOrPredicate &&
        "timeout" in optionsOrPredicate
          ? Number((optionsOrPredicate as { timeout?: number }).timeout) || 20000
          : 20000;
      return new Promise((resolveDownload, rejectDownload) => {
        const timer = setTimeout(() => {
          const idx = pendingDownloads.indexOf(onDownload);
          if (idx >= 0) pendingDownloads.splice(idx, 1);
          rejectDownload(
            new Error(`Timeout ${timeout}ms exceeded while waiting for Android app download`),
          );
        }, timeout);
        const onDownload = (d: CapturedDownload) => {
          clearTimeout(timer);
          resolveDownload(d);
        };
        pendingDownloads.push(onDownload);
      });
    }
    return origWaitForEvent(event as never, optionsOrPredicate as never);
  }) as typeof page.waitForEvent;

  // Map relative `page.goto("/")` calls to Capacitor's `https://localhost/` origin.
  const appOrigin = await page
    .evaluate(() => location.origin)
    .catch(() => "https://localhost");
  const origGoto = page.goto.bind(page);
  page.goto = ((url: string, gotoOptions?: Parameters<Page["goto"]>[1]) => {
    if (url === "/" || url === "./" || url === "") {
      return origGoto(`${appOrigin}/`, gotoOptions);
    }
    if (url.startsWith("/")) {
      return origGoto(`${appOrigin}${url}`, gotoOptions);
    }
    return origGoto(url, gotoOptions);
  }) as typeof page.goto;

  // Report real WebView viewport so mobile layout checks work properly.
  const cachedViewport = await page
    .evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    .catch(() => ({ width: 412, height: 892 }));
  page.viewportSize = () => cachedViewport;

  // Start real Android screen recording.
  let recorder: ChildProcess | null = null;
  let remoteVideoPath: string | null = null;
  if (options.recordVideo) {
    remoteVideoPath = `/sdcard/suiteleaf-android-app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    recorder = spawn(
      adb,
      ["-s", serial, "shell", "screenrecord", "--bit-rate", "4000000", remoteVideoPath],
      { stdio: "ignore" },
    );
  }

  const close = async (): Promise<string | null> => {
    let pulledPath: string | null = null;
    if (recorder && remoteVideoPath) {
      adbExec(adb, serial, ["shell", "pkill", "-2", "screenrecord"], true);
      await waitForExit(recorder, 5000);
      if (recorder.exitCode === null) recorder.kill();
      await new Promise((r) => setTimeout(r, 400));
      const localRaw = join(options.dir, "android-app-raw.mp4");
      try {
        adbExec(adb, serial, ["pull", remoteVideoPath, localRaw]);
        if (existsSync(localRaw)) pulledPath = localRaw;
      } catch {
        pulledPath = null;
      } finally {
        adbExec(adb, serial, ["shell", "rm", "-f", remoteVideoPath], true);
      }
    }
    adbExec(adb, serial, ["shell", "am", "force-stop", ANDROID_APP_PACKAGE], true);
    await device.close().catch(() => {});
    return pulledPath;
  };

  return { page, device, close };
}
