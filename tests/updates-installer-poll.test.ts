import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decideUpdate,
  downloadCheckedInstaller,
  failedStartPlan,
  fetchReleaseOffer,
  installerSha256,
  managedUpdatePolicy,
  noteUpdateDecision,
  planRestart,
  recordReleaseOffer,
  recoverPausedRollout,
  releaseRecord,
  restartWhileDirty,
  rollbackHeldVersion,
  signatureMatches,
  signUpdate,
  startReleasePoll,
  type UpdateManifest,
} from "../apps/desktop/src/updates";

const keys = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const installer = new Uint8Array([1, 2, 3, 4]);
const manifest: UpdateManifest = {
  product: "suiteleaf",
  version: "0.2.0",
  channel: "stable",
  sha256: installerSha256(installer),
  schemaVersion: 5,
  restartRequired: true,
  minRuntime: "22.12.0",
};
const offer = (extra: Record<string, unknown> = {}, next = manifest) =>
  JSON.stringify({
    manifest: next,
    signature: signUpdate(next, keys.privateKey),
    installerSha256: next.sha256,
    ...extra,
  });
const current = {
  currentVersion: "0.1.0",
  currentSchema: 5,
  currentRuntime: "22.12.0",
  publicKeyPem: keys.publicKey,
  policy: { channel: "stable" as const, paused: false },
};
const answered = (text: string) => async () => ({ ok: true, status: 200, text });

afterEach(() => {
  noteUpdateDecision(null);
  vi.unstubAllGlobals();
});

describe("update decisions", () => {
  const decide = (next: Partial<UpdateManifest>, extra: Partial<Parameters<typeof decideUpdate>[0]> = {}) => {
    const m = { ...manifest, ...next };
    return decideUpdate({
      ...current,
      manifest: m,
      signature: signUpdate(m, keys.privateKey),
      installerSha256: m.sha256,
      ...extra,
    });
  };

  it("refuses an empty or unreadable signature and another product", () => {
    expect(signatureMatches(manifest, "", keys.publicKey)).toBe(false);
    expect(signatureMatches(manifest, "AAAA", "not a key")).toBe(false);
    expect(decide({ product: "other" as "suiteleaf" })).toMatchObject({ reason: "The update is not a SuiteLeaf release." });
  });

  it("holds deferred, held, older, and malformed releases", () => {
    expect(
      decide({}, { policy: { ...current.policy, deferUntil: "2999-01-01T00:00:00.000Z" } }),
    ).toEqual({ action: "hold", reason: "Updates are deferred until 2999-01-01T00:00:00.000Z." });
    expect(decide({}, { policy: { ...current.policy, deferUntil: "2000-01-01T00:00:00.000Z" } }).action).toBe(
      "install",
    );
    expect(decide({ version: "0.2" })).toMatchObject({ reason: "The version is not major.minor.patch." });
    expect(decide({ version: "0.0.9" })).toMatchObject({ reason: "This release is older than the installed version." });
  });

  it("describes a rejected release that names its recovery", () => {
    const record = releaseRecord({
      manifest: { ...manifest, schemaVersion: 4 },
      decision: { action: "reject", reason: "x", recovery: "Keep the installed app." },
      currentSchema: 5,
      signatureAccepted: true,
    });
    expect(record.migration).toBe("Keep the installed app.");
    expect(planRestart({ decision: { action: "hold", reason: "Paused." }, unsavedEdits: false, saved: true })).toEqual({
      action: "continue",
      reason: "Paused.",
    });
    expect(
      planRestart({
        decision: { action: "install", version: "0.2.0", restartRequired: false },
        unsavedEdits: true,
        saved: false,
      }),
    ).toEqual({ action: "continue", reason: "This release does not ask the app to restart." });
  });

  it("reads failed-start and rollback records defensively", () => {
    expect(failedStartPlan("null")).toMatchObject({ reason: "The failed start record cannot be read." });
    expect(failedStartPlan('{"previousVersion":"1.0.0"}')).toMatchObject({
      reason: "The failed start record cannot be read.",
    });
    expect(rollbackHeldVersion("null")).toBeNull();
    expect(rollbackHeldVersion('{"version":"one"}')).toBeNull();
    expect(rollbackHeldVersion("{bad")).toBeNull();
  });
});

describe("release offers", () => {
  it("rejects an offer that is not a manifest and forgets a waiting restart", () => {
    noteUpdateDecision({ action: "install", version: "0.2.0", restartRequired: true });
    expect(restartWhileDirty(true).action).toBe("wait");
    for (const bad of [null, { manifest: {} }, { manifest, signature: 1, installerSha256: "x" }])
      expect(recordReleaseOffer({ ...current, offer: bad })).toEqual({
        action: "reject",
        reason: "The release offer is not a SuiteLeaf manifest.",
      });
    expect(restartWhileDirty(true)).toEqual({ action: "continue", reason: "No update is waiting." });
  });

  it("only reads https offers through an http proxy", async () => {
    const fetchOffer = vi.fn(answered(offer()));
    expect(await fetchReleaseOffer({ ...current, url: "http://x", fetchOffer })).toMatchObject({
      reason: "The release address is not an https address.",
    });
    expect(
      await fetchReleaseOffer({ ...current, url: "https://x", proxy: "socks://p", fetchOffer }),
    ).toMatchObject({ reason: "The update proxy is not an http address." });
    expect(fetchOffer).not.toHaveBeenCalled();
    await fetchReleaseOffer({ ...current, url: "https://x", proxy: " http://proxy:3128 ", fetchOffer });
    expect(fetchOffer).toHaveBeenCalledWith("https://x", "http://proxy:3128/");
  });

  it("holds when the server does not answer and refuses an offer it cannot read", async () => {
    const base = { ...current, url: "https://x" };
    expect(
      await fetchReleaseOffer({ ...base, fetchOffer: () => Promise.reject(new Error("offline")) }),
    ).toEqual({ action: "hold", reason: "The release server did not answer." });
    expect(
      await fetchReleaseOffer({ ...base, fetchOffer: async () => ({ ok: false, status: 503, text: "" }) }),
    ).toEqual({ action: "hold", reason: "The release server did not answer." });
    expect(await fetchReleaseOffer({ ...base, fetchOffer: answered("x".repeat(64_001)) })).toEqual({
      action: "reject",
      reason: "The release offer is too large.",
    });
    expect(await fetchReleaseOffer({ ...base, fetchOffer: answered("{not json") })).toMatchObject({
      reason: "The release offer is not a SuiteLeaf manifest.",
    });
  });

  it("keeps an installer only when its bytes match the signed hash", async () => {
    const saved: Uint8Array[] = [];
    const base = {
      ...current,
      url: "https://x",
      save: (bytes: Uint8Array) => void saved.push(bytes),
    };
    const good = await fetchReleaseOffer({
      ...base,
      fetchOffer: answered(offer({ installerUrl: "https://cdn/app.dmg" })),
      fetchBytes: async () => ({ ok: true, status: 200, bytes: installer }),
    });
    expect(good).toEqual({ action: "install", version: "0.2.0", restartRequired: true });
    expect(saved).toEqual([installer]);
    expect(restartWhileDirty(false)).toEqual({ action: "restart", version: "0.2.0" });

    const bad = await fetchReleaseOffer({
      ...base,
      fetchOffer: answered(offer({ installerUrl: "https://cdn/app.dmg" })),
      fetchBytes: async () => ({ ok: true, status: 200, bytes: new Uint8Array([9]) }),
    });
    expect(bad).toEqual({ action: "reject", reason: "The installer hash does not match the manifest." });
    expect(restartWhileDirty(false).action).toBe("continue");
    expect(saved).toHaveLength(1);

    // Without an installer address the decision stands and nothing is downloaded.
    const fetchBytes = vi.fn();
    expect(
      (await fetchReleaseOffer({ ...base, fetchOffer: answered(offer()), fetchBytes })).action,
    ).toBe("install");
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it("refuses an installer that is not https or too large, and holds when it cannot be read", async () => {
    const check = (url: string, fetchBytes: Parameters<typeof downloadCheckedInstaller>[0]["fetchBytes"]) =>
      downloadCheckedInstaller({ url, expectedSha256: manifest.sha256, fetchBytes });
    expect(await check("http://cdn/app", vi.fn())).toEqual({
      action: "reject",
      reason: "The installer address is not an https address.",
    });
    expect(await check("https://cdn/app", () => Promise.reject(new Error("x")))).toEqual({
      action: "hold",
      reason: "The installer could not be downloaded.",
    });
    expect(await check("https://cdn/app", async () => ({ ok: false, status: 404, bytes: installer }))).toMatchObject({
      action: "hold",
    });
    const huge = { byteLength: 512 * 1024 * 1024 + 1 } as Uint8Array;
    expect(await check("https://cdn/app", async () => ({ ok: true, status: 200, bytes: huge }))).toEqual({
      action: "reject",
      reason: "The installer is too large.",
    });
    expect(await check("https://cdn/app", async () => ({ ok: true, status: 200, bytes: installer }))).toEqual({
      action: "checked",
      sha256: manifest.sha256,
    });
  });
});

describe("managed update settings", () => {
  it("refuses settings that are not an object or carry a secret", () => {
    expect(managedUpdatePolicy({}, "{bad")).toEqual({ error: "The managed update settings are not valid." });
    expect(managedUpdatePolicy({}, "[]")).toEqual({ error: "The managed update settings are not valid." });
    expect(managedUpdatePolicy({}, '{"client_secret":"x"}')).toEqual({
      error: "The managed update settings do not store a secret.",
    });
    expect(managedUpdatePolicy({}, '{"channel":5}')).toEqual({ error: "The managed update channel is stable or pilot." });
    expect(managedUpdatePolicy({}, '{"heldVersion":"latest"}')).toEqual({
      error: "The managed update version is not a version.",
    });
    expect(managedUpdatePolicy({}, '{"paused":"yes"}')).toEqual({ error: "The managed update settings are not valid." });
    for (const deferUntil of ["2026-00-01T00:00:00Z", "2026-01-01T24:00:00Z", "2026-1-1", 5])
      expect(managedUpdatePolicy({}, JSON.stringify({ deferUntil }))).toEqual({ error: "The defer date is not a time." });
    expect(managedUpdatePolicy({}, '{"ring":101}')).toEqual({ error: "The update ring is not a percent." });
  });

  it("combines the environment and the file", () => {
    expect(
      managedUpdatePolicy(
        { SUITELEAF_UPDATE_CHANNEL: "pilot", SUITELEAF_UPDATE_PAUSED: "1", SUITELEAF_UPDATE_HELD: " 1.2.3 " },
        "  ",
      ),
    ).toEqual({ policy: { channel: "pilot", paused: true, heldVersion: "1.2.3" } });
    expect(
      managedUpdatePolicy({}, '{"channel":"stable","paused":true,"deferUntil":"2026-03-01T10:00:00.000Z","ring":0}'),
    ).toEqual({ policy: { channel: "stable", paused: true, deferUntil: "2026-03-01T10:00:00.000Z", ring: 0 } });
  });
});

describe("release poll", () => {
  const env = {
    SUITELEAF_UPDATE_URL: "https://updates.example/offer.json",
    SUITELEAF_UPDATE_PUBLIC_KEY: keys.publicKey,
  };
  const poll = (extra: Partial<Parameters<typeof startReleasePoll>[0]> = {}) =>
    startReleasePoll({ currentVersion: "0.1.0", currentSchema: 5, currentRuntime: "22.12.0", env, ...extra });

  it("does not poll with a bad proxy, bad settings, an old runtime, or an old system", async () => {
    const fetchOffer = vi.fn(answered(offer()));
    poll({ env: { ...env, SUITELEAF_UPDATE_PROXY: "ftp://p" }, fetchOffer })();
    poll({ managedText: "{bad", fetchOffer })();
    poll({ currentRuntime: "20.0.0", fetchOffer })();
    poll({ currentPlatform: "darwin", currentOsVersion: "12.6", fetchOffer })();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchOffer).not.toHaveBeenCalled();
  });

  it("downloads through fetch and keeps a checked installer in the updates folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "suiteleaf-updates-"));
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          url.endsWith("offer.json")
            ? new Response(offer({ installerUrl: "https://updates.example/app.bin" }))
            : new Response(installer),
        ),
      );
      const stop = poll({ installerDirectory: dir, currentPlatform: "linux" });
      await vi.waitFor(async () => expect(await readdir(dir)).toEqual([`${manifest.sha256}.bin`]));
      stop();
      expect(restartWhileDirty(false)).toEqual({ action: "restart", version: "0.2.0" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requests through a configured proxy", async () => {
    const fetcher = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    poll({ env: { ...env, SUITELEAF_UPDATE_PROXY: "http://127.0.0.1:9" } })();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, { dispatcher?: object }];
    expect(url).toBe(env.SUITELEAF_UPDATE_URL);
    expect(init.dispatcher?.constructor.name).toBe("ProxyAgent");
  });

  it("clears kept installers when the rollout is paused", async () => {
    const dir = await mkdtemp(join(tmpdir(), "suiteleaf-updates-"));
    try {
      await writeFile(join(dir, `${"a".repeat(64)}.bin`), "old");
      await writeFile(join(dir, "notes.txt"), "keep");
      const fetchOffer = vi.fn(answered(offer()));
      poll({ env: { ...env, SUITELEAF_UPDATE_PAUSED: "1" }, installerDirectory: dir, fetchOffer })();
      await vi.waitFor(() => expect(fetchOffer).toHaveBeenCalled());
      expect(await readdir(dir)).toEqual(["notes.txt"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("recovers a paused rollout whose folder is missing", async () => {
    expect(
      await recoverPausedRollout({ paused: true, updatesDirectory: "/no/such/folder", unsavedEdits: true }),
    ).toEqual({ action: "recovered", removed: [], editsDiscarded: false, unsavedEdits: true });
  });
});
