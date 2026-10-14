import * as Y from "yjs";
import {
  VERSION_PAUSE_MS,
  applyParagraphTexts,
  blockTexts,
  compactSession,
  type Collaborator,
  type FileKind,
  type RegionTouch,
  type StoredVersion,
  type TrackedFile,
} from "./history";

export type CollabRole = "viewer" | "commenter" | "editor" | "owner";

export type CollabJoin = {
  joined: boolean;
  mode: "solo" | "multiuser";
};

const writers = new Set<CollabRole>(["commenter", "editor", "owner"]);

export function canJoinRoom(role: CollabRole): boolean {
  return writers.has(role);
}

/** Mirror paragraph text into the Y.Doc so a later compaction can read it. */
export function syncParagraphTexts(doc: Y.Doc, texts: string[]) {
  const blocks = doc.getArray<Y.Text>("paragraphs");
  doc.transact(() => {
    while (blocks.length < texts.length) blocks.push([new Y.Text()]);
    while (blocks.length > texts.length) blocks.delete(blocks.length - 1, 1);
    texts.forEach((text, index) => {
      const item = blocks.get(index);
      if (item.toString() === text) return;
      if (item.length > 0) item.delete(0, item.length);
      if (text) item.insert(0, text);
    });
  });
}

export function paragraphTexts(doc: Y.Doc): string[] {
  return doc
    .getArray<Y.Text>("paragraphs")
    .toArray()
    .map((item) => item.toString());
}

/** Replace one paragraph's text. Concurrent edits of other indexes still merge. */
export function editParagraph(doc: Y.Doc, index: number, text: string) {
  const blocks = doc.getArray<Y.Text>("paragraphs");
  doc.transact(() => {
    while (blocks.length <= index) blocks.push([new Y.Text()]);
    const item = blocks.get(index);
    if (item.length > 0) item.delete(0, item.length);
    if (text) item.insert(0, text);
  });
}

export function connectDocs(left: Y.Doc, right: Y.Doc) {
  const toRight = (update: Uint8Array, origin: unknown) => {
    if (origin !== right) Y.applyUpdate(right, update, left);
  };
  const toLeft = (update: Uint8Array, origin: unknown) => {
    if (origin !== left) Y.applyUpdate(left, update, right);
  };
  left.on("update", toRight);
  right.on("update", toLeft);
  Y.applyUpdate(right, Y.encodeStateAsUpdate(left), left);
}

type Person = { role: CollabRole; name: string; lastActive: number };

/**
 * One open document on a node. A viewer never joins. A second commenter,
 * editor, or owner switches the room to a Yjs document. Idle people are
 * dropped with no message; the room compacts only after the last writer goes.
 */
export class DocumentRoom<T extends TrackedFile> {
  mode: "solo" | "multiuser" = "solo";
  readonly doc = new Y.Doc();
  private people = new Map<string, Person>();
  private touches: RegionTouch[] = [];
  private baseline: T | null = null;
  /** Merged spreadsheet or deck, when the Yjs paragraphs are not the document. */
  private merged: unknown = undefined;

  constructor(private file: T) {}

  current(): T {
    return this.file;
  }

  present(): string[] {
    return [...this.people.keys()];
  }

  lastActive(userId: string): number | undefined {
    return this.people.get(userId)?.lastActive;
  }

  join(user: Collaborator & { role: CollabRole }, now: number): CollabJoin {
    if (!canJoinRoom(user.role)) return { joined: false, mode: this.mode };
    const before = this.people.size;
    this.people.set(user.id, { role: user.role, name: user.name, lastActive: now });
    if (before >= 1 && this.people.size >= 2 && this.mode === "solo") {
      this.mode = "multiuser";
      this.baseline = structuredClone(this.file);
      if (this.file.kind === "doc") syncParagraphTexts(this.doc, blockTexts(this.file.content));
    }
    return { joined: true, mode: this.mode };
  }

  /** The latest merged snapshot for a sheet or deck, taken from its Y.Map. */
  remember(content: unknown) {
    this.merged = content;
  }

  activity(userId: string, now: number) {
    const person = this.people.get(userId);
    if (person) person.lastActive = now;
  }

  /**
   * Apply a Yjs update. Commenters may only record comment touches; a body
   * update from a commenter is ignored.
   */
  applyUpdate(
    userId: string,
    update: Uint8Array,
    touch: RegionTouch | null,
    now: number,
  ): boolean {
    const person = this.people.get(userId);
    if (!person) return false;
    if (person.role === "commenter" && touch?.unit !== "comment") return false;
    if (this.mode !== "multiuser") return false;
    Y.applyUpdate(this.doc, update);
    if (touch) this.touches.push({ ...touch, by: { id: userId, name: person.name } });
    person.lastActive = now;
    return true;
  }

  /**
   * Drop anyone idle for `pause` milliseconds. Compaction runs only when a
   * multiuser room loses its last writer. The result has no user-facing notice.
   */
  kick(
    now: number,
    pause = VERSION_PAUSE_MS,
  ): { kicked: string[]; version: StoredVersion | null } {
    const kicked: string[] = [];
    for (const [id, person] of [...this.people])
      if (now - person.lastActive >= pause) {
        this.people.delete(id);
        kicked.push(id);
      }
    if (this.people.size > 0 || this.mode !== "multiuser" || !this.baseline)
      return { kicked, version: null };
    const texts = paragraphTexts(this.doc);
    const content =
      this.merged !== undefined
        ? this.merged
        : this.file.kind === "doc"
          ? applyParagraphTexts(this.baseline.content, texts)
          : this.baseline.content;
    const compacted = compactSession(
      this.baseline,
      content,
      this.file.title,
      this.touches,
      new Date(now).toISOString(),
    );
    this.file = compacted.file;
    this.mode = "solo";
    this.touches = [];
    this.baseline = null;
    this.merged = undefined;
    return { kicked, version: compacted.version };
  }
}

export function seedParagraphs(doc: Y.Doc, texts: string[]) {
  syncParagraphTexts(doc, texts);
}

export type { FileKind };
