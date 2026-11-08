import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import {
  authorizedAccount,
  beginGoogle,
  finishGoogle,
  googleCommand,
} from "../src/mail/google";
import { publicAccount, validateAccount } from "../src/mail/types";
import { account, memoryStore } from "./mail-support";
let db: ReturnType<typeof memoryStore>;
const oauthAccount = {
  ...account,
  provider: "gmail" as const,
  oauth: {
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: Date.now() + 3600000,
  },
};
beforeEach(() => {
  db = memoryStore();
  vi.stubEnv("SUITELEAF_GMAIL_CLIENT_ID", "client");
  vi.stubEnv("SUITELEAF_GMAIL_CLIENT_SECRET", "client-secret");
  vi.stubEnv("SUITELEAF_PUBLIC_URL", "https://suite.example");
  vi.stubEnv("SUITELEAF_MAIL_WORKER_ID", "worker");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Google mail OAuth", () => {
  it("requires Workspace delegation and signs assertions only for the connected mailbox", async () => {
    vi.stubEnv("SUITELEAF_GMAIL_SERVICE_ACCOUNT", "");
    expect(
      await googleCommand(oauthAccount, "gmailAdministration", {}),
    ).toMatchObject({ available: false });
    await expect(
      googleCommand(oauthAccount, "gmailDelegate", {
        email: "delegate@example.com",
      }),
    ).rejects.toThrow("domain-wide");
    vi.stubEnv("SUITELEAF_GMAIL_SERVICE_ACCOUNT", "invalid");
    await expect(
      googleCommand(oauthAccount, "gmailAdministration", {}),
    ).rejects.toThrow("invalid");
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    vi.stubEnv(
      "SUITELEAF_GMAIL_SERVICE_ACCOUNT",
      JSON.stringify({
        client_email: "service@example.iam.gserviceaccount.com",
        private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
      }),
    );
    const calls: any[] = [];
    db.setGoogle((url, init) => {
      if (url.includes("/token")) {
        const assertion = (init?.body as URLSearchParams).get("assertion")!;
        const [header, payload, signature] = assertion.split(".");
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
        expect(claims.sub).toBe(oauthAccount.email);
        expect(claims.scope).toContain("gmail.settings.sharing");
        expect(
          verify(
            "RSA-SHA256",
            Buffer.from(`${header}.${payload}`),
            publicKey,
            Buffer.from(signature, "base64url"),
          ),
        ).toBe(true);
        return Response.json({ access_token: "delegated" });
      }
      expect((init?.headers as any).authorization).toBe("Bearer delegated");
      calls.push({
        url,
        method: init?.method,
        body: init?.body && JSON.parse(String(init.body)),
      });
      return Response.json({});
    });
    const command = (action: string, body = {}) =>
      googleCommand(oauthAccount, action, body);
    expect(await command("gmailAdministration")).toMatchObject({
      available: true,
      delegates: [],
      forwardingAddresses: [],
    });
    await command("gmailDelegate", {
      email: "delegate@example.com",
      sub: "attacker@example.com",
    });
    await command("gmailDelegate", {
      email: "delegate@example.com",
      operation: "delete",
    });
    await command("gmailForwarding", {
      email: "forward@example.com",
      operation: "create",
    });
    await command("gmailForwarding", {
      email: "forward@example.com",
      operation: "delete",
    });
    await command("gmailForwarding", {
      email: "forward@example.com",
      enabled: true,
      disposition: "archive",
    });
    await command("gmailForwarding", {
      enabled: false,
      disposition: "invalid",
    });
    await command("gmailAlias", {
      email: "alias@example.com",
      name: "Alias",
      replyTo: "reply@example.com",
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          body: { delegateEmail: "delegate@example.com" },
        }),
        expect.objectContaining({
          method: "PUT",
          body: {
            enabled: true,
            emailAddress: "forward@example.com",
            disposition: "archive",
          },
        }),
        expect.objectContaining({
          method: "PUT",
          body: { enabled: false, disposition: "leaveInInbox" },
        }),
        expect.objectContaining({
          method: "POST",
          body: {
            sendAsEmail: "alias@example.com",
            displayName: "Alias",
            replyToAddress: "reply@example.com",
          },
        }),
      ]),
    );
    db.setGoogle(() => Response.json({}, { status: 403 }));
    await expect(command("gmailAdministration")).rejects.toThrow(
      "Google rejected Workspace delegation",
    );
    await expect(googleCommand(account, "gmailDelegate", {})).rejects.toThrow(
      "Google OAuth",
    );
  });
  it("uses offline consent, PKCE, encrypted single-use state, and saves the Gmail account", async () => {
    const { url } = await beginGoogle(db.store, "ada", true);
    const params = new URL(url).searchParams;
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("scope")).toContain("calendar.readonly");
    expect(params.get("scope")).toContain("/auth/tasks");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("redirect_uri")).toBe(
      "https://suite.example/api/auth/suiteleaf/mail/google/callback",
    );
    let verifier = "";
    db.setGoogle((url, init) => {
      if (url.includes("/token")) {
        const p = init?.body as URLSearchParams;
        verifier = p.get("code_verifier") || "";
        return Response.json({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
        });
      }
      return Response.json({ emailAddress: "ada@gmail.com" });
    });
    const result = await finishGoogle(
      db.store,
      params.get("state")!,
      "authorization-code",
    );
    expect(verifier.length).toBeGreaterThan(40);
    expect(result).toMatchObject({
      provider: "gmail",
      email: "ada@gmail.com",
      imap: { host: "imap.gmail.com", password: "" },
      smtp: { host: "smtp.gmail.com", port: 465 },
      oauth: { refreshToken: "refresh" },
    });
    expect(publicAccount(result)).not.toHaveProperty("oauth");
    expect(publicAccount(result)).toHaveProperty("oauthConnected", true);
    expect(validateAccount(result)).toBe(result);
    await expect(
      finishGoogle(db.store, params.get("state")!, "again"),
    ).rejects.toThrow("already used");
    const reconnect = new URL((await beginGoogle(db.store, "ada")).url);
    const next = await finishGoogle(
      db.store,
      reconnect.searchParams.get("state")!,
      "next",
    );
    expect(next.id).toBe(result.id);
    expect(reconnect.searchParams.get("scope")).not.toContain("calendar");
  });
  it("rejects expired, declined, insufficient and misconfigured authorization", async () => {
    await expect(
      finishGoogle(
        db.store,
        db.store.seal({ user: "ada", key: "expired", expiresAt: 0 }),
        "code",
      ),
    ).rejects.toThrow("expired");
    const { url } = await beginGoogle(db.store, "ada");
    db.setGoogle(() =>
      Response.json({ access_token: "access", expires_in: 3600 }),
    );
    await expect(
      finishGoogle(db.store, new URL(url).searchParams.get("state")!, "code"),
    ).rejects.toThrow("offline access");
    const { url: bad } = await beginGoogle(db.store, "ada");
    db.setGoogle(() => Response.json({ error: "denied" }, { status: 400 }));
    await expect(
      finishGoogle(db.store, new URL(bad).searchParams.get("state")!, "code"),
    ).rejects.toThrow("authorization failed");
    const { url: noMail } = await beginGoogle(db.store, "ada");
    db.setGoogle((url) =>
      url.includes("/token")
        ? Response.json({
            access_token: "a",
            refresh_token: "r",
            expires_in: 3600,
          })
        : Response.json({}),
    );
    await expect(
      finishGoogle(
        db.store,
        new URL(noMail).searchParams.get("state")!,
        "code",
      ),
    ).rejects.toThrow("mailbox");
    vi.stubEnv("SUITELEAF_GMAIL_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    await expect(beginGoogle(db.store, "ada")).rejects.toThrow(
      "not configured",
    );
  });
  it("refreshes expired tokens server-side and retains the refresh token", async () => {
    await db.store.put("ada", oauthAccount);
    db.setGoogle(() =>
      Response.json({ access_token: "renewed", expires_in: 3600 }),
    );
    expect(await authorizedAccount(db.store, "ada", account)).toEqual(account);
    expect(await authorizedAccount(db.store, "ada", oauthAccount)).toEqual(
      oauthAccount,
    );
    const refreshed = await authorizedAccount(db.store, "ada", {
      ...oauthAccount,
      oauth: { ...oauthAccount.oauth, expiresAt: 0 },
    });
    expect(refreshed.oauth).toMatchObject({
      accessToken: "renewed",
      refreshToken: "refresh",
    });
    expect((await db.store.get("ada", "a")).oauth?.accessToken).toBe("renewed");
    db.setGoogle(() =>
      Response.json({
        access_token: "renewed",
        refresh_token: "rotated",
        expires_in: 3600,
      }),
    );
    expect(
      (
        await authorizedAccount(db.store, "ada", {
          ...oauthAccount,
          oauth: { ...oauthAccount.oauth, expiresAt: 0 },
        })
      ).oauth?.refreshToken,
    ).toBe("rotated");
  });
});
describe("Gmail and Google service adapters", () => {
  const command = (action: string, body: Record<string, unknown> = {}) =>
    googleCommand(oauthAccount, action, body);
  it("reads settings and creates, renames and removes labels and filters", async () => {
    const calls: { url: string; method: string; body: any }[] = [];
    db.setGoogle((url, init) => {
      calls.push({
        url,
        method: init?.method || "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Response.json(
        url.endsWith("/labels")
          ? { labels: [{ id: "Label_1", name: "News" }] }
          : url.endsWith("/filters")
            ? { filter: [{ id: "f" }] }
            : url.endsWith("/sendAs")
              ? { sendAs: [{ sendAsEmail: account.email }] }
              : {},
      );
    });
    expect(await command("gmailSettings")).toMatchObject({
      labels: [{ name: "News" }],
      filters: [{ id: "f" }],
      sendAs: [{ sendAsEmail: account.email }],
    });
    await command("gmailLabel", { operation: "create", name: "Projects" });
    await command("gmailLabel", {
      operation: "rename",
      id: "Label_1",
      name: "Updated",
    });
    await command("gmailLabel", { operation: "delete", id: "Label_1" });
    await command("gmailFilter", {
      query: "from:news",
      addLabelIds: ["Label_1"],
      removeLabelIds: ["INBOX"],
      forward: "forward@example.com",
    });
    await command("gmailFilter", { operation: "delete", id: "f" });
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          body: {
            criteria: { query: "from:news" },
            action: {
              addLabelIds: ["Label_1"],
              removeLabelIds: ["INBOX"],
              forward: "forward@example.com",
            },
          },
        }),
        expect.objectContaining({ method: "PATCH", body: { name: "Updated" } }),
        expect.objectContaining({ method: "DELETE" }),
      ]),
    );
    await expect(
      command("gmailLabel", { operation: "create", name: "bad\r\nname" }),
    ).rejects.toThrow("Invalid");
    await expect(command("bad")).rejects.toThrow("Unsupported");
  });
  it("updates vacation and signatures, reads contacts/calendar, and manages tasks", async () => {
    const calls: any[] = [];
    db.setGoogle((url, init) => {
      calls.push({ url, init });
      if (url.includes("people.googleapis.com"))
        return Response.json({
          connections: [
            {
              names: [{ displayName: "Lin" }],
              emailAddresses: [{ value: "lin@example.com" }],
            },
            { emailAddresses: [{ value: "sam@example.com" }] },
            {},
          ],
        });
      return Response.json({ items: [] });
    });
    await command("gmailVacation", {
      enabled: true,
      subject: "Away",
      text: "Back Monday",
      contactsOnly: true,
      startTime: "2026-11-01",
      endTime: "2026-11-10",
    });
    await command("gmailSignature", {
      email: account.email,
      html: "<b>Ada</b>",
    });
    expect(await command("googleContacts")).toEqual([
      { name: "Lin", email: "lin@example.com" },
      { name: "sam@example.com", email: "sam@example.com" },
    ]);
    await command("googleCalendar");
    await command("googleTasks");
    await command("googleAddTask", {
      title: "Follow up",
      notes: "From email",
      due: "2026-12-01",
    });
    await command("googleCompleteTask", { id: "task/id" });
    expect(
      calls.find((c) => c.url.endsWith("/settings/vacation")).init.method,
    ).toBe("PUT");
    expect(calls.find((c) => c.url.includes("task%2Fid")).init.method).toBe(
      "PATCH",
    );
    expect(
      calls.every((c) => c.init.headers.authorization === "Bearer access"),
    ).toBe(true);
    db.setGoogle(() => new Response(null, { status: 204 }));
    expect(
      await command("gmailLabel", { operation: "delete", id: "a" }),
    ).toEqual({});
  });
  it("surfaces permission failures and handles empty provider collections", async () => {
    await expect(googleCommand(account, "gmailSettings", {})).rejects.toThrow(
      "Connect this account",
    );
    db.setGoogle(() =>
      Response.json({ error: "secret server response" }, { status: 403 }),
    );
    await expect(command("gmailSettings")).rejects.toThrow(
      "Google rejected this operation (403)",
    );
    db.setGoogle(() => Response.json({}));
    expect(await command("gmailSettings")).toMatchObject({
      labels: [],
      filters: [],
      sendAs: [],
    });
    expect(await command("googleContacts")).toEqual([]);
    await command("gmailVacation", {});
    await command("gmailFilter", {
      query: "is:unread",
      addLabelIds: "invalid",
      removeLabelIds: null,
    });
    await command("googleAddTask", { title: "Task" });
  });
});
