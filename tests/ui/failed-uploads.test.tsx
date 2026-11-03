// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { FailedUploadList } from "../../apps/web/src/admin/admin-view";

afterEach(cleanup);

it("retries one failed upload and does not show the file id", () => {
  const calls: string[] = [];
  render(
    <FailedUploadList
      jobs={[
        { itemId: "secret-item", failure: { remedy: "Free space in SuiteDrive, then retry this file." } },
        { itemId: "other-item", failure: { remedy: "Retry when SuiteDrive is reachable. This copy stays on this device." } },
      ]}
      onRetry={(itemId) => calls.push(itemId)}
    />,
  );
  const list = screen.getByRole("list", { name: "Failed uploads" });
  expect(list.textContent).toContain("File 1. Free space in SuiteDrive, then retry this file.");
  expect(list.textContent).not.toContain("secret-item");
  fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);
  expect(calls).toEqual(["secret-item"]);
});
