import { useEffect, useRef } from "react";
import * as Y from "yjs";
import { editorCollaborator } from "../collaborator";
import { accessToken, getSession, onSession, type DriveRole } from "../node-client";
import {
  OutboundQueue,
  documentRoomOpens,
  loadQueue,
  reconnectDelay,
  saveQueue,
  sessionUrl,
  type CollabUpdate,
} from "./connection";
import { authFailurePlan, joinMessage, roomRecoveryText, type RoomLink, type RoomStop } from "./recovery";
import { localSelectionMessage, remoteCaret, type RemoteCaret } from "./selection";
import { bindWaitingUndo } from "./waiting-undo";

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
 * room. A dropped socket reconnects with bounded backoff and sends the
 * updates that were made while it was down. The bearer token is the first
 * socket message, not part of the URL.
 */
export function useDocumentRoom({
  itemId,
  role,
  touch,
  log,
  onDoc,
  onSoloAgain,
  sendSelection,
  onCaret,
  onRecovery,
}: {
  itemId?: string;
  role: DriveRole | "local" | null;
  touch: { current: { unit: string; key: string } };
  log?: {
    current: {
      by: { id: string; name: string };
      at: string;
      unit: "paragraph" | "cell" | "slide" | "comment";
      key: string;
    }[];
  };
  onDoc: (doc: Y.Doc | null) => void;
  onSoloAgain: () => void;
  sendSelection?: { current: (anchor: number, head: number) => void };
  onCaret?: (caret: RemoteCaret) => void;
  onRecovery?: (text: string | null) => void;
}) {
  const onDocRef = useRef(onDoc);
  const onSoloRef = useRef(onSoloAgain);
  const onCaretRef = useRef(onCaret);
  const onRecoveryRef = useRef(onRecovery);
  onCaretRef.current = onCaret;
  onRecoveryRef.current = onRecovery;
  onDocRef.current = onDoc;
  onSoloRef.current = onSoloAgain;
  useEffect(() => {
    if (!itemId || !documentRoomOpens(role)) {
      onDocRef.current(null);
      onRecoveryRef.current?.(null);
      return;
    }
    const doc = new Y.Doc();
    const queue = new OutboundQueue();
    const roomStorage = (): Storage | null => {
      try {
        return sessionStorage;
      } catch {
        return null;
      }
    };
    const remember = () => {
      const storage = roomStorage();
      if (storage) saveQueue(storage, itemId, queue);
    };
    bindWaitingUndo(() => {
      const dropped = queue.dropLatestUpdate();
      if (dropped) remember();
      return dropped;
    });
    const storage = roomStorage();
    if (storage) loadQueue(storage, itemId, queue);
    let socket: WebSocket | null = null;
    let wasMulti = false;
    let closed = false;
    let giveUp = false;
    let pausedForSignIn = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let authed = false;
    let connecting = false;
    let link: RoomLink = "joining";
    let stop: RoomStop | undefined;
    const report = () => onRecoveryRef.current?.(roomRecoveryText(link, queue.length, stop));
    const publishSelection = (anchor: number, head: number) => {
      const message = localSelectionMessage(anchor, head);
      if (!message || socket?.readyState !== WebSocket.OPEN || !authed) return;
      socket.send(JSON.stringify(message));
    };
    if (sendSelection) sendSelection.current = publishSelection;
    const flush = () => {
      if (socket?.readyState !== WebSocket.OPEN || !authed) return;
      const current = socket;
      queue.drain((message) => {
        try {
          current.send(JSON.stringify(message));
          return true;
        } catch {
          return false;
        }
      });
    };
    const sendUpdate = (message: CollabUpdate) => {
      queue.push({ ...message, id: message.id || crypto.randomUUID() });
      remember();
      report();
      flush();
    };
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      const point = touch.current;
      const at = new Date().toISOString();
      log?.current.push({
        by: editorCollaborator(),
        at,
        unit:
          point.unit === "cell" || point.unit === "slide" || point.unit === "comment"
            ? point.unit
            : "paragraph",
        key: point.key,
      });
      sendUpdate({
        id: "",
        type: "update",
        update: bytesToBase64(update),
        unit: point.unit,
        key: point.key,
        at,
      });
    };
    doc.on("update", onUpdate);
    const schedule = () => {
      if (closed || giveUp) return;
      const delay = reconnectDelay(attempt);
      attempt += 1;
      timer = setTimeout(() => void connect(), delay);
    };
    const connect = async () => {
      const session = getSession();
      if (!session || closed || giveUp || connecting) return;
      link = attempt === 0 ? "joining" : "reconnecting";
      report();
      if (socket && socket.readyState !== WebSocket.CLOSED) return;
      connecting = true;
      let token: string;
      try {
        token = await accessToken();
      } catch {
        connecting = false;
        schedule();
        return;
      }
      if (closed || giveUp) {
        connecting = false;
        return;
      }
      const next = new WebSocket(sessionUrl(session.url, itemId));
      socket = next;
      connecting = false;
      authed = false;
      let seededThisSocket = false;
      next.onopen = () => {
        next.send(JSON.stringify({ type: "auth", accessToken: token, protocol: 1 }));
      };
      next.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          reason?: string;
          mode?: "solo" | "multiuser";
          state?: string | null;
          update?: string;
          id?: string;
        };
        if (message.type === "error") {
          const plan = authFailurePlan(message.reason ?? "");
          if (plan.stop) {
            giveUp = plan.giveUp;
            pausedForSignIn = plan.pauseForSignIn;
            link = "stopped";
            stop = plan.stop;
            report();
          }
          next.close();
          return;
        }
        if (message.type === "selection") {
          const caret = remoteCaret(message, editorCollaborator().name);
          if (caret) onCaretRef.current?.(caret);
          return;
        }
        if (
          message.type === "reject" &&
          message.reason === "This app speaks collaboration protocol 1."
        ) {
          giveUp = true;
          link = "stopped";
          stop = "version";
          report();
          next.close();
          return;
        }
        if ((message.type === "ack" || message.type === "reject") && message.id) {
          queue.settle(message.id);
          remember();
          report();
          return;
        }
        if (message.type === "update" && message.update) {
          Y.applyUpdate(doc, base64ToBytes(message.update), "remote");
          return;
        }
        if (message.type !== "joined") return;
        authed = true;
        attempt = 0;
        link = "open";
        if (message.state) Y.applyUpdate(doc, base64ToBytes(message.state), "remote");
        const multi = message.mode === "multiuser";
        if (wasMulti && !multi) onSoloRef.current();
        wasMulti = multi;
        onDocRef.current(multi ? doc : null);
        if (multi && !message.state && !seededThisSocket) {
          seededThisSocket = true;
          sendUpdate({
            id: "",
            type: "seed",
            update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
            unit: "paragraph",
            key: "0",
            at: new Date().toISOString(),
          });
        }
        flush();
        report();
      };
      next.onclose = () => {
        if (socket === next) socket = null;
        queue.release();
        authed = false;
        if (!closed && !giveUp && !pausedForSignIn) {
          link = "reconnecting";
          report();
          schedule();
        }
      };
    };
    void connect();
    const onVisible = () => {
      if (document.visibilityState !== "visible") {
        report();
        return;
      }
      if (socket?.readyState === WebSocket.OPEN && authed) {
        socket.send(JSON.stringify(joinMessage()));
        return;
      }
      void connect();
    };
    const onInteract = () => {
      if (document.visibilityState === "visible" && socket?.readyState === WebSocket.OPEN && authed)
        socket.send(JSON.stringify({ type: "activity" }));
    };
    const stopListen = onSession((next) => {
      if (!next || closed || giveUp || !pausedForSignIn) return;
      pausedForSignIn = false;
      stop = undefined;
      attempt = 0;
      link = "reconnecting";
      report();
      void connect();
    });
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("keydown", onInteract);
    window.addEventListener("pointerdown", onInteract);
    return () => {
      closed = true;
      stopListen();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("keydown", onInteract);
      window.removeEventListener("pointerdown", onInteract);
      doc.off("update", onUpdate);
      if (sendSelection) sendSelection.current = () => {};
      bindWaitingUndo(null);
      socket?.close();
      onDocRef.current(null);
      onRecoveryRef.current?.(null);
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
        const params = mutation.params as
          | { range?: { startRow?: number; startColumn?: number }; cellValue?: unknown }
          | undefined;
        const row = params?.range?.startRow;
        const column = params?.range?.startColumn;
        const key = row != null && column != null ? `${row}:${column}` : (mutation.id ?? "edit");
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
