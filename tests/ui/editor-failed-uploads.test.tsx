// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { EditorFailedUploads } from "../../apps/web/src/editor-failed-uploads";
import type { UploadJob } from "../../apps/web/src/upload-queue";

afterEach(cleanup);

it("retries the first failed file and leaves the second file's id out of the list", () => {
  const calls: string[] = [];
  const jobs: UploadJob[] = [
    {
      itemId: "secret-item",
      revision: "rev-1",
      bytes: 4,
      attempts: 1,
      nextAttemptAt: 10,
      failure: {
        kind: "quota",
        message: "full",
        remedy: "Free space in SuiteDrive, then retry this file.",
      },
    },
    {
      itemId: "other-item",
      revision: "rev-2",
      bytes: 4,
      attempts: 1,
      nextAttemptAt: 90,
      failure: {
        kind: "network",
        message: "offline",
        remedy: "Retry when SuiteDrive is reachable. This copy stays on this device.",
      },
    },
  ];
  render(<EditorFailedUploads jobs={jobs} onRetry={(itemId) => calls.push(itemId)} />);
  const list = screen.getByRole("list", { name: "Failed uploads" });
  expect(list.textContent).toContain("File 1. Free space in SuiteDrive, then retry this file.");
  expect(list.textContent).not.toContain("secret-item");
  fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);
  expect(calls).toEqual(["secret-item"]);
});
