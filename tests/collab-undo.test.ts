import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import * as Y from "yjs";
import { undo, ySyncPlugin, ySyncPluginKey, yUndoPlugin } from "y-prosemirror";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    image: { group: "block", attrs: { src: { default: "" } } },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
  },
});

function paragraphText(doc: Y.Doc): string[] {
  const fragment = doc.getXmlFragment("prosemirror");
  const texts: string[] = [];
  for (let index = 0; index < fragment.length; index += 1) {
    const child = fragment.get(index);
    if (!(child instanceof Y.XmlElement)) continue;
    const text = child.get(0);
    texts.push(text instanceof Y.XmlText ? text.toString() : "");
  }
  return texts;
}

function firstText(doc: Y.Doc): Y.XmlText | null {
  const fragment = doc.getXmlFragment("prosemirror");
  const paragraph = fragment.get(0);
  if (!(paragraph instanceof Y.XmlElement)) return null;
  const text = paragraph.get(0);
  return text instanceof Y.XmlText ? text : null;
}

describe("collaborative undo", () => {
  it("uses the editor undo and leaves the other person's paragraph", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("prosemirror");
    const state = EditorState.create({
      schema,
      plugins: [ySyncPlugin(fragment), yUndoPlugin()],
    });
    doc.transact(() => {
      const paragraph = new Y.XmlElement("paragraph");
      const text = new Y.XmlText();
      paragraph.insert(0, [text]);
      text.insert(0, "Tomatoes are in");
      fragment.insert(0, [paragraph]);
    }, ySyncPluginKey);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    remote.transact(() => {
      const paragraphs = remote.getXmlFragment("prosemirror");
      const paragraph = new Y.XmlElement("paragraph");
      const text = new Y.XmlText();
      paragraph.insert(0, [text]);
      text.insert(0, "Beans are staked");
      paragraphs.insert(1, [paragraph]);
    });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)), "remote");
    expect(paragraphText(doc)).toEqual(["Tomatoes are in", "Beans are staked"]);
    expect(undo(state)).toBe(true);
    expect(paragraphText(doc)).toEqual(["Beans are staked"]);
  });

  it("removes the local edit and leaves the other person's edit", () => {
    const doc = new Y.Doc();
    const text = doc.getText("body");
    const undo = new Y.UndoManager(text, { trackedOrigins: new Set(["local"]) });
    doc.transact(() => text.insert(0, "ours"), "local");
    doc.transact(() => text.insert(text.length, " theirs"), "remote");
    undo.undo();
    expect(text.toString()).toBe(" theirs");
    undo.redo();
    expect(text.toString()).toBe("ours theirs");
  });

  it("undoes local bold and a local picture and leaves the other paragraph", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("prosemirror");
    const state = EditorState.create({
      schema,
      plugins: [ySyncPlugin(fragment), yUndoPlugin()],
    });
    doc.transact(() => {
      const paragraph = new Y.XmlElement("paragraph");
      const text = new Y.XmlText();
      paragraph.insert(0, [text]);
      text.insert(0, "Beds");
      fragment.insert(0, [paragraph]);
    });
    doc.transact(() => {
      firstText(doc)?.format(0, 4, { bold: true });
      const image = new Y.XmlElement("image");
      image.setAttribute("src", "data:image/png;base64,beds");
      fragment.insert(1, [image]);
    }, ySyncPluginKey);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    remote.transact(() => {
      const paragraphs = remote.getXmlFragment("prosemirror");
      const paragraph = new Y.XmlElement("paragraph");
      const text = new Y.XmlText();
      paragraph.insert(0, [text]);
      text.insert(0, "secret-value");
      paragraphs.insert(2, [paragraph]);
    });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)), "remote");
    expect(firstText(doc)?.toDelta()).toEqual([{ insert: "Beds", attributes: { bold: true } }]);
    expect(fragment.length).toBe(3);
    expect(undo(state)).toBe(true);
    expect(firstText(doc)?.toDelta()).toEqual([{ insert: "Beds" }]);
    expect(fragment.toJSON()).not.toContain("data:image/png;base64,beds");
    expect(paragraphText(doc)).toContain("secret-value");
    expect(firstText(doc)?.toString()).toBe("Beds");
  });
});
