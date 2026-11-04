import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, type SlideFile } from "../packages/core/src";

const fake = vi.hoisted(() => {
  type Listener = (...args: any[]) => void;
  class Emitter {
    listeners = new Map<string, Listener[]>();
    on(event: string, listener: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }
    once(event: string, listener: Listener) {
      const wrapped: Listener = (...args) => {
        this.removeListener(event, wrapped);
        listener(...args);
      };
      return this.on(event, wrapped);
    }
    removeListener(event: string, listener: Listener) {
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter((l) => l !== listener),
      );
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
  }
  const ipcMain = new Emitter();
  /** What the export page answers when main sends it something. */
  const page = {
    load: (() => {
      queueMicrotask(() => ipcMain.emit("pdf:listening"));
      return Promise.resolve();
    }) as (window: FakeWindow) => Promise<void>,
    onPdf: () => queueMicrotask(() => ipcMain.emit("pdf:ready")),
    slides: [] as Record<string, number>[],
    frames: [] as Uint8Array[],
    captureSize: { width: 0, height: 0 },
  };
  const png = (n: number) =>
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n]);
  class FakeContents extends Emitter {
    destroyed = false;
    url = "suiteleaf://app/pdf-export.html";
    sent: unknown[][] = [];
    script: string[] = [];
    permissionRequest?: Listener;
    permissionCheck?: (...args: unknown[]) => boolean;
    headers?: Listener;
    openHandler?: () => unknown;
    setBackgroundThrottling = vi.fn();
    session = {
      setPermissionRequestHandler: (handler: Listener) =>
        (this.permissionRequest = handler),
      setPermissionCheckHandler: (handler: (...args: unknown[]) => boolean) =>
        (this.permissionCheck = handler),
      webRequest: {
        onHeadersReceived: (handler: Listener) => (this.headers = handler),
      },
    };
    slide = 0;
    constructor() {
      super();
    }
    isDestroyed() {
      return this.destroyed;
    }
    getURL() {
      return this.url;
    }
    setWindowOpenHandler(handler: () => unknown) {
      this.openHandler = handler;
    }
    send(channel: string, ...args: unknown[]) {
      this.sent.push([channel, ...args]);
      if (channel === "pdf:file") page.onPdf();
      if (channel === "png:file") this.slide = 0;
      if (channel === "png:file" || channel === "png:next") {
        const box = page.slides[this.slide++];
        queueMicrotask(() =>
          box
            ? ipcMain.emit("png:slide", {}, box)
            : ipcMain.emit("png:fail", {}, ""),
        );
      }
    }
    async printToPDF() {
      return new Uint8Array([1, 2, 3]);
    }
    async executeJavaScript(code: string) {
      this.script.push(code);
    }
    async capturePage(rect: { width: number; height: number }) {
      const bytes = page.frames.shift() ?? png(0);
      const size =
        page.captureSize.width > 0
          ? page.captureSize
          : { width: rect.width, height: rect.height };
      return {
        getSize: () => size,
        toPNG: () => bytes,
        resize: (to: { width: number; height: number }) => {
          resized.push(to);
          return { toPNG: () => bytes };
        },
      };
    }
  }
  const resized: { width: number; height: number }[] = [];
  const windows: FakeWindow[] = [];
  class FakeWindow {
    webContents = new FakeContents();
    destroyed = false;
    opacity = 1;
    contentSize = [100, 100];
    options: unknown;
    constructor(options: unknown) {
      this.options = options;
      windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.webContents.destroyed = true;
    }
    setBounds = vi.fn();
    setOpacity(value: number) {
      this.opacity = value;
    }
    setIgnoreMouseEvents = vi.fn();
    showInactive = vi.fn();
    loadURL() {
      return page.load(this);
    }
    getContentSize() {
      return this.contentSize;
    }
    setContentSize(width: number, height: number) {
      this.contentSize = [width, height];
    }
  }
  return { ipcMain, page, windows, FakeWindow, png, resized };
});

vi.mock("electron", () => ({
  app: { whenReady: async () => {}, dock: { hide: vi.fn() } },
  BrowserWindow: fake.FakeWindow,
  ipcMain: fake.ipcMain,
}));
vi.mock("../apps/desktop/src/app-protocol", () => ({
  registerAppProtocol: vi.fn(),
}));
vi.mock("../apps/desktop/src/pdf-page-box", () => ({
  restorePrintPageBox: (bytes: Uint8Array, width: number, height: number) => ({
    bytes,
    width,
    height,
  }),
}));

type Host = typeof import("../apps/desktop/src/pdf-export-host");
let host: Host;

const deck = (pointWidth?: number, pointHeight?: number) => {
  const file = createFile("slide", "Deck") as SlideFile;
  file.content.pointWidth = pointWidth;
  file.content.pointHeight = pointHeight;
  return file;
};
const box = (index: number, count: number, extra = {}) => ({
  index,
  count,
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  ...extra,
});

beforeEach(async () => {
  vi.resetModules();
  fake.windows.length = 0;
  fake.resized.length = 0;
  fake.page.slides = [];
  fake.page.frames = [];
  fake.page.captureSize = { width: 0, height: 0 };
  fake.page.load = () => {
    queueMicrotask(() => fake.ipcMain.emit("pdf:listening"));
    return Promise.resolve();
  };
  fake.page.onPdf = () => queueMicrotask(() => fake.ipcMain.emit("pdf:ready"));
  host = await import("../apps/desktop/src/pdf-export-host");
});

describe("PDF export window", () => {
  it("opens one locked-down hidden window and prints presentations in it", async () => {
    const render = await host.openPdfExportWindow();
    expect(fake.windows).toHaveLength(1);
    const [window] = fake.windows;
    expect(window.opacity).toBe(0);
    expect(window.showInactive).toHaveBeenCalled();
    const contents = window.webContents;

    const allow = vi.fn();
    contents.permissionRequest!(contents, "camera", allow);
    expect(allow).toHaveBeenCalledWith(false);
    expect(contents.permissionCheck!()).toBe(false);
    const headers = vi.fn();
    contents.headers!({ responseHeaders: { a: ["b"] } }, headers);
    expect(headers.mock.calls[0][0].responseHeaders).toMatchObject({
      a: ["b"],
      "Content-Security-Policy": [expect.stringContaining("object-src 'none'")],
    });
    expect(contents.openHandler!()).toEqual({ action: "deny" });
    const away = { preventDefault: vi.fn() };
    contents.emit("will-navigate", away, "https://example.com/");
    expect(away.preventDefault).toHaveBeenCalled();
    const hash = { preventDefault: vi.fn() };
    contents.emit("will-navigate", hash, "suiteleaf://app/pdf-export.html#x");
    expect(hash.preventDefault).not.toHaveBeenCalled();

    expect(await render(deck(720, 405))).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      width: 720,
      height: 405,
    });
    expect(await render(deck())).toEqual(new Uint8Array([1, 2, 3]));
    await expect(render(createFile("doc", "Doc"))).rejects.toThrow(
      "Only a presentation can be exported as PDF.",
    );
    await host.openPdfExportWindow();
    expect(fake.windows).toHaveLength(1);
  });

  it("passes the page's failure message on", async () => {
    const render = await host.openPdfExportWindow();
    fake.page.onPdf = () =>
      queueMicrotask(() => fake.ipcMain.emit("pdf:fail", {}, "Bad font"));
    await expect(render(deck())).rejects.toThrow("Bad font");
    fake.page.onPdf = () =>
      queueMicrotask(() => fake.ipcMain.emit("pdf:fail", {}, ""));
    await expect(render(deck())).rejects.toThrow("PDF export failed.");
  });

  it("refuses to print after its page closed", async () => {
    const render = await host.openPdfExportWindow();
    fake.windows[0].webContents.destroyed = true;
    await expect(render(deck())).rejects.toThrow("PDF export page closed.");
  });

  it("destroys a window whose page fails to load and opens a new one next time", async () => {
    fake.page.load = () => Promise.reject("load failed");
    await expect(host.openPdfExportWindow()).rejects.toThrow("load failed");
    expect(fake.windows[0].destroyed).toBe(true);
    fake.page.load = () => {
      queueMicrotask(() => fake.ipcMain.emit("pdf:listening"));
      return Promise.resolve();
    };
    await host.openPdfExportWindow();
    expect(fake.windows).toHaveLength(2);
  });

  it("names the page's console output when it never starts listening", async () => {
    vi.useFakeTimers();
    try {
      fake.page.load = (window) => {
        window.webContents.emit("console-message", {}, 0, "");
        for (let i = 0; i < 10; i++)
          window.webContents.emit("console-message", {}, 0, `log ${i}`);
        return Promise.resolve();
      };
      const opening = host.openPdfExportWindow();
      const failed = expect(opening).rejects.toThrow(
        "PDF export page did not load. log 2 log 3 log 4 log 5 log 6 log 7 log 8 log 9",
      );
      await vi.advanceTimersByTimeAsync(60_000);
      await failed;
    } finally {
      vi.useRealTimers();
    }
  });

  it("replaces a window that was destroyed", async () => {
    await host.openPdfExportWindow();
    fake.windows[0].destroy();
    await host.openPdfExportWindow();
    expect(fake.windows).toHaveLength(2);
  });
});

describe("PNG export", () => {
  it("captures each slide in order, resizing the window and picture as needed", async () => {
    const render = await host.openPngExportWindow();
    fake.page.slides = [box(0, 2, { width: 300 }), box(1, 2, { y: 80 })];
    fake.page.captureSize = { width: 600, height: 100 };
    fake.page.frames = [fake.png(1), fake.png(1), fake.png(2)];
    const slides = await render(deck());
    expect(slides).toEqual([fake.png(1), fake.png(2)]);
    const [window] = fake.windows;
    expect(window.contentSize).toEqual([300, 130]);
    expect(fake.resized[0]).toEqual({ width: 300, height: 50, quality: "best" });
    // The repeated frame waited for another paint before it was captured again.
    expect(window.webContents.script.filter((s) => s.includes("requestAnimationFrame(resolve)"))).not.toHaveLength(0);
    expect(window.webContents.sent.map(([channel]) => channel)).toEqual([
      "png:file",
      "png:next",
    ]);
    expect(window.opacity).toBe(0);
  });

  it("rejects slides the page reports out of order or with bad bounds", async () => {
    await host.openPngExportWindow();
    fake.page.slides = [box(1, 2)];
    await expect(host.renderPresentationPngs(deck())).rejects.toThrow(
      "Slides were exported out of order.",
    );
    for (const bad of [
      box(0, 1, { width: 0 }),
      box(0, 1, { height: 9000 }),
      box(0, 0),
      box(0, 1, { x: Number.NaN }),
    ]) {
      fake.page.slides = [bad];
      await expect(host.renderPresentationPngs(deck())).rejects.toThrow(
        "PNG export reported a slide that cannot be saved.",
      );
    }
  });

  it("rejects a capture that is not a PNG and a page failure", async () => {
    fake.page.slides = [box(0, 1)];
    fake.page.frames = [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])];
    await expect(host.renderPresentationPngs(deck())).rejects.toThrow(
      "Export did not produce a PNG.",
    );
    fake.page.slides = [];
    await expect(host.renderPresentationPngs(deck())).rejects.toThrow(
      "PNG export failed.",
    );
  });

  it("only exports presentations, from a live page", async () => {
    await expect(
      host.renderPresentationPngs(createFile("sheet", "Sheet")),
    ).rejects.toThrow("Only a presentation can be exported as PNG.");
    fake.windows[0].webContents.destroyed = true;
    await expect(host.renderPresentationPngs(deck())).rejects.toThrow(
      "PNG export page closed.",
    );
  });
});
