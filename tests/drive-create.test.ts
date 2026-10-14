import { expect, test } from "vitest";
import {
  DriveRequestError,
  cannotCreateInFolder,
  createInFolderOrRoot,
} from "../apps/web/src/node-client";

test("a folder that refuses a new file falls back to My Drive", async () => {
  const calls: (string | null)[] = [];
  const item = await createInFolderOrRoot("club", async (parentId) => {
    calls.push(parentId);
    if (parentId) {
      throw new DriveRequestError(403, "you do not have access to this item");
    }
    return "at-root";
  });
  expect(item).toBe("at-root");
  expect(calls).toEqual(["club", null]);
  expect(
    cannotCreateInFolder(
      new DriveRequestError(404, "not found"),
    ),
  ).toBe(true);
});

test("a file already at My Drive is created there", async () => {
  const calls: (string | null)[] = [];
  await createInFolderOrRoot(null, async (parentId) => {
    calls.push(parentId);
    return "ok";
  });
  expect(calls).toEqual([null]);
});

test("a folder that accepts the file is used", async () => {
  const calls: (string | null)[] = [];
  const item = await createInFolderOrRoot("club", async (parentId) => {
    calls.push(parentId);
    return "in-club";
  });
  expect(item).toBe("in-club");
  expect(calls).toEqual(["club"]);
});

test("other create failures stay visible", async () => {
  await expect(
    createInFolderOrRoot("club", async () => {
      throw new DriveRequestError(500, "SuiteDrive failed.");
    }),
  ).rejects.toThrow("SuiteDrive failed.");
  expect(cannotCreateInFolder(new Error("you do not have access"))).toBe(
    false,
  );
});
