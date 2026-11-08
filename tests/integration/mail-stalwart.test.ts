import { describe, it, expect } from "vitest";

const base = process.env.SUITELEAF_MAIL_TEST_URL;
describe.skipIf(!base)("SuiteLeaf → authenticated API → Stalwart", () => {
  it("delivers MIME and attachments, preserves Bcc privacy, manages UIDs/drafts/jobs and isolates accounts", async () => {
    const password = process.env.SUITELEAF_MAIL_TEST_PASSWORD!;
    const signup = async (name: string) => {
      const response = await fetch(`${base}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base! },
        body: JSON.stringify({
          name,
          email: `${name}@suiteleaf.test`,
          password,
        }),
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      return data.token as string;
    };
    const token = await signup("tester");
    const call = async (
      action: string,
      body: Record<string, unknown> = {},
      bearer = token,
    ) => {
      const response = await fetch(`${base}/api/auth/suiteleaf/mail`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({ action, ...body }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(`${action}: ${response.status} ${result.error}`);
      return result;
    };
    const accounts = [];
    for (const user of ["alice", "bob"]) {
      const endpoint = {
        host: "127.0.0.1",
        user: `${user}@suiteleaf.test`,
        password,
        secure: true,
      };
      const a = await call("saveAccount", {
        account: {
          name: user,
          email: endpoint.user,
          signature: "",
          imap: { ...endpoint, port: 19993 },
          smtp: { ...endpoint, port: 1465 },
        },
      });
      expect(a.imap.password).toBe("");
      expect(a.smtp.password).toBe("");
      accounts.push(a);
    }
    const [alice, bob] = accounts;
    const a = (action: string, body: Record<string, unknown> = {}) =>
      call(action, { accountId: alice.id, ...body });
    const b = (action: string, body: Record<string, unknown> = {}) =>
      call(action, { accountId: bob.id, ...body });
    const message = {
      to: bob.email,
      bcc: alice.email,
      subject: "Stalwart delivery",
      text: "Real provider content",
      html: "<p>Real <strong>provider</strong> content</p>",
      attachments: [
        {
          filename: "note.txt",
          contentType: "text/plain",
          content: Buffer.from("attachment bytes").toString("base64"),
        },
      ],
    };
    expect(await a("send", { message })).toMatchObject({
      ok: true,
      warning: "",
    });
    let inbox: any;
    await expect
      .poll(
        async () => {
          inbox = await b("list", { folder: "INBOX" });
          return inbox.messages?.length;
        },
        { timeout: 20000 },
      )
      .toBe(1);
    const row = inbox.messages[0],
      ref = { folder: "INBOX", uidValidity: inbox.uidValidity, uid: row.uid };
    const read = await b("read", ref);
    expect(read.text).toContain("Real provider content");
    expect(read.html).toContain("<strong>provider</strong>");
    const attachment = await b("attachment", { ...ref, index: 0 });
    expect(Buffer.from(attachment.content, "base64").toString()).toBe(
      "attachment bytes",
    );
    const original = await b("original", ref);
    expect(Buffer.from(original.content, "base64").toString()).not.toMatch(
      /^bcc:/im,
    );
    await b("flags", { ...ref, uids: [row.uid], flag: "\\Flagged", add: true });
    expect((await b("list", { folder: "INBOX" })).messages[0].flags).toContain(
      "\\Flagged",
    );
    await expect(
      b("read", { ...ref, uidValidity: "999999999" }),
    ).rejects.toThrow();
    await b("createFolder", { path: "Filed" });
    await b("copy", { ...ref, uids: [row.uid], destination: "Filed" });
    expect((await b("list", { folder: "Filed" })).messages).toHaveLength(1);
    await b("move", { ...ref, uids: [row.uid], destination: "Filed" });
    expect((await b("list", { folder: "INBOX" })).messages).toHaveLength(0);
    expect(
      (
        await b("list", {
          folder: "Filed",
          query: 'subject:"Stalwart delivery" is:starred',
        })
      ).messages,
    ).toHaveLength(1);
    await b("renameFolder", { path: "Filed", destination: "ArchiveTest" });
    const filed = await b("list", { folder: "ArchiveTest" });
    await b("delete", {
      folder: "ArchiveTest",
      uidValidity: filed.uidValidity,
      uids: filed.messages.map((m: any) => m.uid),
    });
    await b("deleteFolder", { path: "ArchiveTest" });
    const draft = await a("draft", {
      message: { ...message, subject: "Draft" },
    });
    expect(draft.uid).toBeGreaterThan(0);
    const replaced = await a("draft", {
      message: { ...message, subject: "Revised draft" },
      draftRef: draft,
    });
    const drafts = await a("list", { folder: replaced.folder });
    expect(drafts.messages).toHaveLength(1);
    const cancelled = await a("scheduleSend", {
      message: { ...message, subject: "Cancelled" },
      dueAt: new Date(Date.now() + 60000).toISOString(),
    });
    expect(await a("cancelJob", { key: cancelled.key })).toMatchObject({
      ok: true,
      message: { subject: "Cancelled" },
    });
    const scheduled = await a("scheduleSend", {
      message: { ...message, subject: "Scheduled" },
      dueAt: new Date(Date.now() + 6000).toISOString(),
    });
    await expect
      .poll(
        async () =>
          (await a("jobs")).find((j: any) => j.key === scheduled.key)?.state,
        { timeout: 20000 },
      )
      .toBe("completed");
    await expect
      .poll(
        async () => (await b("list", { folder: "INBOX" })).messages.length,
        { timeout: 20000 },
      )
      .toBe(1);
    const incoming = await b("list", { folder: "INBOX" });
    const snooze = await b("snooze", {
      folder: "INBOX",
      uidValidity: incoming.uidValidity,
      uids: [incoming.messages[0].uid],
      dueAt: new Date(Date.now() + 60000).toISOString(),
    });
    expect((await b("list", { folder: "INBOX" })).messages).toHaveLength(0);
    await b("cancelJob", { key: snooze.key });
    await expect
      .poll(
        async () => (await b("list", { folder: "INBOX" })).messages.length,
        { timeout: 15000 },
      )
      .toBe(1);
    await b("saveRule", {
      rule: {
        name: "Local provider rule",
        query: 'subject:"Rule delivery"',
        markRead: true,
        star: true,
        moveTo: "Rule delivery",
        enabled: true,
      },
    });
    await expect
      .poll(async () => !!(await b("syncStatus")).syncedAt, {
        timeout: 65000,
        interval: 1000,
      })
      .toBe(true);
    await a("send", {
      message: { ...message, bcc: "", subject: "Rule delivery" },
    });
    await expect
      .poll(
        async () => {
          const folders = await b("folders");
          return folders.some((f: any) => f.path === "Rule delivery");
        },
        { timeout: 65000, interval: 1000 },
      )
      .toBe(true);
    const ruled = await b("list", { folder: "Rule delivery" });
    expect(ruled.messages).toHaveLength(1);
    expect(ruled.messages[0].flags).toEqual(
      expect.arrayContaining(["\\Seen", "\\Flagged"]),
    );
    const other = await signup("another");
    expect(await call("accounts", {}, other)).toEqual([]);
    await expect(
      call("folders", { accountId: alice.id }, other),
    ).rejects.toThrow();
    expect((await call("accounts")).length).toBe(2);
  }, 160000);
});
