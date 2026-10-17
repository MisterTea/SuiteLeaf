// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Presentation, Slide } from "../packages/core/src";
import { PresenterNextSlide } from "../apps/web/src/editors/slide-master-ui";

const next: Slide = {
  id: "b",
  elements: [
    { id: "title", type: "text", x: 40, y: 40, width: 400, height: 80, content: "Next title" },
  ],
};

const deck: Presentation = {
  id: "deck",
  width: 960,
  height: 540,
  slideOrder: ["a", "b"],
  slides: {
    a: { id: "a", elements: [] },
    b: next,
  },
  master: {
    background: { color: "#0d2818" },
    elements: [
      { id: "foot", type: "text", x: 40, y: 480, width: 200, height: 32, content: "Club footer" },
    ],
  },
};

describe("presenter next slide", () => {
  it("shows the master layer and the master background when the next slide has none", () => {
    const view = render(
      <PresenterNextSlide deck={deck} slide={next}>
        <span>Next title</span>
      </PresenterNextSlide>,
    );
    const preview = view.container.querySelector(".presenter-next-slide") as HTMLElement;
    const color = preview.style.backgroundColor.replace(/\s/g, "").toLowerCase();
    expect(["#0d2818", "rgb(13,40,24)"]).toContain(color);
    expect(preview.querySelector(".slide-master-layer")).not.toBeNull();
    expect(preview.textContent).toContain("Club footer");
    expect(preview.textContent).toContain("Next title");

    view.rerender(
      <PresenterNextSlide deck={deck} slide={{ ...next, background: { color: "#111111" } }}>
        <span>Next title</span>
      </PresenterNextSlide>,
    );
    const own = view.container.querySelector(".presenter-next-slide") as HTMLElement;
    const ownColor = own.style.backgroundColor.replace(/\s/g, "").toLowerCase();
    expect(["#111111", "rgb(17,17,17)"]).toContain(ownColor);
    expect(own.querySelector(".slide-master-layer")).not.toBeNull();
  });
});
