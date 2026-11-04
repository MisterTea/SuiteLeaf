// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extensions } from "../../apps/web/src/editors/doc-extensions";
import { LineSpacingControl } from "../../apps/web/src/editors/doc-line-spacing-ui";
import { TabStopField } from "../../apps/web/src/editors/doc-tab-stop-ui";
import { emptyRects, frameQueue, resizeObservers } from "../doc-editor-harness";

let editor: Editor;
let restoreRects: () => void;
let frames: ReturnType<typeof frameQueue>;

beforeEach(() => {
  frames = frameQueue();
  resizeObservers();
  restoreRects = emptyRects();
});

afterEach(() => {
  cleanup();
  restoreRects();
  editor?.destroy();
  document.body.replaceChildren();
});

const p = (text: string, attrs?: Record<string, unknown>): JSONContent => ({ type: "paragraph", ...(attrs ? { attrs } : {}), content: [{ type: "text", text }] });

function mount(blocks: JSONContent[], what: "spacing" | "tab" = "spacing") {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions, content: { type: "doc", content: blocks } });
  render(what === "spacing" ? <LineSpacingControl editor={editor as never} /> : <TabStopField editor={editor as never} />);
}

const trigger = () => document.querySelector<HTMLButtonElement>(".line-spacing-button")!;
const attrs = (index: number) => editor.state.doc.child(index).attrs;

describe("line spacing control", () => {
  it("shows the caret's spacing and changes it from the list", () => {
    mount([p("One"), p("Two")]);
    expect(trigger().getAttribute("aria-label")).toBe(
      "Line spacing, Single. Space before 0 points. Space after 0 points. Special indent none.",
    );
    fireEvent.mouseDown(trigger());
    const list = screen.getByRole("listbox", { name: "Line spacing" });
    const options = within(list).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Single", "1.15", "1.5", "Double"]);
    fireEvent.mouseDown(options[2]);
    fireEvent.click(options[2]);
    expect(attrs(0).lineSpacing).toBe("1.5");
    expect(screen.queryByRole("listbox", { name: "Line spacing" })).toBeNull();
    expect(trigger().textContent).toBe("1.5");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 8 });
    });
    expect(trigger().textContent).toBe("Mixed");
  });

  it("works from the keyboard", () => {
    mount([p("One")]);
    fireEvent.keyDown(trigger(), { key: "x" });
    expect(screen.queryByRole("listbox", { name: "Line spacing" })).toBeNull();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const options = within(screen.getByRole("listbox", { name: "Line spacing" })).getAllByRole("option");
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1], { key: "ArrowUp" });
    fireEvent.keyDown(options[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(options[3], { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Space before" }));
    fireEvent.keyDown(options[3], { key: "q" });
    fireEvent.keyDown(options[3], { key: " " });
    expect(attrs(0).lineSpacing).toBe("double");
    fireEvent.keyDown(trigger(), { key: "Enter" });
    fireEvent.keyDown(within(screen.getByRole("listbox", { name: "Line spacing" })).getAllByRole("option")[1], { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Line spacing" })).toBeNull();
    expect(document.activeElement).toBe(trigger());
    fireEvent.keyDown(trigger(), { key: " " });
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Line spacing" })).toBeNull();
    fireEvent.keyDown(trigger(), { key: "Enter" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Line spacing" })).toBeNull();
    fireEvent.mouseDown(trigger());
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox", { name: "Line spacing" })).toBeNull();
  });

  it("sets space before and after in points", () => {
    mount([p("One")]);
    fireEvent.mouseDown(trigger());
    const before = screen.getByRole("textbox", { name: "Space before" }) as HTMLInputElement;
    fireEvent.mouseDown(before);
    frames.flush();
    expect(document.activeElement).toBe(before);
    fireEvent.change(before, { target: { value: "12" } });
    fireEvent.keyDown(before, { key: "a" });
    fireEvent.keyDown(before, { key: "Enter" });
    expect(attrs(0).spaceBefore).toBe(12);
    expect(before.value).toBe("12");
    fireEvent.change(before, { target: { value: "12" } });
    fireEvent.blur(before);
    fireEvent.change(before, { target: { value: "lots" } });
    fireEvent.blur(before);
    expect(before.value).toBe("12");
    const after = screen.getByRole("textbox", { name: "Space after" }) as HTMLInputElement;
    fireEvent.focus(after);
    fireEvent.change(after, { target: { value: "6" } });
    fireEvent.blur(after);
    expect(attrs(0).spaceAfter).toBe(6);
    expect(trigger().getAttribute("aria-label")).toContain("Space before 12 points. Space after 6 points.");
  });

  it("shows mixed spacing across paragraphs", () => {
    mount([p("One", { spaceBefore: 6 }), p("Two", { spaceBefore: 12 })]);
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 8 });
    });
    expect(trigger().getAttribute("aria-label")).toContain("Space before mixed points.");
    fireEvent.mouseDown(trigger());
    const before = screen.getByRole("textbox", { name: "Space before" }) as HTMLInputElement;
    expect(before.placeholder).toBe("Mixed");
    fireEvent.focus(before);
    expect(before.value).toBe("");
  });

  it("sets a first line or hanging indent in inches", () => {
    mount([p("One")]);
    fireEvent.mouseDown(trigger());
    const group = screen.getByRole("listbox", { name: "Special indent" });
    const by = screen.getByRole("textbox", { name: "Indent by" }) as HTMLInputElement;
    expect(by.value).toBe("0.5");
    fireEvent.mouseDown(by);
    frames.flush();
    fireEvent.change(by, { target: { value: "0.75" } });
    fireEvent.keyDown(by, { key: "x" });
    fireEvent.keyDown(by, { key: "Enter" });
    expect(attrs(0).firstLineIndent ?? null).toBeNull();
    fireEvent.mouseDown(within(group).getByRole("option", { name: "First line" }));
    fireEvent.click(within(group).getByRole("option", { name: "First line" }));
    expect(attrs(0).firstLineIndent).toBe(0.75);
    expect(trigger().getAttribute("aria-label")).toContain("First line indent 0.75 inches.");
    fireEvent.focus(by);
    fireEvent.change(by, { target: { value: "1" } });
    fireEvent.blur(by);
    expect(attrs(0).firstLineIndent).toBe(1);
    fireEvent.click(within(group).getByRole("option", { name: "Hanging" }));
    expect(attrs(0)).toMatchObject({ hangingIndent: 1, firstLineIndent: null });
    expect(trigger().getAttribute("aria-label")).toContain("Hanging indent 1 inches.");
    fireEvent.change(by, { target: { value: "0" } });
    fireEvent.blur(by);
    expect(attrs(0)).toMatchObject({ hangingIndent: null, firstLineIndent: null });
    fireEvent.change(by, { target: { value: "huge" } });
    fireEvent.blur(by);
    expect(by.value).toBe("0.5");
    // With no indent on, 0 is not kept as a draft; First line then uses the default.
    fireEvent.change(by, { target: { value: "0" } });
    fireEvent.blur(by);
    fireEvent.click(within(group).getByRole("option", { name: "First line" }));
    expect(attrs(0).firstLineIndent).toBe(0.5);
    fireEvent.click(within(group).getByRole("option", { name: "None" }));
    expect(attrs(0).firstLineIndent ?? null).toBeNull();
  });

  it("reports a mixed indent", () => {
    mount([p("One", { firstLineIndent: 0.5 }), p("Two", { hangingIndent: 0.5 })]);
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 8 });
    });
    expect(trigger().getAttribute("aria-label")).toContain("Special indent mixed.");
  });

  it("is off without an editor", () => {
    render(<LineSpacingControl editor={null} />);
    expect(document.querySelector<HTMLButtonElement>(".line-spacing-button")!.disabled).toBe(true);
  });
});

describe("tab stop field", () => {
  it("applies one stop to the lines selected when the field was pressed", () => {
    mount([p("One"), p("Two"), p("Three")], "tab");
    const field = screen.getByRole("spinbutton", { name: "Tab stop in inches" }) as HTMLInputElement;
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 8 });
    });
    fireEvent.mouseDown(field);
    act(() => {
      editor.commands.setTextSelection(14);
    });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "1.5" } });
    expect([attrs(0).tabStop, attrs(1).tabStop, attrs(2).tabStop]).toEqual([1.5, 1.5, null]);
    expect(screen.getByText("These 2 lines share a stop at 1.5 in.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "99" } });
    expect(attrs(0).tabStop).toBe(1.5);
    fireEvent.keyDown(field, { key: "Tab" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field.value).toBe("1.5");
    // Leaving the field forgets that range; the next visit follows the caret.
    fireEvent.blur(field);
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "2" } });
    expect([attrs(0).tabStop, attrs(1).tabStop, attrs(2).tabStop]).toEqual([1.5, 1.5, 2]);
    expect(screen.getByText("This line has a stop at 2 in.")).toBeTruthy();
    fireEvent.blur(field);
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 16 });
    });
    expect(field.value).toBe("");
  });

  it("is off without an editor", () => {
    render(<TabStopField editor={null} />);
    const field = screen.getByRole("spinbutton", { name: "Tab stop in inches" }) as HTMLInputElement;
    expect(field.disabled).toBe(true);
    fireEvent.mouseDown(field);
    fireEvent.change(field, { target: { value: "1" } });
  });
});
