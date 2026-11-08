import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  handler: vi.fn((_req: unknown, res: import("node:http").ServerResponse) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("better-auth");
  }),
  generateOneTimeToken: vi.fn<(input: { headers: Headers }) => Promise<{ token: string }>>(
    async () => ({ token: "one time" }),
  ),
  options: undefined as unknown,
  getSession: vi.fn(async () => null as null | { user: { id: string } }),
}));

vi.mock("better-auth", () => ({
  betterAuth: (options: unknown) => {
    fake.options = options;
    return { api: { generateOneTimeToken: fake.generateOneTimeToken, getSession: fake.getSession } };
  },
}));
vi.mock("better-auth/node", () => ({
  toNodeHandler: () => fake.handler,
  fromNodeHeaders: (headers: Record<string, string>) => new Headers(headers),
}));
vi.mock("../src/adapter", () => ({
  suitedbAdapter: (config: unknown) => ({ adapter: config }),
}));

let base: string;
const stdin: Record<string, () => void> = {};

beforeAll(async () => {
  vi.stubEnv("SUITELEAF_AUTH_SECRET", "s".repeat(32));
  vi.stubEnv("SUITELEAF_PUBLIC_URL", "http://auth.test");
  vi.stubEnv("SUITELEAF_TRUSTED_ORIGINS", "suiteleaf://app,https://web.example.com");
  vi.stubEnv("GITHUB_CLIENT_ID", "gh");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "ghs");
  vi.stubEnv("SUITELEAF_AUTH_PORT", "0");
  vi.stubEnv("SUITELEAF_INTERNAL_URL", "");
  vi.stubEnv("SUITELEAF_INTERNAL_TOKEN", "");
  await expect(import("../src/server")).rejects.toThrow(
    "SUITELEAF_INTERNAL_URL and SUITELEAF_INTERNAL_TOKEN are set by suiteleaf-node.",
  );
  vi.resetModules();
  vi.stubEnv("SUITELEAF_INTERNAL_URL", "http://node.internal");
  vi.stubEnv("SUITELEAF_INTERNAL_TOKEN", "tok");
  vi.stubEnv("SUITELEAF_EXIT_WITH_STDIN", "1");
  vi.spyOn(process.stdin, "on").mockImplementation(((event: string, listener: () => void) => {
    stdin[event] = listener;
    return process.stdin;
  }) as never);
  vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await import("../src/server");
  await vi.waitFor(() => expect(log).toHaveBeenCalled());
  base = `http://127.0.0.1:${/^SUITELEAF_AUTH_READY (\d+)$/.exec(log.mock.calls[0][0])![1]}`;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const get = (path: string) => fetch(`${base}${path}`, { redirect: "manual" });

describe("auth service", () => {
  it("requires a real auth session before handling mail", async () => {
    const response = await fetch(`${base}/api/auth/suiteleaf/mail`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer bad" }, body: JSON.stringify({ action: "accounts" }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in to use mail." });
    expect(fake.getSession).toHaveBeenCalled();
    fake.getSession.mockResolvedValueOnce({ user: { id: "ada" } });
    expect((await get("/api/auth/suiteleaf/mail")).status).toBe(405);
  });
  it("builds better-auth with the node's database adapter", () => {
    expect(fake.options).toMatchObject({
      baseURL: "http://auth.test",
      database: { adapter: { url: "http://node.internal", token: "tok" } },
    });
  });

  it("exits when the node closes its stdin", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    stdin.end();
    stdin.error();
    expect(exit.mock.calls).toEqual([[0], [0]]);
  });

  it("reports health and the enabled sign-in methods", async () => {
    expect(await (await get("/health")).text()).toBe("ok");
    expect(await (await get("/api/auth/suiteleaf/providers")).json()).toEqual({
      emailAndPassword: true,
      username: true,
      providers: ["github"],
    });
  });

  it("starts social sign-in only for a known provider and a trusted redirect", async () => {
    const bad = [
      "/api/auth/suiteleaf/start?provider=google&redirect=suiteleaf://app/",
      "/api/auth/suiteleaf/start?provider=github&redirect=https://evil.example/",
      "/api/auth/suiteleaf/start?provider=github&redirect=not%20a%20url",
      "/api/auth/suiteleaf/start?provider=github",
    ];
    for (const path of bad) {
      const response = await get(path);
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Unknown provider or untrusted redirect.");
    }
    const response = await get(
      "/api/auth/suiteleaf/start?provider=github&redirect=suiteleaf://app/index.html",
    );
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain('fetch("http://auth.test/api/auth/sign-in/social"');
    expect(page).toContain(
      "http://auth.test/api/auth/suiteleaf/complete?redirect=suiteleaf%3A%2F%2Fapp%2Findex.html",
    );
    expect(page).not.toMatch(/<\/script>.*<\/script>/s);
  });

  it("hands the session back to the redirect with a one-time token", async () => {
    expect((await get("/api/auth/suiteleaf/complete?redirect=https://evil.example/")).status).toBe(400);
    const response = await get(
      "/api/auth/suiteleaf/complete?redirect=https://web.example.com/app",
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://web.example.com/app#/auth-complete?token=one%20time",
    );
    expect(fake.generateOneTimeToken.mock.calls[0][0].headers).toBeInstanceOf(Headers);
  });

  it("hides token errors behind a generic message", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.generateOneTimeToken.mockRejectedValueOnce(new Error("no session"));
    const response = await get("/api/auth/suiteleaf/complete?redirect=suiteleaf://app/");
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Authentication service error.");
    expect(error).toHaveBeenCalledWith("Authentication or cloud service request failed.");
  });

  it("passes every other route to better-auth", async () => {
    expect(await (await get("/api/auth/get-session")).text()).toBe("better-auth");
    expect(fake.handler).toHaveBeenCalled();
  });
});
