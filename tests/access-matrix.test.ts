import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accessMatrix } from "../packages/core/src/access-matrix";
import { readAppStyle } from "./app-style";

describe("accessibility matrix", () => {
  it("keeps screen readers untested and names the contrast and motion rules", () => {
    const cells = accessMatrix();
    expect(cells).toHaveLength(12);
    expect(new Set(cells.map((cell) => cell.status))).toEqual(new Set(["partial", "untested"]));
    const readers = cells.filter((cell) => cell.mode === "screen-reader");
    expect(readers.every((cell) => cell.status === "untested")).toBe(true);
    expect(readers.every((cell) => cell.note.includes("No screen reader"))).toBe(true);
    const contrast = cells.find(
      (cell) => cell.mode === "high-contrast" && cell.platform === "web",
    );
    expect(contrast?.status).toBe("partial");
    expect(contrast?.note).toContain("prefers-contrast: more");
    const motion = cells.find(
      (cell) => cell.mode === "reduced-motion" && cell.platform === "web",
    );
    expect(motion?.status).toBe("partial");
    expect(motion?.note).toContain("prefers-reduced-motion: reduce");
    const desktopContrast = cells.find(
      (cell) => cell.mode === "high-contrast" && cell.platform === "desktop",
    );
    expect(desktopContrast?.status).toBe("untested");

    const css = readAppStyle();
    expect(css).toContain("@media (prefers-contrast: more)");
    expect(css).toContain("--text-primary: #000000");
    expect(css).toContain("--border: #000000");
    const fade = readFileSync("apps/web/src/editors/slide-fade-in.css", "utf8");
    expect(fade).toContain("@media (prefers-reduced-motion: reduce)");
    expect(fade).toContain("animation: none");
  });
});