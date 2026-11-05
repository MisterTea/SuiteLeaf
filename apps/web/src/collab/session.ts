import { useEffect, useRef } from "react";
import * as Y from "yjs";

/** Docs asked to copy the open file into an empty room. This stays off the Y.Doc so later updates do not depend on it. */
const seeders = new WeakSet<Y.Doc>();

export function markSeedDocument(doc: Y.Doc): void {
  seeders.add(doc);
}

export function shouldSeedDocument(doc: Y.Doc): boolean {
  return seeders.has(doc);
}
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
import { noteUnackedEdits } from "../save-state";
import {
  RENEW_TOKEN_EVERY_MS,
  authFailurePlan,
  authMessage,
  joinMessage,
  roomRecoveryText,
  type RoomLink,
  type RoomStop,
} from "./recovery";
import {
  localSelectionMessage,
  localSheetSelectionMessage,
  localSlideSelectionMessage,
  remoteCaret,
  remoteSheetSelection,
  remoteSlideSelection,
  type RemoteCaret,
  type RemoteSheetSelection,
  type RemoteSlideSelection,
  type SheetSelection,
  type SlideSelection,
} from "./selection";
import { mirrorSheetCells } from "./sheet-cells";
import { noteSheetEdit } from "./sheet-undo";
import { mirrorSlides } from "./slide-room";
import { noteSlideEdit } from "./slide-undo";
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
  sendSheetSelection,
  sendSlideSelection,
  onCaret,
  onSheetSelection,
  onSlideSelection,
  onRecovery,
  onStranded,
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
  sendSheetSelection?: { current: (selection: SheetSelection) => void };
  sendSlideSelection?: { current: (selection: SlideSelection) => void };
  onCaret?: (caret: RemoteCaret) => void;
  onSheetSelection?: (selection: RemoteSheetSelection) => void;
  onSlideSelection?: (selection: RemoteSlideSelection) => void;
  onRecovery?: (text: string | null) => void;
  /**
   * Edits made on this device that the room can no longer store, because the
   * room moved to another generation while they waited. The caller keeps them.
   */
  onStranded?: (edits: number) => void;
}) {
  const onDocRef = useRef(onDoc);
  const onSoloRef = useRef(onSoloAgain);
  const onCaretRef = useRef(onCaret);
  const onSheetSelectionRef = useRef(onSheetSelection);
  const onSlideSelectionRef = useRef(onSlideSelection);
  const onRecoveryRef = useRef(onRecovery);
  const onStrandedRef = useRef(onStranded);
  onStrandedRef.current = onStranded;
  onCaretRef.current = onCaret;
  onSheetSelectionRef.current = onSheetSelection;
  onSlideSelectionRef.current = onSlideSelection;
  onRecoveryRef.current = onRecovery;
  onDocRef.current = onDoc;
  onSoloRef.current = onSoloAgain;
  useEffect(() => {
    if (!itemId || !documentRoomOpens(role)) {
      onDocRef.current(null);
      onRecoveryRef.current?.(null);
      return;
    }
    let doc = new Y.Doc();
    /** The room generation from the latest joined message. */
    let generation: number | null = null;
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
    /** The token this socket last signed in with. A renewal sends only a different one. */
    let sentToken: string | null = null;
    let link: RoomLink = "joining";
    let stop: RoomStop | undefined;
    const report = () => {
      noteUnackedEdits(queue.length);
      onRecoveryRef.current?.(roomRecoveryText(link, queue.length, stop));
    };
    const publishSelection = (anchor: number, head: number) => {
      const message = localSelectionMessage(anchor, head);
      if (!message || socket?.readyState !== WebSocket.OPEN || !authed) return;
      socket.send(JSON.stringify(message));
    };
    if (sendSelection) sendSelection.current = publishSelection;
    const publishSheetSelection = (selection: SheetSelection) => {
      const message = localSheetSelectionMessage(selection);
      if (!message || socket?.readyState !== WebSocket.OPEN || !authed) return;
      socket.send(JSON.stringify(message));
    };
    if (sendSheetSelection) sendSheetSelection.current = publishSheetSelection;
    const publishSlideSelection = (selection: SlideSelection) => {
      const message = localSlideSelectionMessage(selection);
      if (!message || socket?.readyState !== WebSocket.OPEN || !authed) return;
      socket.send(JSON.stringify(message));
    };
    if (sendSlideSelection) sendSlideSelection.current = publishSlideSelection;
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
      const message: CollabUpdate = {
        id: "",
        type: "update",
        update: bytesToBase64(update),
        unit: point.unit,
        key: point.key,
        at,
      };
      if (generation !== null) message.generation = generation;
      sendUpdate(message);
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
        sentToken = token;
        next.send(JSON.stringify(authMessage(token)));
      };
      next.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          reason?: string;
          mode?: "solo" | "multiuser";
          state?: string | null;
          update?: string;
          id?: string;
          seed?: boolean;
          generation?: number;
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
          const slide = remoteSlideSelection(message, editorCollaborator().name);
          if (slide) onSlideSelectionRef.current?.(slide);
          const sheet = remoteSheetSelection(message, editorCollaborator().name);
          if (sheet) onSheetSelectionRef.current?.(sheet);
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
        if (message.type === "renewed") return;
        if ((message.type === "ack" || message.type === "reject") && message.id) {
          queue.settle(message.id);
          remember();
          report();
          if (message.type === "reject" && message.reason === "stale") onStrandedRef.current?.(1);
          return;
        }
        if (message.type === "update" && message.update) {
          Y.applyUpdate(doc, base64ToBytes(message.update), "remote");
          if (doc.getXmlFragment("prosemirror").length > 0) onDocRef.current(doc);
          return;
        }
        if (message.type !== "joined") return;
        authed = true;
        attempt = 0;
        link = "open";
        const joinedIn = Number.isSafeInteger(message.generation) ? (message.generation as number) : null;
        if (joinedIn !== null && generation !== null && joinedIn !== generation) {
          // The room was written to the file and started again. Its document is
          // built from a new log, so this device starts a new copy instead of
          // merging the old one into it.
          const stranded = queue.dropOtherGenerations(joinedIn);
          remember();
          doc.off("update", onUpdate);
          doc = new Y.Doc();
          doc.on("update", onUpdate);
          if (stranded > 0) onStrandedRef.current?.(stranded);
        }
        if (joinedIn !== null) generation = joinedIn;
        if (message.state) Y.applyUpdate(doc, base64ToBytes(message.state), "remote");
        const multi = message.mode === "multiuser";
        if (wasMulti && !multi) onSoloRef.current();
        wasMulti = multi;
        if (multi && message.seed && !seededThisSocket) {
          seededThisSocket = true;
          markSeedDocument(doc);
        }
        onDocRef.current(multi ? doc : null);
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
    /** Send a fresh token on the open socket before the node's recheck refuses the old one. */
    const renew = async () => {
      const current = socket;
      if (!current || current.readyState !== WebSocket.OPEN || !authed || closed) return;
      let token: string;
      try {
        token = await accessToken();
      } catch {
        return;
      }
      if (token === sentToken || socket !== current || current.readyState !== WebSocket.OPEN) return;
      sentToken = token;
      current.send(JSON.stringify(authMessage(token)));
    };
    const renewTimer = setInterval(() => void renew(), RENEW_TOKEN_EVERY_MS);
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
    const onOffline = () => {
      if (closed || giveUp || pausedForSignIn) return;
      link = "reconnecting";
      report();
      socket?.close();
    };
    const onOnline = () => {
      if (closed || giveUp || pausedForSignIn) return;
      if (socket?.readyState === WebSocket.OPEN && authed) {
        link = "open";
        report();
        return;
      }
      clearTimeout(timer);
      attempt = 0;
      void connect();
    };
    const stopListen = onSession((next) => {
      if (!next || closed || giveUp) return;
      if (!pausedForSignIn) {
        void renew();
        return;
      }
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
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      closed = true;
      stopListen();
      clearTimeout(timer);
      clearInterval(renewTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("keydown", onInteract);
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      doc.off("update", onUpdate);
      if (sendSelection) sendSelection.current = () => {};
      if (sendSheetSelection) sendSheetSelection.current = () => {};
      if (sendSlideSelection) sendSlideSelection.current = () => {};
      bindWaitingUndo(null);
      noteUnackedEdits(0);
      socket?.close();
      onDocRef.current(null);
      onRecoveryRef.current?.(null);
    };
  }, [itemId, role, touch]);
}

/** Keep sheet cells and slide elements in the shared Y.Doc while people edit together. */
export function mirrorLiveEdit(doc: Y.Doc, kind: "sheet" | "slide", content: unknown, op: unknown) {
  if (kind === "sheet") {
    const before = new Map(doc.getMap<string>("cells").entries());
    mirrorSheetCells(doc, op, content);
    noteSheetEdit(doc, before, new Map(doc.getMap<string>("cells").entries()));
    return;
  }
  const beforeElements = new Map(doc.getMap<string>("slideElements").entries());
  const beforeSlides = new Map(doc.getMap<string>("slides").entries());
  mirrorSlides(doc, content, op);
  noteSlideEdit(
    doc,
    beforeElements,
    new Map(doc.getMap<string>("slideElements").entries()),
    beforeSlides,
    new Map(doc.getMap<string>("slides").entries()),
  );
}
