// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasRoomChannel,
  openRoomChannel,
  roomPresence,
  ROOM_CHANNEL_CHANGED,
} from "../../apps/web/src/collab/room-channel";

afterEach(() => vi.useRealTimers());
describe("room notification channel", () => {
  it("reuses one socket request and delivers the response to all callers", async () => {
    const send = vi.fn();
    const channel = openRoomChannel("one", send);
    expect(hasRoomChannel("one")).toBe(true);
    const first = roomPresence("one", true);
    const second = roomPresence("one", true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0]![0])).toEqual({
      type: "presence",
      editing: true,
    });
    const people = [{ name: "Sam", editing: false, idle: false }];
    channel.receive(people);
    expect(await first).toEqual(people);
    expect(await second).toEqual(people);
    channel.close();
    expect(hasRoomChannel("one")).toBe(false);
    expect(await roomPresence("one", false)).toBeNull();
  });
  it("falls back when a socket stops responding or sending throws", async () => {
    vi.useFakeTimers();
    const channel = openRoomChannel("two", vi.fn());
    const request = roomPresence("two", false);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await request).toBeNull();
    expect(hasRoomChannel("two")).toBe(false);
    channel.close();
    const broken = openRoomChannel("two", () => {
      throw new Error("closed");
    });
    expect(await roomPresence("two", false)).toBeNull();
    broken.close();
  });
  it("does not let a stale socket remove its replacement", async () => {
    const old = openRoomChannel("three", vi.fn());
    const pending = roomPresence("three", true);
    const next = openRoomChannel("three", vi.fn());
    old.close();
    expect(await pending).toBeNull();
    expect(hasRoomChannel("three")).toBe(true);
    next.close();
  });
  it("announces connection changes and lets disconnect resolve pending work", async () => {
    const changed = vi.fn();
    window.addEventListener(ROOM_CHANNEL_CHANGED, changed);
    const channel = openRoomChannel("four", vi.fn());
    const pending = roomPresence("four", false);
    channel.close();
    expect(await pending).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
    window.removeEventListener(ROOM_CHANNEL_CHANGED, changed);
  });
});
