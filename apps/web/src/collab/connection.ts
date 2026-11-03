/** Delays between collaboration reconnects. The last delay repeats. */
export const RECONNECT_DELAYS_MS = [200, 400, 800, 1_600, 3_200, 6_400] as const;

export function reconnectDelay(attempt: number): number {
  if (!Number.isFinite(attempt)) return RECONNECT_DELAYS_MS[0];
  const index = Math.min(Math.max(0, Math.floor(attempt)), RECONNECT_DELAYS_MS.length - 1);
  return RECONNECT_DELAYS_MS[index];
}

const ROOM_ROLES = new Set(["viewer", "commenter", "responder", "editor", "owner"]);

/** A viewer opens the room to receive text. A local file does not. */
export function documentRoomOpens(role: string | null): boolean {
  return role != null && ROOM_ROLES.has(role);
}

/** WebSocket URL for a SuiteDrive item. The bearer token is not a query parameter. */
export function sessionUrl(pageUrl: string, itemId: string): string {
  let url: URL;
  try {
    url = new URL(`/api/drive/items/${encodeURIComponent(itemId)}/session`, pageUrl);
  } catch {
    throw new Error("The collaboration address is not a web address.");
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export type CollabUpdate = {
  id: string;
  type: "update" | "seed";
  update: string;
  unit: string;
  key: string;
  at: string;
};

type QueuedUpdate = { message: CollabUpdate; sent: boolean };

/** Updates waiting for the node to store them. Sending does not remove one. */
export class OutboundQueue {
  private items: QueuedUpdate[] = [];

  push(message: CollabUpdate) {
    if (message.id && this.items.some((item) => item.message.id === message.id)) return;
    this.items.push({ message: { ...message }, sent: false });
  }

  get length(): number {
    return this.items.length;
  }

  /** Sends each update that has not been sent. A false return keeps the rest unsent. */
  drain(send: (message: CollabUpdate) => boolean) {
    let blocked = false;
    for (const item of this.items) {
      if (item.sent) continue;
      if (blocked || !send(item.message)) {
        blocked = true;
        continue;
      }
      item.sent = true;
    }
  }

  /** Drops an update the node stored or refused. */
  settle(id: string) {
    this.items = this.items.filter((item) => item.message.id !== id);
  }

  /** A dropped socket sends these again. */
  release() {
    for (const item of this.items) item.sent = false;
  }

  /** Copies of the updates still waiting. The queue is not changed. */
  pending(): CollabUpdate[] {
    return this.items.map((item) => ({ ...item.message }));
  }

  /**
   * Drop the newest edit that has not been handed to the socket. A seed stays.
   * An update already sent stays until the node settles it. The bytes are not returned.
   */
  dropLatestUpdate(): boolean {
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      if (!item || item.sent || item.message.type !== "update") continue;
      this.items.splice(index, 1);
      return true;
    }
    return false;
  }

  /** Replace the waiting updates. Each one is unsent. The list passed in is not changed. */
  load(messages: readonly CollabUpdate[]) {
    const items: { message: CollabUpdate; sent: boolean }[] = [];
    for (const message of messages) {
      if (message.id && items.some((item) => item.message.id === message.id)) continue;
      items.push({ message: { ...message }, sent: false });
    }
    this.items = items;
  }
}

function queueKey(itemId: string): string {
  return `suiteleaf-room-queue:${itemId}`;
}

function storedUpdate(value: unknown): CollabUpdate | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Partial<CollabUpdate>;
  if (typeof message.id !== "string" || !message.id) return null;
  if (message.type !== "update" && message.type !== "seed") return null;
  if (typeof message.update !== "string") return null;
  return {
    id: message.id,
    type: message.type,
    update: message.update,
    unit: typeof message.unit === "string" ? message.unit : "paragraph",
    key: typeof message.key === "string" ? message.key : "0",
    at: typeof message.at === "string" ? message.at : "",
  };
}

/** Write the waiting updates. A later page load can send them again. */
export function saveQueue(storage: Storage, itemId: string, queue: OutboundQueue) {
  storage.setItem(queueKey(itemId), JSON.stringify(queue.pending()));
}

/**
 * Read waiting updates into an empty queue. A stored value that is not a list
 * is removed. This does not throw that value.
 */
export function loadQueue(storage: Storage, itemId: string, queue: OutboundQueue): number {
  const key = queueKey(itemId);
  const raw = storage.getItem(key);
  if (!raw) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    storage.removeItem(key);
    return 0;
  }
  if (!Array.isArray(parsed)) {
    storage.removeItem(key);
    return 0;
  }
  const messages = parsed.flatMap((item) => {
    const message = storedUpdate(item);
    return message ? [message] : [];
  });
  queue.load(messages);
  return queue.length;
}
