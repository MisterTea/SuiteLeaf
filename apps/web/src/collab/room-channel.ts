import type { FilePresence } from "../node-client";

export const ROOM_CHANNEL_CHANGED = "suiteleaf:room-channel-changed";
export const ROOM_FILE_CHANGED = "suiteleaf:room-file-changed";
type Channel = {
  presence: (editing: boolean) => Promise<FilePresence[] | null>;
};
const channels = new Map<string, Channel>();

export const hasRoomChannel = (id: string) => channels.has(id);
export const roomPresence = (id: string, editing: boolean) =>
  channels.get(id)?.presence(editing) ?? Promise.resolve(null);

/** Only registered after the server advertises support. Older servers and
 * disconnected/timed-out sockets retain the HTTP fallback. */
export function openRoomChannel(id: string, send: (message: string) => void) {
  let pending:
    | {
        promise: Promise<FilePresence[] | null>;
        resolve: (people: FilePresence[] | null) => void;
      }
    | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const settle = (people: FilePresence[] | null) => {
    clearTimeout(timer);
    pending?.resolve(people);
    pending = undefined;
  };
  const close = () => {
    closed = true;
    settle(null);
    if (channels.get(id) === channel) {
      channels.delete(id);
      window.dispatchEvent(new Event(ROOM_CHANNEL_CHANGED));
    }
  };
  const channel: Channel = {
    presence: (editing) => {
      if (closed) return Promise.resolve(null);
      if (pending) return pending.promise;
      let resolve!: (people: FilePresence[] | null) => void;
      const promise = new Promise<FilePresence[] | null>((done) => {
        resolve = done;
      });
      pending = { promise, resolve };
      timer = setTimeout(close, 8000);
      try {
        send(JSON.stringify({ type: "presence", editing }));
      } catch {
        close();
      }
      return promise;
    },
  };
  channels.set(id, channel);
  window.dispatchEvent(new Event(ROOM_CHANNEL_CHANGED));
  return { close, receive: settle };
}
