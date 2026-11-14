import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Deployment script is plain ESM.
import { checkVercelPreview, runPreviewCheck } from "../scripts/check-vercel-preview.mjs";

const env = {
  VERCEL_TOKEN: "api-token",
  VERCEL_ORG_ID: "team-test",
  VERCEL_PROJECT_ID: "prj-test",
  PREVIEW_SHA: "a".repeat(40),
  VERCEL_AUTOMATION_BYPASS_SECRET: "preview-bypass",
};
const detail = {
  projectId: env.VERCEL_PROJECT_ID,
  ownerId: env.VERCEL_ORG_ID,
  meta: { githubCommitSha: env.PREVIEW_SHA },
  target: null,
  readyState: "READY",
  url: "suiteleaf-test.vercel.app",
};

function fixture({ states = ["READY"], deployment = {}, info = {}, providers = {}, html = '<div id="root"></div>' } = {} as {
  states?: string[];
  deployment?: Record<string, unknown>;
  info?: Record<string, unknown>;
  providers?: Record<string, unknown>;
  html?: string;
}) {
  let polls = 0;
  const request = vi.fn(async (url: string, _options?: RequestInit) => {
    if (url.includes("/v9/projects/")) return Response.json({ id: env.VERCEL_PROJECT_ID, accountId: env.VERCEL_ORG_ID });
    if (url.includes("/v7/deployments?")) {
      const state = states[Math.min(polls++, states.length - 1)];
      return Response.json({ deployments: state === "MISSING" ? [] : [{ uid: "dpl-test", state }] });
    }
    if (url.includes("/v13/deployments/")) return Response.json({ ...detail, ...deployment });
    if (url.endsWith("/api/node/info")) return Response.json({ mode: "cluster", database: "postgres", storage: "vercel-blob", auth: { enabled: true }, ...info });
    if (url.endsWith("/api/auth/suiteleaf/providers")) return Response.json({ inviteOnly: true, ...providers });
    return new Response(html);
  });
  const sleep = vi.fn(async () => {});
  return { request, sleep, attempts: 4 };
}

describe("Vercel PR preview verification", () => {
  it("reports success and a nonzero exit code on failure without exposing request details", async () => {
    const log = { log: vi.fn(), error: vi.fn() };
    expect(await runPreviewCheck(env, fixture(), log)).toBe(0);
    expect(log.log).toHaveBeenCalledWith("Vercel preview smoke test passed: https://suiteleaf-test.vercel.app");
    const request = vi.fn(async () => { throw new Error("secret credential"); });
    expect(await runPreviewCheck(env, { request }, log)).toBe(1);
    expect(log.error).toHaveBeenCalledOnce();
    expect(log.error.mock.calls[0][0]).not.toContain("secret credential");
    expect(await runPreviewCheck({ ...env, VERCEL_TOKEN: "" }, fixture(), log)).toBe(1);
    expect(log.error.mock.calls.at(-1)![0]).toContain("Configure VERCEL_TOKEN");
  });

  it("waits for the exact PR preview and checks web, backend, and auth without making another deployment", async () => {
    const options = fixture({ states: ["MISSING", "BUILDING", "READY"] });
    await expect(checkVercelPreview(env, options)).resolves.toBe("https://suiteleaf-test.vercel.app");
    expect(options.sleep).toHaveBeenCalledTimes(2);
    const list = options.request.mock.calls.find(([url]) => url.includes("/v7/"))!;
    expect(new URL(list[0]).searchParams.get("sha")).toBe(env.PREVIEW_SHA);
    expect(new URL(list[0]).searchParams.get("target")).toBe("preview");
    for (const [url, init] of options.request.mock.calls) {
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.redirect).toBe("error");
      expect(init?.headers).toEqual(url.startsWith("https://api.vercel.com/")
        ? { Authorization: "Bearer api-token" }
        : { "x-vercel-protection-bypass": "preview-bypass" });
    }
  });

  it.each(["ERROR", "CANCELED", "BLOCKED"])("fails an unhealthy deployment (%s)", async (state) => {
    const options = fixture({ states: [state] });
    await expect(checkVercelPreview(env, options)).rejects.toThrow(state);
    expect(options.request).toHaveBeenCalledTimes(2);
  });

  it("times out when no preview is built rather than passing an older deployment", async () => {
    const options = fixture({ states: ["MISSING"] });
    await expect(checkVercelPreview(env, options)).rejects.toThrow("Timed out");
    expect(options.sleep).toHaveBeenCalledTimes(3);
  });

  it.each([
    { projectId: "other" },
    { ownerId: "other-team" },
    { meta: { githubCommitSha: "b".repeat(40) } },
    { meta: {} },
    { target: "production" },
    { readyState: "ERROR" },
    { url: "suiteleaf.vercel.app.attacker.test" },
    { url: "suiteleaf.vercel.app/path" },
  ])("rejects the wrong deployment before disclosing bypass credentials: %j", async (deployment) => {
    const options = fixture({ deployment });
    await expect(checkVercelPreview(env, options)).rejects.toThrow();
    expect(options.request.mock.calls.every(([url]) => url.startsWith("https://api.vercel.com/"))).toBe(true);
  });

  it.each([
    { info: { mode: "single" } },
    { info: { database: "sqlite" } },
    { info: { storage: "disk" } },
    { info: { auth: { enabled: false } } },
    { providers: { inviteOnly: false } },
    { html: "Vercel login" },
  ])("fails incorrect runtime configuration or missing app HTML: %j", async (overrides) => {
    await expect(checkVercelPreview(env, fixture(overrides))).rejects.toThrow();
  });

  it("fails protected or broken HTTP endpoints", async () => {
    const options = fixture();
    const original = options.request.getMockImplementation()!;
    options.request.mockImplementation((url, init) => url.endsWith("/api/node/info")
      ? Promise.resolve(new Response("private response", { status: 401 })) : original(url, init));
    await expect(checkVercelPreview(env, options)).rejects.toThrow("HTTP 401");
  });

  it("rejects API authorization failures without logging their body", async () => {
    const request = vi.fn(async () => new Response("secret server response", { status: 403 }));
    await expect(checkVercelPreview(env, { request })).rejects.toThrow("Vercel API returned HTTP 403");
  });

  it("verifies project ownership", async () => {
    const request = vi.fn(async () => Response.json({ id: env.VERCEL_PROJECT_ID, accountId: "other-team" }));
    await expect(checkVercelPreview(env, { request })).rejects.toThrow("Unexpected Vercel team");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("requires configuration and a complete SHA before making a request", async () => {
    const options = fixture();
    await expect(checkVercelPreview({ ...env, VERCEL_TOKEN: "" }, options)).rejects.toThrow("Configure VERCEL_TOKEN");
    await expect(checkVercelPreview({ ...env, PREVIEW_SHA: "main" }, options)).rejects.toThrow("full PR commit SHA");
    expect(options.request).not.toHaveBeenCalled();
  });
});
