// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Equation, EquationDialog } from "../../apps/web/src/editors/doc-equations";
import { parseLinear, plainOf, type EqNode } from "../../packages/core/src/equations";

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  while (editors.length) editors.pop()?.destroy();
  document.body.replaceChildren();
});

function make(content: JSONContent | string, editable = true) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({ element, editable, extensions: [StarterKit, Equation], content });
  editors.push(editor);
  return editor;
}

const withEquation = (expr: EqNode): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Area " }, { type: "equation", attrs: { expr } }] }],
});

const exprOf = (editor: Editor) => editor.getJSON().content?.[0].content?.[1].attrs?.expr as EqNode;
const microtasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("equation in the text", () => {
  it("paints powers, fractions and subscripts as clickable symbols", () => {
    const editor = make(withEquation(parseLinear("(a+b)/c^2")!));
    const dom = editor.view.dom.querySelector<HTMLElement>(".eq")!;
    expect(dom.getAttribute("role")).toBe("math");
    expect(dom.dataset.structure).toBe("frac");
    expect(dom.querySelector(".eq-num")).not.toBeNull();
    expect(dom.querySelector(".eq-den .eq-sup .eq-exp")?.textContent).toBe("2");
    expect(dom.getAttribute("aria-label")).toMatch(/^Equation, /);
    const sub = make(withEquation({ kind: "sub", base: { kind: "text", text: "x" }, sub: { kind: "text", text: "1" } }));
    expect(sub.view.dom.querySelector(".eq-sub .eq-subexp")?.textContent).toBe("1");
    const row = make(withEquation({ kind: "row", items: [{ kind: "text", text: "a" }, { kind: "text", text: "b" }] }));
    expect(row.view.dom.querySelectorAll(".eq-row .eq-slot")).toHaveLength(2);
  });

  it("changes one symbol after a click and Enter", async () => {
    const editor = make(withEquation(parseLinear("x^2")!));
    const symbol = screen.getByRole("button", { name: "Edit symbol 2" });
    fireEvent.click(symbol);
    const input = screen.getByRole("textbox", { name: "Symbol 2" }) as HTMLInputElement;
    await microtasks();
    expect(document.activeElement).toBe(input);
    fireEvent.input(input, { target: { value: "10" } });
    expect(input.style.width).toBe("2ch");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(exprOf(editor)).toEqual({ kind: "sup", base: { kind: "text", text: "x" }, exp: { kind: "text", text: "10" } });
    expect(editor.getJSON().content?.[0].content?.[1].attrs?.plain).toBe(plainOf(exprOf(editor)));
    expect(screen.getByRole("button", { name: "Edit symbol 10" })).toBeTruthy();
  });

  it("keeps the symbol on Escape, an empty value, or no change", () => {
    const editor = make(withEquation(parseLinear("x^2")!));
    const before = exprOf(editor);
    fireEvent.click(screen.getByRole("button", { name: "Edit symbol x" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Symbol x" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: /Symbol/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit symbol x" }));
    const input = screen.getByRole("textbox", { name: "Symbol x" }) as HTMLInputElement;
    fireEvent.keyDown(input, { key: "a" });
    input.value = "  ";
    fireEvent.blur(input);
    expect(exprOf(editor)).toEqual(before);
    fireEvent.click(screen.getByRole("button", { name: "Edit symbol x" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Symbol x" }), { key: "Enter" });
    expect(exprOf(editor)).toEqual(before);
    expect(screen.queryByRole("textbox", { name: /Symbol/ })).toBeNull();
  });

  it("keeps an open symbol when the paragraph around it changes", () => {
    const editor = make(withEquation(parseLinear("x^2")!));
    fireEvent.click(screen.getByRole("button", { name: "Edit symbol 2" }));
    editor.commands.insertContentAt(1, "Big ");
    expect(screen.getByRole("textbox", { name: "Symbol 2" })).toBeTruthy();
    editor.commands.setNodeSelection(10);
    expect(editor.view.dom.querySelector(".eq")?.classList.contains("eq-selected")).toBe(true);
    editor.commands.setTextSelection(1);
    expect(editor.view.dom.querySelector(".eq")?.classList.contains("eq-selected")).toBe(false);
  });

  it("shows plain symbols in a read-only document and round-trips HTML", async () => {
    const editor = make(withEquation(parseLinear("x^2")!), false);
    // Before the editor finishes starting, a symbol press still cannot edit.
    for (const button of screen.queryAllByRole("button")) fireEvent.click(button);
    expect(screen.queryByRole("textbox", { name: /Symbol/ })).toBeNull();
    await microtasks();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(editor.view.dom.querySelectorAll("span.eq-slot")).toHaveLength(2);
    const html = editor.getHTML();
    expect(html).toContain('data-structure="sup"');
    const again = make(html);
    expect(exprOf(again)).toEqual(parseLinear("x^2"));
    expect(again.getJSON().content?.[0].content?.[1].attrs?.plain).toBe(plainOf(parseLinear("x^2")!));
  });

  it("drops an open symbol and stops editing when the document turns read-only", async () => {
    const editor = make(withEquation(parseLinear("x^2")!));
    await microtasks();
    fireEvent.click(screen.getByRole("button", { name: "Edit symbol 2" }));
    const input = screen.getByRole("textbox", { name: "Symbol 2" }) as HTMLInputElement;
    editor.setEditable(false);
    expect(screen.queryByRole("textbox", { name: /Symbol/ })).toBeNull();
    input.value = "9";
    fireEvent.keyDown(input, { key: "Enter" });
    expect(exprOf(editor)).toEqual(parseLinear("x^2"));
    editor.setEditable(true);
    expect(screen.getByRole("button", { name: "Edit symbol 2" })).toBeTruthy();
  });
});

describe("equation dialog", () => {
  function open() {
    const editor = make({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] });
    editor.commands.setTextSelection(3);
    const onClose = vi.fn();
    render(<EquationDialog editor={editor as never} onClose={onClose} />);
    return { editor, onClose, field: screen.getByRole("textbox", { name: "Equation" }) as HTMLInputElement };
  }

  it("previews and inserts a power with Enter", () => {
    const { editor, onClose, field } = open();
    expect(document.activeElement).toBe(field);
    expect(screen.getByText("Preview")).toBeTruthy();
    expect(screen.getByText("A power or a fraction will show here.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Insert equation" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: "x^" } });
    expect(screen.getByText("Keep going. x^2 is a power, and (a+b)/c is a fraction.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "x^2" } });
    expect(screen.getByText("Click any symbol after inserting to change just that one.")).toBeTruthy();
    expect(screen.getByLabelText("Equation preview").querySelector(".eq-sup")).not.toBeNull();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
    const inserted = editor.getJSON().content?.[0].content?.find((node) => node.type === "equation");
    expect(inserted?.attrs).toMatchObject({ expr: parseLinear("x^2"), plain: plainOf(parseLinear("x^2")!) });
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it("explains input it cannot read and closes from every exit", () => {
    const { onClose, field } = open();
    fireEvent.change(field, { target: { value: "a)b(" } });
    expect(screen.getByText("Keep going. x^2 is a power, and (a+b)/c is a fraction.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "x^^2" } });
    const status = document.querySelector(".equation-status")!;
    expect(status.getAttribute("data-invalid")).toBe("true");
    expect(status.textContent).toBe("Use a power like x^2, or a fraction like (a+b)/c.");
    fireEvent.click(screen.getByRole("button", { name: "Insert equation" }));
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("dialog"));
    fireEvent.click(document.querySelector(".gdocs-modal-overlay")!);
    expect(onClose).toHaveBeenCalledTimes(4);
  });
});
