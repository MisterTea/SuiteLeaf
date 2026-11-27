// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    },
    configurable: true,
  });
});

import type { AndroidUpdateInfo, DesktopBridge, GoogleDriveStatus } from "../../packages/core/src";
import { SettingsPage } from "../../apps/web/src/document-settings";
import { AndroidUpdateBanner, GoogleDriveBanner } from "../../apps/web/src/home/home-parts";
import { AssistantSettings, assistantWhere } from "../../apps/web/src/ai/assistant-settings";
import { ModeContext } from "../../apps/web/src/mode";

afterEach(() => {
  cleanup();
  delete window.suiteleaf;
});

describe("Android Single-Node Settings & Companion UI", () => {
  it("shows Google Drive Sync card in Settings and signs in / syncs / signs out", async () => {
    let current: GoogleDriveStatus = {
      connected: false,
      folderName: "My Drive/SuiteLeaf",
      syncing: false,
      pendingUploads: 0,
    };
    const listeners = new Set<(s: GoogleDriveStatus) => void>();
    const rescan = vi.fn(async () => {});

    window.suiteleaf = {
      platform: "android",
      onMenu: () => () => {},
      rescanDocumentsDirectory: rescan,
      googleDrive: {
        status: async () => current,
        signIn: async () => {
          current = {
            connected: true,
            accountEmail: "alex@example.com",
            folderName: "My Drive/SuiteLeaf",
            syncing: false,
            lastSyncedAt: "2026-11-27T01:00:00.000Z",
            pendingUploads: 0,
          };
          listeners.forEach((cb) => cb(current));
          return current;
        },
        signOut: async () => {
          current = {
            connected: false,
            folderName: "My Drive/SuiteLeaf",
            syncing: false,
            pendingUploads: 0,
          };
          listeners.forEach((cb) => cb(current));
        },
        onStatus: (cb) => {
          listeners.add(cb);
          return () => void listeners.delete(cb);
        },
      },
    } as unknown as DesktopBridge;

    render(
      <ModeContext.Provider value={{ mode: { kind: "single" }, locked: false, demo: false }}>
        <MemoryRouter initialEntries={["/settings"]}>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      </ModeContext.Provider>,
    );

    const user = userEvent.setup();
    expect(screen.getByRole("heading", { name: "Google Drive Sync" })).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "Sign in with Google" }));
    await screen.findByText(/Connected as alex@example\.com/);

    await user.click(screen.getByRole("button", { name: "Sync now" }));
    expect(rescan).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("button", { name: "Sign in with Google" });
  });

  it("shows dismissible Google Drive companion banner when signed out on Android", async () => {
    window.suiteleaf = {
      platform: "android",
      googleDrive: {
        status: async () => ({
          connected: false,
          folderName: "My Drive/SuiteLeaf",
          syncing: false,
          pendingUploads: 0,
        }),
        signIn: vi.fn(),
        signOut: vi.fn(),
        onStatus: () => () => {},
      },
    } as unknown as DesktopBridge;

    render(<GoogleDriveBanner />);
    const btn = await screen.findByRole("button", { name: "Connect Google Drive" });
    expect(btn).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Dismiss Google Drive notice" }));
    expect(screen.queryByRole("button", { name: "Connect Google Drive" })).toBeNull();
  });

  it("displays Android AICore assistant settings and hides desktop GGUF model picker", () => {
    window.suiteleaf = {
      platform: "android",
      ai: {
        status: async () => ({ state: "ready", backend: "aicore", modelId: "aicore-full" }),
        load: async () => ({ state: "ready", backend: "aicore", modelId: "aicore-full" }),
        chatTemplate: async () => "",
        generate: () => () => {},
        onStatus: () => () => {},
      },
    } as unknown as DesktopBridge;

    expect(assistantWhere(false, false)).toBe("on this device (AICore)");

    render(
      <ModeContext.Provider value={{ mode: { kind: "single" }, locked: false, demo: false }}>
        <AssistantSettings />
      </ModeContext.Provider>,
    );

    expect(screen.getByText("On this device (Android AICore)")).toBeTruthy();
    expect(screen.queryByLabelText("Model")).toBeNull();
  });

  it("checks for and installs Android in-app updates from Settings and Home banner", async () => {
    let available: AndroidUpdateInfo | null = null;
    const listeners = new Set<(u: AndroidUpdateInfo | null) => void>();
    const install = vi.fn(async () => {});
    const check = vi.fn(async () => {
      available = { version: "0.2.0", body: "Bug fixes and improvements." };
      listeners.forEach((cb) => cb(available));
      return available;
    });

    window.suiteleaf = {
      platform: "android",
      onMenu: () => () => {},
      updater: {
        check,
        install,
        getAvailable: () => available,
        onAvailable: (cb) => {
          listeners.add(cb);
          return () => void listeners.delete(cb);
        },
      },
    } as unknown as DesktopBridge;

    render(
      <ModeContext.Provider value={{ mode: { kind: "single" }, locked: false, demo: false }}>
        <MemoryRouter initialEntries={["/settings"]}>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
        <AndroidUpdateBanner />
      </ModeContext.Provider>,
    );

    const user = userEvent.setup();
    expect(screen.getByRole("heading", { name: "App Updates" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    await screen.findByText("Update available: v0.2.0");
    await screen.findByRole("button", { name: "Update now" });

    await user.click(screen.getByRole("button", { name: "Update to v0.2.0" }));
    expect(install).toHaveBeenCalledTimes(1);
  });
});
