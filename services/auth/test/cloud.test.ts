import { createServer, request as nodeRequest, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  get: vi.fn(),
  head: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  list: vi.fn(),
  streamText: vi.fn(),
  gateway: vi.fn((id: string) => id),
  createGateway: vi.fn(),
}));
vi.mock("@vercel/blob", () => ({
  ...fake,
  BlobNotFoundError: class BlobNotFoundError extends Error {},
}));
vi.mock("ai", () => ({ streamText: fake.streamText }));
vi.mock("@ai-sdk/gateway", () => ({
  gateway: fake.gateway,
  createGateway: fake.createGateway,
}));
import { BlobNotFoundError } from "@vercel/blob";
import {
  acceptsBridgeToken,
  blobPath,
  cloudBlobRequest,
} from "../src/cloud-blobs";
import { cloudAiRequest, completionFrame } from "../src/cloud-ai";
import { authOptions } from "../src/options";

const token = "t".repeat(64),
  hash = "a".repeat(64);
let server: Server, base: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    res.on("error", () => {});
    const handle = req.url === "/ai" ? cloudAiRequest : cloudBlobRequest;
    void handle(req, res, token).catch(() => res.writeHead(503).end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
const request = (
  path: string,
  method = "GET",
  body?: string,
  auth = `Bearer ${token}`,
) =>
  fetch(`${base}${path}`, { method, body, headers: { authorization: auth } });
const blob = (method = "GET", body?: string) =>
  request(`/internal/cloud/blobs/${hash}`, method, body);

it("scopes the container OIDC credential to its authenticated Gateway request", async () => {
  const scoped = vi.fn((id: string) => id);
  fake.createGateway.mockReturnValue(scoped);
  fake.streamText.mockReturnValue({
    fullStream: (async function* () {
      yield { type: "text-delta", text: "ready" };
    })(),
  });
  const response = await fetch(`${base}/ai`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-vercel-oidc-token": "request-oidc",
    },
    body: JSON.stringify({ prompt: "hello" }),
  });
  expect(response.status).toBe(200);
  await response.text();
  expect(fake.createGateway).toHaveBeenCalledWith({
    apiKey: "request-oidc",
    headers: { "ai-gateway-auth-method": "oidc" },
  });
  expect(scoped).toHaveBeenCalledWith("openai/gpt-5-mini");
  expect(fake.gateway).not.toHaveBeenCalled();
});

it("validates bridge credentials and immutable hash paths", () => {
  expect(acceptsBridgeToken(undefined, token)).toBe(false);
  expect(acceptsBridgeToken(`Bearer ${token}`, token)).toBe(true);
  expect(acceptsBridgeToken("Bearer short", "short")).toBe(false);
  expect(blobPath(hash)).toBe(`suiteleaf/objects/aa/${"a".repeat(62)}`);
  for (const value of ["../secret", "A".repeat(64), "a".repeat(63)])
    expect(blobPath(value)).toBeNull();
});
it("rejects unauthorized requests and invalid methods or hashes", async () => {
  expect(
    (await request("/internal/cloud/blobs/usage", "GET", undefined, "wrong"))
      .status,
  ).toBe(401);
  expect((await request("/internal/cloud/blobs/invalid")).status).toBe(400);
  expect((await blob("PATCH")).status).toBe(405);
  expect(fake.get).not.toHaveBeenCalled();
});
it("streams private content and handles missing blobs", async () => {
  fake.get
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ statusCode: 304 })
    .mockResolvedValueOnce({
      statusCode: 200,
      stream: new Response("document").body,
    });
  expect((await blob()).status).toBe(404);
  expect((await blob()).status).toBe(404);
  expect(await (await blob()).text()).toBe("document");
  expect(fake.get).toHaveBeenLastCalledWith(blobPath(hash), {
    access: "private",
    useCache: false,
  });
});
it("writes immutable content, handles retries and concurrent creation", async () => {
  fake.head
    .mockRejectedValueOnce(new BlobNotFoundError())
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new BlobNotFoundError())
    .mockResolvedValueOnce({});
  fake.put
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error("already exists"));
  expect((await blob("PUT", "document")).status).toBe(204);
  expect((await blob("PUT", "document")).status).toBe(204);
  expect((await blob("PUT", "document")).status).toBe(204);
  expect(fake.put).toHaveBeenCalledTimes(2);
  expect(fake.put.mock.calls[0][2]).toMatchObject({
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
  });
});
it("does not acknowledge failed or oversized storage writes", async () => {
  fake.head.mockRejectedValue(new BlobNotFoundError());
  fake.put.mockRejectedValue(new Error("offline"));
  expect((await blob("PUT", "document")).status).toBe(503);
  expect((await blob("PUT", "x".repeat(2 * 1024 * 1024 + 1))).status).toBe(413);
  fake.head.mockRejectedValueOnce(new Error("store unavailable"));
  expect((await blob("HEAD")).status).toBe(503);
});
it("checks existence, deletes, and totals all storage pages", async () => {
  fake.head
    .mockRejectedValueOnce(new BlobNotFoundError())
    .mockResolvedValueOnce({});
  expect((await blob("HEAD")).status).toBe(404);
  expect((await blob("HEAD")).status).toBe(200);
  expect((await blob("DELETE")).status).toBe(204);
  expect(fake.del).toHaveBeenCalledWith(blobPath(hash));
  fake.list
    .mockResolvedValueOnce({
      blobs: [{ size: 3 }],
      hasMore: true,
      cursor: "next",
    })
    .mockResolvedValueOnce({ blobs: [{ size: 8 }], hasMore: false });
  expect(await (await request("/internal/cloud/blobs/usage")).json()).toBe(11);
});
it("streams Gateway text using the existing completion protocol", async () => {
  fake.streamText.mockReturnValue({
    fullStream: (async function* () {
      yield { type: "start" };
      yield { type: "text-delta", text: "Hello\nworld" };
    })(),
  });
  vi.stubEnv("SUITELEAF_AI_GATEWAY_MODEL", "openai/gpt-5-mini");
  const response = await request(
    "/ai",
    "POST",
    JSON.stringify({ prompt: "Write a greeting" }),
  );
  expect(await response.text()).toBe(
    completionFrame("Hello\nworld") + "data: [DONE]\n\n",
  );
  expect(fake.streamText.mock.calls[0][0].abortSignal.aborted).toBe(true);
  expect(fake.streamText.mock.calls[0][0].prompt).toBe("Write a greeting");
});
it("preserves Unicode when a request splits a multibyte character", async () => {
  fake.streamText.mockReturnValue({
    fullStream: (async function* () {
      yield { type: "text-delta", text: "ready" };
    })(),
  });
  const body = Buffer.from(JSON.stringify({ prompt: "A 🌱 grows" }));
  const cut = body.indexOf(Buffer.from("🌱")) + 1;
  await new Promise<void>((resolve, reject) => {
    const req = nodeRequest(
      `${base}/ai`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
      (res) => {
        res.resume();
        res.on("end", () => resolve());
      },
    );
    req.on("error", reject);
    req.write(body.subarray(0, cut));
    setTimeout(() => req.end(body.subarray(cut)), 20);
  });
  expect(fake.streamText.mock.calls[0][0].prompt).toBe("A 🌱 grows");
});
it("validates Gateway requests before spending tokens", async () => {
  expect((await request("/ai", "POST", "{}", "invalid")).status).toBe(401);
  for (const body of ["{", "null", "{}", '{"prompt":3}'])
    expect((await request("/ai", "POST", body)).status).toBe(400);
  expect((await request("/ai", "POST", "x".repeat(4_000_001))).status).toBe(
    413,
  );
  expect(fake.streamText).not.toHaveBeenCalled();
});
it("aborts provider work when the client disconnects", async () => {
  let signal: AbortSignal | undefined;
  fake.streamText.mockImplementation((options) => {
    signal = options.abortSignal;
    return {
      fullStream: (async function* () {
        yield { type: "text-delta", text: "started" };
        await new Promise((resolve) =>
          signal!.addEventListener("abort", resolve, { once: true }),
        );
      })(),
    };
  });
  const controller = new AbortController();
  const response = await fetch(`${base}/ai`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ prompt: "continue", max_tokens: 300 }),
    signal: controller.signal,
  });
  await response.body!.getReader().read();
  controller.abort();
  await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  expect(fake.streamText.mock.calls[0][0].maxOutputTokens).toBe(300);
});
it("terminates failed provider streams without reporting success", async () => {
  fake.streamText.mockReturnValue({
    fullStream: (async function* () {
      yield { type: "error", error: new Error("provider failed") };
    })(),
  });
  const response = await request(
    "/ai",
    "POST",
    JSON.stringify({ prompt: "test" }),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error:
      "The hosted assistant is unavailable. Ask an administrator to check AI Gateway.",
  });
});
it("honors backpressure for large streamed responses", async () => {
  const text = "x".repeat(100_000);
  fake.streamText.mockReturnValue({
    fullStream: (async function* () {
      yield { type: "text-delta", text };
    })(),
  });
  expect(
    await (
      await request(
        "/ai",
        "POST",
        JSON.stringify({ prompt: "large", max_tokens: -1 }),
      )
    ).text(),
  ).toBe(completionFrame(text) + "data: [DONE]\n\n");
  expect(fake.streamText.mock.calls[0][0].maxOutputTokens).toBe(1);
});
it("refuses direct auth and OAuth account creation without a server grant", async () => {
  const options = authOptions(
    {
      baseURL: "https://suiteleaf.test",
      secret: token,
      trustedOrigins: [],
      inviteOnly: true,
      registrationKey: token,
    },
    undefined,
  );
  const before = options.databaseHooks.user.create.before;
  const context = {
    headers: new Headers(),
    context: { adapter: { count: vi.fn(async () => 0) } },
  };
  await expect(
    before({ email: "owner@test" } as never, context as never),
  ).rejects.toThrow("An invitation is required");
  context.headers.set("x-suiteleaf-registration", token);
  await expect(
    before({ email: "owner@test" } as never, context as never),
  ).resolves.toMatchObject({ data: { role: "admin" } });
});
