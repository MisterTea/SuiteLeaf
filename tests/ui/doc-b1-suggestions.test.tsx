// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useRef, type MutableRefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModeContext } from "../../apps/web/src/mode";
import { Suggestions, liveSuggestion } from "../../apps/web/src/editors/doc-suggestions";
import {
  SuggestionBridge,
  SuggestionFlag,
  SuggestionModeSwitch,
  SuggestionProvider,
  SuggestionRail,
  suggestionLabel,
  suggestionWhen,
} from "../../apps/web/src/editors/doc-suggestions-ui";
import { memoryStorage } from "../doc-editor-harness";

type Api = { askPlainExport: () => Promise<"accepted" | "original" | null>; openReview: () => void } | null;
let editor: Editor;
let api: MutableRefObject<Api>;

function Bridge() {
  const ref = useRef<Api>(null);
  api = ref;
  return <SuggestionBridge api={ref} />;
}

function mount(content: JSONContent, kind: "single" | "cluster" = "cluster") {
  const shell = document.createElement("div");
  shell.className = "docs-editor";
  const element = document.createElement("div");
  shell.append(element);
  document.body.append(shell);
  editor = new Editor({ element, extensions: [StarterKit, Suggestions], content });
  render(
    <ModeContext.Provider value={{ mode: kind === "single" ? { kind } : { kind, serverUrl: "https://suiteleaf.test" }, locked: false, demo: false } as never}>
      <SuggestionProvider editor={editor as never}>
        <SuggestionModeSwitch />
        <SuggestionFlag />
        <SuggestionRail />
        <Bridge />
      </SuggestionProvider>
    </ModeContext.Provider>,
  );
  return shell;
}

const doc = (text: string, attrs?: Record<string, unknown>): JSONContent => ({
  type: "doc",
  ...(attrs ? { attrs } : {}),
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const marks = () => {
  const out: { text: string; kind: string; author: string }[] = [];
  editor.state.doc.descendants((node) => {
    const mark = node.marks.find((item) => item.type.name === "suggestion");
    if (node.isText && mark) out.push({ text: node.text!, kind: mark.attrs.kind, author: mark.attrs.author });
  });
  return out;
};

beforeEach(() => {
  memoryStorage();
  liveSuggestion.mode = "editing";
  liveSuggestion.author = "";
});

afterEach(() => {
  cleanup();
  editor?.destroy();
  document.body.replaceChildren();
});

describe("suggesting mode", () => {
  it("records an addition under the chosen name and accepts it", () => {
    mount(doc("We serve customers."));
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Suggesting as" }), { target: { value: "Bo" } });
    expect(localStorage.getItem("suiteleaf-author")).toBe("Bo");
    const suggesting = screen.getByRole("button", { name: "Suggesting" });
    fireEvent.mouseDown(suggesting);
    fireEvent.click(suggesting);
    expect(suggesting.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Suggesting");
    expect(editor.state.doc.attrs.editingMode).toBe("suggesting");
    act(() => {
      editor.commands.insertContentAt(10, "40 ");
    });
    expect(marks()).toEqual([{ text: "40 ", kind: "insert", author: "Bo" }]);
    const rail = screen.getByRole("complementary", { name: "Suggestions" });
    expect(rail.textContent).toContain("1 suggestion");
    expect(rail.querySelector("header")?.textContent).toMatch(/^Bo · /);
    fireEvent.click(screen.getByRole("button", { name: "Accept Add “40”" }));
    expect(editor.state.doc.textContent).toBe("We serve 40 customers.");
    expect(marks()).toEqual([]);
    expect(screen.queryByRole("complementary", { name: "Suggestions" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Editing" }));
    expect(editor.state.doc.attrs.editingMode).toBe("editing");
  });

  it("keeps a deletion until it is rejected", () => {
    mount(doc("Keep this word.", { editingMode: "suggesting" }));
    expect(screen.getByRole("status").textContent).toBe("Suggesting");
    act(() => {
      editor.commands.deleteRange({ from: 6, to: 11 });
    });
    expect(editor.state.doc.textContent).toBe("Keep this word.");
    expect(marks()).toEqual([{ text: "this ", kind: "delete", author: "Someone" }]);
    expect(screen.getByRole("complementary", { name: "Suggestions" }).querySelector("header")?.textContent).toMatch(/^Someone/);
    fireEvent.click(screen.getByRole("button", { name: "Reject Delete “this”" }));
    expect(editor.state.doc.textContent).toBe("Keep this word.");
    expect(marks()).toEqual([]);
  });

  it("switches mode with Ctrl+Alt+Shift+X", () => {
    mount(doc("Text"));
    fireEvent.keyDown(window, { key: "x", ctrlKey: true, altKey: true });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.keyDown(window, { key: "X", ctrlKey: true, altKey: true, shiftKey: true });
    expect(screen.getByRole("status").textContent).toBe("Suggesting");
    expect(liveSuggestion.mode).toBe("suggesting");
    fireEvent.keyDown(window, { key: "x", metaKey: true, altKey: true, shiftKey: true });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("hides the mode switch on a single computer", () => {
    mount(doc("Text"), "single");
    expect(screen.queryByRole("group", { name: "Editing mode" })).toBeNull();
  });
});

describe("reviewing suggestions", () => {
  const pending = (): JSONContent => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Old " },
          { type: "text", text: "new", marks: [{ type: "suggestion", attrs: { id: "a", kind: "insert", author: "Ann", time: "2020-02-03T10:00:00Z" } }] },
          { type: "text", text: " gone", marks: [{ type: "suggestion", attrs: { id: "b", kind: "delete", author: "Ann", time: "" } }] },
        ],
      },
    ],
  });

  it("previews and applies all suggestions from the review dialog", () => {
    const shell = mount(pending());
    act(() => api.current!.openReview());
    const dialog = screen.getByRole("dialog", { name: "Review suggestions" });
    expect(dialog.textContent).toContain("2 suggestions");
    expect([...dialog.querySelectorAll("li")].map((item) => item.textContent)).toEqual(["Add “new”", "Delete “gone”"]);
    const acceptAll = dialog.querySelector<HTMLButtonElement>(".dialog-primary-btn")!;
    fireEvent.mouseEnter(acceptAll);
    expect(screen.getByText("Preview: suggestions accepted")).toBeTruthy();
    expect(shell.classList.contains("suggestions-preview-accepted")).toBe(true);
    fireEvent.mouseLeave(acceptAll);
    expect(shell.classList.contains("suggestions-preview-accepted")).toBe(false);
    const rejectAll = dialog.querySelector<HTMLButtonElement>(".dialog-text-btn")!;
    fireEvent.focus(rejectAll);
    expect(screen.getByText("Preview: original text")).toBeTruthy();
    expect(shell.classList.contains("suggestions-preview-original")).toBe(true);
    fireEvent.blur(rejectAll);
    fireEvent.focus(acceptAll);
    fireEvent.blur(acceptAll);
    fireEvent.mouseEnter(rejectAll);
    fireEvent.mouseLeave(rejectAll);
    fireEvent.click(acceptAll);
    expect(editor.state.doc.textContent).toBe("Old new");
    expect(dialog.textContent).toContain("0 suggestions");
    fireEvent.click(screen.getByRole("dialog", { name: "Review suggestions" }));
    fireEvent.click(screen.getByRole("button", { name: "Close review" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("rejects everything from the rail and closes the review from its backdrop", () => {
    mount(pending());
    const rail = screen.getByRole("complementary", { name: "Suggestions" });
    expect(rail.querySelectorAll("article")).toHaveLength(2);
    expect(rail.querySelectorAll("header")[1].textContent).toBe("Ann");
    fireEvent.click(rail.querySelector<HTMLButtonElement>(".dialog-text-btn")!);
    expect(editor.state.doc.textContent).toBe("Old  gone");
    act(() => api.current!.openReview());
    expect(screen.getByRole("dialog").textContent).toContain("0 suggestions");
    expect(screen.getByRole("dialog").querySelector(".suggestion-actions")).toBeNull();
    fireEvent.click(document.querySelector(".gdocs-modal-overlay")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks which text to export while suggestions are pending", async () => {
    mount(pending());
    let first!: Promise<unknown>;
    act(() => {
      first = api.current!.askPlainExport();
    });
    let second!: Promise<unknown>;
    act(() => {
      second = api.current!.askPlainExport();
    });
    await expect(first).resolves.toBeNull();
    expect(screen.getByRole("dialog", { name: "Pending suggestions" }).textContent).toContain("2 suggestions");
    fireEvent.click(screen.getByRole("button", { name: "Suggestions accepted" }));
    await expect(second).resolves.toBe("accepted");
    for (const [name, expected] of [["Original text", "original"], ["Cancel", null]] as const) {
      let choice!: Promise<unknown>;
      act(() => {
        choice = api.current!.askPlainExport();
      });
      fireEvent.click(screen.getByRole("dialog", { name: "Pending suggestions" }));
      fireEvent.click(screen.getByRole("button", { name }));
      await expect(choice).resolves.toBe(expected);
    }
    let backdrop!: Promise<unknown>;
    act(() => {
      backdrop = api.current!.askPlainExport();
    });
    fireEvent.click(document.querySelector(".gdocs-modal-overlay")!);
    await expect(backdrop).resolves.toBeNull();
  });

  it("reads suggestion spans back from HTML with every detail", () => {
    mount(pending());
    const html = editor.getHTML();
    expect(html).toContain('data-suggestion="b" data-suggestion-kind="delete" data-suggestion-author="Ann"');
    const again = new Editor({ extensions: [StarterKit, Suggestions], content: html });
    const found: Record<string, unknown>[] = [];
    again.state.doc.descendants((node) => {
      for (const mark of node.marks) if (mark.type.name === "suggestion") found.push(mark.attrs);
    });
    expect(found).toMatchObject([
      { id: "a", kind: "insert", author: "Ann", time: "2020-02-03T10:00:00Z" },
      { id: "b", kind: "delete", author: "Ann" },
    ]);
    const format = new Editor({
      extensions: [StarterKit, Suggestions],
      content: '<p><span data-suggestion="f" data-suggestion-kind="format" data-property="bold" data-before="false" data-after="true">x</span></p>',
    });
    expect(format.getJSON().content?.[0].content?.[0].marks?.[0].attrs).toMatchObject({ kind: "format", property: "bold", before: "false", after: "true" });
    expect(format.getHTML()).toContain('data-after="true"');
    again.destroy();
    format.destroy();
  });
});

describe("suggestion wording", () => {
  it("names each kind of suggestion and shortens long text", () => {
    const base = { id: "x", author: "", time: "", text: "" };
    expect(suggestionLabel({ ...base, kind: "insert", text: "a\n  b" } as never)).toBe("Add “a b”");
    expect(suggestionLabel({ ...base, kind: "insert", text: "x".repeat(60) } as never)).toBe(`Add “${"x".repeat(45)}…”`);
    expect(suggestionLabel({ ...base, kind: "heading", after: "0" } as never)).toBe("Format: Normal text");
    expect(suggestionLabel({ ...base, kind: "heading", after: "2" } as never)).toBe("Format: Heading 2");
    expect(suggestionLabel({ ...base, kind: "format", property: "italic" } as never)).toBe("Format: italic");
    expect(suggestionLabel({ ...base, kind: "format" } as never)).toBe("Format: formatting");
  });

  it("gives a time today and a date before today", () => {
    expect(suggestionWhen("nope")).toBe("");
    const now = new Date();
    expect(suggestionWhen(now.toISOString())).not.toContain(",");
    expect(suggestionWhen("2020-02-03T10:00:00Z")).toContain(",");
  });

  it("refuses to render a suggestion part outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<SuggestionFlag />)).toThrow("Suggestions are only available in the document editor.");
  });
});
