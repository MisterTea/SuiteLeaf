// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { DesktopBridge, DocumentScanProgress } from "../../packages/core/src";
import {
  DocumentSettings,
  SettingsButton,
  SettingsPage,
} from "../../apps/web/src/document-settings";
import { ModeContext } from "../../apps/web/src/mode";

afterEach(() => {
  cleanup();
  delete window.suiteleaf;
});
function SettingsApp() {
  return (
    <MemoryRouter>
      <DocumentSettings />
      <Routes>
        <Route path="/" element={<SettingsButton />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>
  );
}
it("opens settings from the gear, selects a cloud folder, and returns to files", async () => {
  const choose = vi
    .fn()
    .mockResolvedValueOnce("/Dropbox/SuiteLeaf")
    .mockResolvedValueOnce(null);
  window.suiteleaf = {
    getDocumentsDirectory: async () => "/Users/test/Documents/SuiteLeaf",
    chooseDocumentsDirectory: choose,
    onMenu: () => () => {},
  } as unknown as DesktopBridge;
  render(<SettingsApp />);
  const user = userEvent.setup();
  const gear = screen.getByRole("button", { name: "Settings" });
  expect(gear.querySelector("svg")).toBeTruthy();
  await user.click(gear);
  expect(
    screen.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeTruthy();
  await screen.findByText("/Users/test/Documents/SuiteLeaf");
  await user.click(screen.getByRole("button", { name: "Choose folder…" }));
  await screen.findByText("/Dropbox/SuiteLeaf");
  await user.click(screen.getByRole("button", { name: "Choose folder…" }));
  expect(screen.getByText("/Dropbox/SuiteLeaf")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Back to files" }));
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
});
it("shows scan progress while a newly chosen folder is indexed", async () => {
  let finish: (path: string | null) => void = () => {};
  const scans: Array<(progress: DocumentScanProgress) => void> = [];
  window.suiteleaf = {
    getDocumentsDirectory: async () => "/Users/test/Documents/SuiteLeaf",
    chooseDocumentsDirectory: () =>
      new Promise<string | null>((resolve) => {
        finish = resolve;
      }),
    onDocumentScan: (callback) => {
      scans.push(callback);
      return () => {
        const index = scans.indexOf(callback);
        if (index >= 0) scans.splice(index, 1);
      };
    },
    onMenu: () => () => {},
  } as unknown as DesktopBridge;
  render(<SettingsApp />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByText("/Users/test/Documents/SuiteLeaf");
  await user.click(screen.getByRole("button", { name: "Choose folder…" }));
  expect(screen.queryByRole("progressbar")).toBeNull();
  const emit = (progress: DocumentScanProgress) => {
    act(() => {
      for (const callback of scans) callback(progress);
    });
  };
  emit({ files: 0, folders: 0 });
  const listing = screen.getByRole("progressbar", {
    name: "Looking through folders… 0 files found",
  }) as HTMLProgressElement;
  expect(listing.hasAttribute("value")).toBe(false);
  expect(screen.getByRole("button", { name: "Scanning…" })).toBeTruthy();
  emit({ files: 1, folders: 1 });
  expect(
    screen.getByRole("progressbar", {
      name: "Looking through 1 folder… 1 file found",
    }).hasAttribute("value"),
  ).toBe(false);
  emit({ files: 2, folders: 3 });
  expect(
    screen.getByRole("progressbar", {
      name: "Looking through 3 folders… 2 files found",
    }),
  ).toBeTruthy();
  emit({ files: 1, folders: 3, total: 4 });
  const reading = screen.getByRole("progressbar", {
    name: "Reading 1 of 4 files",
  }) as HTMLProgressElement;
  expect(reading.value).toBe(1);
  expect(reading.max).toBe(4);
  emit({ files: 1, folders: 1, total: 1 });
  expect(
    (screen.getByRole("progressbar", { name: "Reading 1 of 1 file" }) as HTMLProgressElement)
      .value,
  ).toBe(1);
  emit({ files: 0, folders: 1, total: 0 });
  const empty = screen.getByRole("progressbar", {
    name: "No documents to read",
  }) as HTMLProgressElement;
  expect(empty.value).toBe(1);
  expect(empty.max).toBe(1);
  await act(async () => finish(null));
  await screen.findByRole("button", { name: "Choose folder…" });
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByText("/Users/test/Documents/SuiteLeaf")).toBeTruthy();
  emit({ files: 3, folders: 3, total: 3 });
  expect(screen.queryByRole("progressbar")).toBeNull();
});
it("rescans the current folder and shows progress while library entries are rebuilt", async () => {
  let finish: () => void = () => {};
  const scans: Array<(progress: DocumentScanProgress) => void> = [];
  const rescan = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  window.suiteleaf = {
    getDocumentsDirectory: async () => "/Users/test/Documents/SuiteLeaf",
    chooseDocumentsDirectory: async () => null,
    rescanDocumentsDirectory: rescan,
    onDocumentScan: (callback) => {
      scans.push(callback);
      return () => {
        const index = scans.indexOf(callback);
        if (index >= 0) scans.splice(index, 1);
      };
    },
    onMenu: () => () => {},
  } as unknown as DesktopBridge;
  render(<SettingsApp />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByText(/removes library entries from other folders/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Rescan everything" }));
  expect(rescan).toHaveBeenCalledOnce();
  const scanning = screen.getByRole("button", { name: "Scanning…" }) as HTMLButtonElement;
  const choose = screen.getByRole("button", { name: "Choose folder…" }) as HTMLButtonElement;
  expect(scanning.disabled).toBe(true);
  expect(choose.disabled).toBe(true);
  act(() => {
    for (const callback of scans) callback({ files: 1, folders: 2, total: 3 });
  });
  const bar = screen.getByRole("progressbar", {
    name: "Reading 1 of 3 files",
  }) as HTMLProgressElement;
  expect(bar.value).toBe(1);
  expect(bar.max).toBe(3);
  await act(async () => finish());
  await screen.findByRole("button", { name: "Rescan everything" });
  expect(screen.queryByRole("progressbar")).toBeNull();
});
it("opens settings through the application settings action", async () => {
  render(<SettingsApp />);
  act(() => window.dispatchEvent(new Event("suiteleaf:settings")));
  expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  expect(screen.getByText(/Files are saved in this browser/)).toBeTruthy();
});
it("hides document directory settings in cluster mode", () => {
  render(
    <ModeContext.Provider
      value={{
        mode: { kind: "cluster", serverUrl: "https://suiteleaf.test" },
        locked: false,
        demo: false,
      }}
    >
      <SettingsApp />
    </ModeContext.Provider>,
  );
  act(() => window.dispatchEvent(new Event("suiteleaf:settings")));
  expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
});
