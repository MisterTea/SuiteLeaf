import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser } from "mailparser";
import {
  mailCommand,
  mailDependencies,
  mailSearch,
  withMailbox,
} from "../src/mail/service";
import { MailStore } from "../src/mail/store";
import {
  publicAccount,
  validateAccount,
  validateCompose,
  type MailAccount,
} from "../src/mail/types";
import { mailRequest } from "../src/mail/http";
import type { IncomingMessage, ServerResponse } from "node:http";

const endpoint = {
  host: "mail.example.com",
  port: 993,
  secure: true,
  user: "ada",
  password: "secret",
};
const account: MailAccount = {
  id: "a",
  name: "Ada",
  email: "ada@example.com",
  signature: "Regards",
  imap: endpoint,
  smtp: { ...endpoint, port: 587, secure: false },
};
const base = { folder: "INBOX", uidValidity: "42", uids: [9] };
const compose = {
  to: "lin@example.com",
  cc: "cc@example.com",
  bcc: "hidden@example.com",
  subject: "Hello",
  text: "Body",
  attachments: [
    { filename: "note.txt", contentType: "text/plain", content: "aGVsbG8=" },
  ],
};
let imap: any;
let smtp: any;
beforeEach(() => {
  imap = {
    connect: vi.fn(),
    logout: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    capabilities: new Map(),
    mailbox: { uidValidity: 42n },
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    list: vi.fn().mockResolvedValue([
      {
        path: "INBOX",
        name: "Inbox",
        flags: new Set(),
        status: { messages: 3, unseen: 2 },
      },
      {
        path: "Drafts",
        name: "Drafts",
        flags: new Set(),
        specialUse: "\\Drafts",
      },
      { path: "Sent", name: "Sent", flags: new Set(), specialUse: "\\Sent" },
    ]),
    mailboxCreate: vi.fn(),
    mailboxRename: vi.fn(),
    mailboxDelete: vi.fn(),
    search: vi.fn().mockResolvedValue([1, 9]),
    fetchAll: vi.fn().mockResolvedValue([
      { uid: 1, flags: new Set(), envelope: { subject: "First" } },
      { uid: 9, envelope: { subject: "Last" } },
    ]),
    fetchOne: vi.fn(),
    append: vi.fn().mockResolvedValue({ uid: 10, uidValidity: 42n }),
    messageFlagsAdd: vi.fn().mockResolvedValue(true),
    messageFlagsRemove: vi.fn().mockResolvedValue(true),
    messageMove: vi.fn().mockResolvedValue({}),
    messageCopy: vi.fn().mockResolvedValue({}),
    messageDelete: vi.fn().mockResolvedValue(true),
  };
  smtp = {
    verify: vi.fn().mockResolvedValue(true),
    sendMail: vi.fn().mockResolvedValue({ messageId: "sent-id", rejected: [] }),
    close: vi.fn(),
  };
  vi.spyOn(mailDependencies, "imap").mockReturnValue(imap);
  vi.spyOn(mailDependencies, "smtp").mockReturnValue(smtp);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("mail commands", () => {
  it("sends only from a provider-verified alternate identity", async () => {
    await expect(
      mailCommand(account, "send", {
        message: { ...compose, from: "alias@example.com" },
      }),
    ).rejects.toThrow("alternate send identities");
    const oauthAccount = {
      ...account,
      oauth: {
        accessToken: "a",
        refreshToken: "r",
        expiresAt: Date.now() + 3600000,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          sendAs: [
            {
              sendAsEmail: "alias@example.com",
              verificationStatus: "pending",
            },
          ],
        }),
      ),
    );
    await expect(
      mailCommand(oauthAccount, "send", {
        message: { ...compose, from: "alias@example.com" },
      }),
    ).rejects.toThrow("Invalid sender");
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        sendAs: [
          { sendAsEmail: "alias@example.com", verificationStatus: "accepted" },
        ],
      }),
    );
    await mailCommand(oauthAccount, "send", {
      message: { ...compose, from: "alias@example.com", html: "<b>Rich</b>" },
    });
    expect(
      (await simpleParser(smtp.sendMail.mock.lastCall[0].raw)).from?.value[0]
        .address,
    ).toBe("alias@example.com");
  });
  it("snoozes using destination UIDs, edits labels and reads a conversation", async () => {
    await expect(mailCommand(account, "snooze", base)).rejects.toThrow(
      "UIDPLUS",
    );
    imap.capabilities.set("UIDPLUS", true);
    imap.messageMove.mockResolvedValueOnce({
      uidValidity: 43n,
      uidMap: new Map([[9, 10]]),
    });
    expect(await mailCommand(account, "snooze", base)).toEqual({
      folder: "SuiteLeaf Snoozed",
      uidValidity: "43",
      uids: [10],
    });
    expect(imap.mailboxCreate).toHaveBeenCalledWith("SuiteLeaf Snoozed");
    imap.messageMove.mockResolvedValueOnce(false);
    await expect(mailCommand(account, "snooze", base)).rejects.toThrow(
      "snooze identifiers",
    );
    await expect(
      mailCommand(account, "labels", { ...base, labels: ["News"], add: true }),
    ).rejects.toThrow("Gmail labels");
    imap.capabilities.set("X-GM-EXT-1", true);
    await mailCommand(account, "labels", {
      ...base,
      labels: ["News"],
      add: true,
    });
    await mailCommand(account, "labels", {
      ...base,
      labels: ["News"],
      add: false,
    });
    expect(imap.messageFlagsRemove).toHaveBeenCalledWith([9], ["News"], {
      uid: true,
      useLabels: true,
    });
    await expect(
      mailCommand(account, "labels", { ...base, labels: [] }),
    ).rejects.toThrow("Invalid labels");
    await mailCommand(account, "list", {
      ...base,
      query: "category:promotions in:anywhere",
    });
    expect(imap.search).toHaveBeenLastCalledWith(
      { gmraw: "category:promotions in:anywhere" },
      { uid: true },
    );
    const raw = Buffer.from(
      "From: lin@example.com\r\nMessage-ID: <id@example.com>\r\nReferences: <root@example.com>\r\nSubject: Thread\r\n\r\nBody\r\n",
    );
    imap.fetchOne.mockImplementation((_uid: string, q: any) =>
      Promise.resolve(q.size ? { size: raw.length } : { source: raw }),
    );
    imap.search.mockResolvedValue([9, 10]);
    expect(
      await mailCommand(account, "conversation", { ...base, uid: 9 }),
    ).toMatchObject({
      total: 2,
      messages: [{ uid: 9, subject: "Thread" }, { uid: 10 }],
    });
    const empty = Buffer.from("Content-Type: text/html\r\n\r\n<p>HTML</p>");
    imap.fetchOne.mockImplementation((_uid: string, q: any) =>
      Promise.resolve(q.size ? { size: empty.length } : { source: empty }),
    );
    expect(
      await mailCommand(account, "conversation", { ...base, uid: 9 }),
    ).toMatchObject({ total: 1, messages: [{ subject: "(no subject)" }] });
  });
  it("replaces previous drafts after acceptance and treats cleanup failure as a warning", async () => {
    const draftRef = { folder: "Drafts", uidValidity: "42", uid: 9 };
    await mailCommand(account, "draft", { message: compose, draftRef });
    expect(imap.messageDelete).toHaveBeenCalledWith([9], { uid: true });
    imap.messageDelete.mockRejectedValueOnce(new Error("quota"));
    expect(
      await mailCommand(account, "send", { message: compose, draftRef }),
    ).toMatchObject({ warning: expect.stringContaining("previous draft") });
    expect(
      await mailCommand(account, "draft", {
        message: compose,
        draftRef: { ...draftRef, uidValidity: "stale" },
      }),
    ).toMatchObject({ warning: expect.stringContaining("previous draft") });
  });
  it("tests both TLS connections and closes them", async () => {
    await expect(mailCommand(account, "test", {})).resolves.toEqual({
      ok: true,
    });
    expect(imap.logout).toHaveBeenCalled();
    expect(smtp.verify).toHaveBeenCalled();
    expect(smtp.close).toHaveBeenCalled();
    smtp.verify.mockRejectedValueOnce(new Error("no"));
    await expect(mailCommand(account, "test", {})).rejects.toThrow("no");
    imap.logout.mockRejectedValueOnce(new Error("gone"));
    await withMailbox(account, async () => {});
    expect(imap.close).toHaveBeenCalled();
    imap.connect.mockRejectedValueOnce(new Error("offline"));
    await expect(withMailbox(account, async () => {})).rejects.toThrow(
      "offline",
    );
  });
  it("lists folders with counts and nonselectable containers", async () => {
    imap.list.mockResolvedValueOnce([
      { path: "Group", name: "Group", flags: new Set(["\\Noselect"]) },
    ]);
    expect(await mailCommand(account, "folders", {})).toEqual([
      { path: "Group", name: "Group", selectable: false },
    ]);
    expect(
      ((await mailCommand(account, "folders", {})) as any)[0],
    ).toMatchObject({ unseen: 2, messages: 3 });
  });
  it("creates, renames and deletes folders", async () => {
    for (const action of ["createFolder", "renameFolder", "deleteFolder"])
      await mailCommand(account, action, {
        path: "Work",
        destination: "Projects",
      });
    expect(imap.mailboxCreate).toHaveBeenCalledWith("Work");
    expect(imap.mailboxRename).toHaveBeenCalledWith("Work", "Projects");
    expect(imap.mailboxDelete).toHaveBeenCalledWith("Work");
    for (const path of ["", "a\r\nb", 4, "x".repeat(1025)])
      await expect(
        mailCommand(account, "createFolder", { path }),
      ).rejects.toThrow("Invalid folder");
  });
  it("uses UID search, sorts newest first and paginates 50 messages", async () => {
    expect(await mailCommand(account, "list", base)).toMatchObject({
      total: 2,
      uidValidity: "42",
      messages: [{ uid: 9, flags: [] }, { uid: 1 }],
    });
    expect(imap.fetchAll.mock.calls[0][0]).toEqual([9, 1]);
    imap.search.mockResolvedValueOnce(
      Array.from({ length: 80 }, (_, i) => i + 1),
    );
    await mailCommand(account, "list", {
      ...base,
      page: 1,
      query: "is:unread",
    });
    expect(imap.fetchAll.mock.lastCall[0]).toHaveLength(30);
    imap.search.mockResolvedValueOnce(false);
    expect(await mailCommand(account, "list", base)).toMatchObject({
      total: 0,
      messages: [],
    });
    await expect(
      mailCommand(account, "list", { ...base, page: -1 }),
    ).rejects.toThrow("Invalid page");
  });
  it("rejects stale or absent UIDVALIDITY before mutations", async () => {
    await expect(
      mailCommand(account, "delete", { ...base, uidValidity: "41" }),
    ).rejects.toThrow("mailbox changed");
    imap.mailbox = false;
    await expect(
      mailCommand(account, "read", { ...base, uid: 9 }),
    ).rejects.toThrow("mailbox changed");
    expect(imap.messageDelete).not.toHaveBeenCalled();
    expect(imap.getMailboxLock.mock.results[0].value).resolves.toHaveProperty(
      "release",
    );
  });
  it("applies bounded UID operations under a lock", async () => {
    for (const add of [true, false])
      await mailCommand(account, "flags", { ...base, flag: "\\Seen", add });
    await mailCommand(account, "move", { ...base, destination: "Archive" });
    await mailCommand(account, "copy", { ...base, destination: "Work" });
    await mailCommand(account, "delete", base);
    expect(imap.messageFlagsRemove).toHaveBeenCalledWith([9], ["\\Seen"], {
      uid: true,
    });
    expect(imap.messageMove).toHaveBeenCalledWith([9], "Archive", {
      uid: true,
    });
    expect(imap.messageCopy).toHaveBeenCalledWith([9], "Work", { uid: true });
    expect(imap.messageDelete).toHaveBeenCalledWith([9], { uid: true });
    for (const value of [[], [0], [1.5], Array(501).fill(1), "1:*"])
      await expect(
        mailCommand(account, "delete", { ...base, uids: value }),
      ).rejects.toThrow("Select");
    await expect(
      mailCommand(account, "flags", { ...base, flag: "bad", add: true }),
    ).rejects.toThrow("Unsupported");
    await expect(
      mailCommand(account, "flags", { ...base, flag: "\\Seen", add: 1 }),
    ).rejects.toThrow("Invalid flag");
    await expect(mailCommand(account, "bad", base)).rejects.toThrow("Unknown");
  });
  it("parses real MIME, marks read and downloads attachments without read side effects", async () => {
    const raw = await new MailComposer({
      from: "Lin <lin@example.com>",
      to: "ada@example.com",
      subject: "Report",
      html: "<p>Hello</p>",
      attachments: [{ filename: "data.txt", content: "sample" }],
    })
      .compile()
      .build();
    imap.fetchOne.mockImplementation((_uid: string, q: any) =>
      Promise.resolve(q.size ? { size: raw.length } : { source: raw }),
    );
    expect(
      await mailCommand(account, "read", { ...base, uid: 9 }),
    ).toMatchObject({
      subject: "Report",
      text: "Hello",
      attachments: [{ filename: "data.txt", index: 0 }],
    });
    expect(imap.messageFlagsAdd).toHaveBeenCalledWith([9], ["\\Seen"], {
      uid: true,
    });
    expect(
      await mailCommand(account, "original", { ...base, uid: 9 }),
    ).toMatchObject({
      filename: "message-9.eml",
      content: raw.toString("base64"),
    });
    imap.messageFlagsAdd.mockClear();
    expect(
      await mailCommand(account, "attachment", { ...base, uid: 9, index: 0 }),
    ).toMatchObject({
      filename: "data.txt",
      content: Buffer.from("sample").toString("base64"),
    });
    expect(imap.messageFlagsAdd).not.toHaveBeenCalled();
    await expect(
      mailCommand(account, "attachment", { ...base, uid: 9, index: -1 }),
    ).rejects.toThrow("Attachment not found");
    imap.fetchOne.mockResolvedValueOnce(false);
    await expect(
      mailCommand(account, "read", { ...base, uid: 9 }),
    ).rejects.toThrow("Message not found");
    imap.fetchOne.mockResolvedValueOnce({ size: 30_000_000 });
    await expect(
      mailCommand(account, "read", { ...base, uid: 9 }),
    ).rejects.toThrow("25 MB");
    imap.fetchOne
      .mockResolvedValueOnce({ size: 10 })
      .mockResolvedValueOnce(false);
    await expect(
      mailCommand(account, "read", { ...base, uid: 9 }),
    ).rejects.toThrow("Message not found");
    const empty = Buffer.from("From: a@example.com\r\n\r\n");
    imap.fetchOne.mockImplementation((_uid: string, q: any) =>
      Promise.resolve(q.size ? { size: empty.length } : { source: empty }),
    );
    expect(
      await mailCommand(account, "read", { ...base, uid: 9 }),
    ).toMatchObject({ subject: "(no subject)", html: "", attachments: [] });
  });
  it("saves drafts with Bcc and sends identical MIME with envelope-only Bcc", async () => {
    await mailCommand(account, "draft", { message: compose });
    const draft = await simpleParser(imap.append.mock.lastCall[1]);
    expect(draft.bcc).toMatchObject({ text: "hidden@example.com" });
    expect(draft.attachments[0].content.toString()).toBe("hello");
    const result = await mailCommand(account, "send", { message: compose });
    expect(result).toMatchObject({ ok: true, messageId: "sent-id" });
    const sent = smtp.sendMail.mock.lastCall[0];
    expect(sent.envelope.to).toContain("hidden@example.com");
    expect((await simpleParser(sent.raw)).bcc).toBeUndefined();
    expect(imap.append.mock.lastCall[1]).toEqual(sent.raw);
    expect(smtp.close).toHaveBeenCalled();
  });
  it("reports missing folders, partial rejection and Sent failures without a resend", async () => {
    imap.list.mockResolvedValueOnce([]);
    await expect(
      mailCommand(account, "draft", { message: compose }),
    ).rejects.toThrow("no Drafts");
    imap.append.mockResolvedValueOnce(false);
    await expect(
      mailCommand(account, "draft", { message: compose }),
    ).rejects.toThrow("did not save");
    imap.list.mockResolvedValueOnce([]);
    expect(
      await mailCommand(account, "send", { message: compose }),
    ).toMatchObject({ warning: expect.stringContaining("no Sent") });
    imap.append.mockRejectedValueOnce(new Error("quota"));
    smtp.sendMail.mockResolvedValueOnce({ rejected: ["cc@example.com"] });
    expect(
      await mailCommand(account, "send", { message: compose }),
    ).toMatchObject({ warning: expect.stringContaining("Do not resend") });
    imap.capabilities.set("X-GM-EXT-1", true);
    imap.append.mockClear();
    await mailCommand(
      { ...account, smtp: { ...account.smtp, host: "smtp.gmail.com" } },
      "send",
      { message: compose },
    );
    expect(imap.append).not.toHaveBeenCalled();
    smtp.sendMail.mockRejectedValueOnce(new Error("smtp down"));
    await expect(
      mailCommand(account, "send", { message: compose }),
    ).rejects.toThrow("smtp down");
    expect(smtp.close).toHaveBeenCalled();
    await expect(
      mailCommand(account, "send", { message: { ...compose, to: " " } }),
    ).rejects.toThrow("recipient");
  });
});

describe("validation and search", () => {
  it("supports quoted fields, repeated terms, date and flag filters", () => {
    expect(mailSearch("")).toEqual({ all: true });
    expect(mailSearch("is:unread")).toEqual({ seen: false });
    expect(
      mailSearch(
        'from:ada to:lin cc:sam subject:"monthly report" is:read is:starred before:2026-12-01 after:2026-01-01 alpha beta',
      ),
    ).toEqual({
      not: {
        or: [
          { from: "ada" },
          { to: "lin" },
          { cc: "sam" },
          { subject: "monthly report" },
          { seen: true },
          { flagged: true },
          { before: new Date("2026-12-01") },
          { since: new Date("2026-01-01") },
          { body: "alpha" },
          { body: "beta" },
        ].map((not) => ({ not })),
      },
    });
  });
  it("validates endpoint settings and strips secrets", () => {
    expect(validateAccount(structuredClone(account))).toEqual(account);
    expect(publicAccount(account).imap.password).toBe("");
    for (const value of [
      null,
      {},
      { ...account, email: "bad" },
      { ...account, imap: { ...endpoint, port: 0 } },
      { ...account, smtp: { ...endpoint, host: "http://x" } },
    ])
      expect(() => validateAccount(value)).toThrow();
    expect(
      validateAccount({ ...account, signature: undefined }).signature,
    ).toBe("");
    expect(validateCompose(compose)).toEqual(compose);
    for (const value of [
      null,
      {},
      { ...compose, subject: "a\r\nbcc:evil" },
      { ...compose, references: [3] },
      {
        ...compose,
        attachments: [
          { filename: "a", contentType: "text/plain", content: "../x" },
        ],
      },
      { ...compose, attachments: Array(31).fill(compose.attachments[0]) },
      {
        ...compose,
        attachments: [
          { ...compose.attachments[0], content: "a".repeat(28_000_001) },
        ],
      },
    ])
      expect(() => validateCompose(value)).toThrow();
  });
});

describe("encrypted owner-scoped storage", () => {
  it("authenticates ciphertext and keeps owners distinct", async () => {
    expect(() => new MailStore("http://db", "token", "short")).toThrow();
    const store = new MailStore("http://db", "token", "x".repeat(32));
    const sealed = store.seal(account);
    expect(sealed).not.toContain("secret");
    expect(store.open(sealed)).toEqual(account);
    expect(store.seal(account)).not.toBe(sealed);
    const damaged = Buffer.from(sealed, "base64");
    damaged[30] ^= 1;
    expect(() => store.open(damaged.toString("base64"))).toThrow();
    const rows = new Map<string, any>();
    const requests: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const b = JSON.parse(init.body);
        requests.push(b);
        const id = b.where?.find((w: any) => w.field === "id")?.value;
        let result: any;
        if (b.op === "create") {
          rows.set(b.data.id, b.data);
          result = b.data;
        } else if (b.op === "update") {
          rows.set(id, { ...rows.get(id), ...b.update });
          result = rows.get(id);
        } else if (b.op === "delete") rows.delete(id);
        else if (b.op === "findMany")
          result = [...rows.values()].filter(
            (r) => r.userId === b.where[0].value,
          );
        else result = rows.get(id) ?? null;
        return Response.json({ result });
      }),
    );
    await store.put("ada", account);
    expect(await store.get("ada", "a")).toEqual(account);
    expect(await store.list("lin")).toEqual([]);
    await expect(store.get("lin", "a")).rejects.toThrow("not found");
    await store.put("ada", { ...account, name: "New" });
    expect((await store.list("ada"))[0].name).toBe("New");
    await store.put("lin", account);
    await store.remove("ada", "a");
    expect(await store.list("ada")).toEqual([]);
    expect(await store.list("lin")).toHaveLength(1);
    expect(requests.find((r) => r.op === "update").where).toContainEqual({
      field: "userId",
      value: "ada",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("down", { status: 500 })),
    );
    await expect(store.list("ada")).rejects.toThrow("storage");
  });
});

describe("mail HTTP boundary", () => {
  const store = { list: vi.fn(), get: vi.fn(), put: vi.fn(), remove: vi.fn() };
  async function request(
    body: any,
    user: string | undefined = "ada",
    method = "POST",
    headers: any = {
      authorization: "Bearer session",
      "content-type": "application/json",
    },
  ) {
    const req = Object.assign(
      Readable.from([typeof body === "string" ? body : JSON.stringify(body)]),
      { method, headers },
    );
    const res = { writeHead: vi.fn(), end: vi.fn() };
    await mailRequest(
      req as IncomingMessage,
      res as unknown as ServerResponse,
      user,
      store as unknown as MailStore,
    );
    return {
      status: res.writeHead.mock.calls[0][0],
      body: JSON.parse(res.end.mock.calls[0][0]),
    };
  }
  it("requires session, POST, bearer and JSON; contains provider failures", async () => {
    expect((await request({}, "")).status).toBe(401);
    expect((await request({}, "ada", "GET")).status).toBe(405);
    expect((await request({}, "ada", "POST", {})).status).toBe(403);
    expect((await request("invalid json")).status).toBe(400);
    expect((await request({ action: "read" })).body.error).toContain("Choose");
    store.get.mockResolvedValue(account);
    expect(
      (await request({ accountId: "a", action: "bogus" })).body.error,
    ).toContain("Unknown");
    imap.connect.mockRejectedValueOnce(new Error("password=secret"));
    const result = await request({ accountId: "a", action: "folders" });
    expect(result.status).toBe(400);
    expect(result.body.error).not.toContain("secret");
    expect((await request("x".repeat(32_000_001))).status).toBe(413);
  });
  it("lists public settings, verifies before saving and preserves omitted passwords", async () => {
    store.list.mockResolvedValue([account]);
    expect((await request({ action: "accounts" })).body[0].imap.password).toBe(
      "",
    );
    store.get.mockResolvedValue(account);
    expect(
      (
        await request({
          action: "saveAccount",
          account: publicAccount(account),
        })
      ).status,
    ).toBe(200);
    expect(store.put).toHaveBeenLastCalledWith("ada", account);
    const next = { ...account, id: "" };
    expect(
      (await request({ action: "saveAccount", account: next })).body.id,
    ).not.toBe("");
    expect((await request({ action: "saveAccount" })).status).toBe(400);
    expect(
      (await request({ action: "removeAccount", accountId: "a" })).status,
    ).toBe(200);
    expect(store.remove).toHaveBeenCalledWith("ada", "a");
    expect((await request({ action: "folders", accountId: "a" })).status).toBe(
      200,
    );
  });
  it("bounds concurrent work per owner and releases slots", async () => {
    let release!: () => void;
    store.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );
    const pending = request({ action: "accounts" });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const releases: (() => void)[] = [];
    store.list.mockImplementation(
      () => new Promise((resolve) => releases.push(() => resolve([]))),
    );
    const more = [
      request({ action: "accounts" }),
      request({ action: "accounts" }),
      request({ action: "accounts" }),
    ];
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    expect((await request({ action: "accounts" })).status).toBe(429);
    release();
    releases.forEach((r) => r());
    await Promise.all([pending, ...more]);
    store.list.mockResolvedValue([]);
    expect((await request({ action: "accounts" })).status).toBe(200);
  });
  it("prevents changing the verified OAuth identity used for Workspace delegation", async () => {
    store.get.mockResolvedValue({
      ...account,
      oauth: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 3600000,
      },
    });
    store.put.mockClear();
    const result = await request({
      action: "saveAccount",
      account: { ...publicAccount(account), email: "victim@example.com" },
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain("Invalid Gmail identity");
    expect(store.put).not.toHaveBeenCalled();
  });
});
