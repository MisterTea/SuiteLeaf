import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import type { SuiteFile } from "@suiteleaf/core";
import { serializeFile } from "@suiteleaf/core";
import { registerAppProtocol } from "./app-protocol";
import type { PdfRenderer, PngRenderer } from "./convert-cli";
import { restorePrintPageBox } from "./pdf-page-box";

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

function installPage(pdfWindow: BrowserWindow) {
  const contents = pdfWindow.webContents;
  contents.setBackgroundThrottling(false);
  contents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    }),
  );
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (url.split("#")[0] !== contents.getURL().split("#")[0])
      event.preventDefault();
  });
}

function waitFor(timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error("PDF export timed out.")),
      timeoutMs,
    );
    const onReady = () => finish();
    const onFail = (_event: unknown, message: unknown) =>
      finish(
        new Error(
          typeof message === "string" && message
            ? message
            : "PDF export failed.",
        ),
      );
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener("pdf:ready", onReady);
      ipcMain.removeListener("pdf:fail", onFail);
      if (error) reject(error);
      else resolve();
    };
    ipcMain.on("pdf:ready", onReady);
    ipcMain.on("pdf:fail", onFail);
  });
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

type SlideBounds = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
};

function waitForSlide(timeoutMs: number): Promise<SlideBounds> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error("PNG export timed out.")),
      timeoutMs,
    );
    const onSlide = (_event: unknown, payload: unknown) => {
      const box = payload as Partial<SlideBounds>;
      if (
        !box ||
        ![box.index, box.x, box.y, box.width, box.height, box.count].every(
          (value) => typeof value === "number" && Number.isFinite(value),
        ) ||
        box.width! <= 0 ||
        box.height! <= 0 ||
        box.width! > 8192 ||
        box.height! > 8192 ||
        box.count! < 1
      ) {
        finish(new Error("PNG export reported a slide that cannot be saved."));
        return;
      }
      finish(undefined, box as SlideBounds);
    };
    const onFail = (_event: unknown, message: unknown) =>
      finish(
        new Error(
          typeof message === "string" && message
            ? message
            : "PNG export failed.",
        ),
      );
    const finish = (error?: Error, box?: SlideBounds) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener("png:slide", onSlide);
      ipcMain.removeListener("png:fail", onFail);
      ipcMain.removeListener("pdf:fail", onFail);
      if (error) reject(error);
      else resolve(box!);
    };
    ipcMain.on("png:slide", onSlide);
    ipcMain.on("png:fail", onFail);
    ipcMain.on("pdf:fail", onFail);
  });
}

async function renderPngSlides(
  pdfWindow: BrowserWindow,
  file: SuiteFile,
): Promise<Uint8Array[]> {
  if (file.kind !== "slide")
    throw new Error("Only a presentation can be exported as PNG.");
  if (pdfWindow.webContents.isDestroyed())
    throw new Error("PNG export page closed.");
  const slides: Uint8Array[] = [];
  let pending = waitForSlide(120000);
  pdfWindow.setOpacity(1);
  try {
    pdfWindow.webContents.send("png:file", serializeFile(file));
    for (;;) {
      const bounds = await pending;
      if (bounds.index !== slides.length)
        throw new Error("Slides were exported out of order.");
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      const [contentWidth, contentHeight] = pdfWindow.getContentSize();
      if (
        contentWidth < bounds.x + width ||
        contentHeight < bounds.y + height
      ) {
        pdfWindow.setContentSize(
          Math.max(contentWidth, Math.ceil(bounds.x + width)),
          Math.max(contentHeight, Math.ceil(bounds.y + height)),
        );
      }
      await pdfWindow.webContents.executeJavaScript(
        `new Promise((resolve, reject) => {
          const want = ${bounds.index};
          const start = performance.now();
          const frame = () => document.querySelector(".slides-png-frame");
          const wait = () => {
            if (performance.now() - start > 10000) {
              reject(new Error("The slide did not finish painting."));
              return;
            }
            const node = frame();
            if (!node || node.dataset.exportIndex !== String(want)) {
              requestAnimationFrame(wait);
              return;
            }
            const images = [...node.querySelectorAll("img")];
            if (images.some((img) => !img.complete || img.naturalWidth === 0)) {
              requestAnimationFrame(wait);
              return;
            }
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          };
          wait();
        })`,
        true,
      );
      const rect = {
        x: Math.max(0, Math.round(bounds.x)),
        y: Math.max(0, Math.round(bounds.y)),
        width,
        height,
      };
      // capturePage can return the previous slide's frame. Keep the first
      // picture that is not a copy of the slide just saved.
      const previous = slides[slides.length - 1];
      let bytes = new Uint8Array();
      const deadline = Date.now() + 1500;
      for (;;) {
        const image = await pdfWindow.webContents.capturePage(rect);
        const size = image.getSize();
        const fitted =
          size.width === width && size.height === height
            ? image
            : image.resize({ width, height, quality: "best" });
        bytes = new Uint8Array(fitted.toPNG());
        if (!previous || !sameBytes(previous, bytes) || Date.now() > deadline)
          break;
        await pdfWindow.webContents.executeJavaScript(
          "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
          true,
        );
      }
      if (bytes.length < 8 || bytes[0] !== 0x89)
        throw new Error("Export did not produce a PNG.");
      slides.push(bytes);
      if (bounds.index + 1 >= bounds.count) return slides;
      pending = waitForSlide(120000);
      pdfWindow.webContents.send("png:next");
    }
  } finally {
    if (!pdfWindow.isDestroyed()) pdfWindow.setOpacity(0);
  }
}

async function renderPresentation(
  pdfWindow: BrowserWindow,
  file: SuiteFile,
): Promise<Uint8Array> {
  if (file.kind !== "slide")
    throw new Error("Only a presentation can be exported as PDF.");
  if (pdfWindow.webContents.isDestroyed())
    throw new Error("PDF export page closed.");
  const pending = waitFor(120000);
  pdfWindow.webContents.send("pdf:file", serializeFile(file));
  await pending;
  const bytes = await pdfWindow.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  const { pointWidth, pointHeight } = file.content;
  if (!(pointWidth && pointHeight)) return bytes;
  return restorePrintPageBox(bytes, pointWidth, pointHeight);
}

let opening: Promise<BrowserWindow> | null = null;

async function createExportWindow() {
  await app.whenReady();
  app.dock?.hide();
  registerAppProtocol();
  const pdfWindow = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    width: 1600,
    height: 1000,
    title: "SuiteLeaf PDF",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      // An on-screen window is captured in the display's color profile, which
      // blends translucent fills differently from PowerPoint's sRGB export.
      offscreen: { deviceScaleFactor: 1 },
    },
  });
  installPage(pdfWindow);
  const logs: string[] = [];
  pdfWindow.webContents.on("console-message", (_event, _level, message) => {
    if (message) logs.push(message);
    if (logs.length > 8) logs.shift();
  });
  const listening = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const detail = logs.length ? ` ${logs.join(" ")}` : "";
      reject(new Error(`PDF export page did not load.${detail}`));
    }, 60_000);
    ipcMain.once("pdf:listening", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  try {
    // Off screen, but opaque while a PNG is captured. printToPDF does not use this.
    pdfWindow.setBounds({ x: -32000, y: 0, width: 2560, height: 1600 });
    pdfWindow.setOpacity(0);
    pdfWindow.setIgnoreMouseEvents(true);
    await pdfWindow.loadURL("suiteleaf://app/pdf-export.html");
    pdfWindow.showInactive();
    await listening;
  } catch (error) {
    if (!pdfWindow.isDestroyed()) pdfWindow.destroy();
    throw error instanceof Error ? error : new Error(String(error));
  }
  return pdfWindow;
}

/** Hidden window that prints imported presentations. It never writes the library. */
async function slideExportWindow(): Promise<BrowserWindow> {
  if (opening) {
    const existing = await opening;
    if (!existing.isDestroyed()) return existing;
    opening = null;
  }
  opening = createExportWindow().catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}

let exportQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = exportQueue.then(job, job);
  exportQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function openPdfExportWindow(): Promise<PdfRenderer> {
  const pdfWindow = await slideExportWindow();
  return (file) => enqueue(() => renderPresentation(pdfWindow, file));
}

/** PNG bytes for one presentation. The app menu and `convert --to png` both use this. */
export function renderPresentationPngs(file: SuiteFile) {
  return enqueue(() =>
    slideExportWindow().then((pdfWindow) => renderPngSlides(pdfWindow, file)),
  );
}

export async function openPngExportWindow(): Promise<PngRenderer> {
  await slideExportWindow();
  return renderPresentationPngs;
}
