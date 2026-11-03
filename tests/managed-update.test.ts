import { describe, expect, it } from "vitest";
import { managedUpdatePolicy, startReleasePoll } from "../apps/desktop/src/updates";

describe("managed update settings", () => {
  it("lets an administrator file choose the channel and refuses a secret", () => {
    const env = {
      SUITELEAF_UPDATE_CHANNEL: "stable",
      SUITELEAF_UPDATE_HELD: "0.1.0",
      SUITELEAF_UPDATE_PAUSED: "1",
    };
    expect(managedUpdatePolicy(env, null).policy).toEqual({
      channel: "stable",
      heldVersion: "0.1.0",
      paused: true,
    });
    expect(
      managedUpdatePolicy(env, JSON.stringify({ channel: "pilot", heldVersion: "0.2.0", paused: false })).policy,
    ).toEqual({ channel: "pilot", heldVersion: "0.2.0", paused: false });
    const secret = managedUpdatePolicy(env, JSON.stringify({ apiKey: "secret-value" }));
    expect(secret).toEqual({ error: "The managed update settings do not store a secret." });
    expect(JSON.stringify(secret)).not.toContain("secret-value");
    expect(managedUpdatePolicy(env, JSON.stringify({ channel: "Stable" })).policy?.channel).toBe("stable");
    const channel = managedUpdatePolicy(env, JSON.stringify({ channel: "secret-value" }));
    expect(channel).toEqual({ error: "The managed update channel is stable or pilot." });
    expect(JSON.stringify(channel)).not.toContain("secret-value");
    const deferred = managedUpdatePolicy(
      env,
      JSON.stringify({ deferUntil: "2026-11-02T00:00:00.000Z" }),
    );
    expect(deferred.policy?.deferUntil).toBe("2026-11-02T00:00:00.000Z");
    const badDate = managedUpdatePolicy(env, JSON.stringify({ deferUntil: "secret-value" }));
    expect(badDate).toEqual({ error: "The defer date is not a time." });
    expect(JSON.stringify(badDate)).not.toContain("secret-value");
    const badDay = managedUpdatePolicy(env, JSON.stringify({ deferUntil: "2026-02-31T00:00:00.000Z" }));
    expect(badDay).toEqual({ error: "The defer date is not a time." });
    expect(JSON.stringify(badDay)).not.toContain("2026-02-31");
    const ring = managedUpdatePolicy(env, JSON.stringify({ ring: 10 }));
    expect(ring.policy?.ring).toBe(10);
    const badRing = managedUpdatePolicy(env, JSON.stringify({ ring: "secret-value" }));
    expect(badRing).toEqual({ error: "The update ring is not a percent." });
    expect(JSON.stringify(badRing)).not.toContain("secret-value");
    const held = managedUpdatePolicy({ SUITELEAF_UPDATE_HELD: "secret-value" }, null);
    expect(held).toEqual({ policy: { channel: "stable", paused: false } });
    expect(JSON.stringify(held)).not.toContain("secret-value");

    let called = false;
    const stop = startReleasePoll({
      currentVersion: "0.1.0",
      currentSchema: 5,
      currentRuntime: "22.12.0",
      env: {
        SUITELEAF_UPDATE_URL: "https://updates.example/suiteleaf",
        SUITELEAF_UPDATE_PUBLIC_KEY: "test-key",
      },
      managedText: JSON.stringify({ apiKey: "secret-value" }),
      fetchOffer: async () => {
        called = true;
        return { ok: false, status: 0, text: "" };
      },
    });
    stop();
    expect(called).toBe(false);
  });
});