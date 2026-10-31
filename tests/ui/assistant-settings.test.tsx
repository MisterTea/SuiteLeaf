// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { AssistantSettings } from "../../apps/web/src/ai/assistant-settings";
import { ModeContext } from "../../apps/web/src/mode";
import { readAiPreferences, reloadAiPreferences } from "../../apps/web/src/ai/preferences";

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    // Node's localStorage is absent unless a storage file is configured.
  }
  reloadAiPreferences();
});

function renderSettings(demo: boolean, kind: "single" | "cluster" = "single") {
  return render(
    <ModeContext.Provider
      value={{
        mode: kind === "cluster" ? { kind, serverUrl: "https://suiteleaf.test" } : { kind: "single" },
        locked: demo,
        demo,
      }}
    >
      <AssistantSettings />
    </ModeContext.Provider>,
  );
}

it("hides assistant settings in serverless mode", () => {
  renderSettings(true);
  expect(screen.queryByText("Assistant settings")).toBeNull();
});

it("lets someone choose a remote endpoint and a model, starting from FrogNano", async () => {
  renderSettings(false, "cluster");
  const user = userEvent.setup();
  await user.click(screen.getByText("Assistant settings"));
  expect((screen.getByRole("radio", { name: "On the server" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("frognano-4b");
  expect(screen.getByText(/downloads the selected model/)).toBeTruthy();
  expect([...document.querySelectorAll("#suiteleaf-ai-models option")].map((option) => (option as HTMLOptionElement).value)).toEqual([
    "frognano-4b",
    "gemma-4-e4b",
    "muse-glimmer-30b",
  ]);
  await user.click(screen.getByRole("radio", { name: "OpenAI-compatible endpoint" }));
  await user.clear(screen.getByLabelText("Endpoint"));
  await user.type(screen.getByLabelText("Endpoint"), "http://127.0.0.1:8080/v1");
  await user.clear(screen.getByLabelText("Model"));
  await user.type(screen.getByLabelText("Model"), "my-model");
  expect(readAiPreferences()).toMatchObject({
    place: "remote",
    model: "my-model",
    endpoint: "http://127.0.0.1:8080/v1",
  });
});
