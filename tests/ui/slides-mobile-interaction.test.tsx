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
  pointer(box("a-words"), "pointerdown");
  expect(box("a-words").classList.contains("selected")).toBe(false);
  pointer(box("a-words"), "pointerup");
  fireEvent.click(box("a-words"));
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
  tap(box("a-words"));
  pointer(box("a-words"), "pointerdown");
  pointer(box("a-words"), "pointermove", 150, 120);
  expect(editor.elements()[0]).toMatchObject({ x: 90, y: 80 });
  expect(editor.onChange).not.toHaveBeenCalled();
  pointer(box("a-words"), "pointerup", 150, 120);
  expect(editor.onChange).toHaveBeenCalledTimes(1);
  expect(editor.elements()[0]).toMatchObject({ x: 90, y: 80 });
  expect(box("a-words").querySelector('[contenteditable="true"]')).toBeNull();
  const handle = box("a-words").querySelector(".handle-se")!;
  pointer(handle, "pointerdown");
  pointer(handle, "pointermove", 150, 120);
  expect(editor.onChange).toHaveBeenCalledTimes(1);
  pointer(handle, "pointerup", 150, 120);
  expect(editor.onChange).toHaveBeenCalledTimes(2);
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

it.each([false, true])("leaves unselected slide swipes to native scrolling (readOnly=%s)", (readOnly) => {
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
  expect(list.scrollLeft).toBe(0);
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

it("blocks native scrolling only while reordering and removes the listener on release", () => {
  openSlides();
  vi.useFakeTimers();
  const target = thumb("a");
  const move = () => {
    const event = new Event("touchmove", { bubbles: true, cancelable: true });
    fireEvent(target, event);
    return event.defaultPrevented;
  };
  pointer(target, "pointerdown");
  expect(move()).toBe(false);
  act(() => vi.advanceTimersByTime(SLIDE_HOLD_MS));
  expect(move()).toBe(true);
  pointer(target, "pointerup");
  expect(move()).toBe(false);
  pointer(target, "pointerdown");
  expect(move()).toBe(true);
  pointer(target, "pointercancel");
  expect(move()).toBe(false);
});

it.each([false, true])("toggles speaker notes from the toolbar icon, retaining saved notes (readOnly=%s)", (readOnly) => {
  const editor = openSlides({
    readOnly,
    edit: (deck) => {
      deck.slides.a.notes = "Opening remarks";
    },
  });
  expect(
    screen.queryByPlaceholderText("Click to add speaker notes"),
  ).toBeNull();
  const toggle = screen.getByRole("button", { name: "Speaker notes" });
  expect(toggle.closest('[role="toolbar"]')?.getAttribute("aria-label")).toBe("Slides toolbar");
  expect(toggle.textContent).toBe("");
  expect(toggle.querySelector("svg")).not.toBeNull();
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  expect((toggle as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  const notes = screen.getByPlaceholderText(
    "Click to add speaker notes",
  ) as HTMLTextAreaElement;
  expect(notes.value).toBe("Opening remarks");
  expect(notes.readOnly).toBe(readOnly);
  if (!readOnly) fireEvent.change(notes, { target: { value: "Updated notes" } });
  fireEvent.click(screen.getByRole("button", { name: "Hide speaker notes" }));
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  expect(editor.deck().slides.a.notes).toBe(readOnly ? "Opening remarks" : "Updated notes");
  expect(
    screen.queryByPlaceholderText("Click to add speaker notes"),
  ).toBeNull();
});

it("navigates between slides with horizontal background swipes without saving edits", () => {
  const editor = openSlides();
  const stage = document.querySelector(".slide-stage-viewport")!;
  const swipe = (from: number, to: number) => {
    pointer(stage, "pointerdown", from, 100);
    pointer(stage, "pointerup", to, 100);
  };
  swipe(200, 100);
  expect(editor.active()).toBe("b");
  swipe(200, 100);
  expect(editor.active()).toBe("c");
  swipe(200, 100);
  expect(editor.active()).toBe("c");
  swipe(100, 200);
  expect(editor.active()).toBe("b");
  swipe(100, 200);
  swipe(100, 200);
  expect(editor.active()).toBe("a");
  expect(editor.onChange).not.toHaveBeenCalled();
});

it("ignores short, vertical, canceled, and multi-touch swipes", () => {
  const editor = openSlides();
  const stage = document.querySelector(".slide-stage-viewport")!;
  pointer(stage, "pointerdown", 200, 100);
  pointer(stage, "pointerup", 180, 100);
  pointer(stage, "pointerdown", 200, 100);
  pointer(stage, "pointerup", 100, 300);
  pointer(stage, "pointerdown", 200, 100);
  pointer(stage, "pointercancel");
  pointer(stage, "pointerup", 100, 100);
  pointer(stage, "pointerdown", 200, 100);
  pointer(stage, "pointerdown", 210, 100);
  pointer(stage, "pointerup", 100, 100);
  expect(editor.active()).toBe("a");
});

it("leaves editable object gestures alone and allows read-only object swipes", () => {
  const editable = openSlides();
  tap(box("a-words"));
  pointer(box("a-words"), "pointerdown", 200, 100);
  pointer(box("a-words"), "pointerup", 100, 100);
  expect(editable.active()).toBe("a");
  editable.unmount();
  const viewer = openSlides({ readOnly: true });
  pointer(box("a-words"), "pointerdown", 200, 100);
  pointer(box("a-words"), "pointerup", 100, 100);
  expect(viewer.active()).toBe("b");
  expect(viewer.onChange).not.toHaveBeenCalled();
});

it.each([false, true])("does not select or move an unselected object during a swipe (angled=%s)", (angled) => {
  const editor = openSlides();
  const before = editor.deck();
  const target = box("a-words");
  pointer(target, "pointerdown", 250, 100);
  expect(target.classList.contains("selected")).toBe(false);
  if (angled) pointer(target, "pointermove", 248, 112);
  pointer(target, "pointermove", 150, 120);
  expect(target.classList.contains("selected")).toBe(false);
  expect(editor.deck()).toEqual(before);
  pointer(target, "pointerup", 100, 120);
  expect(editor.active()).toBe(angled ? "a" : "b");
  expect(document.querySelector(".slide-canvas .selected")).toBeNull();
  expect(editor.deck()).toEqual(before);
  expect(editor.onChange).not.toHaveBeenCalled();
});

it("does not select after cancellation or a gesture that returns to its starting point", () => {
  openSlides();
  const target = box("a-words");
  pointer(target, "pointerdown", 100, 100);
  pointer(target, "pointercancel", 100, 100);
  pointer(target, "pointerup", 100, 100);
  expect(target.classList.contains("selected")).toBe(false);
  pointer(target, "pointerdown", 100, 100);
  pointer(target, "pointermove", 120, 120);
  pointer(target, "pointerup", 100, 100);
  expect(target.classList.contains("selected")).toBe(false);
});

it("ignores swipes in editable text and on desktop", () => {
  const editor = openSlides();
  tap(box("a-words"));
  tap(box("a-words"));
  const text = box("a-words").querySelector('[contenteditable="true"]')!;
  pointer(text, "pointerdown", 200, 100);
  pointer(text, "pointerup", 100, 100);
  expect(editor.active()).toBe("a");
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
  const stage = document.querySelector(".slide-stage-viewport")!;
  pointer(stage, "pointerdown", 200, 100);
  pointer(stage, "pointerup", 100, 100);
  fireEvent.mouseDown(stage, { clientX: 200 });
  fireEvent.mouseUp(stage, { clientX: 100 });
  expect(editor.active()).toBe("a");
});

it("swipes through a slideshow once per gesture and still advances on a tap", () => {
  const editor = openSlides();
  act(() => editor.actions().present!());
  const slide = () => document.querySelector(".presenter-slide-box")!;
  const counter = () => document.querySelector(".presenter-counter")!.textContent;
  pointer(slide(), "pointerdown", 200, 100);
  pointer(slide(), "pointerup", 100, 100);
  fireEvent.click(slide(), { detail: 1 });
  expect(counter()).toBe("Slide 2 of 3");
  pointer(slide(), "pointerdown", 100, 100);
  pointer(slide(), "pointerup", 200, 100);
  fireEvent.click(slide(), { detail: 1 });
  expect(counter()).toBe("Slide 1 of 3");
  pointer(slide(), "pointerdown", 100, 100);
  pointer(slide(), "pointerup", 100, 100);
  fireEvent.click(slide(), { detail: 1 });
  expect(counter()).toBe("Slide 2 of 3");
  expect(editor.onChange).not.toHaveBeenCalled();
});
