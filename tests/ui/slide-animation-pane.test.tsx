// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
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
  const preview = vi.fn();
  render(
    <AnimationPane
      deck={file.content}
      slideId={slideId}
      slide={slide}
      onPreview={preview}
      onChange={() => {}}
      onClose={() => {}}
      onSelect={() => {}}
    />,
  );
  const pane = screen.getByRole("complementary", { name: "Animation pane" });
  expect(pane.textContent).toContain("1. Welcome");
  expect(pane.textContent).toContain("1. Photo");
  expect(pane.textContent).toContain("After previous");
  expect(pane.textContent).toContain("1.5 s");
  expect(pane.textContent).toContain("5 s");
  expect(pane.textContent).toContain("0.6 s");
  expect(pane.textContent).not.toContain("9000");
  expect(pane.textContent).not.toContain("secret-value");
  await userEvent.click(
    screen.getByRole("button", { name: "Preview Welcome" }),
  );
  expect(preview).toHaveBeenLastCalledWith("title:entrance");
  await userEvent.click(screen.getByRole("button", { name: "Preview Photo" }));
  expect(preview).toHaveBeenLastCalledWith("photo:entrance");
  expect(pane.textContent).not.toContain("secret-value");
});
