// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { DesktopBridge } from "../../packages/core/src";
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
