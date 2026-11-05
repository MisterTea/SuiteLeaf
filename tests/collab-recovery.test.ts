import { expect, it } from "vitest";
import {
  RENEW_TOKEN_EVERY_MS,
  authFailurePlan,
  authMessage,
  joinMessage,
  roomRecoveryText,
} from "../apps/web/src/collab/recovery";

it("names a waiting edit without the document text", () => {
  expect(roomRecoveryText("open", 0)).toBeNull();
  expect(roomRecoveryText("open", 1)).toBe("1 edit is waiting to be stored.");
  expect(roomRecoveryText("open", 2)).toBe("2 edits are waiting to be stored.");
  expect(roomRecoveryText("joining", 0)).toBe("Joining the shared document.");
  expect(roomRecoveryText("joining", 1)).toBe("Joining. 1 edit is still on this device.");
  expect(roomRecoveryText("reconnecting", 0)).toBe("Reconnecting to the shared document.");
  expect(roomRecoveryText("reconnecting", 2)).toBe("Reconnecting. 2 edits are still on this device.");
  expect(roomRecoveryText("stopped", 0)).toBe("The shared document stopped.");
  expect(roomRecoveryText("stopped", 1)).toBe(
    "The shared document stopped. Edits still on this device were not stored.",
  );
  const hidden = roomRecoveryText("reconnecting", 1);
  expect(hidden).not.toContain("secret-value");
  expect(hidden).not.toContain("token-not-shown");
  expect(roomRecoveryText("stopped", 1, "unauthorized")).toBe(
    "Sign in again. Edits still on this device were not stored.",
  );
  expect(roomRecoveryText("stopped", 0, "forbidden")).toBe(
    "You no longer have access to this shared document.",
  );
  expect(roomRecoveryText("stopped", 0, "unauthorized")).not.toContain("token-not-shown");
  expect(roomRecoveryText("stopped", 1, "version")).toBe(
    "This app speaks collaboration protocol 1.",
  );
  expect(roomRecoveryText("stopped", 1, "version")).not.toContain("secret-value");
  expect(joinMessage()).toEqual({ type: "join", protocol: 1 });
});

it("stops for a changed role and renews a token well before it expires", () => {
  expect(authFailurePlan("role-changed")).toEqual({ pauseForSignIn: false, giveUp: true, stop: "role" });
  expect(roomRecoveryText("stopped", 0, "role")).toBe(
    "Your access to this shared document changed. Open it again to continue.",
  );
  expect(roomRecoveryText("stopped", 2, "role")).toBe(
    "Your access to this shared document changed. Open it again. Edits still on this device were not stored.",
  );
  expect(authMessage("abc")).toEqual({ type: "auth", accessToken: "abc", protocol: 1 });
  // A token lasts 15 minutes and is replaced a minute before it ends.
  expect(RENEW_TOKEN_EVERY_MS).toBeLessThan(60_000);
});
