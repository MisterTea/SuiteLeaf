// @vitest-environment jsdom
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { box, openSlides, setupSlidesDom } from "./slide-editor-harness";
import { SLIDE_HOLD_MS } from "../../apps/web/src/editors/slide-thumbnail-touch";

setupSlidesDom();
const originalWidth = window.innerWidth;
beforeEach(() =>
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 390,
  }),
);
afterEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalWidth,
  });
  vi.useRealTimers();
});

const pointer = (target: Element, type: string, x = 100, y = 80) =>
  fireEvent(
    target,
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "touch",
      clientX: x,
      clientY: y,
    }),
  );
const tap = (target: Element) => {
  pointer(target, "pointerdown");
  pointer(target, "pointerup");
  fireEvent.click(target);
};
const thumb = (id: string) =>
  document.querySelector<HTMLElement>(`.thumbnail-row[data-slide-id="${id}"]`)!;
const hold = (target: Element) => {
  pointer(target, "pointerdown");
  act(() => vi.advanceTimersByTime(SLIDE_HOLD_MS));
};

it("selects a text box on the first tap and edits on the second tap", () => {
  openSlides();
  tap(box("a-words"));
  expect(box("a-words").classList.contains("selected")).toBe(true);
  expect(box("a-words").querySelector('[contenteditable="true"]')).toBeNull();
  expect(box("a-words").contains(document.activeElement)).toBe(false);
  tap(box("a-words"));
  const editor = box("a-words").querySelector('[contenteditable="true"]');
  expect(editor).not.toBeNull();
  expect(document.activeElement).toBe(editor);
});

it("moves and resizes the selected text box with a finger without editing", () => {
  const editor = openSlides();
  const canvas = document.querySelector<HTMLElement>(".slide-canvas")!;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    width: 960,
    height: 540,
  } as DOMRect);
  pointer(box("a-words"), "pointerdown");
  pointer(box("a-words"), "pointermove", 150, 120);
  pointer(box("a-words"), "pointerup", 150, 120);
  expect(editor.elements()[0]).toMatchObject({ x: 90, y: 80 });
  expect(box("a-words").querySelector('[contenteditable="true"]')).toBeNull();
  const handle = box("a-words").querySelector(".handle-se")!;
  pointer(handle, "pointerdown");
  pointer(handle, "pointermove", 150, 120);
  pointer(handle, "pointerup", 150, 120);
  expect(editor.elements()[0]).toMatchObject({ width: 450, height: 120 });
  act(() => editor.slide().undo());
  expect(editor.elements()[0]).toMatchObject({ width: 400, height: 80 });
});

it("starts slide selection with a hold, toggles slides on tap, and exits with Done", () => {
  const editor = openSlides();
  vi.useFakeTimers();
  hold(thumb("a"));
  pointer(thumb("a"), "pointerup");
  fireEvent.click(thumb("a"));
  expect(screen.getByText("1 selected")).toBeTruthy();
  tap(thumb("c"));
  expect(thumb("a").getAttribute("aria-selected")).toBe("true");
  expect(thumb("c").getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("2 selected")).toBeTruthy();
  tap(thumb("a"));
  expect(thumb("a").getAttribute("aria-selected")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByText("1 selected")).toBeNull();
  expect(editor.active()).toBe("c");
});

it.each([1, 2])("reorders a slide when dragging during hold %s", (holdCount) => {
  const editor = openSlides();
  vi.useFakeTimers();
  document.querySelector<HTMLElement>(".thumbnails-list")!.style.flexDirection =
    "row";
  for (const [index, id] of ["a", "b", "c"].entries())
    vi.spyOn(thumb(id), "getBoundingClientRect").mockReturnValue({
      left: index * 110,
      top: 0,
      width: 100,
      height: 80,
    } as DOMRect);
  if (holdCount === 2) {
    hold(thumb("a"));
    pointer(thumb("a"), "pointerup");
    fireEvent.click(thumb("a"));
  }
  hold(thumb("a"));
  pointer(thumb("a"), "pointermove", 350, 80);
  pointer(thumb("a"), "pointerup", 350, 80);
  expect(editor.order()).toEqual(["b", "c", "a"]);
  act(() => editor.slide().undo());
  expect(editor.order()).toEqual(["a", "b", "c"]);
});

it("drags selected slides immediately as a group without scrolling the filmstrip", () => {
  const editor = openSlides();
  vi.useFakeTimers();
  const list = document.querySelector<HTMLElement>(".thumbnails-list")!;
  list.style.flexDirection = "row";
  for (const [index, id] of ["a", "b", "c"].entries())
    vi.spyOn(thumb(id), "getBoundingClientRect").mockReturnValue({
      left: index * 110, top: 0, width: 100, height: 80,
    } as DOMRect);
  hold(thumb("a"));
  pointer(thumb("a"), "pointerup");
  fireEvent.click(thumb("a"));
  tap(thumb("b"));
  pointer(thumb("b"), "pointerdown");
  pointer(thumb("b"), "pointermove", 350, 80);
  expect(list.scrollLeft).toBe(0);
  pointer(thumb("b"), "pointerup", 350, 80);
  fireEvent.click(thumb("b"));
  expect(editor.order()).toEqual(["c", "a", "b"]);
  expect(thumb("a").getAttribute("aria-selected")).toBe("true");
  expect(thumb("b").getAttribute("aria-selected")).toBe("true");
  act(() => editor.slide().undo());
  expect(editor.order()).toEqual(["a", "b", "c"]);
});

it("cancels a selected slide drag without reordering", () => {
  const editor = openSlides();
  vi.useFakeTimers();
  hold(thumb("a"));
  pointer(thumb("a"), "pointerup");
  fireEvent.click(thumb("a"));
  pointer(thumb("a"), "pointerdown");
  pointer(thumb("a"), "pointermove", 350, 80);
  pointer(thumb("a"), "pointercancel");
  pointer(thumb("a"), "pointerup", 350, 80);
  expect(editor.order()).toEqual(["a", "b", "c"]);
  expect(document.querySelector(".drag-source")).toBeNull();
});

it.each([false, true])("scrolls from an unselected slide without reordering (readOnly=%s)", (readOnly) => {
  const editor = openSlides({ readOnly });
  vi.useFakeTimers();
  const list = document.querySelector<HTMLElement>(".thumbnails-list")!;
  hold(thumb("a"));
  pointer(thumb("a"), "pointerup");
  fireEvent.click(thumb("a"));
  const target = thumb(readOnly ? "a" : "b");
  pointer(target, "pointerdown");
  pointer(target, "pointermove", 50, 80);
  pointer(target, "pointerup", 50, 80);
  fireEvent.click(target);
  expect(list.scrollLeft).toBe(50);
  expect(editor.order()).toEqual(["a", "b", "c"]);
  expect(thumb("a").getAttribute("aria-selected")).toBe("true");
  expect(thumb("b").getAttribute("aria-selected")).toBe("false");
});

it("cancels a hold when the user swipes or the pointer is canceled", () => {
  openSlides();
  vi.useFakeTimers();
  pointer(thumb("a"), "pointerdown");
  pointer(thumb("a"), "pointermove", 150, 80);
  act(() => vi.advanceTimersByTime(SLIDE_HOLD_MS));
  pointer(thumb("a"), "pointerup", 150, 80);
  fireEvent.click(thumb("a"));
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  pointer(thumb("a"), "pointerdown");
  pointer(thumb("a"), "pointercancel");
  act(() => vi.advanceTimersByTime(SLIDE_HOLD_MS));
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
});

it("keeps speaker notes behind a button on mobile, retaining saved notes", () => {
  const editor = openSlides({
    edit: (deck) => {
      deck.slides.a.notes = "Opening remarks";
    },
  });
  expect(
    screen.queryByPlaceholderText("Click to add speaker notes"),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Speaker notes" }));
  const notes = screen.getByPlaceholderText(
    "Click to add speaker notes",
  ) as HTMLTextAreaElement;
  expect(notes.value).toBe("Opening remarks");
  fireEvent.change(notes, { target: { value: "Updated notes" } });
  fireEvent.click(screen.getByRole("button", { name: "Hide speaker notes" }));
  expect(editor.deck().slides.a.notes).toBe("Updated notes");
  expect(
    screen.queryByPlaceholderText("Click to add speaker notes"),
  ).toBeNull();
});
