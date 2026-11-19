// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopTabBar, useDesktopTabTitle } from "../../apps/web/src/desktop-tab-bar";

afterEach(() => {
  cleanup();
  delete window.suiteleaf;
  document.title = "";
  document.documentElement.classList.remove("desktop-tabs");
});

function TitleProbe({ title }: { title?: string }) {
  useDesktopTabTitle(title);
  return null;
}

it("renders nothing when the desktop tab api is absent", () => {
  render(<DesktopTabBar />);
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(document.documentElement.classList.contains("desktop-tabs")).toBe(false);
});

it("lists open documents and activates, closes, and adds a tab", async () => {
  const tabs = [
    { id: "home", title: "Files", active: false },
    { id: "plan", title: "Plan", active: true },
  ];
  const api = {
    list: vi.fn(async () => tabs),
    activate: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    open: vi.fn(async () => {}),
    onChange: vi.fn(() => () => {}),
  };
  window.suiteleaf = { tabs: api } as unknown as NonNullable<typeof window.suiteleaf>;
  render(<DesktopTabBar />);
  expect(document.documentElement.classList.contains("desktop-tabs")).toBe(true);
  const plan = await screen.findByRole("tab", { name: "Plan" });
  expect(plan.getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: "Files" }));
  expect(api.activate).toHaveBeenCalledWith("home");
  fireEvent.click(screen.getByRole("button", { name: "Close Plan" }));
  expect(api.close).toHaveBeenCalledWith("plan");
  fireEvent.click(screen.getByRole("button", { name: "New tab" }));
  expect(api.open).toHaveBeenCalledWith("/", "Files");
});

it("publishes the document name as the page title", async () => {
  window.suiteleaf = { tabs: {} } as unknown as NonNullable<typeof window.suiteleaf>;
  const view = render(<TitleProbe title="Plan" />);
  await waitFor(() => expect(document.title).toBe("Plan"));
  view.unmount();
  expect(document.title).toBe("SuiteLeaf");
});
