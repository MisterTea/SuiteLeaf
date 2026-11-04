import { describe, expect, it } from "vitest";
import {
  decideClientSession,
  idleSecsFromInfo,
  sessionActivityNote,
  sessionEndFor,
  sessionTimes,
} from "../apps/web/src/session-policy";

const now = new Date(1_700_000_000_000).toISOString();
const fresh = new Date(1_700_000_000_000 - 1_000).toISOString();
const stale = new Date(1_700_000_000_000 - 3_600_000).toISOString();
const later = new Date(1_700_000_000_000 + 86_400_000).toISOString();

describe("client session policy", () => {
  it("refuses an expired or idle session and keeps a fresh one", () => {
    expect(decideClientSession({ expiresAt: later, updatedAt: fresh, now })).toBe("accept");
    expect(decideClientSession({ expiresAt: now, updatedAt: fresh, now })).toBe("expired");
    expect(
      decideClientSession({ expiresAt: later, updatedAt: stale, now, idleSecs: 30 * 60 }),
    ).toBe("idle");
    expect(sessionEndFor("idle")).toBe("idle");
    expect(sessionEndFor("expired")).toBe("expired");
    expect(sessionEndFor("reauth")).toBe("expired");
    expect(sessionEndFor("accept")).toBeNull();
    expect(
      decideClientSession({ expiresAt: later, updatedAt: fresh, now, idleSecs: 30 * 60 }),
    ).toBe("accept");
    expect(
      decideClientSession({ expiresAt: later, updatedAt: "yesterday", now, idleSecs: 60 }),
    ).toBe("idle");
    expect(decideClientSession({ now })).toBe("accept");
    expect(
      decideClientSession({ expiresAt: later, updatedAt: fresh, now, reauth: true }),
    ).toBe("reauth");
    const note = sessionActivityNote({ expiresAt: later, updatedAt: fresh, now, reauth: true });
    expect(note).toBe("This device must sign in again.");
    expect(note).not.toContain("2023");
    const impossible = "2026-02-31T00:00:00.000Z";
    expect(
      decideClientSession({
        expiresAt: impossible,
        updatedAt: "2026-03-01T00:00:00.000Z",
        now: "2026-02-28T00:00:00.000Z",
      }),
    ).toBe("expired");
    expect(
      decideClientSession({
        expiresAt: "2026-03-01T00:00:00.000Z",
        updatedAt: impossible,
        now: "2026-02-28T00:00:00.000Z",
        idleSecs: 60,
      }),
    ).toBe("idle");
    expect(
      decideClientSession({
        expiresAt: "2024-02-29T00:00:00.000Z",
        updatedAt: "2024-02-28T00:00:00.000Z",
        now: "2024-02-28T00:00:00.000Z",
        idleSecs: 60,
      }),
    ).toBe("accept");
    const refused = sessionActivityNote({
      expiresAt: impossible,
      updatedAt: "2026-03-01T00:00:00.000Z",
      now: "2026-02-28T00:00:00.000Z",
    });
    expect(refused).toBe("This session has expired.");
    expect(refused).not.toContain("2026-02-31");
    expect(sessionActivityNote({ now })).toBe("No idle limit is set.");
    expect(sessionActivityNote({ expiresAt: later, updatedAt: fresh, now, idleSecs: 60 })).toBe(
      "This device is signed in.",
    );
    expect(sessionActivityNote({ expiresAt: later, updatedAt: stale, now, idleSecs: 60 })).toBe(
      "This device is idle.",
    );
  });

  it("reads the idle limit and the sign-in times without a secret", () => {
    expect(idleSecsFromInfo({ auth: { enabled: true, idleSecs: 1800 } })).toBe(1800);
    expect(idleSecsFromInfo({ auth: { enabled: true, idleSecs: null } })).toBeUndefined();
    expect(sessionTimes({ token: "secret-value", user: { id: "sam" } })).toEqual({});
    expect(
      sessionTimes({
        session: { expiresAt: later, updatedAt: fresh, token: "secret-value" },
      }),
    ).toEqual({ expiresAt: later, updatedAt: fresh });
    expect(
      sessionTimes({
        session: { expiresAt: new Date(later), updatedAt: new Date("not a date") },
      }),
    ).toEqual({ expiresAt: later, updatedAt: undefined });
    expect(JSON.stringify(sessionTimes({ session: { token: "secret-value" } }))).not.toContain(
      "secret-value",
    );
  });
});
