// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { useDocumentRoom } from "../../apps/web/src/collab/session";

vi.mock("../../apps/web/src/node-client", () => ({
  getSession: () => ({
    url: "http://127.0.0.1:8787",
    user: { id: "maya", name: "Maya" },
  }),
  accessToken: async () => "token-not-shown",
  onSession: () => () => {},
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
  sent: string[] = [];

  constructor(public url: string) {
    FakeSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    });
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
}

function joinedState(): string {
  const doc = new Y.Doc();
  doc.getText("paragraphs").insert(0, "Tomatoes are in");
  const bytes = Y.encodeStateAsUpdate(doc);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function Probe({ onDoc }: { onDoc: (doc: Y.Doc | null) => void }) {
  const [notice, setNotice] = useState<string | null>(null);
  const touch = useRef({ unit: "paragraph", key: "0" });
  useDocumentRoom({
    itemId: "file-1",
    role: "editor",
    touch,
    onDoc,
    onSoloAgain: () => {},
    onRecovery: setNotice,
  });
  return <p role="status">{notice}</p>;
}

afterEach(() => {
  cleanup();
  FakeSocket.instances = [];
  vi.unstubAllGlobals();
  try {
    sessionStorage.clear();
  } catch {
    // This test environment has no session storage.
  }
});

it("keeps a waiting edit when the tab is hidden and sends it after reconnect", async () => {
  vi.stubGlobal("WebSocket", FakeSocket);
  let doc: Y.Doc | null = null;
  render(<Probe onDoc={(next) => (doc = next)} />);
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  const first = FakeSocket.instances[0];
  await vi.waitFor(() => expect(first.sent.some((line) => line.includes('"type":"auth"'))).toBe(true));
  expect(first.url).not.toContain("token-not-shown");
  first.onmessage?.({
    data: JSON.stringify({ type: "joined", mode: "multiuser", state: joinedState() }),
  });
  await vi.waitFor(() => expect(doc).not.toBeNull());
  doc!.getText("paragraphs").insert(0, "secret-value");
  await vi.waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("1 edit is waiting to be stored."),
  );
  expect(screen.getByRole("status").textContent).not.toContain("secret-value");
  const saved = sessionStorage.getItem("suiteleaf-room-queue:file-1");
  expect(JSON.parse(saved ?? "[]")).toHaveLength(1);
  expect(saved).not.toContain("token-not-shown");
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(screen.getByRole("status").textContent).toBe("1 edit is waiting to be stored.");
  first.close();
  await vi.waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(
      "Reconnecting. 1 edit is still on this device.",
    ),
  );
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
  const second = FakeSocket.instances[1];
  await vi.waitFor(() => expect(second.sent.some((line) => line.includes('"type":"auth"'))).toBe(true));
  second.onmessage?.({
    data: JSON.stringify({ type: "joined", mode: "multiuser", state: joinedState() }),
  });
  await vi.waitFor(() =>
    expect(second.sent.some((line) => line.includes('"type":"update"'))).toBe(true),
  );
  expect(screen.getByRole("status").textContent).not.toContain("secret-value");
  expect(screen.getByRole("status").textContent).not.toContain("token-not-shown");
});

it("stops and asks for a sign-in when the room refuses the token", async () => {
  vi.stubGlobal("WebSocket", FakeSocket);
  render(<Probe onDoc={() => undefined} />);
  await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  const first = FakeSocket.instances[0];
  await vi.waitFor(() => expect(first.sent.some((line) => line.includes('"type":"auth"'))).toBe(true));
  first.onmessage?.({ data: JSON.stringify({ type: "error", reason: "unauthorized" }) });
  await vi.waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(
      "Sign in again to open the shared document.",
    ),
  );
  expect(screen.getByRole("status").textContent).not.toContain("token-not-shown");
  expect(FakeSocket.instances).toHaveLength(1);
});
