import { beforeEach, describe, expect, it, vi } from "vitest";

const now = "2026-11-01T02:00:00.000Z";
const memory = new Map<string, string>();

function installStorage() {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    clear: () => memory.clear(),
  });
}

describe("an idle device", () => {
  beforeEach(() => {
    memory.clear();
    installStorage();
    vi.resetModules();
  });

  it("signs out as idle and leaves the waiting edit and the upload", async () => {
    memory.set(
      "suiteleaf:node-session",
      JSON.stringify({
        url: "https://leaf.example",
        token: "token",
        user: { id: "maya", name: "Maya" },
        updatedAt: "2026-11-01T00:00:00.000Z",
        idleSecs: 60,
      }),
    );
    memory.set("suiteleaf.uploadQueue", JSON.stringify([{ fileId: "beds", bytes: "North" }]));
    memory.set("suiteleaf-room-queue:beds", JSON.stringify([{ id: "edit-1", update: "West" }]));
    const { getSession, sessionEndReason } = await import("../apps/web/src/node-client");
    expect(getSession(now)).toBeNull();
    expect(sessionEndReason()).toBe("idle");
    expect(memory.get("suiteleaf.uploadQueue")).toContain("North");
    expect(memory.get("suiteleaf-room-queue:beds")).toContain("West");
    expect(memory.has("suiteleaf:node-session")).toBe(false);
    const stored = `${memory.get("suiteleaf.uploadQueue")}${memory.get("suiteleaf-room-queue:beds")}`;
    expect(stored).not.toContain("secret-value");
  });
});
