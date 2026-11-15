// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFile, type FileRecord } from "@suiteleaf/core";
import { memoryStorage } from "./ai-memory-storage";

const remote = vi.hoisted(() => ({ get: vi.fn(), signedIn: true }));
vi.mock("../apps/web/src/ai/agent", () => ({ agentSession: { reloadAndResume: vi.fn() } }));
vi.mock("../apps/web/src/node-client", () => ({
  drive: { get: remote.get }, getSession: () => remote.signedIn ? { user: { id: "me" } } : null,
}));

import { currentSuiteTools, registerAgentHost, toAgentTool, type SuiteTool } from "../apps/web/src/ai/host";
import { setAssistantAccessCheck, setAssistantFileRole, type AssistantFileRole } from "../apps/web/src/ai/tool-permission";
import { reloadAiPreferences, writeAiPreferences } from "../apps/web/src/ai/preferences";
import { acceptHeldEdits, clearHeldEdits } from "../apps/web/src/ai/tool-review";
import { approvalStore, startRequest } from "../apps/web/src/ai/guard";
import { assertDriveCreation, assertRecordAccess, authorizeLibraryTool } from "../apps/web/src/ai/tools/file-authorization";
import { homeTools, type HomeAgentContext } from "../apps/web/src/ai/tools/files";
import { driveTools, type DriveAgentContext } from "../apps/web/src/ai/tools/cluster";

const offs: (() => void)[] = [];
const edited = vi.fn(() => "Changed");
const spec = (extra: Partial<SuiteTool> = {}): SuiteTool => ({
  name: "write_text", label: "Write", description: "", parameters: {} as never, execute: edited, ...extra,
});
const mount = (tool: SuiteTool, kind: "doc" | "home" = "doc") => {
  offs.push(registerAgentHost(kind === "home" ? "home" : "editor", { kind, snapshot: () => "", tools: [tool] }));
  return toAgentTool(tool);
};
async function settle<T>(work: () => Promise<T>): Promise<T> {
  const pending = work();
  pending.catch(() => {});
  await vi.runAllTimersAsync();
  return pending;
}
beforeEach(() => {
  vi.useFakeTimers();
  memoryStorage();
  reloadAiPreferences();
  writeAiPreferences({ enabled: true });
  setAssistantFileRole("editor", "file-a");
  setAssistantAccessCheck(undefined);
  clearHeldEdits();
  edited.mockClear();
  remote.signedIn = true;
  remote.get.mockReset().mockResolvedValue({ role: "editor", kind: "folder", trashed: false });
});
afterEach(() => {
  offs.splice(0).forEach(off => off());
  clearHeldEdits();
  setAssistantAccessCheck(undefined);
  setAssistantFileRole("none", "");
  vi.useRealTimers();
});

it.each(["viewer", "commenter", "responder", "none"] as AssistantFileRole[])("blocks a %s even through direct or nested tool execution", async role => {
  setAssistantFileRole(role);
  const tool = mount(spec());
  await expect(settle(() => tool.execute("1", {}, undefined))).rejects.toThrow();
  await expect(currentSuiteTools()[0].execute({})).rejects.toThrow();
  expect(edited).not.toHaveBeenCalled();
});

it.each(["local", "owner", "editor"] as AssistantFileRole[])("allows authorized %s edits", async role => {
  setAssistantFileRole(role);
  await settle(() => mount(spec()).execute("1", {}, undefined));
  expect(edited).toHaveBeenCalledOnce();
});

it("rechecks access after confirmation instead of treating approval as permission", async () => {
  startRequest("Organize this");
  offs.push(approvalStore.subscribe(() => {
    const approval = approvalStore.get();
    if (approval) { setAssistantFileRole("viewer"); approval.resolve(true); }
  }));
  const tool = mount(spec({ confirm: () => "Replace it?" }));
  await expect(settle(() => tool.execute("1", {}, undefined))).rejects.toThrow("cannot change");
  expect(edited).not.toHaveBeenCalled();
});

it.each(["revoked", "different-file", "closed", "stopped"])("refuses a queued edit when %s before Accept", async change => {
  writeAiPreferences({ reviewEdits: true });
  const controller = new AbortController();
  await settle(() => mount(spec()).execute("1", {}, controller.signal));
  if (change === "revoked") setAssistantAccessCheck(async () => "viewer");
  if (change === "different-file") setAssistantFileRole("editor", "file-b");
  if (change === "closed") offs.pop()!();
  if (change === "stopped") controller.abort();
  expect(await acceptHeldEdits()).toContain("could not be applied");
  expect(edited).not.toHaveBeenCalled();
});

it("denies home tools that do not declare authorization", async () => {
  const tool = mount(spec({ name: "create_file" }), "home");
  await expect(settle(() => tool.execute("1", {}, undefined))).rejects.toThrow("no permission check");
  expect(edited).not.toHaveBeenCalled();
});

function linked(title: string, itemId: string): FileRecord {
  return { file: createFile("doc", title), drive: { itemId, nodeUrl: "https://team.example" } } as FileRecord;
}
it("checks every named library target before changing any file, regardless of the last open file's role", async () => {
  const records = [linked("Budget", "editable"), linked("Plan", "read-only")];
  remote.get.mockImplementation(async (id: string) => ({ role: id === "editable" ? "editor" : "viewer" }));
  const ctx = { fresh: async () => records, records, rename: edited, remove: edited } as unknown as HomeAgentContext;
  const tools = homeTools(ctx);
  const rename = tools.find(tool => tool.name === "rename_file")!;
  mount(rename, "home");
  await expect(settle(() => toAgentTool(rename).execute("1", { name: "Plan", new_name: "Changed" }, undefined))).rejects.toThrow("permission to edit");
  await expect(authorizeLibraryTool(ctx, "remove_file", { names: "Budget, Plan" })).rejects.toThrow("permission to edit");
  expect(remote.get).toHaveBeenCalledWith("editable");
  expect(remote.get).toHaveBeenCalledWith("read-only");
  expect(edited).not.toHaveBeenCalled();
});

it("fails closed for cached shared files when signed out or access checks fail", async () => {
  const record = linked("Plan", "shared");
  remote.signedIn = false;
  await expect(assertRecordAccess(record, true)).rejects.toThrow("permission to edit");
  remote.signedIn = true;
  remote.get.mockRejectedValue(new Error("private server detail"));
  await expect(assertRecordAccess(record, false)).rejects.toThrow("do not have access");
  await expect(assertDriveCreation("folder")).rejects.toThrow("permission to create");
  await expect(assertRecordAccess({ file: createFile("doc", "Local") }, true)).resolves.toBeUndefined();
});

it.each(["viewer", "commenter", "responder", null])("denies creation in a folder with %s access", async role => {
  remote.get.mockResolvedValue({ kind: "folder", role });
  await expect(assertDriveCreation("folder")).rejects.toThrow("permission to create");
});

it("allows creation only in writable folders or an authenticated user's own root", async () => {
  for (const role of ["owner", "editor"]) {
    remote.get.mockResolvedValue({ kind: "folder", role });
    await expect(assertDriveCreation("folder")).resolves.toBeUndefined();
  }
  remote.get.mockResolvedValue({ kind: "file", role: "owner" });
  await expect(assertDriveCreation("not-folder")).rejects.toThrow();
  remote.get.mockResolvedValue({ kind: "folder", role: "owner", trashed: true });
  await expect(assertDriveCreation("trashed")).rejects.toThrow();
  await expect(assertDriveCreation(null)).resolves.toBeUndefined();
  remote.signedIn = false;
  await expect(assertDriveCreation(null)).rejects.toThrow();
});

it("applies destination permissions to the actual Drive creation tools", async () => {
  remote.get.mockResolvedValue({ kind: "folder", role: "viewer" });
  const ctx = { authorizeCreate: () => assertDriveCreation("shared-folder"), create: edited } as unknown as DriveAgentContext;
  for (const name of ["create_file", "new_folder"]) {
    const tool = driveTools(ctx).find(tool => tool.name === name)!;
    const off = registerAgentHost("home", { kind: "home", snapshot: () => "", tools: [tool] });
    try {
      await expect(settle(() => toAgentTool(tool).execute("1", { kind: "document", name: "New" }, undefined))).rejects.toThrow("permission to create");
    } finally { off(); }
  }
  expect(edited).not.toHaveBeenCalled();
});

it("permits local library creation and reads, checks implicit Trash targets, and denies unknown actions", async () => {
  const records = [{ file: createFile("doc", "Local"), trashedAt: new Date().toISOString() }];
  const ctx = { records, fresh: async () => records } as HomeAgentContext;
  for (const name of ["list_files", "create_file", "create_from_template", "open_from_computer", "remove_template"])
    await expect(authorizeLibraryTool(ctx, name, {})).resolves.toBeUndefined();
  await expect(authorizeLibraryTool(ctx, "empty_trash", {})).resolves.toBeUndefined();
  await expect(authorizeLibraryTool(ctx, "rename_file", { name: "Local" })).resolves.toBeUndefined();
  await expect(authorizeLibraryTool(ctx, "open_file", { name: "Picked from computer" })).resolves.toBeUndefined();
  await expect(authorizeLibraryTool(ctx, "unknown_write", {})).rejects.toThrow("no permission check");
  remote.get.mockResolvedValue({ role: "commenter" });
  await expect(assertRecordAccess(linked("Shared", "shared"), false)).resolves.toBeUndefined();
});

it("authorizes the exact library row used by the action when duplicate titles have different access", async () => {
  const editable = linked("Plan", "editable"), restricted = linked("Plan", "restricted");
  remote.get.mockImplementation(async (id: string) => ({ role: id === "editable" ? "editor" : "viewer" }));
  const ctx = { records: [restricted, editable], fresh: async () => [editable, restricted] } as HomeAgentContext;
  await expect(authorizeLibraryTool(ctx, "rename_file", { name: "Plan" })).rejects.toThrow("permission to edit");
});

it("refuses an edit if the file changes while the permission lookup is in flight", async () => {
  setAssistantAccessCheck(async () => {
    setAssistantFileRole("editor", "file-b");
    return "editor";
  });
  const tool = mount(spec());
  await expect(settle(() => tool.execute("1", {}, undefined))).rejects.toThrow("open file changed");
  expect(edited).not.toHaveBeenCalled();
});
