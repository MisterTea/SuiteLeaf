// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocCommentThread } from "../../packages/core/src/doc-comments";

const session = vi.hoisted(() => ({
  user: null as null | { id: string; name: string; username: string; email: string },
  accounts: vi.fn(),
}));

vi.mock("../../apps/web/src/node-client", () => ({
  getSession: () => (session.user ? { user: session.user } : null),
  drive: { accounts: session.accounts },
}));

import { DocComments, commentExtensions } from "../../apps/web/src/editors/doc-comments";
import { mentionReader, loadMentionChoices } from "../../apps/web/src/editors/doc-mentions";
import { mentionQuery, readMentionField } from "../../apps/web/src/editors/doc-mention-field";
import { frameQueue, layoutBoxes, memoryStorage } from "../doc-editor-harness";

let editor: Editor;
let api: { insert: () => void; togglePanel: () => void };
let gutter: boolean[];
let frames: ReturnType<typeof frameQueue>;
let restoreBoxes: () => void;

beforeEach(() => {
  memoryStorage();
  session.user = null;
  session.accounts.mockReset();
  frames = frameQueue();
  Element.prototype.scrollIntoView = vi.fn();
  restoreBoxes = layoutBoxes((el) => {
    if (el.classList.contains("document-stage")) return { top: 0, height: 600 };
    if (el.classList.contains("paper")) return { top: 0, left: 0, width: 800, height: 1100 };
    if (el.matches?.("[data-thread]")) return { top: 900, height: 20 };
    if (el.matches?.("[data-comment-card]")) return { height: 100 };
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  editor?.destroy();
  restoreBoxes();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function mount(content: Record<string, unknown>) {
  const stage = document.createElement("div");
  stage.className = "document-stage";
  let scrolled = 0;
  Object.defineProperty(stage, "scrollTop", { get: () => scrolled, set: (value: number) => (scrolled = value) });
  Object.defineProperty(stage, "clientHeight", { value: 600 });
  const paper = document.createElement("div");
  paper.className = "paper";
  stage.append(paper);
  document.body.append(stage);
  editor = new Editor({ element: paper, extensions: [StarterKit, ...commentExtensions], content });
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 120, bottom: 140, left: 40, right: 50 });
  gutter = [];
  render(
    <DocComments
      editor={editor as never}
      stageRef={{ current: stage }}
      onGutter={(open) => {
        gutter.push(open);
      }}
      bind={(next) => {
        api = next;
      }}
    />,
  );
  return stage;
}

const doc = (threads?: DocCommentThread[], marked = false) => ({
  type: "doc",
  ...(threads ? { attrs: { commentThreads: threads } } : {}),
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Q3 grew", ...(marked ? { marks: [{ type: "comment", attrs: { threadId: "t1", resolved: false } }] } : {}) },
        { type: "text", text: " twelve percent." },
      ],
    },
  ],
});

const thread = (extra: Partial<DocCommentThread> = {}): DocCommentThread => ({
  id: "t1",
  quote: "Q3 grew",
  resolved: false,
  messages: [{ id: "m1", authorId: "a", authorName: "Ann", createdAt: "2026-01-02T10:00:00Z", text: "Source?" }],
  ...extra,
});

function select(from: number, to: number) {
  act(() => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
  });
}

function typeInto(field: HTMLElement, text: string) {
  field.textContent = text;
  const node = field.firstChild!;
  const range = document.createRange();
  range.setStart(node, text.length);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.input(field);
}

function threads(): DocCommentThread[] {
  return (editor.state.doc.attrs.commentThreads as DocCommentThread[]) ?? [];
}

describe("document comments", () => {
  it("asks for a selection before starting a comment", () => {
    mount(doc());
    act(() => api.insert());
    expect(screen.getByText("Select the text you want to comment on.")).toBeTruthy();
    expect(screen.getByText("No open comments.")).toBeTruthy();
    expect(gutter.at(-1)).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Resolved" }));
    expect(screen.getByText("No resolved comments.")).toBeTruthy();
  });

  it("posts a comment with a name, then replies and resolves it", async () => {
    mount(doc());
    select(1, 8);
    const add = await screen.findByRole("button", { name: "Add comment" });
    expect(add.style.left).toBe("808px");
    fireEvent.click(add);
    expect(editor.view.dom.querySelector(".comment-draft")?.textContent).toBe("Q3 grew");
    const field = screen.getByRole("textbox", { name: "Comment" });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(threads()).toEqual([]);
    typeInto(field, "Where is this from?");
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(screen.getByText("Add your name. Comments are never signed with a placeholder.")).toBeTruthy();
    const nameBox = screen.getByRole("textbox", { name: "Your name" });
    fireEvent.change(nameBox, { target: { value: "  Bo  " } });
    const focus = vi.spyOn(field, "focus");
    fireEvent.keyDown(nameBox, { key: "Enter" });
    expect(focus).toHaveBeenCalled();
    fireEvent.keyDown(nameBox, { key: "Enter", ctrlKey: true });
    expect(threads()).toHaveLength(1);
    expect(threads()[0]).toMatchObject({ quote: "Q3 grew", messages: [{ authorName: "Bo", text: "Where is this from?" }] });
    expect(localStorage.getItem("suiteleaf:display-name")).toBe("Bo");
    expect(editor.view.dom.querySelector("span.comment-anchor")?.textContent).toBe("Q3 grew");
    expect(editor.view.dom.querySelector(".comment-draft")).toBeNull();

    const reply = screen.getByRole("textbox", { name: "Reply to Bo" });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(threads()[0].messages).toHaveLength(1);
    fireEvent.focus(reply);
    fireEvent.change(reply, { target: { value: "From the report" } });
    fireEvent.keyDown(reply, { key: "Enter", metaKey: true });
    expect(threads()[0].messages.map((message) => message.text)).toEqual(["Where is this from?", "From the report"]);

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(threads()[0]).toMatchObject({ resolved: true, resolvedBy: "Bo" });
    expect(editor.view.dom.querySelector("span.comment-anchor.is-resolved")).not.toBeNull();
    expect(screen.getByText("Resolved by Bo")).toBeTruthy();
  });

  it("does not credit the original author when an unnamed reader resolves", () => {
    mount(doc([thread()], true));
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(threads()[0].resolved).toBe(true);
    expect(threads()[0].resolvedBy).toBeUndefined();
    expect(screen.getByText("Resolved")).toBeTruthy();
  });

  it("signs with the account name when signed in", async () => {
    session.user = { id: "u1", name: "Cy Account", username: "cy", email: "cy@example.com" };
    mount(doc());
    select(9, 16);
    fireEvent.click(await screen.findByRole("button", { name: "Add comment" }));
    expect(screen.getByText("Commenting as Cy Account")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Your name" })).toBeNull();
    typeInto(screen.getByRole("textbox", { name: "Comment" }), "Check");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Comment" }), { key: "Enter", ctrlKey: true });
    expect(threads()[0].messages[0]).toMatchObject({ authorId: "user-u1", authorName: "Cy Account" });
    expect(mentionReader()).toEqual({ name: "Cy Account", email: "cy@example.com", accountId: "u1" });
  });

  it("cancels a draft from the keyboard or the Cancel button", async () => {
    mount(doc());
    select(1, 8);
    fireEvent.click(await screen.findByRole("button", { name: "Add comment" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Your name" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Comment" })).toBeNull();
    expect(editor.view.dom.querySelector(".comment-draft")).toBeNull();
    select(1, 8);
    fireEvent.click(await screen.findByRole("button", { name: "Add comment" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Comment" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Comment" })).toBeNull();
    select(1, 8);
    fireEvent.click(await screen.findByRole("button", { name: "Add comment" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "Comment" })).toBeNull();
  });

  it("opens the existing thread when the selection is already commented", async () => {
    mount(doc([thread()], true));
    select(2, 5);
    fireEvent.click(await screen.findByRole("button", { name: "Add comment" }));
    expect(screen.queryByRole("textbox", { name: "Comment" })).toBeNull();
    expect(document.querySelector(".doc-comment-card.is-active")).not.toBeNull();
  });

  it("keeps a thread when its text is deleted and links it again when the text returns", () => {
    mount(doc([thread()], true));
    act(() => {
      editor.view.dispatch(editor.state.tr.delete(1, 8));
    });
    expect(threads()[0].orphaned).toBe(true);
    expect(screen.getByText("Original text deleted")).toBeTruthy();
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("x", 3));
    });
    expect(threads()[0].orphaned).toBe(true);
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("Q3 grew", 1));
    });
    expect(threads()[0].orphaned).toBe(false);
    expect(editor.view.dom.querySelector("[data-thread='t1']")?.textContent).toBe("Q3 grew");
    act(() => {
      editor.view.dispatch(editor.state.tr.setDocAttribute("commentThreads", [thread({ orphaned: true })]));
    });
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("!", editor.state.doc.content.size - 1));
    });
    expect(threads()[0].orphaned).toBe(false);
  });

  it("lists comments in the panel, jumps to one and reopens a resolved one", () => {
    mount(doc([thread({ resolved: true, resolvedBy: "Ann" }), { ...thread({ id: "t2", quote: "gone", orphaned: true }) }], true));
    act(() => api.togglePanel());
    expect(screen.getByRole("tab", { name: "Open" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Original text deleted" }));
    fireEvent.click(screen.getByRole("tab", { name: "Resolved" }));
    fireEvent.click(screen.getByRole("button", { name: "Q3 grew" }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(threads()[0]).toMatchObject({ resolved: false });
    expect(threads()[0].resolvedBy).toBeUndefined();
    expect(document.querySelector(".doc-comment-panel")).toBeNull();
    act(() => api.togglePanel());
    act(() => api.togglePanel());
    expect(document.querySelector(".doc-comment-panel")).toBeNull();
  });

  it("opens the resolved tab when nothing is open", () => {
    mount(doc([thread({ resolved: true })], true));
    act(() => api.togglePanel());
    expect(screen.getByRole("tab", { name: "Resolved" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Close comments" }));
    expect(document.querySelector(".doc-comment-panel")).toBeNull();
  });

  it("lands on the comment that mentions the reader", async () => {
    localStorage.setItem("suiteleaf:display-name", "Dee");
    const mentioned = thread({
      messages: [{ id: "m1", authorId: "a", authorName: "Ann", createdAt: "bad date", text: "Dee look", mentions: [{ name: "Dee", at: 0 }] }],
    });
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const stage = mount(doc([mentioned], true));
    expect(screen.getAllByText("For you")).toHaveLength(1);
    expect(document.querySelector("[data-for-you='true'] time")?.textContent).toBe("");
    await waitFor(() => expect(frames.size).toBe(1));
    frames.flush();
    clock = 360;
    frames.flush();
    expect(stage.scrollTop).toBeGreaterThan(0);
    clock = 2000;
    frames.flush();
    expect(stage.scrollTop).toBe(610);
    expect(frames.size).toBe(0);
  });

  it("does not land anywhere for a reader nobody mentioned", () => {
    localStorage.setItem("suiteleaf:display-name", "Eve");
    mount(doc([thread()], true));
    expect(screen.queryByText("For you")).toBeNull();
  });
});

describe("mentions in a comment", () => {
  it("suggests names stored here after @ and two letters, and inserts a chip", async () => {
    localStorage.setItem("suiteleaf:known-names", JSON.stringify(["Dana Fox", "Dan Lee"]));
    mount(doc());
    select(1, 8);
    fireEvent.click(await screen.findByRole("button", { name: "Add comment" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), { target: { value: "Bo" } });
    const field = screen.getByRole("textbox", { name: "Comment" });
    typeInto(field, "Hi @D");
    expect(screen.queryByRole("listbox")).toBeNull();
    typeInto(field, "Hi @Da");
    const list = await screen.findByRole("listbox", { name: "Mention someone" });
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Dan LeeOn this computer", "Dana FoxOn this computer", "DaNo account"]);
    expect(field.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(field, { key: "ArrowUp" });
    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[2].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(list.isConnected).toBe(false);
    expect(screen.getByRole("textbox", { name: "Comment" })).toBe(field);
    typeInto(field, "Hi @Dan");
    await screen.findByRole("listbox");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field.querySelector(".doc-mention")?.textContent).toBe("Dan Lee");
    expect(readMentionField(field)).toEqual({ text: "Hi  ", mentions: [{ name: "Dan Lee", at: 3 }] });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(threads()[0].messages[0]).toMatchObject({ mentions: [{ name: "Dan Lee", at: 3 }] });
    expect(document.querySelector(".doc-comment-card .doc-mention")?.textContent).toBe("Dan Lee");
  });

  it("picks a suggestion with the pointer and offers accounts when signed in", async () => {
    session.user = { id: "u1", name: "Cy", username: "cy", email: "cy@example.com" };
    session.accounts.mockResolvedValue([{ id: "u2", name: "Gail Ng", email: "gail@example.com", username: "gail" }]);
    mount(doc());
    select(1, 8);
    fireEvent.click(await screen.findByRole("button", { name: "Add comment" }));
    const field = screen.getByRole("textbox", { name: "Comment" });
    typeInto(field, "@ga");
    const option = await screen.findByRole("option", { name: /Gail Ng/ });
    expect(option.textContent).toContain("gail@example.com");
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(field.querySelector(".doc-mention")?.dataset).toMatchObject({ name: "Gail Ng", email: "gail@example.com", account: "u2" });
    expect(field.classList.contains("is-empty")).toBe(false);
    session.accounts.mockRejectedValue(new Error("offline"));
    localStorage.setItem("suiteleaf:known-names", JSON.stringify(["Gail Ng"]));
    expect(await loadMentionChoices("ga")).toEqual([{ name: "Gail Ng" }, { name: "ga", unmatched: true }]);
    expect(await loadMentionChoices("g")).toEqual([]);
  });

  it("pastes plain text and reads line breaks and blocks", () => {
    mount(doc());
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 8)));
    });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
    const field = screen.getByRole("textbox", { name: "Comment" });
    typeInto(field, "a");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "<b>bold</b>" } });
    field.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(field.textContent).toBe("a<b>bold</b>");
    const empty = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(empty, "clipboardData", { value: { getData: () => "" } });
    field.dispatchEvent(empty);
    expect(field.textContent).toBe("a<b>bold</b>");

    field.innerHTML = "one<br>two<div>three</div><div>four&nbsp;five</div>";
    expect(readMentionField(field)).toEqual({ text: "one\ntwo\nthree\nfour five", mentions: [] });
    // Enter in the box wraps each new line in a div; a trailing break is dropped.
    field.innerHTML = "first<div>second<br></div><div>third</div>";
    expect(readMentionField(field).text).toBe("first\nsecond\nthird");
  });

  it("finds the @ query only at the start of a word in this field", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const set = (text: string, offset = text.length) => {
      root.textContent = text;
      const range = document.createRange();
      range.setStart(root.firstChild!, offset);
      range.collapse(true);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    };
    set("hi @jo");
    expect(mentionQuery(root)).toBe("jo");
    set("mail@jo");
    expect(mentionQuery(root)).toBeNull();
    set("no at");
    expect(mentionQuery(root)).toBeNull();
    set("@a@b");
    expect(mentionQuery(root)).toBeNull();
    const other = document.createElement("div");
    expect(mentionQuery(other)).toBeNull();
    const range = document.createRange();
    range.setStart(root, 0);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(mentionQuery(root)).toBeNull();
  });
});
