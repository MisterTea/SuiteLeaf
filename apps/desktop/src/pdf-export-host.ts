import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import type { SuiteFile } from "@suiteleaf/core";
import { serializeFile } from "@suiteleaf/core";
import { registerAppProtocol } from "./app-protocol";
import type { PdfRenderer } from "./convert-cli";

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
  return bytes;
}

/** Hidden window that prints imported presentations. It never writes the library. */
export async function openPdfExportWindow(): Promise<PdfRenderer> {
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
    pdfWindow.setOpacity(0);
    pdfWindow.setIgnoreMouseEvents(true);
    await pdfWindow.loadURL("suiteleaf://app/pdf-export.html");
    pdfWindow.showInactive();
    await listening;
  } catch (error) {
    if (!pdfWindow.isDestroyed()) pdfWindow.destroy();
    throw error instanceof Error ? error : new Error(String(error));
  }
  return (file) => renderPresentation(pdfWindow, file);
}
