import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decideUpdate,
  planRollback,
  consumeFailedStart,
  holdForRollback,
  updateRingBucket,
  releaseRecord,
  fetchReleaseOffer,
  installerSha256,
  noteUpdateDecision,
  planRestart,
  recordReleaseOffer,
  recoverPausedRollout,
  restartWhileDirty,
  signUpdate,
  startReleasePoll,
  updateProxyAddress,
  type UpdateManifest,
  type UpdatePolicy,
} from "../apps/desktop/src/updates";

const keys = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const manifest: UpdateManifest = {
  product: "suiteleaf",
  version: "0.2.0",
  channel: "pilot",
  sha256: "abc",
  schemaVersion: 5,
  restartRequired: true,
  minRuntime: "22.12.0",
};

const stable: UpdatePolicy = { channel: "stable", heldVersion: "0.1.0", paused: false };
const pilot: UpdatePolicy = { channel: "pilot", paused: false };

function decision(
  next: UpdateManifest,
  policy: UpdatePolicy,
  extra: Partial<Parameters<typeof decideUpdate>[0]> = {},
) {
  return decideUpdate({
    currentVersion: "0.1.0",
      currentRuntime: "22.12.0",
    currentSchema: 5,
    manifest: next,
    signature: signUpdate(next, keys.privateKey),
    publicKeyPem: keys.publicKey,
    installerSha256: next.sha256,
    policy,
    ...extra,
  });
}

describe("signed updates", () => {
  it("installs a signed pilot release and keeps a held stable fleet where it is", () => {
    expect(decision(manifest, pilot)).toEqual({
      action: "install",
      version: "0.2.0",
      restartRequired: true,
    });
    expect(decision({ ...manifest, channel: "stable", version: "0.2.0" }, stable).action).toBe("hold");
    expect(decision({ ...manifest, channel: "stable", version: "0.1.0" }, stable).action).toBe("hold");
  });

  it("installs a signed release only for computers inside the ring", () => {
    const bucket = updateRingBucket("garden");
    const outside = decision(manifest, { ...pilot, ring: bucket }, { deviceId: "garden" });
    expect(outside).toEqual({
      action: "hold",
      reason: "This computer is waiting for a later ring.",
    });
    expect(JSON.stringify(outside)).not.toContain("garden");
    expect(JSON.stringify(outside)).not.toContain("secret-value");
    expect(decision(manifest, { ...pilot, ring: bucket + 1 }, { deviceId: "garden" })).toEqual({
      action: "install",
      version: "0.2.0",
      restartRequired: true,
    });
    const unnamed = decision(manifest, { ...pilot, ring: 100 });
    expect(unnamed).toEqual({
      action: "hold",
      reason: "This computer is not assigned to an update ring.",
    });
    expect(JSON.stringify(unnamed)).not.toContain("secret-value");
  });

  it("holds a signed release until the defer time and then installs it", () => {
    const deferred: UpdatePolicy = { ...pilot, deferUntil: "2026-11-02T00:00:00.000Z" };
    expect(decision(manifest, deferred, { now: "2026-11-01T00:00:00.000Z" })).toEqual({
      action: "hold",
      reason: "Updates are deferred until 2026-11-02T00:00:00.000Z.",
    });
    expect(decision(manifest, deferred, { now: "2026-11-02T00:00:00.000Z" })).toEqual({
      action: "install",
      version: "0.2.0",
      restartRequired: true,
    });
  });

  it("refuses a release that needs a newer runtime", () => {
    const older = decision(manifest, pilot, { currentRuntime: "22.11.0" });
    expect(older.action).toBe("reject");
    if (older.action !== "reject") throw new Error("expected a refusal");
    expect(older.reason).toBe(
      "This release needs runtime 22.12.0. This app is running 22.11.0.",
    );
    expect(older.recovery).toContain("22.12.0");
    expect(decision(manifest, pilot, { currentRuntime: "22.13.0" }).action).toBe("install");
    expect(decision({ ...manifest, minRuntime: "soon" }, pilot).action).toBe("reject");
  });

  it("rejects a manifest whose signed fields were changed", () => {
    const signature = signUpdate(manifest, keys.privateKey);
    const tampered = decideUpdate({
      currentVersion: "0.1.0",
      currentRuntime: "22.12.0",
      currentSchema: 5,
      manifest: { ...manifest, version: "0.9.0" },
      signature,
      publicKeyPem: keys.publicKey,
      installerSha256: manifest.sha256,
      policy: pilot,
    });
    expect(tampered).toEqual({ action: "reject", reason: "The update signature does not match." });
    const note = releaseRecord({
      manifest: { ...manifest, version: "0.9.0" },
      decision: tampered,
      currentSchema: 5,
      signatureAccepted: false,
    });
    expect(note.version).toBe("0.9.0");
    expect(note.signing).toContain("rejected");
    expect(note.migration).toBe("This release was not accepted. Documents stay on schema 5.");
    expect(note.restart).toBe("The app does not need to restart.");
  });

  it("records the version, signature, schema move, and restart for an accepted release", () => {
    const accepted = releaseRecord({
      manifest,
      decision: decision(manifest, pilot),
      currentSchema: 5,
      signatureAccepted: true,
    });
    expect(accepted).toEqual({
      version: "0.2.0",
      signing: "The signature matches.",
      migration: "Documents stay on schema 5.",
      restart: "The app must quit and reopen.",
    });
    const upgraded = { ...manifest, schemaVersion: 6 };
    expect(
      releaseRecord({
        manifest: upgraded,
        decision: decision(upgraded, pilot),
        currentSchema: 5,
        signatureAccepted: true,
      }).migration,
    ).toBe("Documents move from schema 5 to schema 6.");
    const older = { ...manifest, version: "0.0.9", schemaVersion: 4, restartRequired: true };
    const refused = decision(older, { channel: "pilot", heldVersion: "0.0.9", paused: false }, {
      currentVersion: "0.2.0",
    });
    const held = releaseRecord({
      manifest: older,
      decision: refused,
      currentSchema: 5,
      signatureAccepted: true,
    });
    expect(held.version).toBe("0.0.9");
    expect(held.signing).toBe("The signature matches.");
    expect(held.migration).toContain("schema 5");
    expect(held.migration).toContain("schema 4");
    expect(held.migration).toContain("Do not replace");
    expect(held.restart).toBe("The app does not need to restart.");
  });

  it("rejects an installer whose hash is not the one that was signed", () => {
    const result = decision(manifest, pilot, { installerSha256: "fff" });
    expect(result).toEqual({
      action: "reject",
      reason: "The installer hash does not match the manifest.",
    });
  });

  it("pauses a rollout and refuses a schema downgrade", () => {
    expect(decision(manifest, { ...pilot, paused: true }).reason).toBe("Updates are paused.");
    const older: UpdateManifest = { ...manifest, version: "0.0.9", schemaVersion: 4, channel: "stable" };
    const rollback = decision(older, { channel: "stable", heldVersion: "0.0.9", paused: false });
    expect(rollback.action).toBe("reject");
    if (rollback.action === "reject") {
      expect(rollback.recovery).toContain("Do not replace its files");
      expect(rollback.recovery).toContain("schema 5");
      expect(rollback.recovery).toContain("schema 4");
    }
  });

  it("waits to restart while edits are unsaved and does not quit for a paused rollout", () => {
    const install = decision(manifest, pilot);
    expect(
      planRestart({ decision: install, unsavedEdits: true, saved: false }),
    ).toEqual({
      action: "wait",
      reason: "Save open documents before restarting. The update does not discard them.",
    });
    expect(planRestart({ decision: install, unsavedEdits: true, saved: true }).action).toBe(
      "restart",
    );
    noteUpdateDecision(decision(manifest, { ...pilot, paused: true }));
    expect(restartWhileDirty(true).action).toBe("continue");
    noteUpdateDecision(install);
    expect(restartWhileDirty(true).action).toBe("wait");
    expect(restartWhileDirty(false).action).toBe("restart");
    noteUpdateDecision(null);
  });

  it("records a fetched offer and drops it when a later offer is not signed", () => {
    const offer = {
      manifest,
      signature: signUpdate(manifest, keys.privateKey),
      installerSha256: manifest.sha256,
      url: "https://updates.example/SuiteLeaf.dmg",
    };
    const recorded = recordReleaseOffer({
      offer,
      currentVersion: "0.1.0",
      currentRuntime: "22.12.0",
      currentSchema: 5,
      publicKeyPem: keys.publicKey,
      policy: pilot,
    });
    expect(recorded.action).toBe("install");
    expect(restartWhileDirty(true).action).toBe("wait");
    const rejected = recordReleaseOffer({
      offer: { ...offer, signature: "not-a-signature" },
      currentVersion: "0.1.0",
      currentRuntime: "22.12.0",
      currentSchema: 5,
      publicKeyPem: keys.publicKey,
      policy: pilot,
    });
    expect(rejected.action).toBe("reject");
    expect(restartWhileDirty(true).action).toBe("continue");
    noteUpdateDecision(null);
  });

  it("polls an https offer once and leaves a remembered restart when the server is down", async () => {
    const offer = {
      manifest,
      signature: signUpdate(manifest, keys.privateKey),
      installerSha256: manifest.sha256,
      url: "https://updates.example/SuiteLeaf.dmg",
    };
    const asked: string[] = [];
    const recorded = await fetchReleaseOffer({
      url: "https://updates.example/offer.json",
      fetchOffer: async (address) => {
        asked.push(address);
        return { ok: true, status: 200, text: JSON.stringify(offer) };
      },
      currentVersion: "0.1.0",
      currentRuntime: "22.12.0",
      currentSchema: 5,
      publicKeyPem: keys.publicKey,
      policy: pilot,
    });
    expect(recorded.action).toBe("install");
    expect(asked).toEqual(["https://updates.example/offer.json"]);
    expect(restartWhileDirty(false).action).toBe("restart");
    const missed = await fetchReleaseOffer({
      url: "https://updates.example/offer.json",
      fetchOffer: async () => {
        throw new Error("offline");
      },
      currentVersion: "0.1.0",
      currentRuntime: "22.12.0",
      currentSchema: 5,
      publicKeyPem: keys.publicKey,
      policy: pilot,
    });
    expect(missed.action).toBe("hold");
    expect(restartWhileDirty(false).action).toBe("restart");
    const fileAddress = await fetchReleaseOffer({
      url: "file:///tmp/offer.json",
      fetchOffer: async () => {
        throw new Error("should not fetch");
      },
      currentVersion: "0.1.0",
      currentRuntime: "22.12.0",
      currentSchema: 5,
      publicKeyPem: keys.publicKey,
      policy: pilot,
    });
    expect(fileAddress.action).toBe("reject");
    expect(restartWhileDirty(false).action).toBe("restart");
    const bytes = new TextEncoder().encode("suiteleaf-installer");
    const signed = { ...manifest, sha256: installerSha256(bytes) };
    const saved: Uint8Array[] = [];
    const askedBytes: string[] = [];
    const kept = await fetchReleaseOffer({
      url: "https://updates.example/offer.json",
      fetchOffer: async () => ({
        ok: true,
        status: 200,
        text: JSON.stringify({
          manifest: signed,
          signature: signUpdate(signed, keys.privateKey),
          installerSha256: signed.sha256,
          installerUrl: "https://updates.example/SuiteLeaf.dmg",
        }),
      }),
      fetchBytes: async (address) => {
        askedBytes.push(address);
        return { ok: true, status: 200, bytes };
      },
      save: (body) => {
        saved.push(body);
      },
      currentVersion: "0.1.0",
      currentRuntime: "22.12.0",
      currentSchema: 5,
      publicKeyPem: keys.publicKey,
      policy: pilot,
    });
    expect(kept.action).toBe("install");
    expect(askedBytes).toEqual(["https://updates.example/SuiteLeaf.dmg"]);
    expect(saved).toEqual([bytes]);
    const tampered = await fetchReleaseOffer({
      url: "https://updates.example/offer.json",
      fetchOffer: async () => ({
        ok: true,
        status: 200,
        text: JSON.stringify({
          manifest: signed,
          signature: signUpdate(signed, keys.privateKey),
          installerSha256: signed.sha256,
          installerUrl: "https://updates.example/SuiteLeaf.dmg",
        }),
      }),
      fetchBytes: async () => ({
        ok: true,
        status: 200,
        bytes: new TextEncoder().encode("not-the-installer"),
      }),
      save: () => {
        throw new Error("a mismatched installer was kept");
      },
      currentVersion: "0.1.0",
      currentRuntime: "22.12.0",
      currentSchema: 5,
      publicKeyPem: keys.publicKey,
      policy: pilot,
    });
    expect(tampered).toEqual({
      action: "reject",
      reason: "The installer hash does not match the manifest.",
    });
    expect(restartWhileDirty(false).action).toBe("continue");
    const stop = startReleasePoll({
      currentVersion: "0.1.0",
      currentRuntime: "22.12.0",
      currentSchema: 5,
      env: {},
      fetchOffer: async () => {
        throw new Error("should not fetch");
      },
    });
    stop();
    noteUpdateDecision(null);
  });

  it("removes a kept installer when a rollout is paused and leaves other files", async () => {
    noteUpdateDecision(decision(manifest, pilot));
    expect(restartWhileDirty(true).action).toBe("wait");
    const hash = "a".repeat(64);
    const removed: string[] = [];
    const recovered = await recoverPausedRollout({
      paused: true,
      updatesDirectory: "/tmp/suiteleaf-updates",
      unsavedEdits: true,
      list: async () => [`${hash}.bin`, "notes.sldoc", "../notes.sldoc"],
      remove: async (path) => {
        removed.push(path);
      },
    });
    expect(recovered.editsDiscarded).toBe(false);
    expect(recovered.unsavedEdits).toBe(true);
    expect(recovered.removed).toEqual([`${hash}.bin`]);
    expect(removed).toEqual([`/tmp/suiteleaf-updates/${hash}.bin`]);
    expect(restartWhileDirty(true).action).toBe("continue");
    noteUpdateDecision(decision(manifest, pilot));
    const left = await recoverPausedRollout({
      paused: false,
      updatesDirectory: "/tmp/suiteleaf-updates",
      unsavedEdits: true,
      list: async () => {
        throw new Error("should not list");
      },
      remove: async () => {
        throw new Error("should not remove");
      },
    });
    expect(left.action).toBe("left");
    expect(restartWhileDirty(true).action).toBe("wait");
    noteUpdateDecision(null);
  });

  it("sends the offer and the installer through an http proxy and skips a proxy that is not http", async () => {
    expect(updateProxyAddress(undefined)).toEqual({ proxy: null });
    expect(updateProxyAddress("  http://proxy.example:8080 ")).toEqual({
      proxy: "http://proxy.example:8080/",
    });
    expect(updateProxyAddress("file:///tmp/secret-value")).toEqual({
      error: "The update proxy is not an http address.",
    });
    noteUpdateDecision(decision(manifest, pilot));
    const refused = await fetchReleaseOffer({
      url: "https://updates.example/offer.json",
      proxy: "file:///tmp/secret-value",
      fetchOffer: async () => {
        throw new Error("a bad proxy was requested");
      },
      currentVersion: "0.1.0",
      currentRuntime: "22.12.0",
      currentSchema: 5,
      publicKeyPem: keys.publicKey,
      policy: pilot,
    });
    expect(refused).toEqual({
      action: "reject",
      reason: "The update proxy is not an http address.",
    });
    expect(JSON.stringify(refused)).not.toContain("secret-value");
    expect(restartWhileDirty(false).action).toBe("restart");
    const asked: Array<string | undefined> = [];
    const bytesAsked: Array<string | undefined> = [];
    const bytes = new TextEncoder().encode("suiteleaf-installer");
    const signed = { ...manifest, sha256: installerSha256(bytes) };
    const kept = await fetchReleaseOffer({
      url: "https://updates.example/offer.json",
      proxy: "http://user:secret-value@proxy.example:8080",
      fetchOffer: async (address, proxy) => {
        asked.push(address, proxy);
        return {
          ok: true,
          status: 200,
          text: JSON.stringify({
            manifest: signed,
            signature: signUpdate(signed, keys.privateKey),
            installerSha256: signed.sha256,
            installerUrl: "https://updates.example/SuiteLeaf.dmg",
          }),
        };
      },
      fetchBytes: async (address, proxy) => {
        bytesAsked.push(address, proxy);
        return { ok: true, status: 200, bytes };
      },
      save: () => {},
      currentVersion: "0.1.0",
      currentRuntime: "22.12.0",
      currentSchema: 5,
      publicKeyPem: keys.publicKey,
      policy: pilot,
    });
    expect(kept.action).toBe("install");
    expect(asked).toEqual([
      "https://updates.example/offer.json",
      "http://user:secret-value@proxy.example:8080/",
    ]);
    expect(bytesAsked).toEqual([
      "https://updates.example/SuiteLeaf.dmg",
      "http://user:secret-value@proxy.example:8080/",
    ]);
    expect(JSON.stringify(kept)).not.toContain("secret-value");
    let finishPoll = () => {};
    const stop = startReleasePoll({
      currentVersion: "0.1.0",
      currentRuntime: "22.12.0",
      currentSchema: 5,
      env: {
        SUITELEAF_UPDATE_URL: "https://updates.example/offer.json",
        SUITELEAF_UPDATE_PUBLIC_KEY: keys.publicKey,
        SUITELEAF_UPDATE_PROXY: "file:///tmp/secret-value",
      },
      fetchOffer: async () => {
        throw new Error("a bad proxy was requested");
      },
    });
    stop();
    const proxied = new Promise<string>((resolve) => {
      const stopPoll = startReleasePoll({
        currentVersion: "0.1.0",
      currentRuntime: "22.12.0",
        currentSchema: 5,
        env: {
          SUITELEAF_UPDATE_URL: "https://updates.example/offer.json",
          SUITELEAF_UPDATE_PUBLIC_KEY: keys.publicKey,
          SUITELEAF_UPDATE_PROXY: "https://proxy.example",
        },
        fetchOffer: async (_address, proxy) => {
          resolve(proxy ?? "");
          return { ok: false, status: 503, text: "" };
        },
      });
      void stopPoll;
      finishPoll = stopPoll;
    });
    expect(await proxied).toBe("https://proxy.example/");
    finishPoll();
    noteUpdateDecision(null);
  });

  it("restores the previous release when the failed one did not move the schema", () => {
    expect(
      planRollback({
        previousVersion: "0.1.0",
        previousSchema: 5,
        failedVersion: "0.2.0",
        failedSchema: 5,
      }),
    ).toEqual({ action: "restore", version: "0.1.0" });
    const moved = planRollback({
      previousVersion: "0.1.0",
      previousSchema: 5,
      failedVersion: "0.2.0",
      failedSchema: 6,
    });
    expect(moved).toEqual({
      action: "keep",
      reason: "This release changed the document schema. Keep it installed.",
    });
    const named = planRollback({
      previousVersion: "secret-value",
      previousSchema: 5,
      failedVersion: "0.2.0",
      failedSchema: 5,
    });
    expect(named).toEqual({
      action: "keep",
      reason: "The installed version is not major.minor.patch.",
    });
    expect(JSON.stringify(named)).not.toContain("secret-value");
    const schema = planRollback({
      previousVersion: "0.1.0",
      previousSchema: Number.NaN,
      failedVersion: "0.2.0",
      failedSchema: 5,
    });
    expect(schema.action).toBe("keep");
    expect(JSON.stringify(schema)).not.toContain("NaN");
    expect(
      planRollback({
        previousVersion: "0.1.0",
        previousSchema: 5,
        failedVersion: "0.1.0",
        failedSchema: 5,
      }),
    ).toEqual({ action: "keep", reason: "This release is the one already installed." });
  });

  it("reads a failed start on the next launch and does not replace the app", async () => {
    const notes: string[] = [];
    let removed = false;
    const plan = await consumeFailedStart({
      text: JSON.stringify({
        previousVersion: "0.1.0",
        previousSchema: 5,
        failedVersion: "0.2.0",
        failedSchema: 5,
        note: "secret-value",
      }),
      writePlan: async (version) => {
        notes.push(version);
      },
      removeRecord: async () => {
        removed = true;
      },
    });
    expect(plan).toEqual({ action: "restore", version: "0.1.0" });
    expect(notes).toEqual(["0.1.0"]);
    expect(removed).toBe(true);
    expect(JSON.stringify(notes)).not.toContain("secret-value");
    const moved = await consumeFailedStart({
      text: JSON.stringify({
        previousVersion: "0.1.0",
        previousSchema: 5,
        failedVersion: "0.2.0",
        failedSchema: 6,
      }),
      writePlan: async () => {
        throw new Error("schema moved");
      },
      removeRecord: async () => {
        removed = true;
      },
    });
    expect(moved).toEqual({
      action: "keep",
      reason: "This release changed the document schema. Keep it installed.",
    });
    const broken = await consumeFailedStart({
      text: "secret-value",
      writePlan: async () => {
        throw new Error("unreadable");
      },
      removeRecord: async () => {
        removed = true;
      },
    });
    expect(broken).toEqual({ action: "keep", reason: "The failed start record cannot be read." });
    expect(JSON.stringify(broken)).not.toContain("secret-value");
    expect(await consumeFailedStart({
      text: null,
      writePlan: async () => {
        throw new Error("missing");
      },
      removeRecord: async () => {
        throw new Error("missing");
      },
    })).toBeNull();
  });

  it("holds the next poll on the rollback plan and can install that older release", () => {
    const plan = JSON.stringify({ version: "0.1.0", note: "secret-value" });
    const held = holdForRollback(pilot, plan);
    expect(held.heldVersion).toBe("0.1.0");
    expect(JSON.stringify(held)).not.toContain("secret-value");
    expect(holdForRollback({ ...pilot, heldVersion: "0.4.0" }, plan).heldVersion).toBe("0.4.0");
    expect(holdForRollback(pilot, "secret-value")).toEqual(pilot);
    const newer = decision(
      { ...manifest, version: "0.3.0" },
      held,
      { currentVersion: "0.2.0" },
    );
    expect(newer).toEqual({ action: "hold", reason: "The fleet is held on a different version." });
    expect(JSON.stringify(newer)).not.toContain("secret-value");
    expect(
      decision({ ...manifest, version: "0.1.0" }, held, { currentVersion: "0.2.0" }),
    ).toEqual({ action: "install", version: "0.1.0", restartRequired: true });
  });

  it("does not install a signed release on an older Mac", async () => {
    const bytes = new TextEncoder().encode("suiteleaf-installer");
    const signed = { ...manifest, sha256: installerSha256(bytes) };
    let downloaded = false;
    const older = await fetchReleaseOffer({
      url: "https://updates.example/offer.json",
      fetchOffer: async () => ({
        ok: true,
        status: 200,
        text: JSON.stringify({
          manifest: signed,
          signature: signUpdate(signed, keys.privateKey),
          installerSha256: signed.sha256,
          installerUrl: "https://updates.example/SuiteLeaf.dmg",
        }),
      }),
      fetchBytes: async () => {
        downloaded = true;
        return { ok: true, status: 200, bytes };
      },
      currentVersion: "0.1.0",
      currentRuntime: "22.12.0",
      currentSchema: 5,
      currentPlatform: "darwin",
      currentOsVersion: "12.7",
      publicKeyPem: keys.publicKey,
      policy: pilot,
    });
    expect(older).toEqual({
      action: "reject",
      reason: "This Mac is older than macOS 13.",
      recovery: "Keep the installed app.",
    });
    expect(JSON.stringify(older)).not.toContain("12.7");
    expect(downloaded).toBe(false);
    expect(
      decision(manifest, pilot, { currentPlatform: "linux", currentOsVersion: "secret-value" }),
    ).toEqual({ action: "install", version: "0.2.0", restartRequired: true });
    expect(
      decision(manifest, pilot, { currentPlatform: "secret-value", currentOsVersion: "13" }).reason,
    ).toBe("Name macOS, Windows, or Linux.");
    let asked = false;
    const stop = startReleasePoll({
      currentVersion: "0.1.0",
      currentRuntime: "22.11.0",
      currentSchema: 5,
      currentPlatform: "darwin",
      currentOsVersion: "14",
      env: {
        SUITELEAF_UPDATE_URL: "https://updates.example/offer.json",
        SUITELEAF_UPDATE_PUBLIC_KEY: keys.publicKey,
      },
      fetchOffer: async () => {
        asked = true;
        return { ok: true, status: 200, text: "" };
      },
    });
    stop();
    expect(asked).toBe(false);
  });
});
