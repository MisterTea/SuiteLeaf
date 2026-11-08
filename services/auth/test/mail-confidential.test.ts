import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  confidentialCommand,
  confidentialRequest,
  readConfidential,
} from "../src/mail/confidential";
import { account, memoryStore } from "./mail-support";
const fake = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../src/mail/service", () => ({ mailCommand: fake.send }));
let db: ReturnType<typeof memoryStore>;
const message = {
  to: "lin@example.com",
  bcc: "hidden@example.com",
  subject: "Private report",
  text: "Private body",
  html: "<p>Private body</p>",
  attachments: [
    { filename: "note.txt", contentType: "text/plain", content: "aGk=" },
  ],
};
beforeEach(async () => {
  db = memoryStore();
  vi.stubEnv("SUITELEAF_PUBLIC_URL", "https://suite.example");
  await db.store.put("ada", account);
  fake.send.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function send() {
  const result = (await confidentialCommand(
    db.store,
    "ada",
    account,
    "confidentialSend",
    {
      message,
      passcode: "separate-passcode",
      expiresAt: new Date(Date.now() + 2 * 86400000).toISOString(),
    },
  )) as any;
  return {
    ...result,
    token: decodeURIComponent(result.link.split("/confidential/")[1]),
  };
}
describe("expiring passcode-protected message links", () => {
  it("stores content encrypted, emails only a link and unlocks safe message data", async () => {
    const result = await send();
    const sent = fake.send.mock.calls[0][2].message;
    expect(sent.text).toContain(result.link);
    expect(sent.text).not.toContain("Private body");
    expect(sent.text).not.toContain("separate-passcode");
    expect(sent.bcc).toBe("hidden@example.com");
    expect(JSON.stringify([...db.rows.values()])).not.toContain("Private body");
    const viewed = await readConfidential(db.store, {
      token: result.token,
      passcode: "separate-passcode",
    });
    expect(viewed).toMatchObject({
      subject: "Private report",
      text: "Private body",
      attachments: [{ filename: "note.txt", index: 0 }],
    });
    expect(viewed).not.toHaveProperty("bcc");
    expect(viewed).not.toHaveProperty("hash");
    expect(
      await readConfidential(db.store, {
        token: result.token,
        passcode: "separate-passcode",
        index: 0,
      }),
    ).toEqual(message.attachments[0]);
    expect(
      await readConfidential(db.store, {
        token: result.token,
        passcode: "separate-passcode",
        check: true,
      }),
    ).toMatchObject({ ok: true });
    const items = (await confidentialCommand(
      db.store,
      "ada",
      account,
      "confidentialItems",
      {},
    )) as any[];
    expect(items[0]).toMatchObject({
      subject: "Private report",
      state: "active",
    });
    await expect(
      confidentialCommand(db.store, "other", account, "revokeConfidential", {
        key: items[0].key,
      }),
    ).rejects.toThrow("Invalid");
    await confidentialCommand(db.store, "ada", account, "revokeConfidential", {
      key: items[0].key,
    });
    await expect(
      readConfidential(db.store, {
        token: result.token,
        passcode: "separate-passcode",
      }),
    ).rejects.toThrow("Access denied");
  });
  it("rejects expired, revoked, missing, malformed and banned-owner access and limits guesses", async () => {
    const result = await send();
    await expect(
      readConfidential(db.store, { token: result.token, passcode: "wrong" }),
    ).rejects.toThrow("Access denied");
    await expect(
      readConfidential(db.store, {
        token: result.token,
        passcode: "separate-passcode",
        index: 99,
      }),
    ).rejects.toThrow("Access denied");
    for (let i = 0; i < 9; i++)
      await expect(
        readConfidential(db.store, { token: result.token, passcode: "wrong" }),
      ).rejects.toThrow("Access denied");
    await expect(
      readConfidential(db.store, {
        token: result.token,
        passcode: "separate-passcode",
      }),
    ).rejects.toThrow("Access denied");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60000);
    expect(
      await readConfidential(db.store, {
        token: result.token,
        passcode: "separate-passcode",
      }),
    ).toMatchObject({ subject: "Private report" });
    vi.restoreAllMocks();
    db.rows.set("user:ada", { id: "ada", banned: 1 });
    await expect(
      readConfidential(db.store, {
        token: result.token,
        passcode: "separate-passcode",
      }),
    ).rejects.toThrow("Access denied");
    db.rows.set("user:ada", { id: "ada", banned: 0 });
    const expired = db.store.seal({
      user: "ada",
      accountId: "a",
      key: "expired",
      expiresAt: 0,
    });
    await expect(
      readConfidential(db.store, { token: expired, passcode: "x" }),
    ).rejects.toThrow("Access denied");
    await expect(
      readConfidential(db.store, { token: 3, passcode: "x" }),
    ).rejects.toThrow("Access denied");
    await expect(
      readConfidential(db.store, {
        token: result.token,
        passcode: "x".repeat(129),
      }),
    ).rejects.toThrow("Access denied");
    await db.store.remove("ada", "a");
    await expect(
      readConfidential(db.store, {
        token: result.token,
        passcode: "separate-passcode",
      }),
    ).rejects.toThrow("Access denied");
  });
  it("validates secure delivery settings and reports cleanup errors without resending", async () => {
    await expect(
      confidentialCommand(db.store, "ada", account, "bad", {}),
    ).rejects.toThrow("Unknown");
    vi.stubEnv("SUITELEAF_PUBLIC_URL", "http://suite.example");
    await expect(send()).rejects.toThrow("HTTPS");
    vi.stubEnv("SUITELEAF_PUBLIC_URL", "https://suite.example");
    await expect(
      confidentialCommand(db.store, "ada", account, "confidentialSend", {
        message,
        passcode: "short",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    ).rejects.toThrow("passcode");
    await expect(
      confidentialCommand(db.store, "ada", account, "confidentialSend", {
        message,
        passcode: "passcode",
        expiresAt: "invalid",
      }),
    ).rejects.toThrow("expiry");
    fake.send
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("draft cleanup failed"));
    expect(
      await confidentialCommand(db.store, "ada", account, "confidentialSend", {
        message,
        passcode: "passcode",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        draftRef: { folder: "Drafts", uidValidity: "42", uid: 9 },
      }),
    ).toMatchObject({
      ok: true,
      warning: expect.stringContaining("previous provider draft"),
    });
  });
  it("protects the public HTTP boundary without requiring a SuiteLeaf session", async () => {
    const result = await send();
    const request = async (
      body: unknown,
      method = "POST",
      type = "application/json",
    ) => {
      const req = Object.assign(
        Readable.from([typeof body === "string" ? body : JSON.stringify(body)]),
        { method, headers: { "content-type": type } },
      );
      const res = { writeHead: vi.fn(), end: vi.fn() };
      await confidentialRequest(
        req as IncomingMessage,
        res as unknown as ServerResponse,
        db.store,
      );
      return {
        status: res.writeHead.mock.calls[0][0],
        headers: res.writeHead.mock.calls[0][1],
        body: JSON.parse(res.end.mock.calls[0][0]),
      };
    };
    expect((await request({}, "GET")).status).toBe(405);
    expect((await request({}, "POST", "text/plain")).status).toBe(405);
    expect((await request("x".repeat(64001))).status).toBe(413);
    expect((await request("not json")).status).toBe(403);
    const opened = await request({
      token: result.token,
      passcode: "separate-passcode",
    });
    expect(opened.status).toBe(200);
    expect(opened.headers["cache-control"]).toBe("no-store");
    expect(opened.body.text).toBe("Private body");
  });
});
