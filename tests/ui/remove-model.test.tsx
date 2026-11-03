// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RemoveDownloadedModel } from "../../apps/web/src/ai/assistant-settings";

afterEach(cleanup);

it("removes a downloaded model and does not repeat the file name", async () => {
  const names: string[] = [];
  render(
    <RemoveDownloadedModel
      fileName="secret-value.gguf"
      onRemove={async (fileName) => {
        names.push(fileName);
        return "That model was removed.";
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove downloaded model" }));
  expect(names).toEqual(["secret-value.gguf"]);
  const status = await screen.findByRole("status");
  expect(status.textContent).toBe("That model was removed.");
  expect(status.textContent).not.toContain("secret-value");
});

it("does not send a name that is not a built-in model file", async () => {
  let called = false;
  render(
    <RemoveDownloadedModel
      fileName=""
      onRemove={async () => {
        called = true;
        return "secret-value";
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove downloaded model" }));
  expect(called).toBe(false);
  expect(screen.getByRole("status").textContent).toBe("That file is not a downloaded model.");
  expect(screen.getByRole("status").textContent).not.toContain("secret-value");
});
