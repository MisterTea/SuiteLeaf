// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Presentation, Slide } from "../packages/core/src";
import { PresenterNextSlide } from "../apps/web/src/editors/slide-master-ui";
import { sameStill, SlideStill } from "../apps/web/src/editors/slide-surface";

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
      <PresenterNextSlide deck={deck}>
        <SlideStill deck={deck} slide={next} index={1} />
      </PresenterNextSlide>,
    );
    const preview = view.container.querySelector(".presenter-next-slide") as HTMLElement;
    const surface = preview.querySelector(".slide-surface") as HTMLElement;
    const color = surface.style.backgroundColor.replace(/\s/g, "").toLowerCase();
    expect(["#0d2818", "rgb(13,40,24)"]).toContain(color);
    expect(surface.querySelector(".slide-master-layer")).not.toBeNull();
    expect(preview.textContent).toContain("Club footer");
    expect(preview.textContent).toContain("Next title");

    view.rerender(
      <PresenterNextSlide deck={deck}>
        <SlideStill deck={deck} slide={{ ...next, background: { color: "#111111" } }} index={1} />
      </PresenterNextSlide>,
    );
    const own = view.container.querySelector(".slide-surface") as HTMLElement;
    const ownColor = own.style.backgroundColor.replace(/\s/g, "").toLowerCase();
    expect(["#111111", "rgb(17,17,17)"]).toContain(ownColor);
    expect(own.querySelector(".slide-master-layer")).not.toBeNull();
  });
});

describe("redrawing a slide picture", () => {
  it("skips a slide whose drawing did not change when the deck around it did", () => {
    const marp: Presentation = { ...deck, marp: true, marpSource: "# Next title", marpFit: 3 };
    const still = { deck: marp, slide: next, index: 1 };
    expect(sameStill(still, { ...still, deck: { ...marp, marpFit: false, slideOrder: ["b", "a"] } })).toBe(true);
    expect(sameStill(still, { ...still, slide: { ...next } })).toBe(false);
    expect(sameStill(still, { ...still, deck: { ...marp, width: 1280 } })).toBe(false);
    expect(sameStill(still, { ...still, deck: { ...marp, marpAssets: { "a.png": "data:," } } })).toBe(false);
    const page = { width: 1280, height: 720, document: "", plain: "" };
    const pages = { pages: [page, page], dispose: () => {} };
    expect(sameStill({ ...still, pages }, { ...still, pages: { ...pages } })).toBe(true);
    expect(
      sameStill({ ...still, pages }, { ...still, pages: { ...pages, pages: [page, { ...page }] } }),
    ).toBe(false);
  });
});
