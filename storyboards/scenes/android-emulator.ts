import { _android as android, type AndroidDevice, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Locate the Android `adb` binary from SDK env vars, default Windows/macOS/Linux SDK paths, or PATH. */
export function resolveAdbBinary(): string {
  const exe = process.platform === "win32" ? "adb.exe" : "adb";
  const candidates = [
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, "platform-tools", exe),
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, "platform-tools", exe),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", exe),
    process.env.HOME && join(process.env.HOME, "Library", "Android", "sdk", "platform-tools", exe),
    process.env.HOME && join(process.env.HOME, "Android", "Sdk", "platform-tools", exe),
  ].filter((p): p is string => Boolean(p));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return exe;
}

function adbExec(adb: string, serial: string, args: string[], ignoreError = false) {
  try {
    return execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    if (ignoreError) return "";
    throw err;
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export interface AndroidStoryboardSession {
  page: Page;
  device: AndroidDevice;
  context: BrowserContext;
  /** Stop recording, pull the raw MP4 from the emulator (if recorded), and close Chrome/device cleanly. */
  close: () => Promise<string | null>;
}

/**
 * Connect to a running Android emulator via Playwright's `_android` API,
 * forward `baseURL`'s localhost port over `adb reverse`, launch real Android Chrome,
 * clear previous site data for isolation, and optionally record the emulator screen
 * via `adb shell screenrecord`.
 */
export async function openAndroidEmulatorPage(options: {
  baseURL: string | undefined;
  dir: string;
  cursorScript: string;
  recordVideo: boolean;
}): Promise<AndroidStoryboardSession> {
  const adb = resolveAdbBinary();
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
  const port = options.baseURL ? new URL(options.baseURL).port || "80" : "4180";
  adbExec(adb, serial, ["reverse", `tcp:${port}`, `tcp:${port}`]);
  // Prevent Android's notification permission modal from blocking Chrome on first launch.
  adbExec(adb, serial, ["shell", "pm", "grant", "com.android.chrome", "android.permission.POST_NOTIFICATIONS"], true);

  // Launch Chrome on the emulator and connect Playwright via CDP.
  const context = await device.launchBrowser({
    baseURL: options.baseURL,
    acceptDownloads: true,
  });
  context.setDefaultTimeout(20000);
  await context.addInitScript(options.cursorScript);

  // Android Chrome hands blob downloads directly to Android's DownloadManager
  // and does not emit Playwright's `download` event. Capture blob `<a download>`
  // clicks into `options.dir` so storyboards using `page.waitForEvent("download")` work.
  type CapturedDownload = {
    suggestedFilename: () => string;
    path: () => Promise<string>;
    saveAs: (dest: string) => Promise<void>;
    failure: () => Promise<null>;
  };
  const pendingDownloads: Array<(d: CapturedDownload) => void> = [];
  const queuedDownloads: CapturedDownload[] = [];
  let downloadSeq = 0;
  await context.exposeFunction("__androidCaptureDownload", (filename: string, base64: string) => {
    const localPath = join(options.dir, `download-${++downloadSeq}-${filename.replace(/[^\w.-]/g, "_")}`);
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
  await context.addInitScript(`(() => {
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
            return window.__androidCaptureDownload(name, btoa(bin));
          })
          .catch(() => {});
        return;
      }
      return origClick.apply(this, arguments);
    };
  })();`);

  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  for (const extra of pages.slice(1)) {
    await extra.close().catch(() => {});
  }

  const origWaitForEvent = page.waitForEvent.bind(page);
  page.waitForEvent = ((event: string, optionsOrPredicate?: unknown) => {
    if (event === "download") {
      const queued = queuedDownloads.shift();
      if (queued) return Promise.resolve(queued);
      const timeout =
        typeof optionsOrPredicate === "object" && optionsOrPredicate && "timeout" in optionsOrPredicate
          ? Number((optionsOrPredicate as { timeout?: number }).timeout) || 20000
          : 20000;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = pendingDownloads.indexOf(onDownload);
          if (idx >= 0) pendingDownloads.splice(idx, 1);
          reject(new Error(`Timeout ${timeout}ms exceeded while waiting for Android download`));
        }, timeout);
        const onDownload = (d: CapturedDownload) => {
          clearTimeout(timer);
          resolve(d);
        };
        pendingDownloads.push(onDownload);
      });
    }
    return origWaitForEvent(event as never, optionsOrPredicate as never);
  }) as typeof page.waitForEvent;

  // Playwright's _android Page.viewportSize() returns null, which causes
  // storyboards checking `(page.viewportSize()?.width ?? 1280) < 700` to treat
  // the phone emulator as a desktop. Report the real Android Chrome viewport.
  let cachedViewport: { width: number; height: number } = { width: 412, height: 892 };
  if (options.baseURL) {
    await page.goto(options.baseURL, { waitUntil: "domcontentloaded" }).catch(() => {});
    cachedViewport = await page
      .evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
      .catch(() => ({ width: 412, height: 892 }));
    await page.evaluate(async () => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // Ignore storage errors on restricted origins.
      }
      try {
        const dbs = await indexedDB.databases?.();
        if (dbs) {
          await Promise.all(
            dbs
              .map((db) => db.name)
              .filter((name): name is string => Boolean(name))
              .map(
                (name) =>
                  new Promise<void>((resolve) => {
                    const req = indexedDB.deleteDatabase(name);
                    req.onsuccess = req.onerror = req.onblocked = () => resolve();
                  }),
              ),
          );
        }
      } catch {
        // Ignore IndexedDB cleanup errors.
      }
    });
    await page.goto("about:blank");
  }
  page.viewportSize = () => cachedViewport;

  let recorder: ChildProcess | null = null;
  let remoteVideoPath: string | null = null;
  if (options.recordVideo) {
    remoteVideoPath = `/sdcard/suiteleaf-storyboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    recorder = spawn(
      adb,
      ["-s", serial, "shell", "screenrecord", "--bit-rate", "4000000", remoteVideoPath],
      { stdio: "ignore" },
    );
  }

  const close = async (): Promise<string | null> => {
    let pulledPath: string | null = null;
    if (recorder && remoteVideoPath) {
      // Send SIGINT inside the emulator so screenrecord flushes the MP4 moov atom.
      adbExec(adb, serial, ["shell", "pkill", "-2", "screenrecord"], true);
      await waitForExit(recorder, 5000);
      if (recorder.exitCode === null) recorder.kill();
      // Give Android a brief beat to finish closing the file handle on /sdcard.
      await new Promise((r) => setTimeout(r, 400));
      const localRaw = join(options.dir, "android-raw.mp4");
      try {
        adbExec(adb, serial, ["pull", remoteVideoPath, localRaw]);
        if (existsSync(localRaw)) pulledPath = localRaw;
      } catch {
        pulledPath = null;
      } finally {
        adbExec(adb, serial, ["shell", "rm", "-f", remoteVideoPath], true);
      }
    }
    await context.close().catch(() => {});
    await device.close().catch(() => {});
    return pulledPath;
  };

  return { page, device, context, close };
}
