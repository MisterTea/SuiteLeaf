// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDB as fakeIndexedDB, IDBKeyRange } from "fake-indexeddb";
import { webcrypto } from "node:crypto";
import {
  cacheMail,
  cachedMail,
  setOfflineMail,
} from "../../apps/web/src/mail/offline";
import { mailCall } from "../../apps/web/src/mail/client";
vi.mock("../../apps/web/src/node-client", () => ({
  getSession: () => ({
    url: "https://suite.example",
    token: "offline-session",
  }),
}));
const session = { url: "https://suite.example", token: "offline-session" };
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("indexedDB", fakeIndexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("encrypted optional offline mail", () => {
  it("requires opt-in and isolates cached messages by server/session and UID validity", async () => {
    const request = {
      accountId: "a",
      folder: "INBOX",
      uidValidity: "42",
      uid: 9,
      action: "read",
    };
    await cacheMail(session, request, { text: "Private mail" });
    expect(await cachedMail(session, request)).toBeUndefined();
    await setOfflineMail(session, true);
    await cacheMail(session, request, { text: "Private mail" });
    expect(await cachedMail(session, request)).toEqual({
      text: "Private mail",
    });
    expect(
      await cachedMail({ ...session, token: "other" }, request),
    ).toBeUndefined();
    expect(
      await cachedMail(session, { ...request, uidValidity: "43" }),
    ).toBeUndefined();
    await cacheMail(
      session,
      { action: "send" },
      { text: "Never cache mutations" },
    );
    expect(await cachedMail(session, { action: "send" })).toBeUndefined();
    const db = await new Promise<IDBDatabase>((resolve) => {
      const open = indexedDB.open("SuiteLeafMailOffline", 1);
      open.onsuccess = () => resolve(open.result);
    });
    const rows = await new Promise<any[]>((resolve) => {
      const get = db.transaction("mail").objectStore("mail").getAll();
      get.onsuccess = () => resolve(get.result);
    });
    db.close();
    expect(JSON.stringify(rows)).not.toContain("Private mail");
    await setOfflineMail(session, false);
    await setOfflineMail(session, true);
    expect(await cachedMail(session, request)).toBeUndefined();
  });
  it("falls back only on network errors and never queues an offline mutation", async () => {
    await setOfflineMail(session, true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ text: "Cached body" })),
    );
    expect(await mailCall("read", { accountId: "a", uid: 9 })).toEqual({
      text: "Cached body",
    });
    const offline = vi.fn();
    window.addEventListener("suiteleaf:mail-offline", offline);
    vi.mocked(fetch).mockRejectedValue(new Error("Network offline"));
    expect(await mailCall("read", { accountId: "a", uid: 9 })).toEqual({
      text: "Cached body",
    });
    expect(offline).toHaveBeenCalled();
    await expect(mailCall("send", { accountId: "a" })).rejects.toThrow(
      "Network offline",
    );
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ error: "Session expired" }, { status: 401 }),
    );
    await expect(mailCall("read", { accountId: "a", uid: 9 })).rejects.toThrow(
      "Session expired",
    );
    window.removeEventListener("suiteleaf:mail-offline", offline);
  });
  it("expires old entries and tolerates unavailable storage", async () => {
    await setOfflineMail(session, true);
    await cacheMail(session, { action: "accounts" }, []);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31 * 86400000);
    expect(await cachedMail(session, { action: "accounts" })).toBeUndefined();
    vi.restoreAllMocks();
    vi.stubGlobal("indexedDB", undefined);
    await expect(setOfflineMail(session, false)).resolves.toBeUndefined();
    await expect(
      cacheMail(session, { action: "list" }, {}),
    ).resolves.toBeUndefined();
    expect(await cachedMail(session, { action: "list" })).toBeUndefined();
  });
  it("updates local opt-in only after preferences are saved", async () => {
    const enabled = vi.fn();
    window.addEventListener("suiteleaf:mail-offline-enabled", enabled);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ offline: true })),
    );
    await mailCall("savePreferences", { preferences: { offline: true } });
    expect(enabled).toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue(Response.json({ text: "Body" }));
    await mailCall("read", { uid: 19 });
    expect(await cachedMail(session, { uid: 19, action: "read" })).toEqual({
      text: "Body",
    });
    window.removeEventListener("suiteleaf:mail-offline-enabled", enabled);
  });
});
