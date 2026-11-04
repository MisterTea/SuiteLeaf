import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "@suiteleaf/core";

const electron = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const exposed: Record<string, unknown> = {};
  const ipcRenderer = {
    invoke: vi.fn(async (...args: unknown[]) => args),
    send: vi.fn(),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
    }),
    removeListener: vi.fn(
      (channel: string, listener: (...args: unknown[]) => void) => {
        listeners.get(channel)?.delete(listener);
      },
    ),
  };
  const emit = (channel: string, ...args: unknown[]) => {
    for (const listener of [...(listeners.get(channel) ?? [])])
      listener({}, ...args);
  };
  return { listeners, exposed, ipcRenderer, emit };
});

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, value: unknown) => {
      electron.exposed[name] = value;
    },
  },
  ipcRenderer: electron.ipcRenderer,
}));

type PdfBridge = {
  listen(callback: (json: string) => void): void;
  listenPng(callback: (json: string) => void): void;
  onPngNext(callback: () => void): void;
  ready(): void;
  fail(message: string): void;
  pngFail(message: string): void;
  slide(bounds: unknown): void;
};

let bridge: Required<DesktopBridge> & { ai: Required<NonNullable<DesktopBridge["ai"]>> };
let pdf: PdfBridge;

beforeAll(async () => {
  await import("../apps/desktop/src/preload");
  bridge = electron.exposed.suiteleaf as typeof bridge;
  pdf = electron.exposed.suiteleafPdf as PdfBridge;
});

describe("desktop preload bridge", () => {
  it("forwards each file API to its main-process channel", async () => {
    const record = { file: { id: "a" } } as never;
    const calls: [Promise<unknown>, unknown[]][] = [
      [bridge.getDocumentsDirectory(), ["documents:get"]],
      [bridge.chooseDocumentsDirectory(), ["documents:choose"]],
      [bridge.reload("a"), ["files:reload", "a"]],
      [bridge.listFolders(), ["folders:list"]],
      [bridge.createFolder("x", "y"), ["folders:create", "x", "y"]],
      [bridge.renameFolder("x", "z"), ["folders:rename", "x", "z"]],
      [bridge.moveFolder("x", "w"), ["folders:move", "x", "w"]],
      [bridge.moveFile("a", "w"), ["files:move", "a", "w"]],
      [bridge.list(), ["files:list"]],
      [bridge.get("a"), ["files:get", "a"]],
      [bridge.save(record), ["files:save", record]],
      [bridge.remove("a"), ["files:remove", "a"]],
      [bridge.open(), ["files:open"]],
      [bridge.saveAs(record), ["files:save-as", record]],
      [bridge.exportFile("n.txt", "t"), ["files:export", "n.txt", "t"]],
      [bridge.exportSlidesPng("{}"), ["slides:export-png", "{}"]],
      [bridge.print("Title"), ["print", "Title"]],
      [bridge.getMode(), ["mode:get"]],
      [bridge.setMode({ kind: "single" }), ["mode:set", { kind: "single" }]],
      [bridge.authWindow("https://x"), ["auth:window", "https://x"]],
      [bridge.ai.status(), ["ai:status"]],
      [bridge.ai.load("frognano-4b"), ["ai:load", "frognano-4b"]],
      [bridge.ai.removeDownloaded("m.gguf"), ["ai:remove", "m.gguf"]],
      [bridge.ai.chatTemplate(), ["ai:template"]],
    ];
    for (const [promise, args] of calls) expect(await promise).toEqual(args);
  });

  it("sends the dirty flag", () => {
    bridge.setDirty(true);
    expect(electron.ipcRenderer.send).toHaveBeenCalledWith("dirty", true);
  });

  it("subscribes and unsubscribes file-change and menu listeners", () => {
    const changed = vi.fn();
    const stopChanged = bridge.onFilesChanged(changed);
    electron.emit("files:changed");
    expect(changed).toHaveBeenCalledTimes(1);
    stopChanged();
    electron.emit("files:changed");
    expect(changed).toHaveBeenCalledTimes(1);

    const menu = vi.fn();
    const stopMenu = bridge.onMenu(menu);
    electron.emit("menu", "save");
    expect(menu).toHaveBeenCalledWith("save");
    stopMenu();
    electron.emit("menu", "open");
    expect(menu).toHaveBeenCalledTimes(1);

    const status = vi.fn();
    const stopStatus = bridge.ai.onStatus(status);
    electron.emit("ai:status", { state: "ready" });
    expect(status).toHaveBeenCalledWith({ state: "ready" });
    stopStatus();
    electron.emit("ai:status", { state: "idle" });
    expect(status).toHaveBeenCalledTimes(1);
  });

  it("streams one generation's events and stops listening after it ends", () => {
    const events: unknown[] = [];
    const abort = bridge.ai.generate(
      { prompt: "hi", maxTokens: 4, stop: [] } as never,
      (event) => events.push(event),
    );
    const [channel, id, request] = electron.ipcRenderer.send.mock.calls.at(
      -1,
    )!;
    expect(channel).toBe("ai:generate");
    expect(request).toMatchObject({ prompt: "hi" });
    electron.emit("ai:event", "someone-else", { type: "text", text: "no" });
    electron.emit("ai:event", id, { type: "text", text: "he" });
    electron.emit("ai:event", id, { type: "done", reason: "stop" });
    electron.emit("ai:event", id, { type: "text", text: "late" });
    expect(events).toEqual([
      { type: "text", text: "he" },
      { type: "done", reason: "stop" },
    ]);
    abort();
    expect(electron.ipcRenderer.send).toHaveBeenLastCalledWith("ai:abort", id);
  });

  it("delivers export pages their files and reports results", () => {
    const pdfFile = vi.fn();
    pdf.listen(pdfFile);
    pdf.listen(pdfFile);
    expect(
      electron.ipcRenderer.send.mock.calls.filter(
        ([channel]) => channel === "pdf:listening",
      ),
    ).toHaveLength(1);
    electron.emit("pdf:file", "{\"a\":1}");
    electron.emit("pdf:file", 42);
    expect(pdfFile).toHaveBeenCalledExactlyOnceWith("{\"a\":1}");

    const pngFile = vi.fn();
    pdf.listenPng(pngFile);
    electron.emit("png:file", "{}");
    electron.emit("png:file", null);
    expect(pngFile).toHaveBeenCalledExactlyOnceWith("{}");

    const next = vi.fn();
    pdf.onPngNext(next);
    electron.emit("png:next");
    expect(next).toHaveBeenCalledTimes(1);

    pdf.ready();
    expect(electron.ipcRenderer.send).toHaveBeenLastCalledWith("pdf:ready");
    pdf.fail("x".repeat(600));
    expect(electron.ipcRenderer.send).toHaveBeenLastCalledWith(
      "pdf:fail",
      "x".repeat(500),
    );
    pdf.pngFail("bad");
    expect(electron.ipcRenderer.send).toHaveBeenLastCalledWith(
      "png:fail",
      "bad",
    );
    pdf.slide({ index: 0 });
    expect(electron.ipcRenderer.send).toHaveBeenLastCalledWith("png:slide", {
      index: 0,
    });
  });
});
