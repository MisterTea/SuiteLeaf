// @vitest-environment jsdom
import { expect, it } from "vitest";
import { toAgentTool } from "../apps/web/src/ai/host";
import { reloadAiPreferences, writeAiPreferences } from "../apps/web/src/ai/preferences";

function memoryStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
}

it("does not run a tool while the assistant is off", async () => {
  memoryStorage();
  reloadAiPreferences();
  writeAiPreferences({ enabled: false });
  localStorage.removeItem("suiteleaf.ai.orgPolicy");
  let ran = false;
  const tool = toAgentTool({
    name: "write_text",
    label: "Write",
    description: "Write",
    parameters: { type: "object", properties: {} } as never,
    execute: () => {
      ran = true;
      return "secret-value";
    },
  });
  await expect(tool.execute("1", {}, undefined)).rejects.toThrow("The assistant is off.");
  expect(ran).toBe(false);

  localStorage.setItem(
    "suiteleaf.ai.orgPolicy",
    JSON.stringify({ assistant: "off", providers: [], maxTokens: 1024, apiKey: "secret-value" }),
  );
  writeAiPreferences({ enabled: true });
  await expect(tool.execute("1", {}, undefined)).rejects.toThrow(
    "The organization policy does not store a secret.",
  );
  expect(ran).toBe(false);
  try {
    await tool.execute("1", {}, undefined);
  } catch (error) {
    expect(error instanceof Error ? error.message : "").not.toContain("secret-value");
  }
});
