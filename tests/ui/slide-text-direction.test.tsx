/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Presentation, Slide } from "@suiteleaf/core";
import { SlideFace } from "../../apps/web/src/editors/slide-surface";

const deck = (language: Presentation["proofingLanguage"]): Presentation =>
  ({
    width: 960,
    height: 540,
    proofingLanguage: language,
    slides: [],
  }) as Presentation;

const slide: Slide = {
  id: "s",
  elements: [{ id: "t", type: "text", x: 40, y: 40, width: 200, height: 80, content: "North" }],
};

describe("slide text direction", () => {
  it("writes Arabic from right to left and English from left to right", () => {
    const { rerender } = render(<SlideFace deck={deck("ar")} slide={slide} index={0} />);
    expect(document.querySelector(".slide-text")?.getAttribute("dir")).toBe("rtl");
    rerender(<SlideFace deck={deck("en")} slide={slide} index={0} />);
    expect(document.querySelector(".slide-text")?.getAttribute("dir")).toBe("ltr");
    expect(document.body.textContent).toContain("North");
    expect(document.body.textContent).not.toContain("secret-value");
  });
});
