import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentAuthor,
  localName,
  onAuthorChange,
  setLocalName,
} from "../apps/web/src/identity";

describe("comment author identity", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });

  it("keeps one local identity and shows 'You' until a name is chosen", () => {
    const first = currentAuthor();
    expect(first).toMatchObject({ name: "You", signature: "" });
    expect(currentAuthor().id).toBe(first.id);
  });

  it("signs comments with the chosen name and notifies listeners", () => {
    const listener = vi.fn();
    const stop = onAuthorChange(listener);
    setLocalName("  Alex Rivera  ");
    stop();
    expect(listener).toHaveBeenCalledOnce();
    expect(localName()).toBe("Alex Rivera");
    expect(currentAuthor()).toMatchObject({
      name: "Alex Rivera",
      signature: "Alex Rivera",
    });
    setLocalName("");
    expect(currentAuthor()).toMatchObject({ name: "You", signature: "" });
  });

  it("prefers the signed-in account over the local name", () => {
    setLocalName("Alex");
    expect(
      currentAuthor({ id: "u1", name: "", username: "jordan" }),
    ).toEqual({ id: "user-u1", name: "jordan", signature: "jordan" });
  });
});
