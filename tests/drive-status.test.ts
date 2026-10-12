import { afterEach, expect, test, vi } from "vitest";
import {
  formatModified,
  serverSync,
  syncSummary,
} from "../apps/web/src/drive/status";

afterEach(() => vi.unstubAllGlobals());

test("serverSync reads peers, files still copying and database heads", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        peers: ["12D3KooA", "12D3KooB"],
        suitedb: { heads: ["h1", "h2"] },
        suitedrive: { replicating: 3 },
      }),
    ),
  );
  expect(await serverSync("http://office:8787")).toEqual({
    peers: 2,
    replicating: 3,
    heads: "h1,h2",
  });
  expect(fetch).toHaveBeenCalledWith("http://office:8787/api/node/info");
});

test("serverSync is null when the server can't be reached", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
  expect(await serverSync("http://office:8787")).toBeNull();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
  expect(await serverSync("http://office:8787")).toBeNull();
});

test("syncSummary names other servers and files still on their way", () => {
  expect(syncSummary(null)).toBeNull();
  expect(syncSummary({ peers: 0, replicating: 0, heads: "" })).toBeNull();
  expect(syncSummary({ peers: 1, replicating: 0, heads: "" })).toBe(
    "Connected to 1 other server",
  );
  expect(syncSummary({ peers: 2, replicating: 0, heads: "" })).toBe(
    "Connected to 2 other servers",
  );
  expect(syncSummary({ peers: 1, replicating: 1, heads: "" })).toBe(
    "Copying 1 file from other servers…",
  );
  expect(syncSummary({ peers: 0, replicating: 4, heads: "" })).toBe(
    "Copying 4 files from other servers…",
  );
});

test("formatModified shows the time for today and the date otherwise", () => {
  const now = new Date(2026, 9, 12, 18, 0);
  const at = (d: Date) => d.toISOString();
  expect(formatModified(at(new Date(2026, 9, 12, 14, 5)), now)).toBe(
    new Date(2026, 9, 12, 14, 5).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }),
  );
  expect(formatModified(at(new Date(2026, 9, 11, 14, 5)), now)).toBe(
    new Date(2026, 9, 11).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  );
  expect(formatModified(at(new Date(2025, 2, 3)), now)).toBe(
    new Date(2025, 2, 3).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  );
});
