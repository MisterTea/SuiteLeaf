// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createFile, serializeFile, type FileRecord } from "@suiteleaf/core";
import { memoryStorage } from "./ai-memory-storage";

const disk = new Map<string, FileRecord>();
vi.mock("../apps/web/src/storage", () => ({
  storage: {
    list: async () => [...disk.values()].map((r) => (r.path ? { ...r, file: { ...r.file, content: undefined } } : r)),
    get: async (id: string) => disk.get(id),
    save: async (r: FileRecord) => void disk.set(r.file.id, r),
    remove: async (id: string) => void disk.delete(id),
  },
}));

const guard = await import("../apps/web/src/ai/guard");
const host = await import("../apps/web/src/ai/host");
const cursor = await import("../apps/web/src/ai/cursor");
const { fileRequestStore, requestFile, cancelFileRequest } = await import("../apps/web/src/ai/file-request");
const { applyRestoredFile, bindRestoredFile } = await import("../apps/web/src/ai/restored-file");
const { PARSE_ERROR } = await import("../apps/web/src/ai/model-stream");
const { writeAiPreferences, reloadAiPreferences } = await import("../apps/web/src/ai/preferences");
const { acceptHeldEdits, clearHeldEdits } = await import("../apps/web/src/ai/tool-review");

const offs: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  memoryStorage();
  reloadAiPreferences();
  writeAiPreferences({ enabled: true });
  document.body.innerHTML = "";
});
afterEach(() => {
  offs.splice(0).forEach((off) => off());
  vi.useRealTimers();
});

async function settle<T>(work: () => T | Promise<T>) {
  const p = Promise.resolve().then(work);
  p.catch(() => {});
  await vi.runAllTimersAsync();
  return p;
}

const simple = (name: string, extra: Partial<import("../apps/web/src/ai/host").SuiteTool> = {}) =>
  ({ name, label: name.replace(/_/g, " "), description: "", parameters: {} as never, execute: () => `${name} ran`, ...extra }) as import("../apps/web/src/ai/host").SuiteTool;

describe("requests and approvals", () => {
  it("knows the request and whether it asked for an action", () => {
    guard.startRequest("Please delete the draft");
    const id = guard.currentRequest().id;
    guard.startRequest("Rename the draft");
    expect(guard.currentRequest()).toEqual({ id: id + 1, text: "Rename the draft" });
    expect(guard.requested(/rename/i)).toBe(true);
    expect(guard.requested(/delete/i)).toBe(false);
  });

  it("asks one question at a time, and a new question declines the old one", async () => {
    const seen: (string | undefined)[] = [];
    offs.push(guard.approvalStore.subscribe(() => seen.push(guard.approvalStore.get()?.question)));
    const first = guard.requestApproval("Delete A?");
    const second = guard.requestApproval("Delete B?");
    expect(await first).toBe(false);
    expect(guard.approvalStore.get()?.question).toBe("Delete B?");
    guard.approvalStore.get()!.resolve(true);
    expect(await second).toBe(true);
    expect(guard.approvalStore.get()).toBeNull();
    expect(seen).toEqual(["Delete A?", undefined, "Delete B?", undefined]);
  });

  it("declines when time runs out or the assistant stops", async () => {
    const timed = guard.requestApproval("Wait?", 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await timed).toBe(false);
    const stopped = guard.requestApproval("Stop?");
    guard.cancelApproval();
    expect(await stopped).toBe(false);
  });
});

describe("undo baselines", () => {
  it("counts only the request's own undo steps and keeps the first snapshot", () => {
    const editor = {};
    guard.startRequest("first");
    expect(guard.ownUndoSteps(editor, 5)).toBe(0);
    expect(guard.baselineSnapshot(editor)).toBeUndefined();
    guard.markBaseline(editor, 3, () => "before");
    guard.markBaseline(editor, 4, () => "later");
    expect(guard.ownUndoSteps(editor, 6)).toBe(3);
    expect(guard.ownUndoSteps(editor, 1)).toBe(0);
    expect(guard.baselineSnapshot(editor)).toBe("before");
    const undo = vi.fn();
    expect(guard.undoOwnEdits(editor, 5, undo)).toBe(2);
    expect(undo).toHaveBeenCalledTimes(2);
    guard.startRequest("second");
    expect(guard.ownUndoSteps(editor, 9)).toBe(0);
    expect(guard.baselineSnapshot(editor)).toBeUndefined();
  });
});

describe("checkpoints", () => {
  const doc = (title: string, text: string) => {
    const file = createFile("doc", title);
    file.content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } as never;
    return file;
  };

  beforeEach(() => {
    disk.clear();
    location.hash = "#/";
  });

  it("lists created, changed and removed files with the changed lines", async () => {
    const notes = { file: doc("Notes", "Old line") };
    const gone = { file: createFile("sheet", "Gone") };
    const drive = { file: createFile("doc", "Shared"), drive: { id: "d1" } } as unknown as FileRecord;
    const ondisk = { file: doc("On disk", "Disk text"), path: "/tmp/disk.sldoc" } as FileRecord;
    for (const r of [notes, gone, drive, ondisk]) disk.set(r.file.id, structuredClone(r));
    const checkpoint = await guard.takeCheckpoint();
    disk.set(notes.file.id, { file: { ...doc("Notes", "New line"), id: notes.file.id, updatedAt: "2099-01-01T00:00:00.000Z" } });
    disk.set(ondisk.file.id, { ...ondisk, file: { ...doc("On disk", "Disk new"), id: ondisk.file.id, updatedAt: "2099-01-01T00:00:00.000Z" } });
    disk.delete(gone.file.id);
    const fresh = { file: createFile("slide", "Fresh") };
    disk.set(fresh.file.id, fresh);
    disk.set(drive.file.id, { ...drive, file: { ...drive.file, title: "Shared 2" } });
    const changes = await checkpoint.changes();
    expect(changes).toEqual(
      expect.arrayContaining([
        { kind: "changed", title: "Notes", drive: false, preview: { removed: ["Old line"], added: ["New line"] } },
        { kind: "changed", title: "On disk", drive: false, preview: { removed: ["Disk text"], added: ["Disk new"] } },
        { kind: "changed", title: "Shared 2", drive: true, preview: { removed: [], added: [] } },
        { kind: "created", title: "Fresh", drive: false },
        { kind: "removed", title: "Gone", drive: false },
      ]),
    );
    expect(changes).toHaveLength(5);
  });

  it("puts the library back, except SuiteDrive files, after leaving the editor", async () => {
    const notes = { file: doc("Notes", "Old") };
    const gone = { file: createFile("sheet", "Gone") };
    const driveGone = { file: createFile("doc", "Drive gone"), drive: { id: "d2" } } as unknown as FileRecord;
    const same = { file: createFile("doc", "Same") };
    for (const r of [notes, gone, driveGone, same]) disk.set(r.file.id, structuredClone(r));
    const checkpoint = await guard.takeCheckpoint();
    disk.set(notes.file.id, { file: { ...notes.file, title: "Renamed", updatedAt: "2099-01-01T00:00:00.000Z" } });
    disk.delete(gone.file.id);
    disk.delete(driveGone.file.id);
    const fresh = { file: createFile("slide", "Fresh") };
    disk.set(fresh.file.id, fresh);
    const library = vi.fn();
    window.addEventListener("suiteleaf:library-changed", library);
    location.hash = "#/file/x";
    const out = await settle(() => checkpoint.restore());
    expect(location.hash).toBe("#/");
    expect(out).toBe("Put back 3 file(s) as they were before. SuiteDrive files are not undone here: Drive gone.");
    expect([...disk.values()].map((r) => r.file.title).sort()).toEqual(["Gone", "Notes", "Same"]);
    expect(library).toHaveBeenCalled();
  });

  it("skips files whose old body it could not read", async () => {
    const ondisk = { file: doc("Disk", "x"), path: "/tmp/a" } as FileRecord;
    const vanished = { file: doc("Vanished", "y"), path: "/tmp/b" } as FileRecord;
    disk.set(ondisk.file.id, ondisk);
    disk.set(vanished.file.id, vanished);
    const listed = new Map(disk);
    disk.clear();
    for (const [id, r] of listed) disk.set(id, r);
    const original = disk.get.bind(disk);
    const spy = vi
      .spyOn(disk, "get")
      .mockImplementation((id) =>
        id === ondisk.file.id || id === vanished.file.id ? ({ ...original(id)!, file: { ...original(id)!.file, content: undefined } } as unknown as FileRecord) : original(id),
      );
    const checkpoint = await guard.takeCheckpoint();
    spy.mockRestore();
    disk.set(ondisk.file.id, { ...ondisk, file: { ...ondisk.file, title: "Disk 2" } });
    disk.delete(vanished.file.id);
    expect(await settle(() => checkpoint.restore())).toBe("Put back 0 file(s) as they were before. SuiteDrive files are not undone here: Disk, Vanished.");
    expect(await checkpoint.changes()).toEqual([
      { kind: "changed", title: "Disk 2", drive: false, preview: undefined },
      { kind: "removed", title: "Vanished", drive: false },
    ]);
  });
});

describe("hosts and their tools", () => {
  it("registers screens, prefers an open editor, and reports their state", () => {
    const seen = vi.fn();
    offs.push(host.onHostsChanged(seen));
    expect(host.documentContextLabel()).toBe("No document open");
    offs.push(host.registerAgentHost("home", { kind: "home", snapshot: () => "Home", place: () => "No document open", tools: [simple("list_files")] }));
    expect(host.activeHost()?.kind).toBe("home");
    const offEditor = host.registerAgentHost("editor", {
      kind: "doc",
      snapshot: () => "Doc",
      place: () => "Report",
      tools: [simple("write_text"), simple("list_files")],
      review: () => ["Heading is empty"],
    });
    const offGlobal = host.registerGlobalHost({ kind: "home", snapshot: () => "", tools: [simple("connect_to_server")] });
    host.registerToolEverywhere(simple("todo"));
    host.registerToolEverywhere(simple("todo"));
    expect(host.activeHost()?.kind).toBe("doc");
    expect(host.currentSuiteTools().map((t) => t.name)).toEqual(["todo", "list_files", "write_text", "connect_to_server"]);
    expect(host.toolScreen("write_text")).toBe("doc");
    expect(host.toolScreen("list_files")).toBe("doc");
    expect(host.toolScreen("connect_to_server")).toBeUndefined();
    expect(host.currentSnapshot()).toBe("Home\nDoc");
    expect(host.currentReview()).toEqual(["Heading is empty"]);
    expect(host.documentContextLabel()).toBe("Report");
    offEditor();
    offGlobal();
    expect(host.activeHost()?.kind).toBe("home");
    expect(seen).toHaveBeenCalled();
  });

  it("keeps a newer registration when an old one unregisters", () => {
    const off1 = host.registerAgentHost("editor", { kind: "sheet", snapshot: () => "", tools: [] });
    const off2 = host.registerAgentHost("editor", { kind: "slide", snapshot: () => "", tools: [] });
    off1();
    expect(host.activeHost()?.kind).toBe("slide");
    off2();
    const g1 = host.registerGlobalHost({ kind: "home", snapshot: () => "g1", tools: [] });
    const g2 = host.registerGlobalHost({ kind: "home", snapshot: () => "g2", tools: [] });
    g1();
    expect(host.currentSnapshot()).toBe("g2");
    g2();
  });

  it("registers a mounted screen and reads its latest state on every call", () => {
    let title = "One";
    const { rerender, unmount } = renderHook(() =>
      host.useAgentHost("editor", () => ({ kind: "sheet", snapshot: () => title, place: () => `Sheet ${title}`, tools: [simple("set_cells")], beforeTool: () => {} })),
    );
    expect(host.activeHost()?.kind).toBe("sheet");
    title = "Two";
    rerender();
    expect(host.currentSnapshot()).toBe("Two");
    expect(host.documentContextLabel()).toBe("Sheet Two");
    expect(host.currentReview()).toEqual([]);
    expect(host.activeHost()?.tools.map((t) => t.name)).toEqual(["set_cells"]);
    act(() => host.activeHost()?.beforeTool?.());
    unmount();
    expect(host.activeHost()).toBeUndefined();
    const bare = renderHook(() => host.useAgentHost("editor", () => ({ kind: "form", snapshot: () => "", tools: [] })));
    expect(host.activeHost()?.place?.()).toBe("");
    bare.unmount();
  });

  it("waits for a screen with tools, and gives up", async () => {
    const waiting = settle(() => host.waitForHost("sheet"));
    offs.push(host.registerAgentHost("editor", { kind: "sheet", snapshot: () => "", tools: [simple("set_cells")] }));
    expect((await waiting).kind).toBe("sheet");
    const home = settle(() => host.waitForHost("home", 1000));
    await expect(home).rejects.toThrow("The home screen did not open.");
  });

  it("holds the conversation while a tool acts", async () => {
    expect(host.agentIsActing()).toBe(false);
    let during = false;
    await settle(() => host.whileAgentActs(async () => void (during = host.agentIsActing())));
    expect(during).toBe(true);
    expect(host.agentIsActing()).toBe(false);
  });
});

describe("running a tool for the agent", () => {
  const run = (t: ReturnType<typeof host.toAgentTool>, args: unknown = {}, signal?: AbortSignal) =>
    settle(() => t.execute("call-1", args as never, signal));

  it("explains an unreadable call and reshapes arguments first", () => {
    const t = host.toAgentTool(simple("set_cells", { prepare: (a) => ({ ...a, fixed: true }) }));
    expect(() => t.prepareArguments?.({ [PARSE_ERROR]: "bad JSON." })).toThrow("This tool call could not be read: bad JSON. Write the call again with valid arguments.");
    expect(t.prepareArguments?.({ a: 1 })).toEqual({ a: 1, fixed: true });
    expect(host.toAgentTool(simple("x")).prepareArguments?.({ a: 1 })).toEqual({ a: 1 });
  });

  it("runs the live tool after moving the pointer, and returns its details", async () => {
    document.body.innerHTML = `<button id="go">Go</button>`;
    const before = vi.fn();
    const live = simple("set_cells", { target: () => document.getElementById("go"), execute: () => ({ text: "Done", details: { cells: 2 } }) });
    offs.push(host.registerAgentHost("editor", { kind: "sheet", snapshot: () => "", tools: [live], beforeTool: before }));
    const result = await run(host.toAgentTool(simple("set_cells")));
    expect(result).toEqual({ content: [{ type: "text", text: "Done" }], details: { cells: 2 } });
    expect(before).toHaveBeenCalledOnce();
    expect(cursor.cursorStore.get().label).toBe("set cells");
  });

  it("stops before running when aborted, and reports a tool that left", async () => {
    const t = host.toAgentTool(simple("gone_tool"));
    const aborted = AbortSignal.abort();
    expect((await run(t, {}, aborted)).content[0]).toEqual({ type: "text", text: "The assistant stopped. This edit was not run." });
    await expect(run(t)).rejects.toThrow("Tool gone_tool not found");
    const controller = new AbortController();
    offs.push(host.registerAgentHost("editor", { kind: "doc", snapshot: () => "", tools: [simple("gone_tool")] }));
    const pending = settle(() => t.execute("c", {} as never, controller.signal));
    controller.abort();
    expect((await pending).content[0]).toMatchObject({ text: "The assistant stopped. This edit was not run." });
  });

  it("refuses while the assistant is off or the policy cannot be read", async () => {
    const t = host.toAgentTool(simple("x"));
    localStorage.setItem("suiteleaf.ai.orgPolicy", "{not json");
    writeAiPreferences({ enabled: false });
    await expect(run(t)).rejects.toThrow("The assistant is off.");
  });

  it("asks before a destructive action unless the request asked for it", async () => {
    const remove = simple("remove_file", { confirm: () => "Remove Notes?", intent: /remove/i, target: () => Promise.reject(new Error("no row")) });
    offs.push(host.registerAgentHost("home", { kind: "home", snapshot: () => "", tools: [remove] }));
    const t = host.toAgentTool(remove);
    guard.startRequest("tidy up");
    offs.push(guard.approvalStore.subscribe(() => guard.approvalStore.get()?.resolve(false)));
    await expect(run(t)).rejects.toThrow('The user answered no to "Remove Notes?", so nothing was changed.');
    guard.startRequest("remove the notes");
    expect((await run(t)).content[0]).toMatchObject({ text: "remove_file ran" });
  });

  it("holds document edits for review when the user asked to", async () => {
    writeAiPreferences({ reviewEdits: true });
    const edit = vi.fn(() => "written");
    offs.push(host.registerAgentHost("editor", { kind: "doc", snapshot: () => "", tools: [simple("write_text", { execute: edit })] }));
    const result = await run(host.toAgentTool(simple("write_text")));
    expect(result.content[0]).toMatchObject({ text: "This edit is waiting for Accept. The document was not changed." });
    expect(edit).not.toHaveBeenCalled();
    await acceptHeldEdits();
    expect(edit).toHaveBeenCalledOnce();
    clearHeldEdits();
  });
});

describe("the agent's pointer", () => {
  it("resolves elements, rectangles and points", () => {
    expect(cursor.pointOf(null)).toBeNull();
    const el = document.createElement("div");
    expect(cursor.pointOf(el)).toBeNull();
    document.body.append(el);
    expect(cursor.pointOf(el)).toBeNull();
    el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 10 }) as DOMRect;
    expect(cursor.pointOf(el)).toEqual({ x: 50, y: 25 });
    expect(cursor.pointOf({ left: 0, top: 0, width: 10, height: 20 } as DOMRect)).toEqual({ x: 5, y: 10 });
    expect(cursor.pointOf({ x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });

  it("shows, glides, presses and hides", async () => {
    const states: boolean[] = [];
    offs.push(cursor.cursorStore.subscribe(() => states.push(cursor.cursorStore.get().clicking)));
    cursor.showCursor(null);
    expect(cursor.cursorStore.get()).toMatchObject({ visible: true, x: innerWidth - 420, y: 120 });
    cursor.showCursor({ x: 7, y: 8 });
    expect(cursor.cursorStore.get()).toMatchObject({ x: 7, y: 8 });
    await settle(() => cursor.moveCursor({ x: -50, y: 99999 }, "Click"));
    expect(cursor.cursorStore.get()).toMatchObject({ x: 4, y: innerHeight - 4, label: "Click", clicking: false });
    expect(states).toContain(true);
    await settle(() => cursor.moveCursor(null, "Nowhere"));
    cursor.hideCursor();
    expect(cursor.cursorStore.get()).toMatchObject({ visible: false, label: "" });
  });
});

describe("file requests and restored files", () => {
  it("asks for one file at a time and resolves null when replaced, cancelled or timed out", async () => {
    const first = requestFile("Pick one", ".csv");
    expect(fileRequestStore.get()).toMatchObject({ prompt: "Pick one", accept: ".csv" });
    const second = requestFile("Pick another", ".pptx", 1000);
    expect(await first).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await second).toBeNull();
    expect(fileRequestStore.get()).toBeNull();
    const third = requestFile("Again", "*");
    cancelFileRequest();
    expect(await third).toBeNull();
    const file = new File(["x"], "a.csv");
    const fourth = requestFile("Last", "*");
    fileRequestStore.get()!.resolve(file);
    expect(await fourth).toBe(file);
  });

  it("hands a restored file to the editor that listens", () => {
    const record = { file: createFile("doc", "Back") };
    expect(applyRestoredFile(record)).toBe(false);
    const apply = vi.fn();
    bindRestoredFile(apply);
    expect(applyRestoredFile(record)).toBe(true);
    expect(apply).toHaveBeenCalledWith(record);
    bindRestoredFile(null);
    expect(applyRestoredFile(record)).toBe(false);
    expect(serializeFile(record.file)).toContain("Back");
  });
});
