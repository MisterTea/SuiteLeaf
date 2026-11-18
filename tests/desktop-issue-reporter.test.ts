import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));

import { captureScreenshot, registerIssueReporter } from "../apps/desktop/src/issue-reporter";

describe("desktop issue reporter", () => {
  it("captures the window as a data URL", async () => {
    const win: any = {
      webContents: { capturePage: vi.fn().mockResolvedValue({ toDataURL: () => "data:image/png;base64,x" }) },
    };
    expect(await captureScreenshot(win)).toBe("data:image/png;base64,x");
  });

  it("returns an empty string without a window or when capture fails", async () => {
    expect(await captureScreenshot(null)).toBe("");
    const win: any = { webContents: { capturePage: vi.fn().mockRejectedValue(new Error("gone")) } };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await captureScreenshot(win)).toBe("");
  });

  it("registers the screenshot channel", async () => {
    const register = vi.fn();
    registerIssueReporter(register, () => null);
    expect(register).toHaveBeenCalledWith("screenshot:capture", expect.any(Function));
    expect(await register.mock.calls[0][1]()).toBe("");
  });
});
