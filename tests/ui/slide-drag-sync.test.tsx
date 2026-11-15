// @vitest-environment jsdom
import { act, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { slideOp } from "../../packages/core/src";
import { box, openSlides, setupSlidesDom, words } from "./slide-editor-harness";

setupSlidesDom();

it.each(["move", "resize", "group"])("keeps %s previews local and syncs once on release", (mode) => {
  const editor = openSlides({ slides: { a: [
    words("one", "One", mode === "group" ? { groupId: "g" } : {}),
    words("two", "Two", { x: 500, y: 300, ...(mode === "group" ? { groupId: "g" } : {}) }),
  ] } });
  const before = editor.deck();
  vi.spyOn(document.querySelector(".slide-canvas")!, "getBoundingClientRect")
    .mockReturnValue({ width: 960, height: 540, left: 0, top: 0 } as DOMRect);
  fireEvent.mouseDown(box("one"), { clientX: 100, clientY: 80 });
  if (mode === "resize") {
    fireEvent.mouseUp(window);
    fireEvent.mouseDown(box("one").querySelector(".handle-se")!, { clientX: 100, clientY: 80 });
  }
  editor.onChange.mockClear();
  fireEvent.mouseMove(window, { clientX: 150, clientY: 120 });
  fireEvent.mouseMove(window, { clientX: 170, clientY: 140 });
  const preview = editor.deck();
  expect(preview).not.toEqual(before);
  expect(editor.onChange).not.toHaveBeenCalled();
  fireEvent.mouseUp(window);
  expect(editor.onChange).toHaveBeenCalledExactlyOnceWith(preview, slideOp(before, preview));
  expect(editor.onChange.mock.calls[0][1]).not.toEqual(slideOp(preview, preview));
  act(() => editor.slide().undo());
  expect(editor.deck()).toEqual(before);
  act(() => editor.slide().redo());
  expect(editor.deck()).toEqual(preview);
});

it("does not sync a click without movement", () => {
  const editor = openSlides();
  fireEvent.mouseDown(box("a-words"), { clientX: 100, clientY: 80 });
  fireEvent.mouseMove(window, { clientX: 102, clientY: 81 });
  fireEvent.mouseUp(window);
  expect(editor.onChange).not.toHaveBeenCalled();
});
