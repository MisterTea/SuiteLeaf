// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFile } from "../../packages/core/src";
import Slides from "../../apps/web/src/editors/Slides";
import { CommandPalette } from "../../apps/web/src/command-palette";

vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({
  default: "/* @theme beam_ut */",
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(readOnly = false) {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const first = file.content.slides[file.content.slideOrder[0]];
  const words = (content: string) => [
    { id: `${content}-words`, type: "text" as const, x: 40, y: 40, width: 400, height: 80, content },
  ];
  file.content.slides = {
    a: { ...first, id: "a", elements: words("Intro") },
    b: { ...first, id: "b", elements: words("Plan") },
    c: { ...first, id: "c", elements: words("Close") },
  };
  file.content.slideOrder = ["a", "b", "c"];
  render(
    <CommandPalette kind="slide">
      <Slides file={file} onChange={vi.fn()} onError={vi.fn()} onActions={() => {}} readOnly={readOnly} />
    </CommandPalette>,
  );
}

const active = () =>
  document.querySelector<HTMLElement>(".thumbnail-row.active")?.getAttribute("aria-label");
const press = (key: string, target: Element = document.body, init = {}) =>
  fireEvent.keyDown(target, { key, ...init });

it("steps through the slides with Right and Left when nothing is selected", () => {
  open();
  expect(active()).toBe("Slide 1: Intro");
  press("ArrowRight");
  expect(active()).toBe("Slide 2: Plan");
  press("ArrowRight");
  press("ArrowRight");
  expect(active()).toBe("Slide 3: Close");
  press("ArrowLeft");
  expect(active()).toBe("Slide 2: Plan");
  press("ArrowLeft");
  press("ArrowLeft");
  expect(active()).toBe("Slide 1: Intro");
});

it("steps from the slide list and lets a viewer step too", () => {
  open(true);
  press("ArrowRight", screen.getByRole("listbox", { name: "Slides" }));
  expect(active()).toBe("Slide 2: Plan");
});

it("leaves the slide alone while an object is selected or text is being typed", () => {
  open();
  const box = document.querySelector<HTMLElement>('.slide-canvas [data-element-id="Intro-words"]')!;
  fireEvent.mouseDown(box);
  fireEvent.mouseUp(window);
  press("ArrowRight");
  expect(active()).toBe("Slide 1: Intro");
  press("ArrowRight", box.querySelector("textarea")!);
  expect(active()).toBe("Slide 1: Intro");

  fireEvent.click(screen.getByRole("button", { name: "Select tool" }));
  press("ArrowRight");
  expect(active()).toBe("Slide 2: Plan");
});

it("ignores Right and Left with modifiers or inside the speaker notes", () => {
  open();
  press("ArrowRight", document.body, { shiftKey: true });
  press("ArrowRight", document.body, { metaKey: true });
  press("ArrowRight", document.body, { altKey: true });
  press("ArrowRight", screen.getByPlaceholderText("Click to add speaker notes"));
  expect(active()).toBe("Slide 1: Intro");
});
