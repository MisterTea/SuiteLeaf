// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useRef, type MutableRefObject } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDocProofing, type ProofingContext } from "../../apps/web/src/editors/doc-proofing";
import {
  PERSONAL_DICTIONARY_KEY,
  Proofing,
  readLanguageDictionary,
  readPersonalDictionary,
  spellingSuggestionReason,
  spellingSuggestions,
  writePersonalDictionary,
} from "../../apps/web/src/editors/doc-spelling";
import { memoryStorage } from "../doc-editor-harness";

type Exposed = ReturnType<typeof useDocProofing> & { context: MutableRefObject<ProofingContext> };
let exposed: Exposed;
let editor: Editor;
const fix = spellingSuggestions("recieve")[0];

function Harness({ grammar }: { grammar?: MutableRefObject<ProofingContext> }) {
  const context = useRef<ProofingContext>(() => false);
  const proofing = useDocProofing(editor as never, 4, context, grammar);
  exposed = { ...proofing, context };
  return (
    <div>
      <output aria-label="Status count">{proofing.label}</output>
      {proofing.ui}
    </div>
  );
}

function mount(content: JSONContent, grammar?: MutableRefObject<ProofingContext>) {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions: [StarterKit, Proofing], content });
  render(<Harness grammar={grammar} />);
}

const para = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (texts: string[], proofing?: Record<string, unknown>, extra: JSONContent[] = []): JSONContent => ({
  type: "doc",
  ...(proofing ? { attrs: { proofing } } : {}),
  content: [...texts.map(para), ...extra],
});
const proofing = () => (editor.state.doc.attrs.proofing ?? {}) as Record<string, unknown>;
const text = () => editor.state.doc.textContent;

function rightClick(pos: number) {
  editor.view.posAtCoords = () => ({ pos, inside: -1 });
  let handled = false;
  act(() => {
    handled = exposed.context.current(editor.view, new MouseEvent("contextmenu", { clientX: 40, clientY: 60, cancelable: true }));
  });
  return handled;
}

beforeEach(() => {
  memoryStorage();
});

afterEach(() => {
  cleanup();
  editor?.destroy();
  document.body.replaceChildren();
});

describe("word count dialog", () => {
  it("counts the document and the selection and saves its choices", () => {
    mount({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
        para("One two three."),
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Notes" }] },
        para("Four five."),
      ],
    });
    act(() => exposed.openWordCount());
    const dialog = screen.getByRole("dialog", { name: "Word count" });
    const row = (name: string) => within(dialog).getByRole("rowheader", { name }).parentElement!;
    expect(row("Words").textContent).toBe("Words—7");
    expect(row("Pages").textContent).toBe("Pages—4");
    act(() => {
      editor.commands.setTextSelection({ from: 8, to: 15 });
    });
    expect(row("Words").textContent).toBe("Words27");
    expect(screen.getByText("This document has no footnotes. The choice is saved for when it does.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Count footnotes" }));
    expect(proofing().countFootnotes).toBe(true);
    const stop = within(dialog).getByRole("combobox", { name: "Stop counting at heading" }) as HTMLSelectElement;
    expect([...stop.options].map((option) => option.value)).toEqual(["", "Intro", "Notes"]);
    fireEvent.change(stop, { target: { value: "Notes" } });
    expect(proofing().stopAtHeading).toBe("Notes");
    expect(row("Words").textContent).toBe("Words24");
    fireEvent.change(stop, { target: { value: "" } });
    expect(proofing().stopAtHeading).toBeNull();

    expect(screen.getByLabelText("Status count").textContent).toMatch(/2 of 7 words/);
    const show = within(dialog).getByRole("checkbox", { name: "Show word count while typing" });
    fireEvent.click(show);
    expect(screen.getByLabelText("Status count").textContent).toBe("");
    fireEvent.click(show);
    expect(screen.getByLabelText("Status count").textContent).toMatch(/2 of 7 words/);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens from Ctrl+Shift+C but not while typing in a field, and closes every way", () => {
    mount(doc(["Hello there."], { stopAtHeading: "Gone" }));
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "C", ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.keyDown(window, { key: "c", ctrlKey: true, shiftKey: true, altKey: true });
    fireEvent.keyDown(window, { key: "x", metaKey: true, shiftKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "C", metaKey: true, shiftKey: true });
    const stop = screen.getByRole("combobox", { name: "Stop counting at heading" }) as HTMLSelectElement;
    expect([...stop.options].map((option) => option.value)).toEqual(["", "Gone"]);
    fireEvent.click(screen.getByRole("button", { name: "Close word count" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => exposed.openWordCount());
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => exposed.openWordCount());
    fireEvent.mouseDown(document.querySelector(".page-setup-overlay")!);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => exposed.openWordCount());
    act(() => exposed.closeProofing());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not count a selected photo as a selection of zero words", () => {
    mount(doc(["Two words"]));
    act(() => exposed.openWordCount());
    expect(screen.getByRole("rowheader", { name: "Words" }).parentElement!.textContent).toBe("Words—2");
  });
});

describe("spelling dialog", () => {
  it("walks the misspellings and changes, ignores and adds them", () => {
    mount(doc(["I recieve mail daily.", "Pleese recieve it.", "A qzxv and wrold."]));
    act(() => exposed.openSpelling());
    const progress = () => document.querySelector(".spelling-progress")!.textContent;
    expect(progress()).toBe(`1 of 5 · recieve → ${fix}`);
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe("recieve");
    expect(editor.view.dom.querySelector(".spelling-current")?.textContent).toBe("recieve");
    const suggestions = screen.getByRole("listbox", { name: "Suggestions" });
    const first = within(suggestions).getAllByRole("button")[0];
    fireEvent.change(screen.getByRole("textbox", { name: "Correction" }), { target: { value: "receipt" } });
    expect(first.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(first);
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".spelling-panel")?.textContent).toContain(spellingSuggestionReason("recieve", fix));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(text()).toContain(`I ${fix} mail`);
    expect(progress()).toMatch(/^2 of 5 · Pleese/);
    fireEvent.click(screen.getByRole("button", { name: "Ignore this one" }));
    expect(editor.state.doc.nodeAt(24)?.marks.map((mark) => mark.type.name)).toContain("spellingIgnore");
    expect(progress()).toMatch(/^3 of 5 · recieve/);
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    expect(proofing().ignored).toEqual(["recieve"]);
    expect(progress()).toMatch(/^4 of 5 · qzxv/);
    expect(screen.getByText("No suggestion. Type a correction, or add the word to your dictionary.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to dictionary" }));
    expect(readPersonalDictionary().added).toEqual(["qzxv"]);
    expect(readLanguageDictionary().en).toEqual(["qzxv"]);
    expect(progress()).toMatch(/^5 of 5 · wrold/);
    fireEvent.change(screen.getByRole("textbox", { name: "Correction" }), { target: { value: " " } });
    fireEvent.submit(screen.getByRole("dialog", { name: "Spelling" }));
    expect(text()).toContain("wrold");
    fireEvent.change(screen.getByRole("textbox", { name: "Correction" }), { target: { value: "world" } });
    fireEvent.submit(screen.getByRole("dialog", { name: "Spelling" }));
    expect(progress()).toBe("Spelling check finished");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("changes every copy only after the preview is confirmed", () => {
    mount(doc(["We recieve.", "They recieve too.", "Recieve!"]));
    act(() => exposed.openSpelling());
    fireEvent.click(screen.getByRole("button", { name: "Change all" }));
    const preview = screen.getByRole("dialog", { name: "Change every copy?" });
    expect(within(preview).getByText(`3 copies of “recieve” will become “${fix}”.`)).toBeTruthy();
    expect(text()).toContain("recieve");
    fireEvent.click(within(preview).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Change every copy?" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change all" }));
    fireEvent.click(screen.getByRole("button", { name: "Change 3 copies" }));
    expect(text()).not.toMatch(/recieve/i);
    expect(text()).toContain(fix[0].toUpperCase() + fix.slice(1));
    expect(document.querySelector(".spelling-progress")?.textContent).toBe("No spelling issues");
  });

  it("switches the proofing language and marks a selection with it", () => {
    mount(doc(["Bonjour recieve."]));
    act(() => exposed.openSpelling());
    fireEvent.change(screen.getByRole("combobox", { name: "Proofing language" }), { target: { value: "fr" } });
    expect(proofing().language).toBe("fr");
    expect(editor.view.dom.dir).toBe("ltr");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 8 });
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this language for the selection" }));
    expect(editor.state.doc.nodeAt(1)?.marks.find((mark) => mark.type.name === "proofingLanguage")?.attrs.language).toBe("fr");
    fireEvent.change(screen.getByRole("combobox", { name: "Proofing language" }), { target: { value: "ar" } });
    expect(editor.view.dom.dir).toBe("rtl");
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Spelling" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when nothing was compared with the English dictionary", () => {
    mount(doc(["مرحبا بالعالم"], { language: "ar" }));
    act(() => exposed.openSpelling());
    expect(document.querySelector(".spelling-progress")?.textContent).toBe("No spelling issues");
    expect(screen.getByText("Nothing was compared with the English dictionary.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close spelling" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => exposed.openDictionary());
    expect(document.querySelector(".dictionary-dialog")?.getAttribute("dir")).toBe("rtl");
  });
});

describe("spelling menu", () => {
  it("offers suggestions, change all, and the dictionary on a right click", () => {
    mount(doc(["I recieve mail.", "We recieve more."]));
    expect(rightClick(2)).toBe(false);
    expect(rightClick(4)).toBe(true);
    const menu = screen.getByRole("menu", { name: "Spelling for recieve" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items[0].textContent).toBe(fix);
    expect(within(menu).getByRole("menuitem", { name: `Change all to ${fix}` })).toBeTruthy();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    rightClick(4);
    fireEvent.click(screen.getByRole("menuitem", { name: fix }));
    expect(text()).toBe(`I ${fix} mail.We recieve more.`);
    expect(screen.queryByRole("menu")).toBeNull();

    rightClick(23);
    expect(screen.queryByRole("menuitem", { name: /Change all/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Ignore this one" }));
    expect(screen.queryByRole("menu")).toBeNull();
    rightClick(23);
    fireEvent.click(screen.getByRole("menuitem", { name: "Check this one again" }));
    expect(editor.state.doc.nodeAt(23)?.marks).toEqual([]);
    rightClick(23);
    fireEvent.click(screen.getByRole("menuitem", { name: "Ignore" }));
    expect(proofing().ignored).toEqual(["recieve"]);
  });

  it("adds a word to the dictionary from the menu and opens change all", () => {
    mount(doc(["The zorbly recieve.", "The zorbly recieve."]));
    rightClick(7);
    expect(screen.getByText("No suggestions")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to dictionary" }));
    expect(readPersonalDictionary().added).toEqual(["zorbly"]);
    expect(rightClick(7)).toBe(false);
    rightClick(14);
    fireEvent.click(screen.getByRole("menuitem", { name: `Change all to ${fix}` }));
    expect(screen.getByRole("dialog", { name: "Change every copy?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change 2 copies" }));
    expect(text()).toBe(`The zorbly ${fix}.The zorbly ${fix}.`);
  });

  it("closes from the backdrop and lets grammar answer first", () => {
    const grammar = { current: (() => true) as ProofingContext };
    mount(doc(["I recieve mail."]), grammar);
    expect(rightClick(4)).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    grammar.current = () => false;
    rightClick(4);
    fireEvent.contextMenu(document.querySelector(".context-menu-backdrop")!);
    expect(screen.queryByRole("menu")).toBeNull();
    rightClick(4);
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(document.querySelector(".context-menu-backdrop")!);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("personal dictionary", () => {
  it("lists and removes added, ignored and flagged words", () => {
    localStorage.setItem(PERSONAL_DICTIONARY_KEY, JSON.stringify({ added: ["Zorbly"], flagged: [] }));
    mount(doc(["Zorbly text."], { ignored: ["recieve"] }));
    act(() => exposed.openDictionary());
    const dialog = screen.getByRole("dialog", { name: "Personal dictionary" });
    expect(within(dialog).getByText("Zorbly")).toBeTruthy();
    expect(within(dialog).getByText("recieve")).toBeTruthy();
    const [removeAdded, removeIgnored] = within(dialog).getAllByRole("button", { name: "Remove" });
    fireEvent.click(removeIgnored);
    expect(proofing().ignored).toEqual([]);
    expect(within(dialog).getByText("No ignored words. Removing one here underlines it again.")).toBeTruthy();
    fireEvent.click(removeAdded);
    expect(readPersonalDictionary().added).toEqual([]);
    expect(within(dialog).getByText("No added words yet. Right-click a name and choose Add to dictionary.")).toBeTruthy();

    const flag = within(dialog).getByRole("textbox", { name: "Word to flag" });
    fireEvent.submit(flag.closest("form")!);
    expect(readPersonalDictionary().flagged).toEqual([]);
    fireEvent.change(flag, { target: { value: "wer" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Flag word" }));
    expect(readPersonalDictionary().flagged).toEqual(["wer"]);
    expect((flag as HTMLInputElement).value).toBe("");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(readPersonalDictionary().flagged).toEqual([]);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => exposed.openDictionary());
    fireEvent.click(screen.getByRole("button", { name: "Close personal dictionary" }));
    act(() => exposed.openDictionary());
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    act(() => exposed.openDictionary());
    fireEvent.mouseDown(document.querySelector(".page-setup-overlay")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("follows a dictionary changed in another window", () => {
    mount(doc(["Zorbly text."]));
    act(() => exposed.openDictionary());
    act(() => writePersonalDictionary({ added: ["Elsewhere"], flagged: ["wer"] }));
    expect(screen.getByText("Elsewhere")).toBeTruthy();
    expect(screen.getByText("wer")).toBeTruthy();
  });
});
