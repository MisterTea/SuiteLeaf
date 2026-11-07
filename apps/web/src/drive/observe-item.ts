import { drive, type DriveItem } from "../node-client";
import { DRIVE_SAVED } from "./last-edit";
import { visiblePoll } from "./visible-poll";
import {
  hasRoomChannel,
  ROOM_CHANNEL_CHANGED,
  ROOM_FILE_CHANGED,
} from "../collab/room-channel";

type Listener = (item: DriveItem) => void | Promise<void>;
type Observer = { listeners: Set<Listener>; stop: () => void };
const observers = new Map<string, Observer>();

/** Share one metadata request between the editor's version watcher and author
 * label. Never cache an authoritative read used to resolve a save conflict. */
export function observeItem(id: string, listener: Listener, immediate = true) {
  let observer = observers.get(id);
  if (!observer) {
    observer = { listeners: new Set(), stop: () => {} };
    observers.set(id, observer);
    const current = observer;
    // Start after registering the first listener, including synchronously mocked APIs.
    current.listeners.add(listener);
    current.stop = visiblePoll(
      async () => {
        const item = await drive.get(id);
        await Promise.all([...current.listeners].map((notify) => notify(item)));
      },
      () => (hasRoomChannel(id) ? 30_000 : 2000),
      {
        immediate,
        events: [DRIVE_SAVED, ROOM_CHANNEL_CHANGED, ROOM_FILE_CHANGED],
      },
    );
  } else observer.listeners.add(listener);
  const current = observer;
  return () => {
    current.listeners.delete(listener);
    if (!current.listeners.size && observers.get(id) === current) {
      current.stop();
      observers.delete(id);
    }
  };
}
