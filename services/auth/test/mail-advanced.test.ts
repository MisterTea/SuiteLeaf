import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { account, memoryStore } from "./mail-support";
import {
  jobCommand,
  runMailJobs,
  scheduleTime,
  startMailJobs,
} from "../src/mail/jobs";
import { preferenceCommand, defaultPreferences } from "../src/mail/preferences";
import { syncMailAccounts } from "../src/mail/sync";
import { mailCommand, withMailbox } from "../src/mail/service";
import { MailStore, type MailJob } from "../src/mail/store";
const fake = vi.hoisted(() => ({ command: vi.fn(), mailbox: vi.fn() }));
vi.mock("../src/mail/service", async (original) => ({
  ...(await original<typeof import("../src/mail/service")>()),
  mailCommand: fake.command,
  withMailbox: fake.mailbox,
}));
let db: ReturnType<typeof memoryStore>;
beforeEach(async () => {
  vi.stubEnv("SUITELEAF_MAIL_WORKER_ID", "worker");
  db = memoryStore();
  await db.store.put("ada", account);
  fake.command.mockReset().mockResolvedValue({ ok: true });
  fake.mailbox.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const message = { to: "lin@example.com", subject: "Later", text: "Body" };

describe("durable mail jobs", () => {
  it("validates times and records encrypted sends owned by one worker", async () => {
    for (const input of [
      null,
      "invalid",
      new Date(Date.now() - 1000).toISOString(),
      new Date(Date.now() + 367 * 86400000).toISOString(),
    ])
      expect(() => scheduleTime(input)).toThrow();
    const dueAt = new Date(Date.now() + 60000).toISOString();
    const result = (await jobCommand(
      db.store,
      "ada",
      account,
      "scheduleSend",
      { dueAt, message },
      "worker",
    )) as any;
    const jobs = await db.store.records<MailJob>("ada", "a", "job");
    expect(jobs[0]).toMatchObject({
      owner: "worker",
      state: "scheduled",
      dueAt,
      payload: { type: "send", message },
    });
    expect(
      await jobCommand(db.store, "ada", account, "jobs", {}, "worker"),
    ).toEqual([expect.objectContaining({ key: result.key, subject: "Later" })]);
    expect(JSON.stringify([...db.rows.values()])).not.toContain(
      '"subject":"Later"',
    );
    expect(await db.store.dueJobs("other", dueAt)).toEqual([]);
    await runMailJobs(db.store, "worker", dueAt);
    const completed = (await db.store.records<MailJob>("ada", "a", "job"))[0];
    expect(completed.state).toBe("completed");
    expect(completed.payload.message).toBeUndefined();
    expect(fake.command).toHaveBeenCalledWith(account, "send", { message });
    await runMailJobs(db.store, "worker", dueAt);
    expect(fake.command).toHaveBeenCalledTimes(1);
  });
  it("cancels queued sends, handles wrong owners and restores snoozed mail", async () => {
    const dueAt = new Date(Date.now() + 60000).toISOString();
    const queued = (await jobCommand(
      db.store,
      "ada",
      account,
      "scheduleSend",
      { dueAt, message },
      "worker",
    )) as any;
    await expect(
      jobCommand(
        db.store,
        "ada",
        account,
        "cancelJob",
        { key: queued.key },
        "other",
      ),
    ).rejects.toThrow("server that scheduled");
    await jobCommand(
      db.store,
      "ada",
      account,
      "cancelJob",
      { key: queued.key },
      "worker",
    );
    await runMailJobs(db.store, "worker", dueAt);
    expect(fake.command).not.toHaveBeenCalled();
    await expect(
      jobCommand(
        db.store,
        "ada",
        account,
        "cancelJob",
        { key: queued.key },
        "worker",
      ),
    ).rejects.toThrow("already started");
    fake.command.mockResolvedValueOnce({
      folder: "SuiteLeaf Snoozed",
      uidValidity: "43",
      uids: [10],
    });
    const snoozed = (await jobCommand(
      db.store,
      "ada",
      account,
      "snooze",
      { dueAt, folder: "INBOX", uidValidity: "42", uids: [9] },
      "worker",
    )) as any;
    await jobCommand(
      db.store,
      "ada",
      account,
      "cancelJob",
      { key: snoozed.key },
      "worker",
    );
    await runMailJobs(
      db.store,
      "worker",
      new Date(Date.now() + 1000).toISOString(),
    );
    expect(fake.command).toHaveBeenLastCalledWith(
      account,
      "move",
      expect.objectContaining({
        folder: "SuiteLeaf Snoozed",
        destination: "INBOX",
        uids: [10],
        uidValidity: "43",
      }),
    );
  });
  it("does not retry uncertain delivery and handles provider errors, banned owners and interruptions", async () => {
    const dueAt = new Date(Date.now() + 60000).toISOString();
    await jobCommand(
      db.store,
      "ada",
      account,
      "scheduleSend",
      { dueAt, message },
      "worker",
    );
    fake.command.mockRejectedValueOnce(new Error("SMTP disconnected"));
    await runMailJobs(db.store, "worker", dueAt);
    expect(
      (await db.store.records<MailJob>("ada", "a", "job"))[0],
    ).toMatchObject({
      state: "uncertain",
      payload: { result: expect.stringContaining("Check Sent") },
    });
    await jobCommand(
      db.store,
      "ada",
      account,
      "scheduleSend",
      { dueAt, message },
      "worker",
    );
    db.rows.set("user:ada", { id: "ada", banned: 1 });
    await runMailJobs(db.store, "worker", dueAt);
    expect(fake.command).toHaveBeenCalledTimes(1);
    await db.store.saveRecord(
      "ada",
      "a",
      "job",
      "running",
      { key: "running", type: "send", message },
      { state: "running", owner: "worker", dueAt },
    );
    vi.useFakeTimers();
    const stop = startMailJobs(db.store, "worker");
    await vi.advanceTimersByTimeAsync(6000);
    expect(
      (await db.store.record<MailJob>("ada", "a", "job", "running"))?.state,
    ).toBe("uncertain");
    stop();
  });
  it("rolls back snooze when persistence fails and keeps queued sends on cleanup errors", async () => {
    const dueAt = new Date(Date.now() + 60000).toISOString();
    await expect(
      jobCommand(
        db.store,
        "ada",
        account,
        "scheduleSend",
        { dueAt, message },
        "",
      ),
    ).rejects.toThrow("worker identity");
    await expect(
      jobCommand(
        db.store,
        "ada",
        account,
        "scheduleSend",
        { dueAt, message: { ...message, to: " " } },
        "worker",
      ),
    ).rejects.toThrow("recipient");
    await expect(
      jobCommand(db.store, "ada", account, "bad", { dueAt }, "worker"),
    ).rejects.toThrow("Unknown");
    fake.command.mockResolvedValue({
      folder: "SuiteLeaf Snoozed",
      uidValidity: "42",
      uids: [10],
    });
    const failure = vi
      .spyOn(db.store, "saveRecord")
      .mockRejectedValueOnce(new Error("disk"));
    await expect(
      jobCommand(
        db.store,
        "ada",
        account,
        "snooze",
        { dueAt, folder: "INBOX" },
        "worker",
      ),
    ).rejects.toThrow("disk");
    expect(fake.command).toHaveBeenLastCalledWith(
      account,
      "move",
      expect.objectContaining({ destination: "INBOX" }),
    );
    failure.mockRejectedValueOnce(new Error("disk"));
    fake.command
      .mockResolvedValueOnce({
        folder: "SuiteLeaf Snoozed",
        uidValidity: "42",
        uids: [10],
      })
      .mockRejectedValueOnce(new Error("offline"));
    await expect(
      jobCommand(
        db.store,
        "ada",
        account,
        "snooze",
        { dueAt, folder: "INBOX" },
        "worker",
      ),
    ).rejects.toThrow("Messages remain");
    failure.mockRestore();
    fake.command.mockRejectedValueOnce(new Error("cleanup failed"));
    expect(
      await jobCommand(
        db.store,
        "ada",
        account,
        "scheduleSend",
        {
          dueAt,
          message,
          draftRef: { folder: "Drafts", uidValidity: "42", uid: 9 },
        },
        "worker",
      ),
    ).toMatchObject({ ok: true });
    await db.store.saveRecord(
      "ada",
      "a",
      "job",
      "snooze-failed",
      { key: "snooze-failed", type: "snooze", folder: "Snoozed", uids: [2] },
      { state: "scheduled", owner: "worker", dueAt },
    );
    fake.command.mockRejectedValue(new Error("bad"));
    await runMailJobs(db.store, "worker", dueAt);
    expect(
      (await db.store.record<MailJob>("ada", "a", "job", "snooze-failed"))
        ?.state,
    ).toBe("failed");
  });
  it("ticks sync and jobs independently and records warnings", async () => {
    const dueAt = new Date(Date.now() + 60000).toISOString();
    await jobCommand(
      db.store,
      "ada",
      account,
      "scheduleSend",
      { dueAt, message },
      "worker",
    );
    fake.command.mockResolvedValue({ warning: "Sent copy missing" });
    await runMailJobs(db.store, "worker", dueAt);
    expect(
      (await db.store.records<MailJob>("ada", "a", "job"))[0].payload.result,
    ).toBe("Sent copy missing");
    vi.useFakeTimers();
    fake.mailbox.mockImplementation(async (_account, fn) =>
      fn({
        getMailboxLock: async () => ({ release() {} }),
        mailbox: { uidValidity: 42n, uidNext: 10 },
      }),
    );
    const stop = startMailJobs(db.store, "worker");
    await vi.advanceTimersByTimeAsync(61000);
    expect(fake.mailbox).toHaveBeenCalled();
    stop();
    const broken = vi
      .spyOn(db.store, "interruptedJobs")
      .mockRejectedValue(new Error("db"));
    const stop2 = startMailJobs(db.store, "worker");
    await vi.advanceTimersByTimeAsync(6000);
    stop2();
    broken.mockRestore();
  });
});

describe("mail preferences, templates, contacts and rules", () => {
  const command = (action: string, body: Record<string, unknown> = {}) =>
    preferenceCommand(db.store, "ada", account, action, body);
  it("round-trips preferences and validates updates", async () => {
    expect(await command("preferences")).toEqual(defaultPreferences);
    const next = { ...defaultPreferences, density: "compact", theme: "dark" };
    expect(await command("savePreferences", { preferences: next })).toEqual(
      next,
    );
    expect(await command("preferences")).toEqual(next);
    await expect(
      command("savePreferences", { preferences: {} }),
    ).rejects.toThrow("Invalid");
  });
  it("creates, updates and deletes server rules", async () => {
    const rule = (await command("saveRule", {
      rule: {
        name: "News",
        query: "from:news",
        moveTo: "News",
        enabled: true,
        markRead: true,
        star: true,
      },
    })) as any;
    expect(await command("rules")).toEqual([rule]);
    await command("saveRule", {
      rule: { ...rule, enabled: false, moveTo: "" },
    });
    expect(((await command("rules")) as any[])[0].enabled).toBe(false);
    await command("deleteRule", { id: rule.id });
    await command("deleteRule", { id: "missing" });
    expect(await command("rules")).toEqual([]);
    await expect(command("saveRule", { rule: {} })).rejects.toThrow("Invalid");
  });
  it("stores message templates and contacts only for their owner", async () => {
    const t = (await command("saveTemplate", {
      name: "Thanks",
      text: "Thank you",
      html: "<p>Thank you</p>",
    })) as any;
    expect(await command("templates")).toEqual([t]);
    await command("saveTemplate", { ...t, text: "Updated" });
    expect(((await command("templates")) as any[])[0].text).toBe("Updated");
    expect(await db.store.records("other", "a", "template")).toEqual([]);
    await command("deleteTemplate", { id: t.id });
    await command("deleteTemplate", { id: "missing" });
    const c = (await command("saveContact", {
      name: "Lin",
      email: "lin@example.com",
    })) as any;
    expect(await command("contacts")).toEqual([c]);
    await command("saveContact", { ...c, name: "Lin New" });
    await command("deleteContact", { id: c.id });
    await command("deleteContact", { id: "missing" });
    expect(await command("contacts")).toEqual([]);
    for (const [action, body] of [
      ["saveContact", { email: "bad" }],
      ["saveTemplate", { name: "", text: "" }],
      ["saveTemplate", { name: "x", text: "", html: 1 }],
      ["bad", {}],
    ] as const)
      await expect(command(action, body)).rejects.toThrow();
  });
});

describe("background inbox synchronization", () => {
  it("initializes a cursor, processes only new UIDs and applies rules", async () => {
    const client: any = {
      mailbox: { uidValidity: 42n, uidNext: 10 },
      capabilities: new Map(),
      getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
      search: vi.fn(),
      messageFlagsAdd: vi.fn(),
      messageMove: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      mailboxCreate: vi.fn(),
    };
    fake.mailbox.mockImplementation(async (_a, fn) => fn(client));
    await syncMailAccounts(db.store, "worker");
    expect(
      (await db.store.record<any>("ada", "a", "sync", "inbox"))?.payload
        .lastUid,
    ).toBe(9);
    expect(client.search).not.toHaveBeenCalled();
    await preferenceCommand(db.store, "ada", account, "saveRule", {
      rule: {
        name: "News",
        query: "subject:news",
        moveTo: "News",
        markRead: true,
        star: true,
      },
    });
    client.mailbox.uidNext = 12;
    client.search
      .mockResolvedValueOnce([9, 10, 11])
      .mockResolvedValueOnce([10]);
    await syncMailAccounts(db.store, "worker");
    expect(client.messageFlagsAdd).toHaveBeenCalledWith([10], ["\\Seen"], {
      uid: true,
    });
    expect(client.messageMove).toHaveBeenCalledWith([10], "News", {
      uid: true,
    });
    client.capabilities.set("X-GM-EXT-1", true);
    client.mailbox.uidNext = 13;
    client.search.mockResolvedValueOnce([12]).mockResolvedValueOnce(false);
    await syncMailAccounts(db.store, "worker");
    expect(client.search.mock.lastCall[0].gmraw).toBe("subject:news");
    client.mailbox.uidValidity = 43n;
    await syncMailAccounts(db.store, "worker");
    expect(
      (await db.store.record<any>("ada", "a", "sync", "inbox"))?.payload
        .uidValidity,
    ).toBe("43");
  });
  it("retains cursors on failure and skips banned owners", async () => {
    fake.mailbox.mockRejectedValue(new Error("bad credentials"));
    await syncMailAccounts(db.store, "worker");
    expect(
      (await db.store.record<any>("ada", "a", "sync", "inbox"))?.payload.error,
    ).toContain("Background sync failed");
    db.rows.set("user:ada", { id: "ada", banned: 1 });
    fake.mailbox.mockClear();
    await syncMailAccounts(db.store, "worker");
    expect(fake.mailbox).not.toHaveBeenCalled();
  });
});
