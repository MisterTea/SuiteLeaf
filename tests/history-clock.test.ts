import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  DocumentRoom,
  OP_BYTE_CAP,
  VERSION_PAUSE_MS,
  VERSION_SNAPSHOT_CAP,
  applyParagraphTexts,
  blockTexts,
  compactSession,
  createFile,
  editParagraph,
  nameVersion,
  paragraphTexts,
  parseFile,
  recordEdit,
  restoreToVersion,
  sealIfIdle,
  seedParagraphs,
  serializeFile,
  summarizeChange,
  changeExcerpt,
  trimVersions,
  versionPauseMs,
  type Collaborator,
  type CollabRole,
  type StoredEdit,
  type SuiteFile,
} from "../packages/core/src";

const MINUTE = 60_000;
const PAUSE = VERSION_PAUSE_MS;

/** A clock the tests move by hand. Nothing here reads the wall clock. */
class Clock {
  constructor(private ms = Date.parse("2026-10-13T15:00:00.000Z")) {}
  now() {
    return this.ms;
  }
  iso() {
    return new Date(this.ms).toISOString();
  }
  advance(ms: number) {
    this.ms += ms;
    return this;
  }
  at(iso: string) {
    this.ms = Date.parse(iso);
    return this;
  }
}

const maya: Collaborator = { id: "maya", name: "Maya" };
const sam: Collaborator = { id: "sam", name: "Sam" };
const rosa: Collaborator = { id: "rosa", name: "Rosa" };
const viewer = { id: "lee", name: "Lee", role: "viewer" as const };

function paragraph(text: string) {
  return text
    ? { type: "paragraph", content: [{ type: "text", text }] }
    : { type: "paragraph" };
}

function doc(texts: string[], blanks = false) {
  const content = texts.flatMap((text, index) =>
    blanks && index > 0 ? [paragraph(""), paragraph(text)] : [paragraph(text)],
  );
  return { type: "doc", content };
}

function sheet(cells: Record<string, string>) {
  const cellData: Record<string, Record<string, { v: string }>> = {};
  for (const [ref, value] of Object.entries(cells)) {
    const col = String(ref.charCodeAt(0) - 65);
    const row = String(Number(ref.slice(1)) - 1);
    cellData[row] ??= {};
    cellData[row][col] = { v: value };
  }
  return {
    workbook: {
      id: "b",
      sheetOrder: ["s"],
      sheets: { s: { id: "s", name: "Sheet", rowCount: 10, columnCount: 5, cellData } },
    },
    charts: [],
    pivots: [],
  };
}

type Person = Collaborator & { role: CollabRole };

/** One document, one room, and the solo edit log, all driven by `clock`. */
class Session {
  clock = new Clock();
  file: SuiteFile;
  room: DocumentRoom<SuiteFile>;
  private clients = new Map<string, Y.Doc>();

  constructor(file = withText(createFile("doc", "Notes"), ["One", "Two"])) {
    this.file = file;
    this.room = new DocumentRoom(this.file);
  }

  join(person: Person) {
    const result = this.room.join(person, this.clock.now());
    if (result.joined && result.mode === "multiuser" && !this.clients.has(person.id))
      this.attach(person.id);
    if (result.mode === "multiuser") {
      for (const id of this.room.present()) if (!this.clients.has(id)) this.attach(id);
    }
    return result;
  }

  private attach(id: string) {
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(this.room.doc));
    this.clients.set(id, client);
  }

  edit(person: Collaborator, index: number, text: string) {
    const client = this.clients.get(person.id);
    if (!client) throw new Error(`${person.name} has no editor`);
    // Start from the room, so a rejected edit is not merged back in later.
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, Y.encodeStateAsUpdate(this.room.doc));
    editParagraph(fresh, index, text);
    const accepted = this.room.applyUpdate(
      person.id,
      Y.encodeStateAsUpdate(fresh),
      {
        by: person,
        at: this.clock.iso(),
        unit: "paragraph",
        key: String(index),
      },
      this.clock.now(),
    );
    if (accepted) this.clients.set(person.id, fresh);
    return accepted;
  }

  comment(person: Collaborator) {
    return this.room.applyUpdate(
      person.id,
      Y.encodeStateAsUpdate(new Y.Doc()),
      { by: person, at: this.clock.iso(), unit: "comment", key: "c" },
      this.clock.now(),
    );
  }

  /** Stop sending activity, then move the clock. Idle people are kicked. */
  elapse(ms: number) {
    this.clock.advance(ms);
    return this.room.kick(this.clock.now(), PAUSE);
  }

  /** Keep `ids` active at the current instant, then kick everyone else. */
  elapseExcept(ms: number, ...ids: string[]) {
    this.clock.advance(ms);
    for (const id of ids) this.room.activity(id, this.clock.now());
    return this.room.kick(this.clock.now(), PAUSE);
  }
}

function withText(file: SuiteFile, texts: string[]): SuiteFile {
  return { ...file, content: doc(texts) };
}

function regions(edits: StoredEdit[] | undefined) {
  return (edits ?? []).filter(
    (edit) =>
      edit.op && typeof edit.op === "object" && "kind" in edit.op && edit.op.kind === "region",
  );
}

function regionKey(edit: StoredEdit) {
  return (edit.op as { key: string }).key;
}

describe("fake clock", () => {
  it("seals on the exact 15 minute mark and not one millisecond earlier", () => {
    const clock = new Clock();
    let file = createFile("doc", "Notes");
    file = recordEdit(file, {
      content: doc(["Hello"]),
      op: { kind: "doc", steps: [] },
      by: maya,
      at: clock.iso(),
      now: clock.now(),
    }).file;
    clock.advance(PAUSE - 1);
    expect(sealIfIdle(file, clock.now(), PAUSE).sealed).toBeNull();
    clock.advance(1);
    const sealed = sealIfIdle(file, clock.now(), PAUSE);
    expect(sealed.sealed?.content).toEqual(doc(["Hello"]));
    expect(sealed.sealed?.at).toBe(file.edits?.[0]?.at);
  });

  it("does not seal a burst, and the edit that ends a pause is not inside the sealed version", () => {
    const clock = new Clock();
    let file = createFile("doc", "Notes");
    const burst = ["a", "ab", "abc", "abcd"];
    for (const text of burst) {
      file = recordEdit(file, {
        content: doc([text]),
        op: { kind: "doc", steps: [{ text }] },
        by: maya,
        at: clock.iso(),
        now: clock.now(),
        pauseMs: PAUSE,
      }).file;
      clock.advance(200);
    }
    expect(file.versions).toBeUndefined();
    expect(file.edits).toHaveLength(burst.length);

    clock.advance(PAUSE);
    const next = recordEdit(file, {
      content: doc(["abcd!"]),
      op: { kind: "doc", steps: [] },
      by: maya,
      at: clock.iso(),
      now: clock.now(),
      pauseMs: PAUSE,
    });
    expect(blockTexts(next.sealed?.content)).toEqual(["abcd"]);
    expect(blockTexts(next.file.content)).toEqual(["abcd!"]);
    expect(next.file.versions).toHaveLength(1);
    expect(next.file.edits).toHaveLength(burst.length + 1);
  });

  it("keeps one version per pause when edits are minutes, then hours, apart", () => {
    const clock = new Clock();
    let file = createFile("doc", "Notes");
    const gaps = [MINUTE, 5 * MINUTE, 14 * MINUTE, PAUSE, 2 * MINUTE, PAUSE + MINUTE];
    let text = "v0";
    file = recordEdit(file, {
      content: doc([text]),
      op: { kind: "doc" },
      by: maya,
      at: clock.iso(),
      now: clock.now(),
    }).file;
    const sealed: string[] = [];
    for (const [index, gap] of gaps.entries()) {
      clock.advance(gap);
      text = `v${index + 1}`;
      const result = recordEdit(file, {
        content: doc([text]),
        op: { kind: "doc" },
        by: maya,
        at: clock.iso(),
        now: clock.now(),
      });
      file = result.file;
      if (result.sealed) sealed.push(blockTexts(result.sealed.content)[0]);
    }
    expect(sealed).toEqual(["v3", "v5"]);
    expect(blockTexts(file.content)).toEqual(["v6"]);
    expect(file.edits).toHaveLength(gaps.length + 1);
  });

  it("seals when the file is opened after the pause, and ignores a broken timestamp", () => {
    const clock = new Clock();
    let file = createFile("doc", "Notes");
    file = recordEdit(file, {
      content: doc(["Kept"]),
      op: { kind: "doc" },
      by: maya,
      at: clock.iso(),
      now: clock.now(),
    }).file;
    clock.advance(PAUSE);
    const opened = sealIfIdle(file, clock.now(), PAUSE);
    expect(blockTexts(opened.sealed?.content)).toEqual(["Kept"]);
    const broken = recordEdit(createFile("doc", "Notes"), {
      content: doc(["X"]),
      op: { kind: "doc" },
      by: maya,
      at: "not-a-time",
      pauseMs: PAUSE,
    });
    expect(sealIfIdle({ ...broken.file, edits: [{ ...broken.file.edits![0], at: "nope" }] }, clock.now()).sealed).toBeNull();
  });

  it("truncates a huge op and still seals that edit after the pause", () => {
    const clock = new Clock();
    const huge = { kind: "doc", steps: ["x".repeat(OP_BYTE_CAP + 500)] };
    let file = createFile("doc", "Notes");
    const recorded = recordEdit(file, {
      content: doc(["Big"]),
      op: huge,
      by: maya,
      at: clock.iso(),
      now: clock.now(),
    });
    expect(recorded.file.edits?.[0]?.op).toEqual({ kind: "doc", truncated: true });
    clock.advance(PAUSE);
    file = sealIfIdle(recorded.file, clock.now(), PAUSE).file;
    expect(file.versions?.[0]?.throughEdit).toBe(recorded.file.edits?.[0]?.id);
    const opened = parseFile(serializeFile(file));
    expect(blockTexts(opened.content)).toEqual(["Big"]);
  });

  it("keeps a named version when unlabeled snapshots pass the cap", () => {
    const clock = new Clock();
    const versions = Array.from({ length: VERSION_SNAPSHOT_CAP + 2 }, (_, index) => ({
      id: `v${index}`,
      at: new Date(clock.now() + index * PAUSE).toISOString(),
      by: maya,
      summary: "Edited a paragraph",
      title: "Notes",
      throughEdit: `e${index}`,
      content: doc([String(index)]),
      ...(index === 3 ? { label: "Agreed" } : {}),
    }));
    const trimmed = trimVersions(versions);
    expect(trimmed).toHaveLength(VERSION_SNAPSHOT_CAP);
    expect(trimmed.some((version) => version.label === "Agreed")).toBe(true);
    expect(trimmed.some((version) => version.id === "v0")).toBe(false);
  });
});

describe("opening and leaving together", () => {
  it("lets several writers open at the same instant and ignores viewers", () => {
    const session = new Session();
    const instant = session.clock.now();
    expect(session.join(viewer).joined).toBe(false);
    expect(session.join({ ...maya, role: "editor" })).toEqual({ joined: true, mode: "solo" });
    expect(session.join({ ...sam, role: "owner" })).toEqual({ joined: true, mode: "multiuser" });
    expect(session.join({ ...rosa, role: "commenter" })).toEqual({
      joined: true,
      mode: "multiuser",
    });
    expect(session.room.present()).toEqual([maya.id, sam.id, rosa.id]);
    expect(session.room.lastActive(maya.id)).toBe(instant);
    expect(session.room.lastActive(sam.id)).toBe(instant);
    expect(session.join({ ...maya, role: "editor" }).mode).toBe("multiuser");
    expect(session.room.present()).toEqual([maya.id, sam.id, rosa.id]);
  });

  it("kicks everyone who stopped together and saves one version", () => {
    const session = new Session();
    session.join({ ...maya, role: "editor" });
    session.join({ ...sam, role: "editor" });
    session.join({ ...rosa, role: "commenter" });
    session.clock.advance(MINUTE);
    expect(session.edit(maya, 0, "Maya's line")).toBe(true);
    session.clock.advance(10 * MINUTE);
    expect(session.edit(sam, 1, "Sam's line")).toBe(true);
    session.clock.advance(MINUTE);
    expect(session.comment(rosa)).toBe(true);
    expect(session.edit(rosa, 0, "Rosa cannot rewrite")).toBe(false);

    const done = session.elapse(PAUSE);
    expect(done.kicked.sort()).toEqual([maya.id, rosa.id, sam.id].sort());
    expect(done.version).not.toBeNull();
    expect(session.room.mode).toBe("solo");
    expect(session.room.present()).toEqual([]);
    expect(blockTexts(session.room.current().content)).toEqual(["Maya's line", "Sam's line"]);
    const body = regions(session.room.current().edits);
    expect(body.map((edit) => [edit.by.id, regionKey(edit)])).toEqual([
      [maya.id, "0"],
      [sam.id, "1"],
    ]);
    expect(session.room.current().versions).toHaveLength(1);
    const again = session.elapse(0);
    expect(again.kicked).toEqual([]);
    expect(again.version).toBeNull();
    expect(session.room.current().versions).toHaveLength(1);
  });

  it("does not save a version when a room opens and leaves without edits", () => {
    const session = new Session();
    session.join({ ...maya, role: "editor" });
    session.join({ ...sam, role: "editor" });
    const done = session.elapse(PAUSE);
    expect(done.kicked.sort()).toEqual([maya.id, sam.id].sort());
    expect(done.version).toBeNull();
    expect(session.room.current().versions ?? []).toHaveLength(0);
    expect(regions(session.room.current().edits)).toHaveLength(0);
  });

  it("drops the people who went idle and keeps whoever is still here", () => {
    const session = new Session();
    session.join({ ...maya, role: "editor" });
    session.join({ ...sam, role: "editor" });
    session.join({ ...rosa, role: "owner" });
    session.edit(maya, 0, "From Maya");
    const first = session.elapseExcept(PAUSE, sam.id);
    expect(first.kicked.sort()).toEqual([maya.id, rosa.id].sort());
    expect(first.version).toBeNull();
    expect(session.room.mode).toBe("multiuser");
    expect(session.room.present()).toEqual([sam.id]);
    expect(session.edit(maya, 1, "Maya already left")).toBe(false);
    session.clock.advance(MINUTE);
    session.edit(sam, 1, "Sam stayed");
    const rest = session.elapse(PAUSE);
    expect(rest.kicked).toEqual([sam.id]);
    expect(blockTexts(session.room.current().content)).toEqual(["From Maya", "Sam stayed"]);
    expect(session.room.current().versions).toHaveLength(1);
  });

  it("treats the pause boundary separately for each person", () => {
    const session = new Session();
    session.join({ ...maya, role: "editor" });
    session.join({ ...sam, role: "editor" });
    session.clock.advance(PAUSE - 1);
    expect(session.room.kick(session.clock.now(), PAUSE).kicked).toEqual([]);
    session.room.activity(sam.id, session.clock.now());
    session.clock.advance(1);
    const kicked = session.room.kick(session.clock.now(), PAUSE);
    expect(kicked.kicked).toEqual([maya.id]);
    expect(kicked.version).toBeNull();
    expect(session.room.present()).toEqual([sam.id]);
  });
});

describe("people coming and going", () => {
  it("rejoins without a notice, into a live room or a compacted file", () => {
    const session = new Session();
    session.join({ ...maya, role: "editor" });
    session.join({ ...sam, role: "editor" });
    session.edit(maya, 0, "Shared");
    session.elapseExcept(PAUSE, sam.id);
    const back = session.join({ ...maya, role: "editor" });
    expect(back).toEqual({ joined: true, mode: "multiuser" });
    expect(session.room.present().sort()).toEqual([maya.id, sam.id].sort());
    expect(session.edit(maya, 1, "Maya returned")).toBe(true);

    session.elapse(PAUSE);
    const alone = session.join({ ...maya, role: "editor" });
    expect(alone).toEqual({ joined: true, mode: "solo" });
    expect(session.room.activity(sam.id, session.clock.now())).toBeUndefined();
    expect(session.room.present()).toEqual([maya.id]);
    const opened = parseFile(serializeFile(session.room.current()));
    expect(blockTexts(opened.content)).toEqual(["Shared", "Maya returned"]);
  });

  it("keeps the original baseline when someone arrives after editing has started", () => {
    const session = new Session();
    session.join({ ...maya, role: "editor" });
    session.join({ ...sam, role: "editor" });
    session.edit(maya, 0, "Before Rosa");
    session.clock.advance(20 * MINUTE);
    session.join({ ...rosa, role: "editor" });
    expect(session.room.mode).toBe("multiuser");
    session.edit(rosa, 1, "Rosa's note");
    session.elapseExcept(PAUSE, rosa.id);
    expect(session.room.present()).toEqual([rosa.id]);
    session.elapse(PAUSE);
    expect(blockTexts(session.room.current().content)).toEqual(["Before Rosa", "Rosa's note"]);
    expect(session.room.current().versions).toHaveLength(1);
  });

  it("starts a fresh room after compaction and does not reuse the previous baseline", () => {
    const session = new Session();
    session.join({ ...maya, role: "editor" });
    session.join({ ...sam, role: "editor" });
    session.edit(sam, 1, "First room");
    session.elapse(PAUSE);
    expect(session.room.current().versions).toHaveLength(1);

    session.join({ ...maya, role: "editor" });
    session.join({ ...rosa, role: "editor" });
    session.edit(rosa, 0, "Second room");
    session.elapse(PAUSE);
    expect(session.room.current().versions).toHaveLength(2);
    expect(blockTexts(session.room.current().content)).toEqual(["Second room", "First room"]);
    expect(blockTexts(session.room.current().versions?.[0]?.content)).toEqual([
      "One",
      "First room",
    ]);
  });

  it("lets a commenter stay while editors leave, then seals only the body edits", () => {
    const session = new Session();
    session.join({ ...maya, role: "editor" });
    session.join({ ...rosa, role: "commenter" });
    session.edit(maya, 0, "Body");
    session.comment(rosa);
    session.elapseExcept(PAUSE, rosa.id);
    expect(session.room.present()).toEqual([rosa.id]);
    expect(session.comment(rosa)).toBe(true);
    const done = session.elapse(PAUSE);
    expect(done.kicked).toEqual([rosa.id]);
    expect(regions(session.room.current().edits).map((edit) => edit.by.id)).toEqual([maya.id]);
  });

  it("does not let a solo editor push a CRDT update, and a late joiner does not see a second version early", () => {
    const session = new Session();
    session.join({ ...maya, role: "editor" });
    expect(session.room.mode).toBe("solo");
    const stray = new Y.Doc();
    editParagraph(stray, 0, "Too soon");
    expect(
      session.room.applyUpdate(
        maya.id,
        Y.encodeStateAsUpdate(stray),
        { by: maya, at: session.clock.iso(), unit: "paragraph", key: "0" },
        session.clock.now(),
      ),
    ).toBe(false);
    expect(blockTexts(session.room.current().content)).toEqual(["One", "Two"]);
    session.join({ ...sam, role: "editor" });
    expect(session.elapseExcept(PAUSE - 1, maya.id, sam.id).version).toBeNull();
    expect(session.room.mode).toBe("multiuser");
  });
});

describe("edits at different rates", () => {
  it("collapses a fast typist and a slow one into one edit each", () => {
    const session = new Session();
    session.join({ ...maya, role: "editor" });
    session.join({ ...sam, role: "editor" });
    for (const text of ["M", "Ma", "May", "Maya"]) {
      session.clock.advance(300);
      session.edit(maya, 0, text);
    }
    session.clock.advance(12 * MINUTE);
    session.edit(sam, 1, "Sam once");
    session.clock.advance(8 * MINUTE);
    session.edit(maya, 0, "Maya finished");
    session.elapse(PAUSE);
    const body = regions(session.room.current().edits);
    expect(body).toHaveLength(2);
    expect(body.find((edit) => edit.by.id === maya.id)?.at).toBe(
      new Date(Date.parse("2026-10-13T15:00:00.000Z") + 300 * 4 + 12 * MINUTE + 8 * MINUTE).toISOString(),
    );
    expect(body.find((edit) => edit.by.id === sam.id)?.at).toBe(
      new Date(Date.parse("2026-10-13T15:00:00.000Z") + 300 * 4 + 12 * MINUTE).toISOString(),
    );
    expect(blockTexts(session.room.current().content)).toEqual(["Maya finished", "Sam once"]);
  });

  it("keeps both authors when they revise the same paragraph at different times", () => {
    const session = new Session();
    session.join({ ...maya, role: "editor" });
    session.join({ ...sam, role: "editor" });
    session.edit(maya, 0, "Draft");
    session.clock.advance(25 * MINUTE);
    session.edit(sam, 0, "Final");
    session.elapse(PAUSE);
    const shared = regions(session.room.current().edits).filter((edit) => regionKey(edit) === "0");
    expect(shared.map((edit) => edit.by.id)).toEqual([maya.id, sam.id]);
    expect(shared[1]?.at > shared[0]?.at).toBe(true);
  });

  it("adds and clears paragraphs without a blank line stealing the index", () => {
    const source = doc(["Keep", "Drop"]);
    source.content.splice(1, 0, paragraph(""));
    expect(blockTexts(applyParagraphTexts(source, ["Keep", "Added"]))).toEqual(["Keep", "Added"]);
    expect(blockTexts(applyParagraphTexts(source, ["Only"]))).toEqual(["Only"]);
    const withBlank = {
      type: "doc",
      content: [paragraph("One"), paragraph(""), paragraph("Two")],
    };
    expect(blockTexts(applyParagraphTexts(withBlank, ["One more", "Two"]))).toEqual([
      "One more",
      "Two",
    ]);

    const session = new Session(withText(createFile("doc", "Notes"), ["Keep", "Drop"]));
    session.join({ ...maya, role: "editor" });
    session.join({ ...sam, role: "editor" });
    session.edit(sam, 1, "");
    session.clock.advance(MINUTE);
    session.edit(maya, 2, "Added");
    session.elapse(PAUSE);
    expect(blockTexts(session.room.current().content)).toEqual(["Keep", "Added"]);
  });

  it("seals a spreadsheet and a deck on their own pauses", () => {
    const clock = new Clock();
    let sheetFile = createFile("sheet", "Budget");
    sheetFile = recordEdit(sheetFile, {
      content: sheet({ A1: "Rent" }),
      op: { kind: "sheet", mutations: [{ id: "set", params: { a: 1 } }] },
      by: maya,
      at: clock.iso(),
      now: clock.now(),
    }).file;
    clock.advance(MINUTE);
    sheetFile = recordEdit(sheetFile, {
      content: sheet({ A1: "Rent", B1: "40" }),
      op: { kind: "sheet", mutations: [{ id: "set" }, { id: "set" }] },
      by: sam,
      at: clock.iso(),
      now: clock.now(),
    }).file;
    expect(sheetFile.versions).toBeUndefined();
    clock.advance(PAUSE);
    const sealed = sealIfIdle(sheetFile, clock.now(), PAUSE);
    expect(sealed.sealed?.summary).toBe("Changed 2 cells");
    expect(sealed.sealed?.by).toEqual(sam);

    clock.advance(MINUTE);
    let slides = createFile("slide", "Talk");
    const first = slides.content;
    slides = recordEdit(slides, {
      content: {
        ...first,
        slideOrder: [...(first as { slideOrder: string[] }).slideOrder, "extra"],
        slides: {
          ...(first as { slides: Record<string, unknown> }).slides,
          extra: { id: "extra", elements: [] },
        },
      },
      op: { kind: "slide", added: ["extra"], removed: [], edited: [] },
      by: rosa,
      at: clock.iso(),
      now: clock.now(),
    }).file;
    clock.advance(PAUSE);
    const firstSeal = sealIfIdle(slides, clock.now(), PAUSE);
    expect(firstSeal.sealed).not.toBeNull();
    const head = firstSeal.file;
    const deck = head.content as {
      slideOrder: string[];
      slides: Record<string, unknown>;
    };
    const added = recordEdit(head, {
      content: {
        ...deck,
        slideOrder: [...deck.slideOrder, "second"],
        slides: { ...deck.slides, second: { id: "second", elements: [] } },
      },
      op: { kind: "slide", added: ["second"], removed: [], edited: [] },
      by: rosa,
      at: new Date(clock.now() + MINUTE).toISOString(),
      now: clock.now() + MINUTE,
    });
    expect(added.sealed).toBeNull();
    expect(sealIfIdle(added.file, clock.now() + MINUTE + PAUSE, PAUSE).sealed?.summary).toBe(
      "Added a slide",
    );
  });

  it("restores across a pause without waiting, and refuses a missing version", () => {
    const clock = new Clock();
    let file = createFile("doc", "Notes");
    file = recordEdit(file, {
      content: doc(["Both", "Basil"]),
      op: { kind: "doc" },
      by: maya,
      at: clock.iso(),
      now: clock.now(),
    }).file;
    clock.advance(PAUSE);
    file = sealIfIdle(file, clock.now(), PAUSE).file;
    const id = file.versions?.[0]?.id ?? "";
    file = nameVersion(file, id, "  Before the meeting  ");
    expect(file.versions?.[0]?.label).toBe("Before the meeting");
    clock.advance(MINUTE);
    file = recordEdit(file, {
      content: doc(["Both"]),
      op: { kind: "doc" },
      by: sam,
      at: clock.iso(),
      now: clock.now(),
    }).file;
    const restored = restoreToVersion(file, id, rosa, clock.iso());
    expect(blockTexts(restored.file.content)).toEqual(["Both", "Basil"]);
    expect(blockTexts(restored.sealed?.content)).toEqual(["Both"]);
    expect(restored.file.versions?.find((version) => version.id === id)?.label).toBe(
      "Before the meeting",
    );
    expect(() => restoreToVersion(file, "missing", maya, clock.iso())).toThrow(
      /not in this file/,
    );
  });
});

describe("compaction when the touches and the snapshot disagree", () => {
  it("keeps the later timestamp when the same cell is touched out of order", () => {
    const clock = new Clock();
    const file = { ...createFile("sheet", "Budget"), content: sheet({ A1: "Rent" }) };
    const later = new Date(clock.now() + 1_000).toISOString();
    const middle = new Date(clock.now() + 500).toISOString();
    const done = compactSession(
      file,
      sheet({ A1: "Rent", B1: "40", C1: "Note" }),
      "Budget",
      [
        { by: sam, at: clock.iso(), unit: "cell", key: "s:0:1" },
        { by: maya, at: later, unit: "cell", key: "s:0:1" },
        { by: sam, at: middle, unit: "cell", key: "s:0:1" },
      ],
      new Date(clock.now() + PAUSE).toISOString(),
    );
    const cells = regions(done.file.edits);
    expect(cells.filter((edit) => regionKey(edit) === "s:0:1").map((edit) => [edit.by.id, edit.at])).toEqual([
      [sam.id, middle],
      [maya.id, later],
    ]);
    expect(cells.find((edit) => regionKey(edit) === "s:0:2")?.by).toEqual(sam);
    expect(done.version?.summary).toBe("Changed 2 cells");
  });

  it("records who added, removed, and edited a slide, and who changed one nobody claimed", () => {
    const clock = new Clock();
    const before = {
      slideOrder: ["keep", "gone"],
      slides: {
        keep: { id: "keep", elements: [{ content: "Old" }] },
        gone: { id: "gone", elements: [] },
      },
    };
    const after = {
      slideOrder: ["keep", "new"],
      slides: {
        keep: { id: "keep", elements: [{ content: "New" }] },
        new: { id: "new", elements: [] },
      },
    };
    const file = { ...createFile("slide", "Talk"), content: before };
    const done = compactSession(
      file,
      after,
      "Talk",
      [
        { by: maya, at: clock.iso(), unit: "slide", key: "new" },
        { by: sam, at: clock.iso(), unit: "slide", key: "keep" },
      ],
      new Date(clock.now() + PAUSE).toISOString(),
    );
    expect(regions(done.file.edits).map((edit) => [edit.by.id, regionKey(edit)])).toEqual([
      [maya.id, "new"],
      [sam.id, "gone"],
      [sam.id, "keep"],
    ]);
  });

  it("still records a rename when the body did not change", () => {
    const clock = new Clock();
    const file = withText(createFile("doc", "Notes"), ["Same"]);
    const done = compactSession(file, file.content, "Garden club", [], clock.iso());
    expect(done.version?.summary).toBe('Renamed to "Garden club"');
    expect(done.file.edits?.at(-1)?.by).toEqual({ id: "local", name: "You" });
  });

  it("saves a sheet from the merged snapshot when the last writers leave together", () => {
    const clock = new Clock();
    const file = { ...createFile("sheet", "Budget"), content: sheet({ A1: "Rent" }) };
    const room = new DocumentRoom(file);
    room.join({ ...maya, role: "editor" }, clock.now());
    room.join({ ...sam, role: "editor" }, clock.now());
    clock.advance(MINUTE);
    room.applyUpdate(
      maya.id,
      Y.encodeStateAsUpdate(new Y.Doc()),
      { by: maya, at: clock.iso(), unit: "cell", key: "s:0:1" },
      clock.now(),
    );
    clock.advance(4 * MINUTE);
    room.remember(sheet({ A1: "Rent", B1: "40" }));
    clock.advance(PAUSE);
    const done = room.kick(clock.now(), PAUSE);
    expect(done.kicked.sort()).toEqual([maya.id, sam.id].sort());
    expect(done.version?.summary).toBe("Changed 1 cell");
    expect(room.mode).toBe("solo");
    expect(room.current().content).toEqual(sheet({ A1: "Rent", B1: "40" }));
  });

  it("seeds paragraph text for a later reader", () => {
    const doc = new Y.Doc();
    seedParagraphs(doc, ["A", "B"]);
    seedParagraphs(doc, ["A", "B"]);
    expect(paragraphTexts(doc)).toEqual(["A", "B"]);
  });

  it("describes every kind of change, including a blank cell and a long title", () => {
    const empty = sheet({});
    const withNull = sheet({ A1: "Rent" });
    (withNull.workbook.sheets.s.cellData["0"]["1"] as { v: string } | null) = null;
    expect(
      summarizeChange("sheet", { title: "Budget", content: empty }, { title: "Budget", content: { ...empty, charts: [{}] } }),
    ).toBe("Edited the spreadsheet");
    expect(
      summarizeChange(
        "slide",
        { title: "Talk", content: { slideOrder: ["a", "b"], slides: { a: { id: "a" }, b: { id: "b" } } } },
        { title: "Talk", content: { slideOrder: ["a"], slides: { a: { id: "a" } } } },
      ),
    ).toBe("Removed a slide");
    expect(
      summarizeChange(
        "slide",
        { title: "Talk", content: { slideOrder: ["a"], slides: { a: {} } } },
        { title: "Talk", content: { slideOrder: ["a", "b", "c"], slides: { a: {}, b: {}, c: {} } } },
      ),
    ).toBe("Added 2 slides");
    expect(
      summarizeChange(
        "slide",
        { title: "Talk", content: { slideOrder: ["a", "b"], slides: { a: { v: 1 }, b: { v: 1 } } } },
        { title: "Talk", content: { slideOrder: ["a", "b"], slides: { a: { v: 2 }, b: { v: 3 } } } },
      ),
    ).toBe("Edited 2 slides");
    expect(
      summarizeChange(
        "slide",
        { title: "Old", content: { slideOrder: ["a"], slides: { a: {} } } },
        { title: "New", content: { slideOrder: ["b"], slides: { b: {} } } },
      ),
    ).toBe('Renamed to "New" and edited a slide');
    const title = "N".repeat(250);
    expect(summarizeChange("doc", { title: "A", content: doc(["Hi"]) }, { title, content: doc(["Hi"]) })).toMatch(
      /^Renamed to "/,
    );
    expect(
      changeExcerpt("sheet", { title: "Budget", content: sheet({ A1: "Rent" }) }, { title: "Budget", content: sheet({ A1: "Tax" }) }).after,
    ).toContain("Tax");
    expect(
      changeExcerpt(
        "slide",
        { title: "Talk", content: { slideOrder: ["a"], slides: { a: { notes: "Hello" } } } },
        { title: "Talk", content: { slideOrder: ["a"], slides: { a: { notes: "Bye" } } } },
      ).after,
    ).toContain("Bye");
    expect(changeExcerpt("doc", { title: "N", content: doc(["Hi"]) }, { title: "N", content: doc(["Hi", "There"]) }).after).toContain(
      "There",
    );
  });
});

describe("pause override", () => {
  it("reads a non-negative override and ignores anything else", () => {
    expect(versionPauseMs({ getItem: () => null })).toBe(PAUSE);
    expect(versionPauseMs({ getItem: () => "  " })).toBe(PAUSE);
    expect(versionPauseMs({ getItem: () => "0" })).toBe(0);
    expect(versionPauseMs({ getItem: () => "1500" })).toBe(1500);
    expect(versionPauseMs({ getItem: () => "-1" })).toBe(PAUSE);
    expect(versionPauseMs({ getItem: () => "soon" })).toBe(PAUSE);
  });
});
