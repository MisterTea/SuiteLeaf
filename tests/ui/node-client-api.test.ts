// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, serializeFile } from "../../packages/core/src";

const NODE = "https://leaf.example";
type Call = { url: string; method: string; headers: Headers; body: unknown };
let calls: Call[];
let route: (call: Call) => Response | Promise<Response> | undefined;

function jwt(exp: number) {
  const payload = btoa(JSON.stringify({ exp })).replace(/=+$/, "");
  return `h.${payload}.s`;
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const request = input instanceof Request ? input : null;
      const url = request ? request.url : String(input);
      const method = (init.method ?? request?.method ?? "GET").toUpperCase();
      const headers = new Headers(init.headers ?? request?.headers);
      let body: unknown = init.body ?? (request ? await request.text() : undefined);
      if (typeof body === "string" && /^[[{]/.test(body)) body = JSON.parse(body);
      const call = { url: url.replace(NODE, ""), method, headers, body };
      calls.push(call);
      const answer = await route(call);
      if (answer) return answer;
      if (call.url === "/api/auth/token") return Response.json({ token: jwt(Date.now() / 1000 + 3600) });
      return Response.json({});
    }),
  );
}

async function client() {
  return import("../../apps/web/src/node-client");
}

async function signedIn(extra: Record<string, unknown> = {}) {
  localStorage.setItem(
    "suiteleaf:node-session",
    JSON.stringify({ url: NODE, token: "session-token", user: { id: "u1" }, ...extra }),
  );
  return client();
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
  };
}

beforeEach(() => {
  vi.resetModules();
  for (const name of ["localStorage", "sessionStorage"])
    Object.defineProperty(globalThis, name, { value: memoryStorage(), configurable: true });
  calls = [];
  route = () => undefined;
  stubFetch();
});

afterEach(() => vi.unstubAllGlobals());

describe("node sessions", () => {
  it("ignores a stored session that is broken or incomplete", async () => {
    localStorage.setItem("suiteleaf:node-session", "{broken");
    expect((await client()).getSession()).toBeNull();
    vi.resetModules();
    localStorage.setItem("suiteleaf:node-session", JSON.stringify({ url: NODE }));
    expect((await client()).getSession()).toBeNull();
  });

  it("ends a stored session after its expiry", async () => {
    const { getSession, sessionEndReason } = await signedIn({
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
    expect(getSession("2025-12-31T00:00:00.000Z")?.token).toBe("session-token");
    expect(getSession("2026-02-01T00:00:00.000Z")).toBeNull();
    expect(sessionEndReason()).toBe("expired");
    expect(localStorage.getItem("suiteleaf:node-session")).toBeNull();
  });

  it("reads the providers a node offers", async () => {
    const { providers } = await client();
    route = ({ url }) =>
      url === "/api/auth/suiteleaf/providers"
        ? Response.json({ emailAndPassword: true, providers: ["github"] })
        : undefined;
    expect(await providers(NODE)).toMatchObject({ providers: ["github"] });
    route = () => new Response("", { status: 404 });
    await expect(providers(NODE)).rejects.toThrow(
      "This node does not offer sign-in. Check the address.",
    );
  });

  it("signs in by email or username and keeps the node's idle limit", async () => {
    const { signIn, getSession, onSession } = await client();
    const seen = vi.fn();
    const stop = onSession(seen);
    route = ({ url }) => {
      if (url.startsWith("/api/auth/sign-in/"))
        return Response.json({ token: "t1", user: { id: "u1", name: "Ann" } });
      if (url === "/api/node/info") return Response.json({ auth: { idleSecs: 600 } });
    };
    const session = await signIn(NODE, "ann@example.com", "pw");
    expect(session).toMatchObject({ url: NODE, token: "t1", idleSecs: 600 });
    expect(calls[0]).toMatchObject({
      url: "/api/auth/sign-in/email",
      body: { email: "ann@example.com", password: "pw" },
    });
    expect(seen).toHaveBeenCalledWith(session);
    stop();
    route = ({ url }) => {
      if (url.startsWith("/api/auth/sign-in/"))
        return Response.json({ token: "t2", user: { id: "u1" } });
      if (url === "/api/node/info") throw new Error("offline");
    };
    await signIn(NODE, "ann", "pw");
    expect(calls.find((c) => c.url === "/api/auth/sign-in/username")?.body).toEqual({
      username: "ann",
      password: "pw",
    });
    expect(getSession()).toMatchObject({ token: "t2", idleSecs: undefined });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("suiteleaf:node-session")!).token).toBe("t2");
  });

  it("explains a rejected sign-in", async () => {
    const { signIn } = await client();
    route = () => Response.json({ message: "Invalid password" }, { status: 401 });
    await expect(signIn(NODE, "ann", "bad")).rejects.toThrow("Invalid password");
    route = () => Response.json({}, { status: 200 });
    await expect(signIn(NODE, "ann", "bad")).rejects.toThrow(
      "The node rejected the request.",
    );
  });

  it("signs up and leaves an empty username out", async () => {
    const { signUp } = await client();
    route = ({ url }) => {
      if (url === "/api/auth/sign-up/email")
        return Response.json({
          token: "t3",
          user: { id: "u2" },
          session: { expiresAt: "2030-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        });
      if (url === "/api/node/info") return new Response("", { status: 500 });
    };
    const session = await signUp(NODE, { name: "B", email: "b@x", username: "", password: "longpass" });
    expect(session).toMatchObject({ token: "t3", expiresAt: "2030-01-01T00:00:00.000Z" });
    expect(calls[0].body).toEqual({ name: "B", email: "b@x", password: "longpass" });
    route = () => Response.json({ message: "Taken" }, { status: 422 });
    await expect(signUp(NODE, { name: "B", email: "b@x", password: "x" })).rejects.toThrow("Taken");
  });

  it("completes a social sign-in hand-off", async () => {
    const { completeHandoff, socialStartUrl, pendingHandoffUrl } = await client();
    const start = socialStartUrl(NODE, "git hub");
    expect(start).toBe(
      `${NODE}/api/auth/suiteleaf/start?provider=git%20hub&redirect=${encodeURIComponent("http://127.0.0.1:4173/")}`,
    );
    expect(pendingHandoffUrl()).toBe(NODE);
    expect(pendingHandoffUrl()).toBeNull();
    route = ({ url }) =>
      url === "/api/auth/one-time-token/verify"
        ? Response.json({ session: { token: "t4" }, user: { id: "u3" } })
        : undefined;
    expect(await completeHandoff(NODE, "once")).toMatchObject({ token: "t4", user: { id: "u3" } });
    route = () => Response.json({}, { status: 400 });
    await expect(completeHandoff(NODE, "once")).rejects.toThrow("The node rejected the request.");
  });

  it("signs out locally first and revokes on the node", async () => {
    const { signOut, getSession, sessionEndReason } = await signedIn();
    await signOut();
    expect(getSession()).toBeNull();
    expect(sessionEndReason()).toBe("signed-out");
    const revoke = calls.find((c) => c.url === "/api/auth/sign-out")!;
    expect(revoke.headers.get("authorization")).toBe("Bearer session-token");
    expect(localStorage.getItem("suiteleaf:signing-out")).toBeNull();
    await signOut();
    expect(calls.filter((c) => c.url === "/api/auth/sign-out")).toHaveLength(1);
  });

  it("finishes a sign-out the app closed during", async () => {
    const { finishSignOut } = await client();
    await finishSignOut();
    expect(calls).toHaveLength(0);
    localStorage.setItem(
      "suiteleaf:signing-out",
      JSON.stringify({ url: NODE, token: "old" }),
    );
    route = () => {
      throw new Error("offline");
    };
    await finishSignOut();
    expect(calls[0].url).toBe("/api/auth/sign-out");
    expect(localStorage.getItem("suiteleaf:signing-out")).toBeNull();
    localStorage.setItem("suiteleaf:signing-out", "{not json");
    await finishSignOut();
    expect(localStorage.getItem("suiteleaf:signing-out")).toBeNull();
  });
});

describe("authenticated requests", () => {
  it("need a session", async () => {
    const { api, accessToken } = await client();
    await expect(api("/api/me")).rejects.toThrow("Sign in to SuiteDrive first.");
    await expect(accessToken()).rejects.toThrow("Sign in to SuiteDrive first.");
  });

  it("use a cached short-lived token and fall back to the session token", async () => {
    const { accessToken } = await signedIn();
    const first = await accessToken();
    expect(first).toMatch(/^h\./);
    expect(await accessToken()).toBe(first);
    expect(calls.filter((c) => c.url === "/api/auth/token")).toHaveLength(1);

    vi.resetModules();
    const unavailable = await signedIn();
    route = ({ url }) => (url === "/api/auth/token" ? new Response("", { status: 404 }) : undefined);
    expect(await unavailable.accessToken()).toBe("session-token");
    route = ({ url }) => (url === "/api/auth/token" ? Response.json({ token: "not-a-jwt" }) : undefined);
    expect(await unavailable.accessToken()).toBe("session-token");
  });

  it("turn network failures, 401s, and server errors into clear messages", async () => {
    const { api, getSession, sessionEndReason } = await signedIn();
    route = ({ url }) => {
      if (url === "/api/a") throw new TypeError("Failed to fetch");
      if (url === "/api/b") return Response.json({ error: "No such file." }, { status: 404 });
      if (url === "/api/c") return new Response("oops", { status: 502 });
      if (url === "/api/d") return Response.json({ item: {} }, { status: 409 });
      if (url === "/api/e") return new Response("", { status: 401 });
    };
    await expect(api("/api/a")).rejects.toThrow(
      "SuiteDrive is unreachable. Your changes stay on this device.",
    );
    await expect(api("/api/b")).rejects.toMatchObject({ status: 404, message: "No such file." });
    await expect(api("/api/c")).rejects.toThrow("SuiteDrive request failed (502).");
    expect((await api("/api/d")).status).toBe(409);
    await expect(api("/api/e")).rejects.toThrow("Your SuiteDrive session ended. Sign in again.");
    expect(getSession()).toBeNull();
    expect(sessionEndReason()).toBe("expired");
  });
});

describe("drive and admin endpoints", () => {
  it("send each request to its route", async () => {
    const { drive, adminApi, currentAccount } = await signedIn();
    route = ({ url }) => {
      if (url === "/api/auth/token") return undefined;
      if (url.endsWith("/content")) return new Response("body", { headers: { etag: '"v9"' } });
      if (url.includes("/content?version=")) return new Response("old");
      return Response.json({
        hits: ["hit"],
        spreadsheets: ["sheet"],
        items: ["item"],
        folders: ["folder"],
        accounts: ["acct"],
        groups: ["group"],
        notices: ["notice"],
        comments: ["comment"],
        people: ["person"],
        versions: ["version"],
        users: ["user"],
        id: "x",
      });
    };
    const results: [unknown, string, string, unknown?][] = [
      [await drive.search("a b"), "GET", "/api/drive/search?q=a%20b"],
      [await drive.spreadsheets(), "GET", "/api/drive/spreadsheets"],
      [await drive.list(), "GET", "/api/drive/items"],
      [await drive.list("f/1"), "GET", "/api/drive/items?parent=f%2F1"],
      [await drive.shared(), "GET", "/api/drive/items?shared=1"],
      [await drive.listTrashed(), "GET", "/api/drive/trash"],
      [await drive.listFolders(), "GET", "/api/drive/folders"],
      [await drive.deleteForever("i"), "DELETE", "/api/drive/items/i"],
      [await drive.get("i"), "GET", "/api/drive/items/i"],
      [await drive.create({ name: "n", kind: "folder" }), "POST", "/api/drive/items", { name: "n", kind: "folder" }],
      [await drive.update("i", { trashed: true }), "PATCH", "/api/drive/items/i", { trashed: true }],
      [await drive.read("i"), "GET", "/api/drive/items/i/content"],
      [await drive.accounts("ann"), "GET", "/api/accounts?q=ann"],
      [await drive.searchGroups("ops"), "GET", "/api/drive/groups?q=ops"],
      [await drive.access("i"), "GET", "/api/drive/items/i/access"],
      [await drive.explanation("i"), "GET", "/api/drive/items/i/explanation"],
      [await drive.share("i", "u2", "editor"), "PUT", "/api/drive/items/i/acl", { principalType: "user", principalId: "u2", role: "editor" }],
      [await drive.notices(), "GET", "/api/drive/notices"],
      [await drive.dismissNotice("n"), "POST", "/api/drive/notices/n/dismiss"],
      [await drive.keepCopy("i"), "POST", "/api/drive/items/i/copy"],
      [await drive.expire("i", "g", null, "group"), "PUT", "/api/drive/items/i/expiry", { principalId: "g", principalType: "group", expiresAt: null }],
      [await drive.transfer("i", "u2"), "POST", "/api/drive/items/i/owner", { userId: "u2" }],
      [await drive.comments("i"), "GET", "/api/drive/items/i/comments"],
      [await drive.comment("i", "hi"), "POST", "/api/drive/items/i/comments", { body: "hi" }],
      [await drive.presence("i"), "GET", "/api/drive/items/i/presence"],
      [await drive.reportPresence("i", true), "POST", "/api/drive/items/i/presence", { editing: true }],
      [await drive.versions("i"), "GET", "/api/drive/items/i/versions"],
      [await drive.readVersion("i", "v 1"), "GET", "/api/drive/items/i/content?version=v%201"],
      [await drive.nameVersion("i", "v", "Final"), "PATCH", "/api/drive/items/i/versions/v", { name: "Final" }],
      [await drive.restoreVersion("i", "v"), "POST", "/api/drive/items/i/versions/v/restore"],
      [await drive.copyVersion("i", "v", "Copy"), "POST", "/api/drive/items/i/versions/v/copy", { name: "Copy" }],
      [await drive.createRespondLink("i"), "POST", "/api/drive/items/i/respond-link"],
      [await drive.clearRespondLink("i"), "DELETE", "/api/drive/items/i/respond-link"],
      [await currentAccount(), "GET", "/api/me"],
      [await adminApi.replication(), "GET", "/api/admin/replication"],
      [await adminApi.backup(), "GET", "/api/admin/backup"],
      [await adminApi.organizationExport(), "GET", "/api/admin/export"],
      [await adminApi.users(), "GET", "/api/admin/users"],
      [await adminApi.users("ann", "g1"), "GET", "/api/admin/users?q=ann&group=g1"],
      [await adminApi.user("u"), "GET", "/api/admin/users/u"],
      [await adminApi.createUser({ name: "n", email: "e", password: "p" }), "POST", "/api/admin/users", { name: "n", email: "e", password: "p" }],
      [await adminApi.updateUser("u", { name: "N" }), "PATCH", "/api/admin/users/u", { name: "N" }],
      [await adminApi.setRole("u", "admin"), "POST", "/api/admin/users/u/role", { role: "admin" }],
      [await adminApi.setBanned("u", true), "POST", "/api/admin/users/u/banned", { banned: true }],
      [await adminApi.setPassword("u", "pw"), "POST", "/api/admin/users/u/password", { password: "pw" }],
      [await adminApi.revokeSessions("u"), "DELETE", "/api/admin/users/u/sessions"],
      [await adminApi.removeUser("u"), "DELETE", "/api/admin/users/u", { ownerId: null }],
      [await adminApi.removeUser("u", "o"), "DELETE", "/api/admin/users/u", { ownerId: "o" }],
      [await adminApi.groups(), "GET", "/api/admin/groups"],
      [await adminApi.group("g"), "GET", "/api/admin/groups/g"],
      [await adminApi.createGroup("Ops"), "POST", "/api/admin/groups", { name: "Ops" }],
      [await adminApi.renameGroup("g", "Dev"), "PATCH", "/api/admin/groups/g", { name: "Dev" }],
      [await adminApi.deleteGroup("g"), "DELETE", "/api/admin/groups/g"],
      [await adminApi.addMember("g", "user", "u"), "POST", "/api/admin/groups/g/members", { memberType: "user", memberId: "u" }],
      [await adminApi.memberPlan("g", "u", true), "POST", "/api/admin/groups/g/member-plan", { memberId: "u", adding: true }],
      [await adminApi.editorPolicy(), "GET", "/api/admin/editor-policy"],
      [await adminApi.applyEditorPolicy("s"), "POST", "/api/admin/editor-policy", { stamp: "s" }],
      [await adminApi.removeMember("g", "group", "h"), "DELETE", "/api/admin/groups/g/members", { memberType: "group", memberId: "h" }],
    ];
    const requests = calls.filter((c) => c.url !== "/api/auth/token");
    expect(requests).toHaveLength(results.length);
    results.forEach(([, method, url, body], i) => {
      expect(requests[i]).toMatchObject({ method, url });
      if (body !== undefined) expect(requests[i].body).toEqual(body);
      expect(requests[i].headers.get("authorization")).toMatch(/^Bearer h\./);
    });
    expect(results[0][0]).toEqual(["hit"]);
    expect(results[11][0]).toEqual({ text: "body", versionId: "v9" });
    expect(results[27][0]).toBe("old");
    expect(results[37][0]).toEqual(["user"]);
  });

  it("reads content without a version tag", async () => {
    const { drive } = await signedIn();
    route = () => new Response("text");
    expect(await drive.read("i")).toEqual({ text: "text", versionId: undefined });
  });
});

describe("drive files", () => {
  const item = (extra = {}) => ({
    id: "i1",
    name: "Report.sldoc",
    headVersionId: "v2",
    ...extra,
  });

  it("opens a drive file as a linked record", async () => {
    const { openDriveFile } = await signedIn();
    const file = createFile("doc", "Report");
    route = () => new Response(serializeFile(file), { headers: { etag: '"v1"' } });
    const record = await openDriveFile(item() as never);
    expect(record.file.title).toBe("Report");
    expect(record.drive).toEqual({
      nodeUrl: NODE,
      itemId: "i1",
      versionId: "v1",
      syncedAt: record.file.updatedAt,
      name: "Report.sldoc",
    });
  });

  it("uploads a new version, renames to the title, and reports conflicts", async () => {
    const { uploadDriveFile, DriveConflict } = await signedIn();
    const file = createFile("doc", "Report");
    route = ({ method }) =>
      method === "PUT"
        ? Response.json(item({ name: "Old.sldoc" }))
        : method === "PATCH"
          ? Response.json(item({ headVersionId: null }))
          : undefined;
    const link = await uploadDriveFile(file, { nodeUrl: NODE, itemId: "i1", versionId: "v1" } as never);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("if-match")).toBe('"v1"');
    expect(put.headers.get("content-type")).toBe("application/vnd.suiteleaf.doc+json");
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ name: "Report.sldoc" });
    expect(link).toMatchObject({ versionId: undefined, name: "Report.sldoc", syncedAt: file.updatedAt });

    route = ({ method }) =>
      method === "PUT" ? Response.json({ item: item({ name: "Theirs" }) }, { status: 409 }) : undefined;
    await expect(
      uploadDriveFile(file, { nodeUrl: NODE, itemId: "i1" } as never),
    ).rejects.toBeInstanceOf(DriveConflict);
    expect(calls.filter((c) => c.method === "PUT").at(-1)!.headers.get("if-match")).toBeNull();
  });

  it("imports a large file in contiguous bounded UTF-8 chunks and commits only at the end", async () => {
    const { saveNewDriveFile } = await signedIn();
    const file = createFile("doc", "Report");
    // Multibyte data makes character offsets differ from the required byte offsets.
    if (file.kind !== "doc") throw new Error("Expected a document");
    file.content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "é".repeat(2_500_000) }] }] };
    const expected = new TextEncoder().encode(serializeFile(file));
    let accepted = 0;
    const chunks: Uint8Array[] = [];
    route = ({ method, headers, body }) => {
      if (method === "POST") return Response.json(item({ name: "Report.sldoc" }));
      if (method === "PUT") {
        const chunk = body as Uint8Array;
        expect(chunk.byteLength).toBeLessThanOrEqual(262_144);
        expect(headers.get("content-range")).toBe(
          `bytes ${accepted}-${accepted + chunk.length - 1}/${expected.length}`,
        );
        chunks.push(chunk);
        accepted += chunk.length;
        return accepted === expected.length
          ? Response.json(item({ headVersionId: "imported" }))
          : Response.json({ accepted }, { status: 202 });
      }
      if (method === "PATCH") return Response.json(item({ headVersionId: "imported" }));
    };
    const link = await saveNewDriveFile(file, null, "Report.sldoc");
    expect(expected.length).toBeGreaterThan(4_500_000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(Buffer.concat(chunks).equals(Buffer.from(expected))).toBe(true);
    expect(link.versionId).toBe("imported");
  });

  it("restores a version, and refuses a stale restore", async () => {
    const { drive, DriveConflict } = await signedIn();
    route = () => Response.json(item());
    expect(await drive.restoreVersion("i1", "v1", "v2")).toMatchObject({ id: "i1" });
    expect(calls.at(-1)!.headers.get("if-match")).toBe('"v2"');
    route = () => Response.json({ item: item() }, { status: 409 });
    await expect(drive.restoreVersion("i1", "v1")).rejects.toBeInstanceOf(DriveConflict);
  });

  it("saves a new file in a folder, or at the top when the folder refuses", async () => {
    const { saveNewDriveFile, DriveRequestError } = await signedIn();
    const file = createFile("sheet", "Budget");
    let refuse = true;
    route = ({ method, body }) => {
      if (method === "POST") {
        if (refuse && (body as { parentId: string | null }).parentId)
          return Response.json({ error: "No access." }, { status: 403 });
        return Response.json(item({ id: "new", name: "Budget.slsheet" }));
      }
      if (method === "PUT") return Response.json(item({ id: "new", name: "Budget.slsheet", headVersionId: "h" }));
    };
    const link = await saveNewDriveFile(file, "folder", "Budget.slsheet", { fallbackToRoot: true });
    expect(link).toMatchObject({ itemId: "new", versionId: "h", nodeUrl: NODE });
    const creates = calls.filter((c) => c.method === "POST");
    expect(creates.map((c) => (c.body as { parentId: unknown }).parentId)).toEqual(["folder", null]);
    await expect(saveNewDriveFile(file, "folder", "Budget.slsheet")).rejects.toBeInstanceOf(
      DriveRequestError,
    );
    refuse = false;
    expect((await saveNewDriveFile(file, "folder", "B.slsheet")).itemId).toBe("new");
  });

  it("runs locked drive writes one at a time", async () => {
    const { withDriveLock } = await client();
    const order: string[] = [];
    let release!: () => void;
    const first = withDriveLock(
      () => new Promise<void>((resolve) => (release = resolve)).then(() => order.push("first")),
    );
    const failing = withDriveLock(async () => {
      order.push("second");
      throw new Error("x");
    });
    const third = withDriveLock(async () => order.push("third"));
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await first;
    await expect(failing).rejects.toThrow("x");
    await third;
    expect(order).toEqual(["first", "second", "third"]);
  });
});
