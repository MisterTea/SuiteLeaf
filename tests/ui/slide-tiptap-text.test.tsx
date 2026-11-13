// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TextRun } from "@suiteleaf/core";
import { restoreSelection, selectionOffsets, SlideTextBody as TrialTextBody } from "../../apps/web/src/editors/slide-text";
import { TiptapSlideTextBody as SlideTextBody } from "../../apps/web/src/editors/slide-tiptap-text";
import { slideTextEditor } from "../../apps/web/src/editors/slide-tiptap-selection";

beforeEach(() => history.replaceState(null, "", "/?slideText=tiptap"));
afterEach(() => { cleanup(); history.replaceState(null, "", "/"); });
const noop = () => {};

it("loads the trial through the shared slide text entry point", async () => {
  const view = render(<TrialTextBody content="Trial words" editing={false} onText={noop} onCaret={noop} />);
  await waitFor(() => expect(view.container.querySelector(".slide-tiptap-text")?.textContent).toBe("Trial words"));
});

it("uses static rendering for inactive boxes and creates only the active editor", () => {
  function Boxes({ active }: { active: number }) {
    return <>{Array.from({ length: 100 }, (_, index) => <SlideTextBody key={index} content={`Box ${index}`} editing={index === active} onText={noop} onCaret={noop} />)}</>;
  }
  const view = render(<Boxes active={-1} />);
  expect(view.container.querySelectorAll(".ProseMirror")).toHaveLength(0);
  expect(view.container.querySelectorAll(".slide-tiptap-text")).toHaveLength(100);
  view.rerender(<Boxes active={3} />);
  expect(view.container.querySelectorAll(".ProseMirror")).toHaveLength(1);
  const first = view.container.querySelector<HTMLElement>(".ProseMirror")!;
  const editor = slideTextEditor(first)!;
  expect(editor).toBeDefined();
  expect(first.getAttribute("role")).toBe("textbox");
  view.rerender(<Boxes active={5} />);
  expect(editor.isDestroyed).toBe(true);
  expect(slideTextEditor(first)).toBeUndefined();
  expect(view.container.querySelectorAll(".ProseMirror")).toHaveLength(1);
  view.rerender(<Boxes active={-1} />);
  expect(view.container.querySelectorAll(".ProseMirror")).toHaveLength(0);
});

it("emits no saved change when entering and leaving editing", () => {
  const onText = vi.fn();
  const props = { content: "▪ First", runs: [{ text: "▪ ", font: "SuiteLeaf Sprig", paraHang: 24 }, { text: "First" }], onText, onCaret: noop };
  const view = render(<SlideTextBody {...props} editing={false} />);
  view.rerender(<SlideTextBody {...props} editing />);
  view.rerender(<SlideTextBody {...props} editing={false} />);
  expect(onText).not.toHaveBeenCalled();
  expect(view.container.querySelector("ul li [data-slide-content]")?.textContent).toBe("First");
});

it("keeps a live instance and selection while local edits echo through slide state", () => {
  const caret = vi.fn();
  function Box() {
    const [runs, setRuns] = useState<TextRun[]>([{ text: "Hello" }]);
    return <SlideTextBody runs={runs} editing onText={setRuns} onCaret={caret} />;
  }
  const view = render(<Box />);
  const node = view.container.querySelector<HTMLElement>(".ProseMirror")!;
  const e = slideTextEditor(node)!;
  act(() => { restoreSelection(node, 5, 5); e.commands.insertContent(" there"); });
  expect(node.textContent).toBe("Hello there");
  expect(slideTextEditor(node)).toBe(e);
  expect(selectionOffsets(node)).toEqual({ start: 11, end: 11 });
  expect(caret).toHaveBeenCalled();
  const event = new MouseEvent("mousedown", { bubbles: true });
  const stop = vi.spyOn(event, "stopPropagation");
  // The mount owns propagation; native caret hit-testing belongs in the browser test.
  fireEvent(node.parentElement!, event);
  expect(stop).toHaveBeenCalled();
});

it("accepts external undo/formatting updates without creating a second editor", () => {
  const onText = vi.fn();
  const view = render(<SlideTextBody content="Hello" editing onText={onText} onCaret={noop} />);
  const node = view.container.querySelector<HTMLElement>(".ProseMirror")!;
  const e = slideTextEditor(node)!;
  act(() => restoreSelection(node, 2, 4));
  view.rerender(<SlideTextBody content="Hello" runs={[{ text: "Hello", bold: true }]} editing onText={onText} onCaret={noop} />);
  expect(node.querySelector("strong")?.textContent).toBe("Hello");
  expect(selectionOffsets(node)).toEqual({ start: 2, end: 4 });
  expect(onText).not.toHaveBeenCalled();
  expect(slideTextEditor(node)).toBe(e);
  act(() => { restoreSelection(node, 5, 5); e.commands.insertContent("!"); });
  // The slide draft echoes the local transaction before the undo request.
  view.rerender(<SlideTextBody runs={[{ text: "Hello!", bold: true }]} editing onText={onText} onCaret={noop} />);
  view.rerender(<SlideTextBody runs={[{ text: "Hello", bold: true }]} editing onText={onText} onCaret={noop} />);
  expect(node.textContent).toBe("Hello");
  view.rerender(<SlideTextBody runs={[{ text: "Hello!", bold: true }]} editing onText={onText} onCaret={noop} />);
  expect(node.textContent).toBe("Hello!");
});

it("keeps authored selections correct across markers and math", () => {
  const view = render(<SlideTextBody runs={[{ text: "• First" }, { text: "\n", paragraphBreak: true }, { text: "• Second" }, { text: "x+y", math: true }]} editing onText={noop} onCaret={noop} placeholder="Body" />);
  const node = view.container.querySelector<HTMLElement>(".ProseMirror")!;
  act(() => restoreSelection(node, 10, 16));
  expect(selectionOffsets(node)).toEqual({ start: 10, end: 16 });
  expect(node.getAttribute("aria-label")).toBe("Body");
});

it("renders empty static boxes with their placeholder and repaints layout changes", () => {
  const view = render(<SlideTextBody content="" editing={false} onText={noop} onCaret={noop} placeholder="Body" />);
  expect(view.container.querySelector<HTMLElement>(".element-editor")!.dataset.empty).toBe("true");
  view.rerender(<SlideTextBody content="• First" hang={24} fontSize={22} editing onText={noop} onCaret={noop} />);
  expect(view.container.querySelector(".slide-bullet-slot")).not.toBeNull();
  view.rerender(<SlideTextBody content="First" fontSize={24} editing onText={noop} onCaret={noop} />);
  expect(view.container.querySelectorAll(".ProseMirror")).toHaveLength(1);
  expect(view.container.querySelector(".slide-bullet-slot")).toBeNull();
});

it("ignores delayed local echoes while applying an explicit undo revision", () => {
  const onText = vi.fn();
  const props = { editing: true, onText, onCaret: noop, revision: 0 };
  const view = render(<SlideTextBody {...props} content="" />);
  const root = view.container.querySelector<HTMLElement>(".ProseMirror")!;
  const editor = slideTextEditor(root)!;
  act(() => { editor.commands.insertContent("K"); editor.commands.insertContent("ickoff"); });
  view.rerender(<SlideTextBody {...props} content="K" />);
  expect(editor.state.doc.textContent).toBe("Kickoff");
  view.rerender(<SlideTextBody {...props} revision={1} content="K" />);
  expect(editor.state.doc.textContent).toBe("K");
  expect(root.textContent).toBe("K");
});

it("keeps the live editor when inherited bold is normalized into text runs", () => {
  const props = { content: "North", bold: true, editing: true, onText: noop, onCaret: noop };
  const view = render(<SlideTextBody {...props} />);
  const root = view.container.querySelector<HTMLElement>(".ProseMirror")!;
  const editor = slideTextEditor(root)!;
  view.rerender(<SlideTextBody {...props} bold={false} content="W" runs={[{ text: "W", bold: true }]} />);
  expect(slideTextEditor(root)).toBe(editor);
  expect(editor.isDestroyed).toBe(false);
  expect(editor.state.doc.textContent).toBe("W");
});
