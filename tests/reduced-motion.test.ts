import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("reduced motion", () => {
  it("shortens app motion when the person asks for less", () => {
    const css = readFileSync("apps/web/src/style.css", "utf8");
    const rule = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(rule).toContain("animation-duration: 0.01ms");
    expect(rule).toContain("transition-duration: 0.01ms");
    expect(rule).toContain("scroll-behavior: auto");
    expect(rule).not.toContain("secret-value");
  });
});
