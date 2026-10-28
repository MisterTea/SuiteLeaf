// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { FontCache, UniverRenderingContext2D } from "@univerjs/engine-render";
import { stopSheetKerning } from "../apps/web/src/sheet-kerning";

function fakeCanvas() {
  return {
    fontKerning: "auto" as CanvasFontKerning,
    font: "",
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 1 })),
  };
}

describe("sheet kerning", () => {
  stopSheetKerning();
  stopSheetKerning();

  it("paints cell text unkerned unless a style asked for kerning", () => {
    const canvas = fakeCanvas();
    const ctx = Object.assign(Object.create(UniverRenderingContext2D.prototype), { _context: canvas });
    ctx.fillText("AVATAR", 0, 0);
    expect(canvas.fontKerning).toBe("none");
    expect(canvas.fillText).toHaveBeenCalledWith("AVATAR", 0, 0);

    canvas.fontKerning = "normal";
    ctx.strokeText("AV", 0, 0);
    expect(canvas.fontKerning).toBe("normal");
  });

  it("measures cell text unkerned, so alignment matches the paint", () => {
    const canvas = fakeCanvas();
    (FontCache as unknown as { _context: unknown })._context = canvas;
    FontCache.getMeasureText("AVATAR", "11px KernTestA");
    expect(canvas.fontKerning).toBe("none");
    FontCache.getMeasureText("AVATAR", "11px KernTestB", "auto");
    expect(canvas.fontKerning).toBe("none");
    FontCache.getMeasureText("AVATAR", "11px KernTestC", "normal");
    expect(canvas.fontKerning).toBe("normal");
  });
});
