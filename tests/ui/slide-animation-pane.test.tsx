// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { createFile } from "@suiteleaf/core";
import { AnimationPane } from "../../apps/web/src/editors/slide-animation-pane";

afterEach(cleanup);

it("shows one click number for an object that follows the previous entrance", async () => {
  const file = createFile("slide", "Pitch");
  if (file.kind !== "slide") throw new Error("expected slides");
  const slideId = file.content.slideOrder[0]!;
  const slide = file.content.slides[slideId]!;
  slide.elements = [
    {
      id: "title",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      content: "Welcome",
      animation: "fade-on-click",
      animationOrder: 1,
      animationDuration: 1500,
    },
    {
      id: "photo",
      type: "text",
      x: 0,
      y: 80,
      width: 100,
      height: 40,
      content: "Photo",
      animation: "fly-on-click",
      animationOrder: 2,
      animationTrigger: "after",
      animationDuration: 9000,
    },
    {
      id: "chart",
      type: "text",
      x: 0,
      y: 120,
      width: 100,
      height: 40,
      content: "Chart",
      animation: "appear-on-click",
      animationOrder: 3,
    },
    {
      id: "note",
      type: "text",
      x: 0,
      y: 160,
      width: 100,
      height: 40,
      content: "secret-value",
    },
  ];
  render(
    <AnimationPane
      deck={file.content}
      slideId={slideId}
      slide={slide}
      onChange={() => {}}
      onClose={() => {}}
      onSelect={() => {}}
    />,
  );
  const pane = screen.getByRole("complementary", { name: "Animation pane" });
  expect(pane.textContent).toContain("1. Welcome");
  expect(pane.textContent).toContain("1. Photo");
  expect(pane.textContent).toContain("after previous");
  expect(pane.textContent).toContain("1500 ms");
  expect(pane.textContent).toContain("5000 ms");
  expect(pane.textContent).toContain("600 ms");
  expect(pane.textContent).not.toContain("9000");
  expect(pane.textContent).not.toContain("secret-value");
  await userEvent.click(screen.getByRole("button", { name: "Preview Welcome" }));
  const welcome = pane.querySelector("[data-preview='title']");
  expect(welcome?.className).toBe("show-object fade-on-click-enter");
  expect(welcome?.getAttribute("style")).toContain("1500ms");
  await userEvent.click(screen.getByRole("button", { name: "Preview Photo" }));
  const photo = pane.querySelector("[data-preview='photo']");
  expect(photo?.className).toBe("show-object fly-on-click-enter animation-after-previous");
  expect(photo?.getAttribute("style")).toContain("5000ms");
  expect(photo?.getAttribute("style")).not.toContain("9000");
  expect(pane.textContent).not.toContain("secret-value");
});
