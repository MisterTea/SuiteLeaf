import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authOptions,
  envFromProcess,
  nextcloudProvider,
  plugins,
  providers,
  type AuthEnv,
} from "../services/auth/src/options";

const secret = "s".repeat(32);
const nextcloud = { url: "https://cloud.example.com", clientId: "id", clientSecret: "pw" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("auth environment", () => {
  it("requires a long shared secret", () => {
    expect(() => envFromProcess({})).toThrow(/at least 32 characters/);
    expect(() => envFromProcess({ SUITELEAF_AUTH_SECRET: "short" })).toThrow();
    expect(envFromProcess({ BETTER_AUTH_SECRET: secret }).secret).toBe(secret);
  });

  it("defaults to the local node and the desktop app origin", () => {
    expect(envFromProcess({ SUITELEAF_AUTH_SECRET: secret })).toEqual({
      baseURL: "http://127.0.0.1:8787",
      secret,
      trustedOrigins: ["http://127.0.0.1:8787", "suiteleaf://app"],
      google: undefined,
      github: undefined,
      nextcloud: undefined,
    });
  });

  it("reads providers only when both halves of a client pair are set", () => {
    const env = envFromProcess({
      SUITELEAF_AUTH_SECRET: secret,
      SUITELEAF_PUBLIC_URL: "https://suite.example.com",
      SUITELEAF_TRUSTED_ORIGINS: " https://web.example.com, ,suiteleaf://app",
      GOOGLE_CLIENT_ID: "g",
      GOOGLE_CLIENT_SECRET: "gs",
      GITHUB_CLIENT_ID: "only-id",
      NEXTCLOUD_CLIENT_ID: "n",
      NEXTCLOUD_CLIENT_SECRET: "ns",
      NEXTCLOUD_URL: "https://cloud.example.com///",
    });
    expect(env.trustedOrigins).toEqual([
      "https://suite.example.com",
      "https://web.example.com",
      "suiteleaf://app",
    ]);
    expect(env.google).toEqual({ clientId: "g", clientSecret: "gs" });
    expect(env.github).toBeUndefined();
    expect(env.nextcloud).toEqual({
      clientId: "n",
      clientSecret: "ns",
      url: "https://cloud.example.com",
    });
    expect(providers(env)).toEqual(["google", "nextcloud"]);
    expect(
      envFromProcess({
        SUITELEAF_AUTH_SECRET: secret,
        NEXTCLOUD_CLIENT_ID: "n",
        NEXTCLOUD_CLIENT_SECRET: "ns",
      }).nextcloud,
    ).toBeUndefined();
  });

  it("lists every configured provider and keeps the same plugins without them", () => {
    const env: AuthEnv = {
      baseURL: "http://x",
      secret,
      trustedOrigins: [],
      google: { clientId: "a", clientSecret: "b" },
      github: { clientId: "c", clientSecret: "d" },
      nextcloud,
    };
    expect(providers(env)).toEqual(["google", "github", "nextcloud"]);
    expect(plugins().map((p) => p.id)).toEqual(plugins(env).map((p) => p.id));
    const options = authOptions(env, undefined);
    expect(Object.keys(options.socialProviders)).toEqual(["google", "github"]);
  });
});

describe("Nextcloud profile", () => {
  const userInfo = (response: Response) => {
    const fetcher = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetcher);
    return nextcloudProvider(nextcloud)
      .getUserInfo({ accessToken: "t" })
      .then((user) => ({ user, fetcher }));
  };

  it("points at the Nextcloud OAuth endpoints", () => {
    const provider = nextcloudProvider(nextcloud);
    expect(provider.authorizationUrl).toBe(
      "https://cloud.example.com/index.php/apps/oauth2/authorize",
    );
    expect(provider.tokenUrl).toBe(
      "https://cloud.example.com/index.php/apps/oauth2/api/v1/token",
    );
  });

  it("names a user without an email or display name by their ID", async () => {
    const { user, fetcher } = await userInfo(
      Response.json({ ocs: { data: { id: "ann", email: null } } }),
    );
    expect(user).toEqual({
      id: "ann",
      email: "ann@nextcloud.invalid",
      name: "ann",
      emailVerified: false,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://cloud.example.com/ocs/v2.php/cloud/user?format=json",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer t" }),
      }),
    );
  });

  it("returns no user for a failed or empty profile", async () => {
    expect((await userInfo(new Response("", { status: 401 }))).user).toBeNull();
    expect((await userInfo(Response.json({ ocs: {} }))).user).toBeNull();
  });
});

describe("account hooks", () => {
  type Row = { id: string; role?: string | null; banned?: boolean | number | null };
  let users: Row[];
  let audit: ReturnType<typeof vi.fn>;
  const adapter = () => ({
    count: async () => users.length,
    findOne: async ({ where }: { where: { value: string }[] }) =>
      users.find((u) => u.id === where[0].value) ?? null,
    findMany: async () => users,
  });
  const context = (extra: Record<string, unknown> = {}) =>
    ({ context: { adapter: adapter(), session: null }, ...extra }) as never;
  const hooks = () =>
    authOptions({ baseURL: "http://x", secret, trustedOrigins: [] }, undefined)
      .databaseHooks;

  beforeEach(() => {
    users = [];
    audit = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", audit);
    vi.stubEnv("SUITELEAF_INTERNAL_URL", "http://node.internal");
    vi.stubEnv("SUITELEAF_INTERNAL_TOKEN", "tok");
  });

  it("makes the first account an admin", async () => {
    const create = hooks().user.create;
    const user = { id: "u1", email: "a@x", name: "A" } as never;
    expect(await create.before(user, context())).toEqual({
      data: { id: "u1", email: "a@x", name: "A", role: "admin" },
    });
    users = [{ id: "u0" }];
    expect(await create.before(user, context())).toBeUndefined();
    expect(await create.before(user, null as never)).toBeUndefined();
  });

  it("audits account creation by the signed-in admin or the new user", async () => {
    const create = hooks().user.create;
    await create.after({ id: "u2", email: "b@x", name: "B" } as never, {
      context: { session: { user: { id: "admin" } } },
    } as never);
    await create.after({ id: "u3", email: null, name: "C" } as never, null as never);
    const bodies = audit.mock.calls.map(([, init]) => JSON.parse(init.body).data);
    expect(bodies[0]).toMatchObject({ actorId: "admin", action: "user.create", targetId: "u2", name: "b@x" });
    expect(bodies[1]).toMatchObject({ actorId: "u3", name: "C" });
    expect(audit.mock.calls[0][0]).toBe("http://node.internal/internal/db");
    expect(audit.mock.calls[0][1].headers["x-suiteleaf-internal"]).toBe("tok");
  });

  it("audits sign-ins and logs audit failures without failing them", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const after = hooks().session.create.after;
    const session = { id: "s1", userId: "u1", ipAddress: "1.2.3.4", userAgent: null } as never;
    await after(session, null as never);
    expect(JSON.parse(audit.mock.calls[0][1].body).data).toMatchObject({
      action: "sign-in",
      targetType: "session",
      name: "1.2.3.4",
    });
    audit.mockResolvedValueOnce(new Response("nope", { status: 503 }));
    await after(session, null as never);
    expect(error).toHaveBeenLastCalledWith("SuiteLeaf audit:", 503, "nope");
    audit.mockRejectedValueOnce(new Error("down"));
    await after(session, null as never);
    expect(error).toHaveBeenLastCalledWith("SuiteLeaf audit:", new Error("down"));
  });

  it("skips the audit outside a node", async () => {
    vi.stubEnv("SUITELEAF_INTERNAL_TOKEN", "");
    await hooks().session.create.after({ id: "s", userId: "u" } as never, null as never);
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses to demote or ban the last active admin", async () => {
    const before = hooks().user.update.before;
    users = [{ id: "a", role: "admin" }, { id: "b", role: "user" }, { id: "c", role: "admin", banned: 1 }];
    const update = (data: Record<string, unknown>, userId: unknown = "a") =>
      before(data as never, context({ body: { userId } }));
    await expect(update({ role: "user" })).rejects.toThrow("The server needs at least one admin.");
    await expect(update({ banned: true })).rejects.toThrow("The server needs at least one admin.");
    expect(await update({ name: "Renamed" })).toBeUndefined();
    expect(await update({ role: "user" }, "b")).toBeUndefined();
    expect(await update({ role: "user" }, "missing")).toBeUndefined();
    expect(await update({ role: "user" }, 5)).toBeUndefined();
    expect(await before({ role: "user" } as never, null as never)).toBeUndefined();
    users.push({ id: "d", role: "user,admin" });
    expect(await update({ role: "user" })).toBeUndefined();
  });

  it("refuses to delete the last active admin", async () => {
    const before = hooks().user.delete.before;
    users = [{ id: "a", role: "admin" }];
    await expect(before({ id: "a", role: "admin" } as never, context())).rejects.toThrow(
      "The server needs at least one admin.",
    );
    expect(await before({ id: "a", role: "admin", banned: true } as never, context())).toBeUndefined();
    expect(await before({ id: "u", role: "user" } as never, context())).toBeUndefined();
    expect(await before({ id: "a", role: "admin" } as never, null as never)).toBeUndefined();
    users.push({ id: "b", role: "admin" });
    expect(await before({ id: "a", role: "admin" } as never, context())).toBeUndefined();
  });
});
