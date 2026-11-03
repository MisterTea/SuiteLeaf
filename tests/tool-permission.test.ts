import { afterEach, describe, expect, it } from "vitest";
import {
  assistantAccessNow,
  assistantTargetAllowed,
  assistantToolAllowed,
  currentAssistantFileRole,
  setAssistantAccessCheck,
  setAssistantFileRole,
} from "../apps/web/src/ai/tool-permission";

afterEach(() => {
  setAssistantFileRole("none");
  setAssistantAccessCheck(undefined);
});

describe("assistant tool permission", () => {
  it("blocks a change after access drops, and still allows a read", () => {
    setAssistantFileRole("editor");
    expect(assistantToolAllowed(currentAssistantFileRole(), "set_cells").ok).toBe(true);
    setAssistantFileRole("viewer");
    const blocked = assistantToolAllowed(currentAssistantFileRole(), "set_cells");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toContain("cannot change");
    expect(assistantToolAllowed("viewer", "read_sheet").ok).toBe(true);
    expect(assistantToolAllowed("viewer", "export_spreadsheet").ok).toBe(false);
    expect(assistantToolAllowed("none", "read_sheet").ok).toBe(false);
    expect(assistantToolAllowed("commenter", "add_comment").ok).toBe(true);
    expect(assistantToolAllowed("commenter", "set_cells").ok).toBe(false);
    expect(assistantToolAllowed("local", "set_cells").ok).toBe(true);
  });

  it("reads access again before the next tool call and does not keep the error", async () => {
    setAssistantFileRole("editor");
    let role: "editor" | "none" = "editor";
    setAssistantAccessCheck(async () => role);
    expect(await assistantAccessNow()).toBe("editor");
    expect(assistantToolAllowed(currentAssistantFileRole(), "set_cells").ok).toBe(true);
    role = "none";
    const blocked = assistantToolAllowed(await assistantAccessNow(), "set_cells");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toContain("do not have access");
    setAssistantAccessCheck(async () => {
      throw new Error("secret-value");
    });
    expect(await assistantAccessNow()).toBe("none");
    const failed = assistantToolAllowed(currentAssistantFileRole(), "read_sheet");
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.reason).not.toContain("secret-value");
  });

  it("refuses another file after its access is removed and does not repeat the argument", () => {
    const roles = new Map<string, "editor" | "none">([["other", "editor"]]);
    const args = { fileId: "other", text: "secret tomato" };
    expect(
      assistantTargetAllowed("editor", "read_sheet", args, (id) => roles.get(id)).ok,
    ).toBe(true);
    roles.set("other", "none");
    const blocked = assistantTargetAllowed("editor", "read_sheet", args, (id) => roles.get(id));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toContain("do not have access");
      expect(blocked.reason).not.toContain("secret tomato");
      expect(blocked.reason).not.toContain("other");
    }
    const unknown = assistantTargetAllowed("editor", "read_sheet", { itemId: "missing" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toContain("unknown");
    expect(assistantTargetAllowed("editor", "set_cells", { range: "A1" }).ok).toBe(true);
  });
});
