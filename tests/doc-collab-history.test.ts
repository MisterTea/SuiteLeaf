// @vitest-environment jsdom
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { undo, ySyncPlugin, ySyncPluginKey, yUndoPlugin } from "y-prosemirror";
import {
  collabHistoryPlugin,
  restoreUndoFlag,
  sharedUndoDepth,
  sharedUndoManager,
} from "../apps/web/src/editors/doc-collab-history";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+", toDOM: () => ["div", 0] },
    paragraph: { content: "text*", toDOM: () => ["p", 0], parseDOM: [{ tag: "p" }] },
    text: {},
  },
});

/** A layout pass that marks the batch as not undoable. */
function layoutPlugin() {
  return new Plugin({
    appendTransaction(transactions, _old, state) {
      if (transactions.some((tr) => tr.getMeta("layout"))) return null;
      if (!transactions.some((tr) => tr.docChanged)) return null;
      return state.tr.setMeta("addToHistory", false).setMeta("layout", true);
    },
  });
}

function open(host: HTMLElement, plugins: Plugin[]) {
  return new EditorView(host, { state: EditorState.create({ schema, plugins }) });
}

describe("shared undo after a layout transaction", () => {
  it("restores the undo flag only when a real edit is followed by layout", () => {
    const state = EditorState.create({ schema });
    const edit = state.tr.insertText("Beds");
    const layout = state.tr.setMeta("addToHistory", false);
    const idle = state.tr;
    const hidden = state.tr.insertText("x").setMeta("addToHistory", false);
    expect(restoreUndoFlag([edit, layout], state)?.getMeta("addToHistory")).toBe(true);
    expect(restoreUndoFlag([edit], state)).toBeNull();
    expect(restoreUndoFlag([layout], state)).toBeNull();
    expect(restoreUndoFlag([idle], state)).toBeNull();
    expect(restoreUndoFlag([hidden], state)).toBeNull();
    expect(sharedUndoDepth(state)).toBe(0);
  });

  it("does not make a layout pass after another person's edit this person's undo step", () => {
    const state = EditorState.create({ schema });
    const remote = state.tr.insertText("plot").setMeta(ySyncPluginKey, { isChangeOrigin: true });
    const layout = state.tr.setMeta("addToHistory", false);
    expect(restoreUndoFlag([remote, layout], state)).toBeNull();
  });

  const hosts: HTMLElement[] = [];
  const views: EditorView[] = [];

  afterEach(() => {
    for (const view of views) view.destroy();
    for (const host of hosts) host.remove();
    views.length = 0;
    hosts.length = 0;
  });

  function mount(withFix: boolean) {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("prosemirror");
    const host = document.createElement("div");
    document.body.appendChild(host);
    hosts.push(host);
    const view = open(host, [
      layoutPlugin(),
      ...(withFix ? [collabHistoryPlugin()] : []),
      ySyncPlugin(fragment),
      yUndoPlugin({ undoManager: sharedUndoManager(fragment) }),
    ]);
    views.push(view);
    return { doc, view };
  }

  it("keeps the typed word undoable when layout clears the history flag", () => {
    const lost = mount(false);
    lost.view.dispatch(lost.view.state.tr.insertText("Beds"));
    expect(sharedUndoDepth(lost.view.state)).toBe(0);

    const kept = mount(true);
    kept.view.dispatch(kept.view.state.tr.insertText("Beds"));
    expect(sharedUndoDepth(kept.view.state)).toBeGreaterThan(0);
    expect(undo(kept.view.state)).toBe(true);
    expect(kept.view.state.doc.textContent).toBe("");
  });

  it("undoes a new paragraph and leaves the other person's paragraph", () => {
    const { doc, view } = mount(true);
    view.dispatch(view.state.tr.insertText("Beds"));
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    remote.transact(() => {
      const fragment = remote.getXmlFragment("prosemirror");
      const paragraph = new Y.XmlElement("paragraph");
      paragraph.insert(0, [new Y.XmlText("North")]);
      fragment.insert(fragment.length, [paragraph]);
    });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)), "remote");
    const before = sharedUndoDepth(view.state);
    const end = view.state.doc.content.size;
    view.dispatch(view.state.tr.insert(end, schema.node("paragraph", null, schema.text("West"))));
    expect(sharedUndoDepth(view.state)).toBeGreaterThan(before);
    expect(undo(view.state)).toBe(true);
    expect(view.state.doc.textContent).toContain("Beds");
    expect(view.state.doc.textContent).toContain("North");
    expect(view.state.doc.textContent).not.toContain("West");
  });
});
