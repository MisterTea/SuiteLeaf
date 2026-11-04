// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { paintRemoteSheetSelections } from "../apps/web/src/editors/sheet-remote-selection";

describe("remote sheet selection", () => {
  it("draws the range on the grid and leaves a zero-size range off", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    paintRemoteSheetSelections(host, [
      { name: "Maya Chen A1", left: 10, top: 20, width: 80, height: 24 },
      { name: "Hidden", left: 0, top: 0, width: 0, height: 10 },
    ]);
    const mark = host.querySelector(".sheet-remote-range");
    expect(mark?.getAttribute("data-selection")).toBe("Maya Chen A1");
    expect(mark?.textContent).toBe("Maya Chen A1");
    expect((mark as HTMLElement).style.left).toBe("10px");
    expect((mark as HTMLElement).style.pointerEvents).toBe("none");
    expect(host.querySelectorAll(".sheet-remote-range")).toHaveLength(1);
    paintRemoteSheetSelections(host, []);
    expect(host.querySelector(".sheet-remote-range")).toBeNull();
    host.remove();
  });
});
