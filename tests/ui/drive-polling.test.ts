// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { visiblePoll } from "../../apps/web/src/drive/visible-poll";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../apps/web/src/node-client", () => ({ drive: { get } }));
import { observeItem } from "../../apps/web/src/drive/observe-item";
import { DRIVE_SAVED } from "../../apps/web/src/drive/last-edit";
import {
  openRoomChannel,
  ROOM_FILE_CHANGED,
} from "../../apps/web/src/collab/room-channel";

const stops: (() => void)[] = [];
let hidden = false;
let online = true;
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  online = true;
  get.mockReset().mockResolvedValue({ id: "one" });
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible",
  );
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("visible polling", () => {
  it("waits for completion and never overlaps a slow request, even on focus", async () => {
    let finish!: () => void;
    const work = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    stops.push(visiblePoll(work, 1000));
    await tick(10_000);
    window.dispatchEvent(new Event("focus"));
    expect(work).toHaveBeenCalledTimes(1);
    finish();
    await tick(999);
    expect(work).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("suspends hidden and offline pages and refreshes immediately on return", async () => {
    hidden = true;
    const work = vi.fn(async () => {});
    stops.push(visiblePoll(work, 1000));
    await tick(10_000);
    expect(work).not.toHaveBeenCalled();
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await tick();
    expect(work).toHaveBeenCalledTimes(1);
    online = false;
    window.dispatchEvent(new Event("offline"));
    await tick(10_000);
    expect(work).toHaveBeenCalledTimes(1);
    online = true;
    window.dispatchEvent(new Event("online"));
    await tick();
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("backs off failures, caps retries and resets after recovery", async () => {
    const work = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("offline"));
    stops.push(visiblePoll(work, 1000));
    await tick();
    await tick(1999);
    expect(work).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(work).toHaveBeenCalledTimes(2);
    await tick(4000 + 8000 + 16000 + 32000 + 60000 + 60000);
    expect(work).toHaveBeenCalledTimes(8);
    work.mockResolvedValue();
    await tick(60_000);
    expect(work).toHaveBeenCalledTimes(9);
    await tick(1000);
    expect(work).toHaveBeenCalledTimes(10);
  });

  it("queues one invalidation during a request and cleans up every trigger", async () => {
    let finish!: () => void;
    const work = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = visiblePoll(work, 1000, {
      immediate: false,
      events: [DRIVE_SAVED],
    });
    stops.push(stop);
    await tick(999);
    expect(work).not.toHaveBeenCalled();
    await tick(1);
    window.dispatchEvent(new Event(DRIVE_SAVED));
    window.dispatchEvent(new Event(DRIVE_SAVED));
    finish();
    await tick();
    expect(work).toHaveBeenCalledTimes(2);
    stop();
    finish();
    await tick(60_000);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event(DRIVE_SAVED));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("does not run a queued invalidation after the page becomes hidden", async () => {
    let finish!: () => void;
    const work = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    stops.push(visiblePoll(work, 1000, { events: [DRIVE_SAVED] }));
    window.dispatchEvent(new Event(DRIVE_SAVED));
    hidden = true;
    finish();
    await tick(60_000);
    expect(work).toHaveBeenCalledTimes(1);
  });
});

describe("shared item observation", () => {
  it("uses socket notifications with a slow fallback, then resumes fast polling on disconnect", async () => {
    stops.push(observeItem("live", vi.fn()));
    await tick();
    const channel = openRoomChannel("live", vi.fn());
    stops.push(channel.close);
    await tick();
    expect(get).toHaveBeenCalledTimes(2);
    await tick(29_999);
    expect(get).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event(ROOM_FILE_CHANGED));
    await tick();
    expect(get).toHaveBeenCalledTimes(3);
    channel.close();
    await tick();
    expect(get).toHaveBeenCalledTimes(4);
    await tick(2000);
    expect(get).toHaveBeenCalledTimes(5);
  });
  it("shares a read across subscribers and stops when the last subscriber leaves", async () => {
    const author = vi.fn();
    const version = vi.fn();
    const stopAuthor = observeItem("one", author);
    const stopVersion = observeItem("one", version);
    stops.push(stopAuthor, stopVersion);
    await tick();
    expect(get).toHaveBeenCalledTimes(1);
    expect(author).toHaveBeenCalledWith({ id: "one" });
    expect(version).toHaveBeenCalledWith({ id: "one" });
    stopAuthor();
    get.mockResolvedValue({ id: "one", headVersionId: "v2" });
    await tick(2000);
    expect(author).toHaveBeenCalledTimes(1);
    expect(version).toHaveBeenCalledTimes(2);
    stopVersion();
    await tick(10_000);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("refreshes on local saves and drops results after unsubscription", async () => {
    let finish!: (item: { id: string }) => void;
    get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const listener = vi.fn();
    const stop = observeItem("one", listener);
    stops.push(stop);
    stop();
    finish({ id: "one" });
    await tick();
    expect(listener).not.toHaveBeenCalled();
    stops.push(observeItem("one", listener, false));
    window.dispatchEvent(new Event(DRIVE_SAVED));
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
