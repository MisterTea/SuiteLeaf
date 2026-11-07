// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { memoryStorage } from "../ai-memory-storage";

memoryStorage();
memoryStorage("sessionStorage");
const scrolled = vi.fn();
Element.prototype.scrollTo = scrolled as never;

const session = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const s = {
    state: "idle" as string,
    items: [] as unknown[],
    metrics: { requests: 0, toolCalls: 0, outputTokens: 0, generateMs: 0, wallMs: 0 } as Record<string, number>,
    model: { state: "idle" } as Record<string, unknown>,
    draft: undefined as undefined | { label: string; chars: number },
    version: 0,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    getVersion: () => s.version,
    emit() {
      s.version++;
      listeners.forEach((l) => l());
    },
    prompt: vi.fn(async () => {}),
    reset: vi.fn(),
    stop: vi.fn(),
    warmUp: vi.fn(),
    resume: vi.fn(async () => {}),
  };
  return s;
});
vi.mock("../../apps/web/src/ai/agent", () => ({ agentSession: session }));

const { AgentCursor, AgentLayer, AgentSidebar, AiButton } = await import("../../apps/web/src/ai/AgentSidebar");
const { ModeContext } = await import("../../apps/web/src/mode");
const { readAiPreferences, reloadAiPreferences, writeAiPreferences } = await import("../../apps/web/src/ai/preferences");
const { requestApproval } = await import("../../apps/web/src/ai/guard");
const { requestFile } = await import("../../apps/web/src/ai/file-request");
const { todoTool, clearTodos } = await import("../../apps/web/src/ai/todo");
const { moveCursor, hideCursor } = await import("../../apps/web/src/ai/cursor");
const { registerAgentHost, whileAgentActs } = await import("../../apps/web/src/ai/host");

type Mode = { demo?: boolean; cluster?: boolean };
const wrap = (node: ReactNode, { demo = false, cluster = false }: Mode = {}, path = "/") => (
  <MemoryRouter initialEntries={[path]}>
    <ModeContext.Provider value={{ mode: cluster ? { kind: "cluster", serverUrl: "https://team.example" } : { kind: "single" }, locked: demo, demo }}>{node}</ModeContext.Provider>
  </MemoryRouter>
);
const update = (change: Partial<typeof session>) =>
  act(() => {
    Object.assign(session, change);
    session.emit();
  });

it("shows the model the hosted server selected", () => {
  session.model = { state: "ready", backend: "remote", model: "openai/gpt-5-mini" };
  render(wrap(<AgentSidebar />, { cluster: true }));
  expect(screen.getByText("openai/gpt-5-mini · on the server")).toBeTruthy();
  expect(screen.getByPlaceholderText("Ask openai/gpt-5-mini to do something…")).toBeTruthy();
});

beforeEach(() => {
  memoryStorage();
  memoryStorage("sessionStorage");
  reloadAiPreferences();
  Object.assign(session, { state: "idle", items: [], model: { state: "idle" }, draft: undefined, metrics: { requests: 0, toolCalls: 0, outputTokens: 0, generateMs: 0, wallMs: 0 } });
  vi.clearAllMocks();
  delete (window as { suiteleaf?: unknown }).suiteleaf;
});
afterEach(() => {
  cleanup();
  clearTodos();
  hideCursor();
});

describe("the AI button and layer", () => {
  it("turns the assistant on with the first click and opens and closes the panel", async () => {
    render(wrap(<><AiButton /><AgentLayer /></>));
    const button = screen.getByRole("button", { name: "AI assistant" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("complementary", { name: "AI assistant" })).toBeNull();
    fireEvent.click(button);
    expect(readAiPreferences().enabled).toBe(true);
    expect(await screen.findByRole("complementary", { name: "AI assistant" })).toBeTruthy();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(document.body.classList.contains("agent-open")).toBe(true);
    expect(sessionStorage.getItem("suiteleaf.ai.open")).toBe("1");
    expect(session.warmUp).toHaveBeenCalled();
    expect(session.resume).toHaveBeenCalled();
    fireEvent.click(button);
    expect(screen.queryByRole("complementary", { name: "AI assistant" })).toBeNull();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByRole("complementary", { name: "AI assistant" })).toBeNull();
  });

  it("drops the conversation when the user opens another file, but not when a tool does", async () => {
    writeAiPreferences({ enabled: true });
    let go: (path: string) => void = () => {};
    const Nav = () => {
      go = useNavigate();
      return null;
    };
    render(wrap(<><Nav /><AiButton /><AgentLayer /></>, {}, "/file/a"));
    fireEvent.click(screen.getByRole("button", { name: "AI assistant" }));
    act(() => go("/file/a"));
    expect(session.reset).not.toHaveBeenCalled();
    let release = () => {};
    const acting = whileAgentActs(() => new Promise<void>((done) => (release = done)));
    act(() => go("/file/b"));
    release();
    await act(() => acting);
    expect(session.reset).not.toHaveBeenCalled();
    act(() => go("/"));
    expect(session.reset).toHaveBeenCalledOnce();
    expect(screen.queryByRole("complementary", { name: "AI assistant" })).toBeNull();
  });

  it("opens the panel when the assistant asks a question", async () => {
    writeAiPreferences({ enabled: true });
    render(wrap(<AgentLayer />));
    let answer: Promise<boolean> = Promise.resolve(false);
    act(() => {
      answer = requestApproval("Delete Notes?");
    });
    const dialog = await screen.findByRole("alertdialog", { name: "FrogNano asks" });
    expect(dialog.textContent).toContain("Delete Notes?");
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(await answer).toBe(true);
    act(() => {
      answer = requestApproval("Empty Trash?");
    });
    fireEvent.click(await screen.findByRole("button", { name: "Don't allow" }));
    expect(await answer).toBe(false);
  });

  it("draws the pointer with its label above the bottom edge", async () => {
    render(wrap(<AgentCursor />));
    vi.useFakeTimers();
    let moving: Promise<void> = Promise.resolve();
    act(() => {
      moving = moveCursor({ x: 20, y: innerHeight - 10 }, "Typing");
    });
    expect(document.querySelector(".agent-cursor")?.className).toBe("agent-cursor visible");
    expect(screen.getByText("FrogNano · Typing").className).toBe("agent-cursor-label above");
    await act(async () => {
      await vi.runAllTimersAsync();
      await moving;
    });
    vi.useRealTimers();
  });
});

describe("the conversation", () => {
  const sidebar = (mode?: Mode) => render(wrap(<AgentSidebar />, mode));

  it("suggests requests and says where the assistant runs", () => {
    const { unmount } = sidebar();
    expect(screen.getByText("Ask FrogNano to do something in this app, like:")).toBeTruthy();
    expect(screen.getByText(/runs on the SuiteLeaf server\./)).toBeTruthy();
    expect(screen.getByText("No document open")).toBeTruthy();
    unmount();
    sidebar({ demo: true });
    expect(screen.getByText(/runs in this browser\./)).toBeTruthy();
    cleanup();
    (window as { suiteleaf?: unknown }).suiteleaf = { ai: {} };
    sidebar();
    expect(screen.getByText(/runs on this computer\./)).toBeTruthy();
    cleanup();
    writeAiPreferences({ place: "remote", endpoint: "https://llm.example/v1", model: "my-llama" });
    sidebar();
    expect(screen.getByText(/my-llama runs at llm\.example\./)).toBeTruthy();
  });

  it("shows where the user is", () => {
    const off = registerAgentHost("editor", { kind: "doc", snapshot: () => "", place: () => "Report", tools: [] });
    sidebar();
    expect(screen.getByText("Report")).toBeTruthy();
    off();
  });

  it("renders each kind of transcript item", () => {
    const undo = vi.fn(async () => {});
    session.items = [
      { kind: "user", text: "Tidy the report" },
      { kind: "assistant", text: "" },
      { kind: "assistant", text: "Made the **title** bold.", thinking: "Check the heading" },
      { kind: "error", text: "The model failed." },
      { kind: "review", issues: ["The heading is empty."] },
      { kind: "review", issues: [] },
      { kind: "reminder", open: ["Title", "Body"] },
      { kind: "tool", id: "1", name: "write_text", label: "Write", args: { text: "Hi", n: 2 }, status: "ok", result: "Wrote it.\nMore" },
      { kind: "tool", id: "2", name: "set_cells", label: "Cells", args: { __parse_error: "bad" }, status: "error" },
      { kind: "tool", id: "3", name: "save", label: "Save", args: null, status: "running" },
      { kind: "changes", changes: [{ kind: "changed", title: "Report", drive: false, preview: { removed: ["Old"], added: ["New"] } }, { kind: "created", title: "Shared", drive: true }], undo },
      { kind: "changes", changes: [{ kind: "removed", title: "Gone", drive: false }], undone: "Put back 1 file(s)." },
    ];
    sidebar();
    expect(screen.getByText("Tidy the report").className).toBe("agent-msg user");
    expect(screen.getByText("title").tagName).toBe("STRONG");
    expect(screen.getByText("Thinking").tagName).toBe("SUMMARY");
    expect(screen.getByRole("alert").textContent).toContain("The model failed.");
    expect(screen.getByText("The heading is empty.").tagName).toBe("LI");
    expect(screen.getByText(/Not finished yet: 2 item\(s\)/)).toBeTruthy();
    expect(document.querySelector('[data-tool="write_text"]')?.textContent).toBe("Writetext: Hi · n: 2Wrote it.");
    expect(document.querySelector('[data-tool="set_cells"]')?.textContent).toBe("CellsFrogNano wrote this step in a form it couldn't read, so it writes it again.");
    expect(document.querySelector('[data-tool="save"] .spin')).toBeTruthy();
    const changes = screen.getAllByLabelText("Changes from this request");
    expect(changes[0].textContent).toContain("Changed “Report”Remove “Old”Add “New”");
    expect(changes[0].textContent).toContain("Created “Shared” (SuiteDrive)");
    expect(changes[1].textContent).toContain("Removed “Gone”Put back 1 file(s).");
    fireEvent.click(screen.getByRole("button", { name: /Undo all of this/ }));
    expect(undo).toHaveBeenCalled();
    expect(scrolled).toHaveBeenCalled();
  });

  it("shows what the assistant is doing and lets the user stop it", () => {
    sidebar();
    update({ state: "loading" });
    expect(screen.getByText(/Starting FrogNano…/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "New conversation" }) as HTMLButtonElement).disabled).toBe(true);
    update({ state: "working", draft: { label: "Write", chars: 1234 } });
    expect(screen.getByText(/Preparing “Write”… 1,234 characters/)).toBeTruthy();
    update({ draft: { label: "Write", chars: 10 } });
    expect(screen.getByText(/Preparing “Write”…$/)).toBeTruthy();
    update({ draft: undefined });
    expect(screen.getByText(/Working…/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(session.stop).toHaveBeenCalled();
    update({ state: "done", items: [{ kind: "tool", id: "1", name: "x", label: "X", args: {}, status: "ok" }] });
    expect(screen.getByText("FrogNano finished without a summary. The steps above are what it did.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(session.reset).toHaveBeenCalled();
  });

  it("shows the model loading, failing, or running on a fallback device", () => {
    sidebar({ demo: true });
    update({ model: { state: "loading", message: "Downloading Gemma", progress: 0.4 } });
    expect(screen.getByRole("status").textContent).toBe("Downloading Gemma");
    expect((document.querySelector("progress") as HTMLProgressElement).value).toBe(0.4);
    update({ model: { state: "loading" } });
    expect(screen.getByRole("status").textContent).toBe("Loading the model…");
    update({ model: { state: "error", message: "No GPU." } });
    expect(screen.getByRole("alert").textContent).toContain("No GPU.");
    update({ model: { state: "ready", backend: "webgpu", fallback: "webnn-gpu failed" } });
    expect(screen.getByText("WebNN couldn't run FrogNano here, so it runs on WebGPU.")).toBeTruthy();
    expect(screen.getByText(/in this browser · WebGPU/)).toBeTruthy();
    update({ model: { state: "ready", backend: "webnn" } });
    expect(screen.getByText(/in this browser · WebNN/)).toBeTruthy();
    update({ model: { state: "ready", backend: "llama.cpp" } });
    expect(screen.getByText(/in this browser · llama\.cpp · Metal/)).toBeTruthy();
    update({ model: { state: "ready", backend: "llama.cpp", message: "llama.cpp · CUDA" } });
    expect(screen.getByText(/in this browser · llama\.cpp · CUDA/)).toBeTruthy();
    update({ model: { state: "ready", backend: "wasm" } });
    expect(screen.getByText(/in this browser · wasm/)).toBeTruthy();
  });

  it("sends with Enter or the button, keeps Shift+Enter for a new line, and ignores blanks", () => {
    sidebar();
    const box = screen.getByRole("textbox", { name: "Ask the assistant" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(session.prompt).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "  Add a slide  " } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(session.prompt).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "a" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(session.prompt).toHaveBeenCalledWith("Add a slide");
    expect((box as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(box, { target: { value: "Again" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(session.prompt).toHaveBeenLastCalledWith("Again");
    update({ state: "working" });
    fireEvent.change(box, { target: { value: "Busy" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(session.prompt).toHaveBeenCalledTimes(2);
  });

  it("shows run numbers once the model has answered", () => {
    sidebar();
    expect(document.querySelector(".agent-metrics")).toBeNull();
    update({ metrics: { requests: 1, toolCalls: 1, outputTokens: 50, generateMs: 2000, wallMs: 4600 } });
    expect(document.querySelector(".agent-metrics")?.textContent).toBe("1 tool call · 1 request · 25 tok/s · 5s");
    update({ metrics: { requests: 2, toolCalls: 3, outputTokens: 50, generateMs: 0, wallMs: 0 } });
    expect(document.querySelector(".agent-metrics")?.textContent).toBe("3 tool calls · 2 requests · 0 tok/s · 0s");
  });

  it("shows the checklist as items are ticked", async () => {
    sidebar();
    expect(screen.queryByLabelText("Checklist")).toBeNull();
    const before = session.version;
    await act(async () => {
      await todoTool.execute({ action: "add", items: ["Title", "Body"] } as never);
      await todoTool.execute({ action: "toggle", id: 1 } as never);
    });
    const list = screen.getByLabelText("Checklist");
    expect(list.textContent).toContain("Checklist · 1/2");
    expect(session.version).toBe(before);
    expect(list.querySelector("li.done")?.textContent?.trim()).toBe("Title");
  });

  it("asks the user for a file and passes on their choice", async () => {
    sidebar();
    let chosen: Promise<File | null> = Promise.resolve(null);
    act(() => {
      chosen = requestFile("Choose the file to open", ".csv");
    });
    expect(screen.getByText("Choose the file to open")).toBeTruthy();
    const input = document.querySelector<HTMLInputElement>('.agent-file-request input[type="file"]')!;
    expect(input.accept).toBe(".csv");
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Choose file…" }));
    expect(click).toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [] } });
    const file = new File(["a,b"], "codes.csv");
    fireEvent.change(input, { target: { files: [file] } });
    expect(await chosen).toBe(file);
    act(() => {
      chosen = requestFile("Again", "*");
    });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await chosen).toBeNull();
    expect(screen.queryByText("Again")).toBeNull();
  });
});
