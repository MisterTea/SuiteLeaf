import { expect, test } from "vitest";
import { driveWatchDecision } from "../apps/web/src/drive-watch";

test("an upload in flight is not someone else's newer version", () => {
  expect(
    driveWatchDecision({
      uploading: true,
      unsent: true,
      remoteHead: "version-we-just-wrote",
      localHead: "version-when-we-opened",
    }),
  ).toBe("wait");
  expect(
    driveWatchDecision({
      uploading: true,
      unsent: false,
      remoteHead: "version-we-just-wrote",
      localHead: "version-when-we-opened",
    }),
  ).toBe("wait");
});

test("a different head while idle is a conflict if edits are unsent, otherwise adopted", () => {
  expect(
    driveWatchDecision({
      uploading: false,
      unsent: true,
      remoteHead: "theirs",
      localHead: "ours",
    }),
  ).toBe("conflict");
  expect(
    driveWatchDecision({
      uploading: false,
      unsent: false,
      remoteHead: "theirs",
      localHead: "ours",
    }),
  ).toBe("adopt");
  expect(
    driveWatchDecision({
      uploading: false,
      unsent: true,
      remoteHead: "ours",
      localHead: "ours",
    }),
  ).toBe("idle");
});
