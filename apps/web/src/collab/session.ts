import { useEffect, useRef } from "react";
import * as Y from "yjs";
import { editorCollaborator } from "../collaborator";
import { accessToken, getSession, type DriveRole } from "../node-client";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Join a SuiteDrive file. A second writer flips the document into the Yjs
 * room. Coming back to the tab sends the same join again. Nothing here tells
 * the person they were idle.
 */
export function useDocumentRoom({
  itemId,
  role,
  touch,
  log,
  onDoc,
  onSoloAgain,
}: {
  itemId?: string;
  role: DriveRole | "local" | null;
  touch: { current: { unit: string; key: string } };
  log?: { current: { by: { id: string; name: string }; at: string; unit: "paragraph" | "cell" | "slide" | "comment"; key: string }[] };
  onDoc: (doc: Y.Doc | null) => void;
  onSoloAgain: () => void;
}) {
  const onDocRef = useRef(onDoc);
  const onSoloRef = useRef(onSoloAgain);
  onDocRef.current = onDoc;
  onSoloRef.current = onSoloAgain;
  useEffect(() => {
    if (!itemId || role === "local" || role === "viewer" || role == null) {
      onDocRef.current(null);
      return;
    }
    const doc = new Y.Doc();
    let socket: WebSocket | null = null;
    let wasMulti = false;
    let closed = false;
    const send = (message: unknown) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      const point = touch.current;
      const at = new Date().toISOString();
      log?.current.push({
        by: editorCollaborator(),
        at,
        unit: point.unit === "cell" || point.unit === "slide" || point.unit === "comment" ? point.unit : "paragraph",
        key: point.key,
      });
      send({
        type: "update",
        update: bytesToBase64(update),
        unit: point.unit,
        key: point.key,
        at,
      });
    };
    doc.on("update", onUpdate);
    const connect = async () => {
      const session = getSession();
      if (!session || closed) return;
      const token = await accessToken();
      if (closed) return;
      const url = new URL(`/api/drive/items/${itemId}/session`, session.url);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("access_token", token);
      const next = new WebSocket(url);
      socket = next;
      next.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          mode?: "solo" | "multiuser";
          state?: string | null;
          update?: string;
        };
        if (message.type === "update" && message.update) {
          Y.applyUpdate(doc, base64ToBytes(message.update), "remote");
          return;
        }
        if (message.type !== "joined") return;
        if (message.state) Y.applyUpdate(doc, base64ToBytes(message.state), "remote");
        const multi = message.mode === "multiuser";
        if (wasMulti && !multi) onSoloRef.current();
        wasMulti = multi;
        onDocRef.current(multi ? doc : null);
        if (multi && !message.state) {
          send({
            type: "seed",
            update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
            unit: "paragraph",
            key: "0",
            at: new Date().toISOString(),
          });
        }
      };
    };
    void connect();
    const onVisible = () => {
      if (document.visibilityState === "visible") send({ type: "join" });
    };
    const onInteract = () => {
      if (document.visibilityState === "visible") send({ type: "activity" });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("keydown", onInteract);
    window.addEventListener("pointerdown", onInteract);
    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("keydown", onInteract);
      window.removeEventListener("pointerdown", onInteract);
      doc.off("update", onUpdate);
      socket?.close();
      onDocRef.current(null);
    };
  }, [itemId, role, touch]);
}

/** Keep sheet cells and slide elements in the shared Y.Doc while people edit together. */
export function mirrorLiveEdit(doc: Y.Doc, kind: "sheet" | "slide", content: unknown, op: unknown) {
  if (kind === "sheet") {
    const cells = doc.getMap<string>("cells");
    const mutations =
      op && typeof op === "object" && "mutations" in op && Array.isArray(op.mutations)
        ? (op.mutations as { id?: string; params?: unknown }[])
        : [];
    doc.transact(() => {
      for (const mutation of mutations) {
        const params = mutation.params as { range?: { startRow?: number; startColumn?: number }; cellValue?: unknown } | undefined;
        const row = params?.range?.startRow;
        const column = params?.range?.startColumn;
        const key =
          row != null && column != null ? `${row}:${column}` : mutation.id ?? "edit";
        cells.set(key, JSON.stringify(params?.cellValue ?? params ?? null));
      }
    });
    return;
  }
  const slides = doc.getMap<string>("slides");
  const change = (op ?? {}) as { added?: string[]; edited?: string[]; removed?: string[] };
  const deck = content as { slides?: Record<string, unknown> };
  doc.transact(() => {
    for (const id of [...(change.added ?? []), ...(change.edited ?? [])]) {
      if (deck.slides?.[id] != null) slides.set(id, JSON.stringify(deck.slides[id]));
    }
    for (const id of change.removed ?? []) slides.delete(id);
  });
}
