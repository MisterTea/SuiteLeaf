import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  DocumentRoom,
  VERSION_PAUSE_MS,
  createFile,
  parseFile,
  prosemirrorJson,
  recordEdit,
  serializeFile,
  syncCommentThreads,
} from "../packages/core/src";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const maya = { id: "maya", name: "Maya" };
const sam = { id: "sam", name: "Sam" };

function richUpdate(): Uint8Array {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("prosemirror");
  const paragraph = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  text.insert(0, "Keep", { bold: {} });
  paragraph.insert(0, [text]);
  const table = new Y.XmlElement("table");
  table.setAttribute("rows", 2);
  fragment.insert(0, [paragraph, table]);
  return Y.encodeStateAsUpdate(doc);
}

describe("rich collaboration compaction", () => {
  it("reads marks and tables from the prosemirror fragment", () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, richUpdate());
    expect(prosemirrorJson(doc)).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Keep", marks: [{ type: "bold", attrs: {} }] }],
        },
        { type: "table", attrs: { rows: 2 } },
      ],
    });
  });

  it("compacts the fragment instead of rewriting paragraphs as plain text", () => {
    let file = createFile("doc", "Notes");
    file = recordEdit(file, {
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Old" }] }],
      },
      op: { kind: "doc" },
      by: maya,
      at: "2026-10-30T18:00:00.000Z",
      now: 0,
    }).file;
    const room = new DocumentRoom(file);
    room.join({ ...maya, role: "editor" }, 0);
    room.join({ ...sam, role: "editor" }, 1);
    expect(
      room.applyUpdate(
        maya.id,
        richUpdate(),
        { by: maya, at: "2026-10-30T18:05:00.000Z", unit: "paragraph", key: "0" },
        1_000,
      ),
    ).toBe(true);
    const finished = room.kick(1_000 + VERSION_PAUSE_MS);
    expect(finished.version).not.toBeNull();
    expect(room.current().content).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Keep", marks: [{ type: "bold", attrs: {} }] }],
        },
        { type: "table", attrs: { rows: 2 } },
      ],
    });
  });

  it("strips the y-prosemirror hash suffix from an overlapping mark", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("prosemirror");
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, "Both", { "bold--abcdefgh": { href: "x" } });
    paragraph.insert(0, [text]);
    fragment.insert(0, [paragraph]);
    const json = prosemirrorJson(doc) as {
      content: { content: { marks: { type: string; attrs: { href: string } }[] }[] }[];
    };
    expect(json.content[0]?.content[0]?.marks[0]).toEqual({
      type: "bold",
      attrs: { href: "x" },
    });
  });

  it("keeps embedded image bytes when the room is saved and drops a file name", () => {
    let file = createFile("doc", "Notes");
    file = recordEdit(file, {
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Old" }] }],
      },
      op: { kind: "doc" },
      by: maya,
      at: "2026-10-30T18:00:00.000Z",
      now: 0,
    }).file;
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("prosemirror");
    const image = new Y.XmlElement("image");
    image.setAttribute("alt", "North beds");
    image.setAttribute("src", png);
    const named = new Y.XmlElement("image");
    named.setAttribute("alt", "Missing");
    named.setAttribute("src", "bed.png");
    fragment.insert(0, [image, named]);
    const room = new DocumentRoom(file);
    room.join({ ...maya, role: "editor" }, 0);
    room.join({ ...sam, role: "editor" }, 1);
    expect(
      room.applyUpdate(
        maya.id,
        Y.encodeStateAsUpdate(doc),
        { by: maya, at: "2026-10-31T12:00:00.000Z", unit: "paragraph", key: "0" },
        1_000,
      ),
    ).toBe(true);
    room.kick(1_000 + VERSION_PAUSE_MS);
    const saved = room.current();
    const reopened = parseFile(serializeFile(saved));
    if (reopened.kind !== "doc") throw new Error("expected a document");
    expect(JSON.stringify(reopened.content)).toContain(png);
    expect(JSON.stringify(reopened.content)).not.toContain("bed.png");
    expect(JSON.stringify(reopened.content)).toContain("North beds");
  });

  it("keeps a comment thread with the shared fragment", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("prosemirror");
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, "ripe");
    paragraph.insert(0, [text]);
    fragment.insert(0, [paragraph]);
    doc.getMap("docAttrs").set("note", "secret-value");
    syncCommentThreads(doc, "secret-value");
    const dropped = prosemirrorJson(doc) as { attrs?: unknown; content: { content: { text: string }[] }[] };
    expect(dropped.attrs).toBeUndefined();
    expect(JSON.stringify(dropped)).not.toContain("secret-value");
    expect(dropped.content[0].content[0].text).toBe("ripe");
    syncCommentThreads(doc, [
      { id: "c1", quote: "ripe", messages: [{ text: "Water the beds" }], resolved: false },
    ]);
    const kept = prosemirrorJson(doc) as {
      attrs: { commentThreads: { quote: string; messages: { text: string }[] }[] };
    };
    expect(kept.attrs.commentThreads[0].quote).toBe("ripe");
    expect(kept.attrs.commentThreads[0].messages[0].text).toBe("Water the beds");
  });
});
