// @vitest-environment jsdom
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { afterEach, describe, expect, it } from "vitest";
import { paintRemoteCarets, remoteCaretPlugin } from "../apps/web/src/collab/caret-mark";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+", toDOM: () => ["div", 0] },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: {},
  },
});

describe("remote caret marks", () => {
  const hosts: HTMLElement[] = [];
  const views: EditorView[] = [];

  afterEach(() => {
    for (const view of views) view.destroy();
    for (const host of hosts) host.remove();
    views.length = 0;
    hosts.length = 0;
  });

  it("draws Maya's caret and leaves the paragraph text", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("Tomatoes are in")),
    ]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    hosts.push(host);
    const view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [remoteCaretPlugin()] }),
    });
    views.push(view);
    paintRemoteCarets(view, [{ name: "Maya", anchor: 1, head: 4 }]);
    const mark = host.querySelector(".remote-caret");
    expect(mark?.getAttribute("data-caret")).toBe("Maya");
    expect(mark?.getAttribute("aria-label")).toBe("Maya");
    expect(host.querySelector(".remote-caret-range")).toBeTruthy();
    expect(view.state.doc.textContent).toBe("Tomatoes are in");
    expect(host.textContent).toContain("Tomatoes are in");
  });
});
