// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { mirrorLiveEdit, shouldSeedDocument, useDocumentRoom } from "../../apps/web/src/collab/session";
import type { DriveRole } from "../../apps/web/src/node-client";

const fake = vi.hoisted(() => ({
  session: { url: "http://127.0.0.1:8787", user: { id: "maya", name: "Maya" } } as null | {
    url: string;
    user: { id: string; name: string };
  },
  token: vi.fn(async () => "token"),
  sessionListener: (() => {}) as (next: unknown) => void,
}));

vi.mock("../../apps/web/src/node-client", () => ({
  getSession: () => fake.session,
  accessToken: () => fake.token(),
  onSession: (listener: (next: unknown) => void) => {
    fake.sessionListener = listener;
    return () => {
      fake.sessionListener = () => {};
    };
  },
}));

class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: Record<string, unknown>[] = [];
  failSend = false;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    });
  }
  send(data: string) {
    if (this.failSend) throw new Error("socket full");
    this.sent.push(JSON.parse(data));
  }
  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  receive(message: Record<string, unknown>) {
    act(() => this.onmessage?.({ data: JSON.stringify(message) }));
  }
  types() {
    return this.sent.map((m) => m.type);
  }
}

function encode(doc: Y.Doc) {
  let binary = "";
  for (const byte of Y.encodeStateAsUpdate(doc)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function prosemirrorState() {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("prosemirror");
  fragment.insert(0, [new Y.XmlElement("paragraph")]);
  return encode(doc);
}

type Props = Parameters<typeof useDocumentRoom>[0];
const spies = {
  onDoc: vi.fn(),
  onSoloAgain: vi.fn(),
  onCaret: vi.fn(),
  onSheetSelection: vi.fn(),
  onSlideSelection: vi.fn(),
  onRecovery: vi.fn(),
};
const senders = {
  selection: { current: (() => {}) as (anchor: number, head: number) => void },
  sheet: { current: (() => {}) as (selection: never) => void },
  slide: { current: (() => {}) as (selection: never) => void },
};
const log = { current: [] as Props["log"] extends infer L ? (L extends { current: infer C } ? C : never) : never };

function Probe({ role = "editor", itemId = "file-1" }: { role?: DriveRole | "local" | null; itemId?: string }) {
  const touch = useRef({ unit: "cell", key: "A1" });
  useDocumentRoom({
    itemId,
    role,
    touch,
    log,
    ...spies,
    sendSelection: senders.selection,
    sendSheetSelection: senders.sheet as never,
    sendSlideSelection: senders.slide as never,
  });
  return null;
}

const socket = (index = -1) => FakeSocket.instances.at(index)!;
const lastRecovery = () => spies.onRecovery.mock.calls.at(-1)?.[0];

async function joined(message: Record<string, unknown> = {}) {
  await vi.waitFor(() => expect(socket().types()).toContain("auth"));
  socket().receive({ type: "joined", mode: "multiuser", ...message });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  fake.session = { url: "http://127.0.0.1:8787", user: { id: "maya", name: "Maya" } };
  fake.token.mockResolvedValue("token");
  log.current = [];
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
  FakeSocket.instances = [];
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  try {
    sessionStorage.clear();
  } catch {
    // No session storage here.
  }
});

describe("document room", () => {
  it("stays closed for a local file or a missing role", () => {
    render(<Probe role="local" />);
    render(<Probe role={null} />);
    render(<Probe itemId="" />);
    expect(FakeSocket.instances).toHaveLength(0);
    expect(spies.onDoc).toHaveBeenCalledWith(null);
    expect(spies.onRecovery).toHaveBeenCalledWith(null);
  });

  it("joins with the token as the first message and shares the document with a second writer", async () => {
    render(<Probe />);
    await joined({ state: prosemirrorState(), seed: true });
    expect(socket().url).toBe("ws://127.0.0.1:8787/api/drive/items/file-1/session");
    expect(socket().sent[0]).toEqual({ type: "auth", accessToken: "token", protocol: 1 });
    const doc = spies.onDoc.mock.calls.at(-1)![0] as Y.Doc;
    expect(doc).toBeInstanceOf(Y.Doc);
    expect(shouldSeedDocument(doc)).toBe(true);
    expect(lastRecovery()).toBeNull();

    // A local edit is queued, logged, and sent.
    act(() => doc.getText("t").insert(0, "hello"));
    const update = socket().sent.find((m) => m.type === "update")!;
    expect(update).toMatchObject({ unit: "cell", key: "A1" });
    expect(log.current[0]).toMatchObject({ by: { id: "maya", name: "Maya" }, unit: "cell", key: "A1" });
    expect(lastRecovery()).toBe("1 edit is waiting to be stored.");
    socket().receive({ type: "ack", id: update.id as string });
    expect(lastRecovery()).toBeNull();

    // An update from someone else is applied and does not echo back.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    other.getXmlFragment("prosemirror").insert(0, [new Y.XmlElement("paragraph")]);
    const before = socket().sent.length;
    socket().receive({ type: "update", update: encode(other) });
    expect(socket().sent).toHaveLength(before);
    expect(doc.getXmlFragment("prosemirror").length).toBe(2);
  });

  it("goes solo again when the other writer leaves", async () => {
    render(<Probe />);
    await joined();
    socket().receive({ type: "joined", mode: "solo" });
    expect(spies.onSoloAgain).toHaveBeenCalledTimes(1);
    expect(spies.onDoc).toHaveBeenLastCalledWith(null);
    socket().receive({ type: "unknown" });
    socket().receive({ type: "update" });
  });

  it("publishes this person's selection only once joined, and shows other people's", async () => {
    render(<Probe />);
    senders.selection.current(1, 2);
    await joined();
    senders.selection.current(3, 4);
    senders.selection.current(-1, 4);
    senders.sheet.current({ sheetId: "s1", startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 } as never);
    senders.sheet.current({ sheetId: "", startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 } as never);
    senders.slide.current({ slideId: "slide-1" } as never);
    senders.slide.current({ slideId: "" } as never);
    expect(socket().sent.filter((m) => m.type === "selection")).toEqual([
      { type: "selection", anchor: 3, head: 4 },
      { type: "selection", sheetId: "s1", startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 },
      { type: "selection", slideId: "slide-1" },
    ]);
    socket().receive({ type: "selection", name: "Ravi", anchor: 5, head: 6 });
    socket().receive({ type: "selection", name: "Ravi", sheetId: "s1", startRow: 2, startColumn: 2, endRow: 2, endColumn: 2 });
    socket().receive({ type: "selection", name: "Ravi", slideId: "slide-2" });
    socket().receive({ type: "selection", name: "Maya", anchor: 1, head: 1 });
    expect(spies.onCaret).toHaveBeenCalledExactlyOnceWith({ name: "Ravi", anchor: 5, head: 6 });
    expect(spies.onSheetSelection).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: "Ravi", startRow: 2 }));
    expect(spies.onSlideSelection).toHaveBeenCalledExactlyOnceWith({ name: "Ravi", slideId: "slide-2" });
  });

  it("pauses for sign-in on an expired token and resumes with the next session", async () => {
    render(<Probe />);
    await joined();
    socket().receive({ type: "error", reason: "unauthorized" });
    expect(lastRecovery()).toBe("Sign in again to open the shared document.");
    expect(socket().readyState).toBe(FakeSocket.CLOSED);
    // Going offline or online while paused changes nothing.
    act(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });
    expect(FakeSocket.instances).toHaveLength(1);
    act(() => fake.sessionListener(null));
    act(() => fake.sessionListener({ url: "x" }));
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    await joined();
    expect(lastRecovery()).toBeNull();
  });

  it("stops for good when access is gone or the protocol differs", async () => {
    render(<Probe />);
    await joined();
    socket().receive({ type: "error", reason: "forbidden" });
    expect(lastRecovery()).toBe("You no longer have access to this shared document.");
    act(() => fake.sessionListener({ url: "x" }));
    cleanup();
    FakeSocket.instances = [];
    render(<Probe />);
    await vi.waitFor(() => expect(socket().types()).toContain("auth"));
    socket().receive({ type: "reject", reason: "This app speaks collaboration protocol 1." });
    expect(lastRecovery()).toBe("This app speaks collaboration protocol 1.");
  });

  it("reconnects after an unknown error and after a dropped socket", async () => {
    render(<Probe />);
    await joined();
    socket().receive({ type: "error", reason: "busy" });
    expect(lastRecovery()).toBe("Reconnecting to the shared document.");
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2), { timeout: 2000 });
  });

  it("retries when a token cannot be read", async () => {
    fake.token.mockRejectedValueOnce(new Error("offline"));
    render(<Probe />);
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1), { timeout: 2000 });
    expect(fake.token).toHaveBeenCalledTimes(2);
  });

  it("does not connect without a session", async () => {
    fake.session = null;
    render(<Probe />);
    await new Promise((r) => setTimeout(r, 10));
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("keeps edits a socket could not send and sends them after reconnecting", async () => {
    render(<Probe />);
    await joined();
    const doc = spies.onDoc.mock.calls.at(-1)![0] as Y.Doc;
    socket().failSend = true;
    act(() => doc.getText("t").insert(0, "x"));
    expect(lastRecovery()).toBe("1 edit is waiting to be stored.");
    expect(JSON.parse(sessionStorage.getItem("suiteleaf-room-queue:file-1")!)).toHaveLength(1);
    act(() => socket().close());
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2), { timeout: 2000 });
    await joined();
    expect(socket().types()).toContain("update");
  });

  it("rejoins when the tab becomes visible and reports activity", async () => {
    render(<Probe />);
    await joined();
    setVisibility("hidden");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown"));
    });
    expect(socket().types()).not.toContain("activity");
    setVisibility("visible");
    expect(socket().sent.at(-1)).toEqual({ type: "join", protocol: 1 });
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(socket().sent.at(-1)).toEqual({ type: "activity" });
  });

  it("reconnects when the tab becomes visible with no open socket", async () => {
    render(<Probe />);
    await joined();
    socket().receive({ type: "error", reason: "unauthorized" });
    setVisibility("visible");
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
  });

  it("drops the socket when offline and reconnects at once when online", async () => {
    render(<Probe />);
    await joined();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(lastRecovery()).toBeNull();
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(socket().readyState).toBe(FakeSocket.CLOSED);
    expect(lastRecovery()).toBe("Reconnecting to the shared document.");
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
  });

  it("closes and clears everything when the editor closes", async () => {
    const { unmount } = render(<Probe />);
    await joined();
    unmount();
    expect(socket().readyState).toBe(FakeSocket.CLOSED);
    expect(spies.onDoc).toHaveBeenLastCalledWith(null);
    expect(spies.onRecovery).toHaveBeenLastCalledWith(null);
    senders.selection.current(1, 1);
    expect(socket().types()).not.toContain("selection");
    await new Promise((r) => setTimeout(r, 300));
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("does not open a socket if the editor closed while the token was read", async () => {
    let release!: (token: string) => void;
    fake.token.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const { unmount } = render(<Probe />);
    unmount();
    release("token");
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeSocket.instances).toHaveLength(0);
  });
});

describe("live sheet and slide edits", () => {
  it("mirrors sheet cells and slide elements into the shared document", () => {
    const doc = new Y.Doc();
    mirrorLiveEdit(doc, "sheet", { workbook: { sheets: {}, sheetOrder: [] } }, null);
    mirrorLiveEdit(doc, "slide", { slides: {}, slideOrder: [] }, null);
    expect(doc.getMap("cells").size).toBe(0);
    expect(doc.getMap("slideElements").size).toBe(0);
  });
});
