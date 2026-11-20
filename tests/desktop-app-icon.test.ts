import { describe, expect, it, vi } from "vitest";
import { fakeElectron } from "./desktop-electron-fake";

vi.mock("electron", async () =>
  (await import("./desktop-electron-fake")).electronModule(),
);

describe("desktop app icon", () => {
  it("provides valid candidates and configures the dock icon", async () => {
    const { getAppIconCandidates, setupAppIcon } = await import(
      "../apps/desktop/src/app-icon"
    );
    const candidates = getAppIconCandidates();
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.endsWith("icon.icns"))).toBe(true);
    expect(candidates.some((c) => c.endsWith("icon.png"))).toBe(true);

    const fake = fakeElectron();
    expect(fake.app.name).toBe("SuiteLeaf");
    expect(fake.app.getName()).toBe("SuiteLeaf");

    const icon = setupAppIcon();
    expect(icon).toBeDefined();
    if (process.platform === "darwin") {
      expect(fake.app.dock.setIcon).toHaveBeenCalledWith(icon);
    }
  });
});
