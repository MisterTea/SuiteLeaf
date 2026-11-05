import { describe, expect, it } from "vitest";
import {
  OutboundQueue,
  RECONNECT_DELAYS_MS,
  documentRoomOpens,
  loadQueue,
  reconnectDelay,
  saveQueue,
  sessionUrl,
} from "../apps/web/src/collab/connection";
import { authFailurePlan } from "../apps/web/src/collab/recovery";
import { bindWaitingUndo, undoWaitingEdit } from "../apps/web/src/collab/waiting-undo";

describe("collaboration reconnect", () => {
  it("opens the live room for a viewer and not for a local file", () => {
    expect(documentRoomOpens("viewer")).toBe(true);
    expect(documentRoomOpens("commenter")).toBe(true);
    expect(documentRoomOpens("editor")).toBe(true);
    expect(documentRoomOpens("owner")).toBe(true);
    expect(documentRoomOpens("local")).toBe(false);
    expect(documentRoomOpens(null)).toBe(false);
  });

  it("backs off and then holds the last delay", () => {
    expect(reconnectDelay(0)).toBe(200);
    expect(reconnectDelay(1)).toBe(400);
    expect(reconnectDelay(RECONNECT_DELAYS_MS.length)).toBe(6_400);
    expect(reconnectDelay(99)).toBe(6_400);
    expect(reconnectDelay(-3)).toBe(200);
    expect(reconnectDelay(Number.NaN)).toBe(200);
    expect(reconnectDelay("secret-value" as never)).toBe(200);
  });

  it("keeps the bearer token out of the socket URL", () => {
    const url = sessionUrl("https://leaf.example/app", "file-1");
    expect(url).toBe("wss://leaf.example/api/drive/items/file-1/session");
    expect(url).not.toContain("access_token");
    expect(url).not.toContain("token");
    expect(sessionUrl("http://127.0.0.1:8787", "file-1")).toBe(
      "ws://127.0.0.1:8787/api/drive/items/file-1/session",
    );
    const hidden = sessionUrl("https://user:secret-value@leaf.example/app?token=secret-value#part", "file-1");
    expect(hidden).toBe("wss://leaf.example/api/drive/items/file-1/session");
    expect(hidden).not.toContain("secret-value");
    expect(() => sessionUrl("secret-value", "file-1")).toThrow(
      "The collaboration address is not a web address.",
    );
  });

  it("holds a sent update until the server acknowledges it", () => {
    const queue = new OutboundQueue();
    const first = {
      id: "one",
      type: "update" as const,
      update: "a",
      unit: "paragraph",
      key: "0",
      at: "t",
    };
    const second = {
      id: "two",
      type: "seed" as const,
      update: "b",
      unit: "paragraph",
      key: "0",
      at: "t",
    };
    queue.push(first);
    queue.push(second);
    const sent: string[] = [];
    queue.drain((message) => {
      if (message.id === "two") return false;
      sent.push(message.id);
      return true;
    });
    expect(sent).toEqual(["one"]);
    expect(queue.length).toBe(2);
    queue.settle("one");
    expect(queue.length).toBe(1);
    queue.release();
    queue.drain((message) => {
      sent.push(message.id);
      return true;
    });
    expect(sent).toEqual(["one", "two"]);
    expect(queue.length).toBe(1);
    queue.settle("two");
    expect(queue.length).toBe(0);
  });

  it("keeps the first copy when the same update id is queued again", () => {
    const queue = new OutboundQueue();
    queue.push({
      id: "one",
      type: "update",
      update: "beds",
      unit: "paragraph",
      key: "0",
      at: "t",
    });
    queue.push({
      id: "one",
      type: "update",
      update: "secret-value",
      unit: "paragraph",
      key: "0",
      at: "t",
    });
    expect(queue.length).toBe(1);
    expect(queue.pending()[0].update).toBe("beds");
    expect(JSON.stringify(queue.pending())).not.toContain("secret-value");
  });

  it("keeps an unstored edit for the next page load", () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
      clear: () => stored.clear(),
      key: () => null,
      get length() {
        return stored.size;
      },
    } as Storage;
    const queue = new OutboundQueue();
    queue.push({
      id: "one",
      type: "update",
      update: "secret-value",
      unit: "paragraph",
      key: "0",
      at: "t",
    });
    saveQueue(storage, "file-1", queue);
    const next = new OutboundQueue();
    expect(loadQueue(storage, "file-1", next)).toBe(1);
    expect(next.pending()[0].update).toBe("secret-value");
    expect(queue.pending()[0].update).toBe("secret-value");
    storage.setItem("suiteleaf-room-queue:file-1", "secret-value");
    const broken = new OutboundQueue();
    expect(loadQueue(storage, "file-1", broken)).toBe(0);
    expect(storage.getItem("suiteleaf-room-queue:file-1")).toBeNull();
    expect(broken.length).toBe(0);
  });

  it("undo drops the newest waiting edit and leaves the seed", () => {
    const queue = new OutboundQueue();
    queue.push({
      id: "seed",
      type: "seed",
      update: "secret-value",
      unit: "paragraph",
      key: "0",
      at: "t",
    });
    queue.push({
      id: "edit",
      type: "update",
      update: "secret-value",
      unit: "paragraph",
      key: "1",
      at: "t",
    });
    bindWaitingUndo(() => queue.dropLatestUpdate());
    expect(undoWaitingEdit()).toBe(true);
    expect(queue.pending().map((message) => message.type)).toEqual(["seed"]);
    expect(queue.pending().some((message) => message.id === "edit")).toBe(false);
    expect(undoWaitingEdit()).toBe(false);
    expect(queue.length).toBe(1);
    queue.push({
      id: "sent",
      type: "update",
      update: "secret-value",
      unit: "paragraph",
      key: "2",
      at: "t",
    });
    queue.drain(() => true);
    queue.push({
      id: "later",
      type: "update",
      update: "beds",
      unit: "paragraph",
      key: "3",
      at: "t",
    });
    expect(undoWaitingEdit()).toBe(true);
    expect(queue.pending().map((message) => message.id)).toEqual(["seed", "sent"]);
    expect(undoWaitingEdit()).toBe(false);
    bindWaitingUndo(null);
    expect(undoWaitingEdit()).toBe(false);
  });

  it("keeps the first copy when a saved queue repeats an update id", () => {
    const queue = new OutboundQueue();
    queue.load([
      { id: "one", type: "update", update: "beds", unit: "paragraph", key: "0", at: "t" },
      { id: "one", type: "update", update: "secret-value", unit: "paragraph", key: "0", at: "t" },
    ]);
    expect(queue.length).toBe(1);
    expect(queue.pending()[0].update).toBe("beds");
    expect(JSON.stringify(queue.pending())).not.toContain("secret-value");
  });

  it("pauses for a new sign-in and keeps the waiting edit", () => {
    const expired = authFailurePlan("unauthorized");
    expect(expired).toEqual({ pauseForSignIn: true, giveUp: false, stop: "unauthorized" });
    const revoked = authFailurePlan("forbidden");
    expect(revoked.giveUp).toBe(true);
    expect(revoked.pauseForSignIn).toBe(false);
    const other = authFailurePlan("secret-value");
    expect(other).toEqual({ pauseForSignIn: false, giveUp: false, stop: null });
    expect(JSON.stringify(other)).not.toContain("secret-value");
    const queue = new OutboundQueue();
    queue.push({
      id: "one",
      type: "update",
      update: "beds",
      unit: "paragraph",
      key: "0",
      at: "t",
    });
    expect(expired.giveUp).toBe(false);
    expect(queue.pending()[0].update).toBe("beds");
  });
});
describe("room generations", () => {
  const edit = (id: string, generation?: number, type: "update" | "seed" = "update") => ({
    id,
    type,
    update: "AA==",
    unit: "paragraph",
    key: "0",
    at: "",
    ...(generation === undefined ? {} : { generation }),
  });

  it("drops edits made in another generation and keeps the rest", () => {
    const queue = new OutboundQueue();
    queue.push(edit("old-1", 3));
    queue.push(edit("old-seed", 3, "seed"));
    queue.push(edit("now-1", 4));
    queue.push(edit("before-generations"));
    expect(queue.dropOtherGenerations(4)).toBe(1);
    expect(queue.pending().map((m) => m.id)).toEqual(["now-1", "before-generations"]);
    expect(queue.dropOtherGenerations(4)).toBe(0);
  });

  it("keeps a whole-number generation through session storage and drops anything else", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    } as unknown as Storage;
    const queue = new OutboundQueue();
    queue.push(edit("a", 7));
    saveQueue(storage, "file-1", queue);
    const read = new OutboundQueue();
    loadQueue(storage, "file-1", read);
    expect(read.pending()[0]?.generation).toBe(7);
    store.set(
      "suiteleaf-room-queue:file-1",
      JSON.stringify([{ ...edit("b"), generation: "secret-value" }, { ...edit("c"), generation: 1.5 }]),
    );
    loadQueue(storage, "file-1", read);
    expect(read.pending().map((m) => m.generation)).toEqual([undefined, undefined]);
    expect(JSON.stringify(read.pending())).not.toContain("secret-value");
  });
});
