import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  DocumentRoom,
  VERSION_PAUSE_MS,
  connectDocs,
  createFile,
  editParagraph,
  paragraphTexts,
  parseFile,
  recordEdit,
  restoreToVersion,
  sealIfIdle,
  serializeFile,
  summaryPrompt,
  type Collaborator,
} from "../packages/core/src";

const maya: Collaborator = { id: "maya", name: "Maya" };
const sam: Collaborator = { id: "sam", name: "Sam" };

function paragraph(text: string) {
  return text
    ? { type: "paragraph", content: [{ type: "text", text }] }
    : { type: "paragraph" };
}

function doc(texts: string[]) {
  return { type: "doc", content: texts.map(paragraph) };
}

function edited(
  file: ReturnType<typeof createFile>,
  texts: string[],
  by: Collaborator,
  at: string,
  pauseMs = VERSION_PAUSE_MS,
) {
  return recordEdit(
    file,
    {
      content: doc(texts),
      op: { kind: "doc", steps: [{ stepType: "replace" }] },
      by,
      at,
      pauseMs,
    },
  );
}

describe("solo version history", () => {
  it("keeps edits inside 15 minutes off the version list and seals after the pause", () => {
    const start = "2026-10-13T18:00:00.000Z";
    const soon = "2026-10-13T18:05:00.000Z";
    const later = "2026-10-13T18:20:00.000Z";
    let file = createFile("doc", "Notes");
    file = edited(file, ["Plant sale"], maya, start).file;
    file = edited(file, ["Plant sale", "Basil"], maya, soon).file;
    expect(file.versions).toBeUndefined();
    expect(file.edits).toHaveLength(2);

    const idle = sealIfIdle(file, Date.parse(later));
    expect(idle.sealed?.summary).toBe("Added 2 paragraphs");
    expect(idle.sealed?.content).toEqual(doc(["Plant sale", "Basil"]));
    expect(idle.file.versions).toHaveLength(1);

    const next = recordEdit(idle.file, {
      content: doc(["Plant sale"]),
      op: { kind: "doc", steps: [] },
      by: maya,
      at: later,
    });
    expect(next.sealed).toBeNull();
    expect(next.file.versions).toHaveLength(1);
    expect(blockCount(next.file)).toBe(1);
  });

  it("seals a paused session when the file is opened", () => {
    let file = createFile("doc", "Notes");
    file = edited(file, ["Hello"], maya, "2026-10-13T18:00:00.000Z").file;
    const opened = sealIfIdle(file, Date.parse("2026-10-13T18:20:00.000Z"));
    expect(opened.sealed?.throughEdit).toBe(file.edits?.[0]?.id);
    expect(opened.file.content).toEqual(file.content);
  });

  it("keeps the departed head when a version is restored", () => {
    let file = createFile("doc", "Notes");
    const first = edited(file, ["Both paragraphs", "Basil"], maya, "2026-10-13T18:00:00.000Z");
    file = sealIfIdle(first.file, Date.parse("2026-10-13T18:20:00.000Z")).file;
    const versionId = file.versions?.[0]?.id ?? "";
    file = edited(file, ["Both paragraphs"], maya, "2026-10-13T18:21:00.000Z").file;
    const restored = restoreToVersion(file, versionId, maya, "2026-10-13T18:22:00.000Z");
    expect(restored.file.content).toEqual(doc(["Both paragraphs", "Basil"]));
    expect(restored.sealed?.content).toEqual(doc(["Both paragraphs"]));
    expect(restored.file.versions?.map((version) => version.id)).toContain(versionId);
    expect(restored.file.versions?.some((version) => version.id === restored.sealed?.id)).toBe(
      true,
    );
  });
});

describe("opening a file", () => {
  it("uses the saved content and does not replay edits", () => {
    let file = createFile("doc", "Notes");
    file = edited(file, ["Keep this"], maya, "2026-10-13T18:00:00.000Z").file;
    const text = serializeFile(file);
    const broken = JSON.parse(text);
    broken.edits[0].op = { kind: "doc", steps: "not-a-step" };
    const opened = parseFile(JSON.stringify(broken));
    expect(opened.content).toEqual(doc(["Keep this"]));
    expect(serializeFile(createFile("doc", "Empty"))).not.toContain('"edits"');
  });

  it("opens a compacted file from its snapshot", () => {
    let file = createFile("doc", "Notes");
    file = edited(file, ["One", "Two"], maya, "2026-10-13T18:00:00.000Z").file;
    const room = new DocumentRoom(file);
    room.join({ ...maya, role: "editor" }, 0);
    room.join({ ...sam, role: "editor" }, 1);
    const mayaDoc = new Y.Doc();
    const samDoc = new Y.Doc();
    connectDocs(room.doc, mayaDoc);
    connectDocs(room.doc, samDoc);
    editParagraph(mayaDoc, 0, "One more");
    editParagraph(samDoc, 1, "Two more");
    room.applyUpdate(
      maya.id,
      Y.encodeStateAsUpdate(mayaDoc),
      { by: maya, at: "2026-10-13T18:05:00.000Z", unit: "paragraph", key: "0" },
      5 * 60 * 1000,
    );
    room.applyUpdate(
      sam.id,
      Y.encodeStateAsUpdate(samDoc),
      { by: sam, at: "2026-10-13T18:06:00.000Z", unit: "paragraph", key: "1" },
      6 * 60 * 1000,
    );
    const finished = room.kick(6 * 60 * 1000 + VERSION_PAUSE_MS);
    expect(finished.version).not.toBeNull();
    const opened = parseFile(serializeFile(room.current() as typeof file));
    expect(opened.content).toEqual(doc(["One more", "Two more"]));
    expect(JSON.stringify(opened)).not.toContain("yjs");
  });
});

function blockCount(file: { content: unknown }) {
  return (file.content as { content?: unknown[] }).content?.length ?? 0;
}

describe("FrogNano summary prompt", () => {
  it("closes the think block before the answer", () => {
    const prompt = summaryPrompt("doc", "Hello", "Hello\nBasil");
    expect(prompt).toContain("<|im_start|>assistant\n<think>\n\n</think>\n\n");
    expect(prompt.endsWith("</think>\n\n")).toBe(true);
    expect(prompt.includes("<think>\n\n</think>")).toBe(true);
  });
});

describe("multiuser room", () => {
  it("merges concurrent edits to different paragraphs", () => {
    const left = new Y.Doc();
    const right = new Y.Doc();
    editParagraph(left, 0, "One");
    editParagraph(left, 1, "Two");
    connectDocs(left, right);
    editParagraph(left, 0, "One more");
    editParagraph(right, 1, "Two more");
    expect(paragraphTexts(left)).toEqual(["One more", "Two more"]);
    expect(paragraphTexts(right)).toEqual(["One more", "Two more"]);
  });

  it("switches on a second writer, kicks one without sealing, then compacts", () => {
    let file = createFile("doc", "Notes");
    file = edited(file, ["One", "Two"], maya, "2026-10-13T18:00:00.000Z").file;
    const room = new DocumentRoom(file);
    expect(room.join({ id: "view", name: "View", role: "viewer" }, 0).joined).toBe(false);
    expect(room.mode).toBe("solo");
    room.join({ ...maya, role: "editor" }, 0);
    expect(room.mode).toBe("solo");
    expect(room.join({ ...sam, role: "commenter" }, 1_000).mode).toBe("multiuser");
    expect(
      room.applyUpdate(
        sam.id,
        Y.encodeStateAsUpdate(new Y.Doc()),
        { by: sam, at: "2026-10-13T18:01:00.000Z", unit: "paragraph", key: "0" },
        1_000,
      ),
    ).toBe(false);

    const mayaDoc = new Y.Doc();
    connectDocs(room.doc, mayaDoc);
    editParagraph(mayaDoc, 0, "One more");
    room.applyUpdate(
      maya.id,
      Y.encodeStateAsUpdate(mayaDoc),
      { by: maya, at: "2026-10-13T18:02:00.000Z", unit: "paragraph", key: "0" },
      1_000,
    );
    const stillHere = 1_000 + VERSION_PAUSE_MS;
    room.activity(sam.id, stillHere);
    const oneGone = room.kick(stillHere);
    expect(oneGone.kicked).toEqual([maya.id]);
    expect(oneGone.version).toBeNull();
    expect(room.mode).toBe("multiuser");

    const done = room.kick(stillHere + VERSION_PAUSE_MS);
    expect(done.version).not.toBeNull();
    expect(room.mode).toBe("solo");
    const edits = room.current().edits ?? [];
    const regions = edits.filter(
      (edit) =>
        edit.op &&
        typeof edit.op === "object" &&
        "kind" in edit.op &&
        edit.op.kind === "region",
    );
    expect(regions.length).toBeGreaterThan(0);
    expect(regions.length).toBeLessThan(edits.length);
    expect(room.current().versions).toHaveLength(1);

    const again = room.join({ ...maya, role: "editor" }, stillHere + VERSION_PAUSE_MS);
    expect(again).toEqual({ joined: true, mode: "solo" });
  });
});
