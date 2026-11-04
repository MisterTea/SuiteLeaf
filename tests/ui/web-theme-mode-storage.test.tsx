// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile } from "../../packages/core/src";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
  };
}

type Listener = (event: { matches: boolean }) => void;
function installMedia(dark: boolean, legacy = false) {
  const listeners = new Set<Listener>();
  const query = {
    matches: dark,
    ...(legacy
      ? {
          addListener: (l: Listener) => listeners.add(l),
          removeListener: (l: Listener) => listeners.delete(l),
        }
      : {
          addEventListener: (_: string, l: Listener) => listeners.add(l),
          removeEventListener: (_: string, l: Listener) => listeners.delete(l),
        }),
  };
  window.matchMedia = (() => query) as never;
  return {
    change(next: boolean) {
      query.matches = next;
      for (const l of [...listeners]) l({ matches: next });
    },
    listeners,
  };
}

beforeEach(() => {
  vi.resetModules();
  for (const name of ["localStorage", "sessionStorage"])
    Object.defineProperty(globalThis, name, { value: memoryStorage(), configurable: true });
  delete window.suiteleaf;
  document.documentElement.className = "";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("theme", () => {
  it("starts from the saved choice and marks the page", async () => {
    localStorage.setItem("suiteleaf_theme_mode", "dark");
    installMedia(false);
    const theme = await import("../../apps/web/src/theme");
    expect(theme.getThemeMode()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.classList.contains("univer-dark")).toBe(true);
    theme.setThemeMode("light");
    expect(localStorage.getItem("suiteleaf_theme_mode")).toBe("light");
    expect(document.documentElement.className).toBe("light-theme");
    theme.setThemeMode("system");
    expect(localStorage.getItem("suiteleaf_theme_mode")).toBeNull();
    expect(document.documentElement.dataset.themeMode).toBe("system");
  });

  it("ignores an unknown saved value and follows the system", async () => {
    localStorage.setItem("suiteleaf_theme_mode", "purple");
    const media = installMedia(true);
    const theme = await import("../../apps/web/src/theme");
    expect(theme.getThemeMode()).toBe("system");
    expect(theme.getEffectiveTheme()).toBe("dark");
    expect(theme.getEffectiveTheme("light")).toBe("light");
    media.change(false);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("keeps working when the choice cannot be saved", async () => {
    installMedia(false, true);
    const theme = await import("../../apps/web/src/theme");
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    theme.setThemeMode("dark");
    expect(theme.getThemeMode()).toBe("dark");
    theme.setThemeMode("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("cycles system, dark, light in the toggle and follows system changes", async () => {
    const media = installMedia(false);
    const { useTheme } = await import("../../apps/web/src/theme");
    let toggle = () => {};
    function Probe() {
      const theme = useTheme();
      toggle = theme.toggleTheme;
      return <p>{`${theme.mode} ${theme.isDark ? "dark" : "light"}`}</p>;
    }
    render(<Probe />);
    expect(screen.getByText("system light")).toBeTruthy();
    act(() => media.change(true));
    expect(screen.getByText("system dark")).toBeTruthy();
    act(() => toggle());
    expect(screen.getByText("dark dark")).toBeTruthy();
    act(() => toggle());
    expect(screen.getByText("light light")).toBeTruthy();
    act(() => toggle());
    expect(screen.getByText("system dark")).toBeTruthy();
    cleanup();
    expect(media.listeners.size).toBe(1);
  });

  it("follows system changes with the older listener API", async () => {
    const media = installMedia(false, true);
    const { useTheme } = await import("../../apps/web/src/theme");
    function Probe() {
      return <p>{useTheme().isDark ? "dark" : "light"}</p>;
    }
    render(<Probe />);
    act(() => media.change(true));
    expect(screen.getByText("dark")).toBeTruthy();
    cleanup();
    expect(media.listeners.size).toBe(1);
  });

  it("works without matchMedia", async () => {
    vi.stubGlobal("matchMedia", undefined);
    const theme = await import("../../apps/web/src/theme");
    expect(theme.getEffectiveTheme("system")).toBe("light");
    function Probe() {
      return <p>{theme.useTheme().isDark ? "dark" : "light"}</p>;
    }
    render(<Probe />);
    expect(screen.getByText("light")).toBeTruthy();
  });
});

describe("app mode", () => {
  const info = (body: unknown, ok = true) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: ok ? 200 : 503 }));
  const node = { name: "SuiteLeaf node", mode: "cluster", auth: { enabled: true } };

  it("normalizes a server address and tries http after https", async () => {
    const { probeServer } = await import("../../apps/web/src/mode");
    const fetcher = vi.fn((url: string) =>
      url.startsWith("https:") ? Promise.reject(new Error("TLS")) : info(node),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await probeServer("  suite.example.com/leaf/  ")).toBe("http://suite.example.com/leaf");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://suite.example.com/leaf/api/node/info",
      "http://suite.example.com/leaf/api/node/info",
    ]);
    fetcher.mockClear();
    fetcher.mockImplementation(() => info(node));
    expect(await probeServer("https://suite.example.com")).toBe("https://suite.example.com");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("explains addresses and servers it cannot use", async () => {
    const { probeServer } = await import("../../apps/web/src/mode");
    await expect(probeServer("http://")).rejects.toThrow("Enter a server address such as suiteleaf.example.com.");
    await expect(probeServer("ftp://x.example")).rejects.toThrow("Use an http:// or https:// address.");
    vi.stubGlobal("fetch", () => info({ name: "Other" }));
    await expect(probeServer("x.example")).rejects.toThrow("No SuiteLeaf server answered at that address.");
    vi.stubGlobal("fetch", () => info({}, false));
    await expect(probeServer("x.example")).rejects.toThrow("No SuiteLeaf server answered");
    vi.stubGlobal("fetch", () => info({ ...node, auth: { enabled: false } }));
    await expect(probeServer("x.example")).rejects.toThrow("sign-in service is not running yet");
  });

  it("times out a probe without AbortSignal.timeout", async () => {
    vi.useFakeTimers();
    const timeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")!;
    try {
      Object.defineProperty(AbortSignal, "timeout", { value: undefined, configurable: true });
      const { probeServer } = await import("../../apps/web/src/mode");
      vi.stubGlobal(
        "fetch",
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) =>
            init.signal!.addEventListener("abort", () => reject(new Error("aborted"))),
          ),
      );
      const probe = expect(probeServer("https://slow.example")).rejects.toThrow("No SuiteLeaf server");
      await vi.advanceTimersByTimeAsync(10_000);
      await probe;
    } finally {
      vi.useRealTimers();
      Object.defineProperty(AbortSignal, "timeout", timeout);
    }
  });

  it("is a locked single-user demo in the demo build", async () => {
    vi.stubEnv("VITE_SUITELEAF_DEMO", "1");
    const { resolveMode, isDemo } = await import("../../apps/web/src/mode");
    expect(isDemo).toBe(true);
    expect(await resolveMode()).toEqual({ mode: { kind: "single" }, locked: true, demo: true });
  });

  it("asks the desktop app for its mode", async () => {
    window.suiteleaf = { getMode: async () => ({ kind: "cluster", serverUrl: "https://n" }) } as never;
    const { resolveMode } = await import("../../apps/web/src/mode");
    expect(await resolveMode()).toEqual({
      mode: { kind: "cluster", serverUrl: "https://n" },
      locked: false,
      demo: false,
    });
  });

  it("locks to the node that serves the page", async () => {
    vi.stubGlobal("fetch", () => info(node));
    const { resolveMode } = await import("../../apps/web/src/mode");
    expect(await resolveMode()).toEqual({
      mode: { kind: "cluster", serverUrl: "http://127.0.0.1:4173" },
      locked: true,
      demo: false,
    });
  });

  it("uses a saved mode, or single-user mode when the saved one is broken", async () => {
    vi.stubGlobal("fetch", () => info({ name: "static host" }));
    const { resolveMode } = await import("../../apps/web/src/mode");
    localStorage.setItem("suiteleaf:mode", JSON.stringify({ kind: "cluster", serverUrl: "https://n" }));
    expect((await resolveMode()).mode).toEqual({ kind: "cluster", serverUrl: "https://n" });
    localStorage.setItem("suiteleaf:mode", "{broken");
    expect((await resolveMode()).mode).toEqual({ kind: "single" });
    localStorage.setItem("suiteleaf:mode", JSON.stringify({ kind: "cluster" }));
    expect((await resolveMode()).mode).toEqual({ kind: "single" });
  });

  it("saves a new mode and reloads, or hands it to the desktop app", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      reload,
      hash: "",
    } as Location);
    const { switchMode } = await import("../../apps/web/src/mode");
    await switchMode({ kind: "cluster", serverUrl: "https://n" });
    expect(JSON.parse(localStorage.getItem("suiteleaf:mode")!)).toEqual({
      kind: "cluster",
      serverUrl: "https://n",
    });
    await switchMode({ kind: "single" });
    expect(localStorage.getItem("suiteleaf:mode")).toBeNull();
    expect(reload).toHaveBeenCalledTimes(2);
    const setMode = vi.fn(async () => {});
    window.suiteleaf = { setMode } as never;
    await switchMode({ kind: "single" });
    expect(setMode).toHaveBeenCalledWith({ kind: "single" });
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("remembers the server it disconnected from once", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload } as Location);
    const { disconnect, leftServer, forgetLeftServer } = await import("../../apps/web/src/mode");
    await disconnect("https://suite.example.com:8443/");
    expect(leftServer()).toBe("suite.example.com:8443");
    forgetLeftServer();
    expect(leftServer()).toBeNull();
    expect(reload).toHaveBeenCalled();
  });
});

describe("browser storage", () => {
  it("downloads exports and Save As in the browser", async () => {
    const created: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        return "blob:x";
      },
      revokeObjectURL: vi.fn(),
    }));
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const { storage, exportText, exportBinary, printDocument } = await import("../../apps/web/src/storage");
    const record = { file: createFile("doc", "Notes") };
    expect(await storage.saveAs(record)).toBe(record);
    expect(await storage.open()).toBeNull();
    expect(await exportText("a.txt", "hello")).toBeUndefined();
    await exportBinary("a.bin", new Uint8Array([1, 2]), "application/octet-stream");
    await printDocument("T");
    expect(clicks).toEqual(["Notes.sldoc", "a.txt", "a.bin"]);
    expect(created.map((b) => b.type)).toEqual([
      "application/vnd.suiteleaf.doc+json",
      "text/plain",
      "application/octet-stream",
    ]);
    expect(await created[1].text()).toBe("hello");
    expect(print).toHaveBeenCalled();
  });

  it("uses the desktop bridge when there is one", async () => {
    const exportFile = vi.fn(async () => "/saved");
    const print = vi.fn(async () => {});
    window.suiteleaf = { exportFile, print } as never;
    const { storage, exportText, exportBinary, printDocument } = await import("../../apps/web/src/storage");
    expect(storage).toBe(window.suiteleaf);
    expect(await exportText("a.txt", "x")).toBe("/saved");
    expect(await exportBinary("a.bin", new Uint8Array([1]), "x")).toBe("/saved");
    await printDocument("Title");
    expect(print).toHaveBeenCalledWith("Title");
  });

  it("keeps writes in order after one fails", async () => {
    const { SaveQueue } = await import("../../apps/web/src/storage");
    const queue = new SaveQueue();
    const order: number[] = [];
    const first = queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push(1);
      throw new Error("x");
    });
    const second = queue.enqueue(async () => {
      order.push(2);
      return "ok";
    });
    await expect(first).rejects.toThrow("x");
    expect(await second).toBe("ok");
    await queue.flush();
    expect(order).toEqual([1, 2]);
  });
});
