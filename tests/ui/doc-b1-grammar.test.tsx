// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useRef, type MutableRefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useDocGrammar } from "../../apps/web/src/editors/doc-grammar-ui";
import { Grammar } from "../../apps/web/src/editors/doc-grammar";
import { Proofing } from "../../apps/web/src/editors/doc-spelling";
import type { ProofingContext } from "../../apps/web/src/editors/doc-proofing";

let editor: Editor;
let exposed: ReturnType<typeof useDocGrammar> & { context: MutableRefObject<ProofingContext> };

function Harness() {
  const context = useRef<ProofingContext>(() => false);
  const grammar = useDocGrammar(editor as never, context);
  exposed = { ...grammar, context };
  return <>{grammar.ui}</>;
}

function mount(text: string, ignoredGrammar: string[] = []) {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({
    element,
    extensions: [StarterKit, Proofing, Grammar],
    content: { type: "doc", attrs: { proofing: { ignoredGrammar } }, content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  });
  render(<Harness />);
}

const text = () => editor.state.doc.textContent;
const ignored = () => ((editor.state.doc.attrs.proofing ?? {}) as { ignoredGrammar?: string[] }).ignoredGrammar ?? [];
const progress = () => document.querySelector(".spelling-progress")?.textContent;
const sentence = "the movement were strong and its the reason they was ready";

function rightClick(pos: number) {
  editor.view.posAtCoords = () => ({ pos, inside: -1 });
  let handled = false;
  act(() => {
    handled = exposed.context.current(editor.view, new MouseEvent("contextmenu", { clientX: 30, clientY: 40, cancelable: true }));
  });
  return handled;
}

afterEach(() => {
  cleanup();
  editor?.destroy();
  document.body.replaceChildren();
});

describe("grammar check", () => {
  it("walks each issue, changing and ignoring them", () => {
    mount(sentence);
    act(() => exposed.openGrammar());
    expect(progress()).toBe("1 of 3 · were → was");
    expect(editor.view.dom.querySelector(".grammar-current")?.textContent).toBe("were");
    const field = screen.getByRole("textbox", { name: "Suggestion" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: " " } });
    expect((screen.getByRole("button", { name: "Change" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("dialog"));
    expect(text()).toBe(sentence);
    fireEvent.change(field, { target: { value: "was" } });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(text()).toBe("the movement was strong and its the reason they was ready");
    expect(progress()).toBe("2 of 3 · its → it's");
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    expect(ignored()).toEqual(["its the → it's"]);
    expect(progress()).toBe("3 of 3 · was → were");
    fireEvent.submit(screen.getByRole("dialog"));
    expect(text()).toBe("the movement was strong and its the reason they were ready");
    expect(progress()).toBe("Grammar check finished");
    expect(screen.getByText("Nothing left to change. Spelling issues are still under Tools › Spelling.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor.view.dom.querySelector(".grammar-current")).toBeNull();
  });

  it("says when there is nothing to fix and closes from the keyboard", () => {
    mount("The movement was strong.");
    act(() => exposed.openGrammar());
    expect(progress()).toBe("No grammar issues");
    expect(screen.getByText("No agreement or its/it's issues. Spelling is a separate check.")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => exposed.openGrammar());
    fireEvent.click(screen.getByRole("button", { name: "Close grammar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists ignored grammar and brings an underline back", () => {
    mount(sentence, ["its the", "they was"]);
    act(() => exposed.openIgnoredGrammar());
    const dialog = screen.getByRole("dialog", { name: "Ignored grammar" });
    expect(within(dialog).getAllByRole("listitem").map((item) => item.querySelector("span")?.textContent)).toEqual(["its the", "they was"]);
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Remove" })[0]);
    expect(ignored()).toEqual(["they was"]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(screen.getByText("No ignored grammar. A blue underline comes back when you remove one.")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => exposed.openIgnoredGrammar());
    fireEvent.click(screen.getByRole("button", { name: "Close ignored grammar" }));
    act(() => exposed.openIgnoredGrammar());
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("grammar menu", () => {
  it("offers the fix and Ignore on a right click", () => {
    mount(sentence);
    expect(rightClick(2)).toBe(false);
    expect(rightClick(15)).toBe(true);
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe("were");
    const menu = screen.getByRole("menu", { name: "Grammar for were" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "was" }));
    expect(text()).toBe("the movement was strong and its the reason they was ready");
    expect(screen.queryByRole("menu")).toBeNull();
    // The end of a word still counts as that word.
    expect(rightClick(32)).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Ignore" }));
    expect(ignored()).toEqual(["its the → it's"]);
    expect(rightClick(30)).toBe(false);
  });

  it("closes from Escape and the backdrop", () => {
    mount(sentence);
    rightClick(15);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    rightClick(15);
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.contextMenu(document.querySelector(".context-menu-backdrop")!);
    expect(screen.queryByRole("menu")).toBeNull();
    rightClick(15);
    fireEvent.mouseDown(document.querySelector(".context-menu-backdrop")!);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(exposed.context.current(editor.view, new Event("contextmenu"))).toBe(false);
  });
});
