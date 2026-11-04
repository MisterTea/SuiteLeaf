// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocFindDialog, useDocFindEffects } from "../../apps/web/src/editors/doc-find-replace";
import { DocumentSearchHighlight } from "../../apps/web/src/editors/doc-search-plugin";
import type { Point } from "../../apps/web/src/editors/doc-find";
import { frameQueue, layoutBoxes } from "../doc-editor-harness";

let editor: Editor;
let showTab: ReturnType<typeof vi.fn>;
let frames: ReturnType<typeof frameQueue>;
let restoreBoxes: (() => void) | null = null;

function Harness({ others = [], names = ["Tab 1"] }: { others?: JSONContent[]; names?: string[] }) {
  const [findOpen, setFindOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [ignoreDiacritics, setIgnoreDiacritics] = useState(false);
  const [replacedCount, setReplacedCount] = useState<number | null>(null);
  const [findSpot, setFindSpot] = useState<Point | null>(null);
  const [revision, setRevision] = useState(0);
  const findDialog = useRef<HTMLDivElement>(null);
  const findAvoided = useRef("");
  const findInput = useRef<HTMLInputElement>(null);
  const findDrag = useRef<Point | null>(null);
  const firstBody = useRef(editor.getJSON());
  const extrasRef = useRef(others.map((content) => ({ content })));
  const activeRef = useRef(0);
  const showTabRef = useRef(showTab);
  useEffect(() => {
    const bump = () => setRevision((value) => value + 1);
    editor.on("transaction", bump);
    return () => {
      editor.off("transaction", bump);
    };
  }, []);
  useDocFindEffects({
    editor: editor as never,
    findOpen,
    query,
    replacement,
    matchCase,
    useRegex,
    ignoreDiacritics,
    revision,
    setFindSpot,
    setQuery,
    setReplacedCount,
    findDialog,
    findAvoided,
    findInput,
    firstBody: firstBody as never,
    extrasRef: extrasRef as never,
    activeRef,
    showTabRef: showTabRef as never,
  });
  return (
    <>
      <button type="button" onClick={() => setFindOpen(true)}>
        Open find
      </button>
      {findOpen ? (
        <DocFindDialog
          editor={editor as never}
          query={query}
          setQuery={setQuery}
          replacement={replacement}
          setReplacement={setReplacement}
          matchCase={matchCase}
          setMatchCase={setMatchCase}
          useRegex={useRegex}
          setUseRegex={setUseRegex}
          ignoreDiacritics={ignoreDiacritics}
          setIgnoreDiacritics={setIgnoreDiacritics}
          replacedCount={replacedCount}
          setReplacedCount={setReplacedCount}
          findSpot={findSpot}
          setFindSpot={setFindSpot}
          findDialog={findDialog}
          findInput={findInput}
          findDrag={findDrag}
          tabNames={names}
          active={0}
          closeFind={() => setFindOpen(false)}
        />
      ) : null}
    </>
  );
}

function make(text: string) {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({
    element,
    extensions: [StarterKit, DocumentSearchHighlight],
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  });
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0 });
  editor.view.scrollToSelection = () => {};
  return editor;
}

const findField = () => screen.getByRole("textbox", { name: "Find text" }) as HTMLInputElement;
const counter = () => screen.getByRole("status").textContent;
const selected = () => editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);

beforeEach(() => {
  showTab = vi.fn();
  frames = frameQueue();
});

afterEach(() => {
  cleanup();
  restoreBoxes?.();
  restoreBoxes = null;
  editor?.destroy();
  document.body.replaceChildren();
});

describe("find and replace", () => {
  it("starts from the selected words and walks the matches", () => {
    make("cat dog cat bird cat");
    editor.commands.setTextSelection({ from: 1, to: 4 });
    render(<Harness />);
    expect(findField().value).toBe("cat");
    expect(counter()).toBe("1 of 3");
    expect(editor.view.dom.querySelectorAll(".doc-search-current")).toHaveLength(1);
    fireEvent.keyDown(findField(), { key: "Enter" });
    expect(editor.state.selection.from).toBe(9);
    expect(counter()).toBe("2 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(editor.state.selection.from).toBe(1);
    fireEvent.keyDown(findField(), { key: "Enter", shiftKey: true });
    expect(editor.state.selection.from).toBe(18);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(editor.state.selection.from).toBe(9);
    fireEvent.keyDown(findField(), { key: "a" });
    act(() => {
      editor.commands.setTextSelection(2);
    });
    expect(counter()).toBe("3 results");
  });

  it("replaces one match at a time and then all of them", () => {
    make("one Two one two");
    render(<Harness />);
    fireEvent.change(findField(), { target: { value: "two" } });
    expect(counter()).toBe("1 of 2");
    fireEvent.click(screen.getByRole("checkbox", { name: "Match case" }));
    expect(counter()).toBe("1 of 1");
    fireEvent.click(screen.getByRole("checkbox", { name: "Match case" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Replacement text" }), { target: { value: "2" } });
    // Turning Match case on and off left the last "two" selected, so that copy changes.
    expect(editor.state.selection.from).toBe(13);
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(editor.state.doc.textContent).toBe("one Two one 2");
    expect(selected()).toBe("Two");
    fireEvent.change(findField(), { target: { value: "one" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    expect(editor.state.doc.textContent).toBe("2 Two 2 2");
    expect(screen.getByText("Replaced 2 instances of “one” with “2”.")).toBeTruthy();
    fireEvent.change(findField(), { target: { value: "two" } });
    expect(screen.queryByText(/Replaced/)).toBeNull();
    editor.commands.setTextSelection(1);
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    expect(screen.getByText("Replaced 1 instance of “two” with “2”.")).toBeTruthy();
    expect(counter()).toBe("No results");
    for (const name of ["Replace", "Replace all", "Previous", "Next"])
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("explains a broken regular expression and honours diacritics", () => {
    make("café cafe");
    render(<Harness />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Use regular expressions/ }));
    fireEvent.change(findField(), { target: { value: "(" } });
    expect(counter()).not.toBe("No results");
    expect(counter()).toBeTruthy();
    fireEvent.change(findField(), { target: { value: "caf." } });
    expect(counter()).toBe("1 of 2");
    fireEvent.click(screen.getByRole("checkbox", { name: /Use regular expressions/ }));
    fireEvent.change(findField(), { target: { value: "cafe" } });
    expect(counter()).toBe("1 of 1");
    fireEvent.click(screen.getByRole("checkbox", { name: /Ignore diacritics/ }));
    expect(counter()).toMatch(/of 2$/);
  });

  it("looks on the other tabs when this one has no match", () => {
    make("nothing here");
    render(
      <Harness
        names={["Tab 1", "Tab 2", "Tab 3"]}
        others={[
          { type: "bogus" } as never,
          { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "the needle" }] }] },
        ]}
      />,
    );
    const field = findField();
    fireEvent.change(field, { target: { value: "needle" } });
    expect(showTab).toHaveBeenCalledWith(2, "find");
    (document.activeElement as HTMLElement | null)?.blur();
    frames.flush();
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(6);
    fireEvent.change(field, { target: { value: "here" } });
    expect(showTab).toHaveBeenCalledTimes(1);
    expect(screen.getByText("on Tab 1")).toBeTruthy();
  });

  it("stops looking at a tab when the pattern is broken", () => {
    make("nothing");
    render(<Harness names={["A", "B"]} others={[{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Use regular expressions/ }));
    fireEvent.change(findField(), { target: { value: "[" } });
    expect(showTab).not.toHaveBeenCalled();
  });

  it("closes from Escape, the close button and the backdrop, and refocuses with Ctrl+F", () => {
    make("text");
    render(<Harness />);
    const dialog = screen.getByRole("search", { name: "Find and replace" });
    findField().blur();
    fireEvent.keyDown(dialog, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(findField());
    fireEvent.click(dialog);
    expect(screen.getByRole("search")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open find" }));
    fireEvent.click(screen.getByRole("button", { name: "Close find" }));
    expect(screen.queryByRole("search")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open find" }));
    fireEvent.click(document.querySelector(".gdocs-modal-overlay")!);
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("drags the dialog by its header and keeps it on screen", () => {
    make("text");
    render(<Harness />);
    const dialog = screen.getByRole("search");
    restoreBoxes = layoutBoxes((el) => (el === dialog ? { top: 100, left: 100, width: 300, height: 200 } : undefined));
    const header = dialog.querySelector<HTMLElement>(".dialog-header")!;
    header.setPointerCapture = vi.fn();
    fireEvent.pointerMove(header, { clientX: 50, clientY: 50 });
    expect(dialog.style.position).toBe("");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Close find" }), { clientX: 110, clientY: 110 });
    fireEvent.pointerDown(header, { clientX: 110, clientY: 110, button: 2 });
    fireEvent.pointerMove(header, { clientX: 50, clientY: 50 });
    expect(dialog.style.position).toBe("");
    fireEvent.pointerDown(header, { clientX: 110, clientY: 110, button: 0 });
    fireEvent.pointerMove(header, { clientX: 210, clientY: 160 });
    expect(dialog.style.position).toBe("fixed");
    expect(dialog.style.left).toBe("200px");
    expect(dialog.style.top).toBe("150px");
    fireEvent.pointerMove(header, { clientX: -500, clientY: -500 });
    expect(dialog.style.left).toBe("8px");
    fireEvent.pointerUp(header);
    fireEvent.pointerMove(header, { clientX: 400, clientY: 400 });
    expect(dialog.style.left).toBe("8px");
    fireEvent.pointerDown(header, { clientX: 110, clientY: 110 });
    fireEvent.pointerCancel(header);
  });

  it("steps aside when the current match is under the dialog", () => {
    make("alpha beta alpha");
    restoreBoxes = layoutBoxes((el) => {
      if (el.classList.contains("find-replace-dialog")) return { top: 100, left: 100, width: 300, height: 200 };
      if (el.classList.contains("doc-search-current")) return { top: 150, left: 150, width: 40, height: 16 };
      return undefined;
    });
    render(<Harness />);
    fireEvent.change(findField(), { target: { value: "beta" } });
    const dialog = screen.getByRole("search");
    expect(dialog.style.position).toBe("fixed");
    expect(dialog.style.top).toBe("182px");
  });
});
