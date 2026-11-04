// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createFile } from "@suiteleaf/core";
import { SlideFace } from "../../apps/web/src/editors/slide-surface";

afterEach(cleanup);

it("draws a master color and font on a title that stores neither", () => {
  const file = createFile("slide", "Pitch");
  if (file.kind !== "slide") throw new Error("expected slides");
  const deck = file.content;
  const slide = deck.slides[deck.slideOrder[0]];
  const title = slide.elements[0];
  delete title.color;
  delete title.fontFamily;
  title.placeholder = "title";
  deck.master = {
    elements: [
      {
        id: "master-title",
        type: "text",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        placeholder: "title",
        color: "#112233",
        fontFamily: "Georgia",
      },
    ],
  };
  render(<SlideFace deck={deck} slide={slide} index={0} />);
  const node = document.querySelector(".slide-text") as HTMLElement | null;
  expect(node?.style.color).toBe("rgb(17, 34, 51)");
  expect(node?.style.fontFamily).toContain("SuiteLeaf Durian");
  expect(title.color).toBeUndefined();
});

it("draws master text on a blank title and keeps typed words", () => {
  const file = createFile("slide", "Pitch");
  if (file.kind !== "slide") throw new Error("expected slides");
  const deck = file.content;
  const slide = deck.slides[deck.slideOrder[0]];
  const title = slide.elements[0];
  title.content = "";
  title.placeholder = "title";
  deck.master = {
    elements: [
      {
        id: "master-title",
        type: "text",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        placeholder: "title",
        content: "Garden club",
      },
    ],
  };
  const first = render(<SlideFace deck={deck} slide={slide} index={0} />);
  const slideText = () =>
    [...document.querySelectorAll(".slide-element.slide-text")].map((node) => node.textContent ?? "").join("");
  expect(slideText()).toContain("Garden club");
  expect(title.content).toBe("");
  first.unmount();
  title.content = "North";
  deck.master.elements[0].content = "secret-value";
  render(<SlideFace deck={deck} slide={slide} index={0} />);
  expect(slideText()).toContain("North");
  expect(slideText()).not.toContain("secret-value");
  expect(title.content).toBe("North");
});
