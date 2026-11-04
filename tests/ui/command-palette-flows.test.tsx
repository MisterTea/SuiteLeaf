// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandPalette,
  MenuSearchPill,
  menuSearchPlace,
  useCommandPalette,
  useRegisterCommand,
  type CommandRegistration,
} from "../../apps/web/src/command-palette";

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Command(props: CommandRegistration | { off: true; id: string }) {
  useRegisterCommand("off" in props ? null : props);
  return null;
}

const runs: string[] = [];
const command = (id: string, extra: Partial<CommandRegistration> = {}): CommandRegistration => ({
  id,
  label: id,
  path: ["Edit"],
  run: () => runs.push(id),
  ...extra,
});

function Harness({
  kind = "doc",
  commands = [
    command("Bold text", { shortcut: "Mod+B" }),
    command("Insert link", { shortcut: "Mod+K", path: ["Insert"] }),
    command("Word count", { availability: () => "Open a document first." }),
    command("Voice typing", { pending: true }),
  ],
  extra,
}: {
  kind?: "doc" | "sheet" | "slide";
  commands?: CommandRegistration[];
  extra?: React.ReactNode;
}) {
  return (
    <CommandPalette kind={kind}>
      <div className="file-menu">
        <button className="menu-trigger">File</button>
        <button className="menu-trigger">Edit</button>
        <button className="menu-trigger">View</button>
      </div>
      <MenuSearchPill />
      {commands.map((c) => (
        <Command key={c.id} {...c} />
      ))}
      {extra}
    </CommandPalette>
  );
}

const key = (init: KeyboardEventInit & { key: string }, target: Element | Window = window) =>
  act(() => {
    fireEvent.keyDown(target, init);
  });
const openSearch = () => key({ key: "/", code: "Slash", altKey: true });
const options = () => screen.queryAllByRole("option");

describe("menu search placement", () => {
  it("opens below the Menus button and stays inside the window", () => {
    expect(menuSearchPlace(null, { width: 1000 }, 300)).toBeNull();
    expect(menuSearchPlace({ left: 100, bottom: 40 }, { width: 1000 }, 300)).toEqual({ top: 44, left: 100 });
    expect(menuSearchPlace({ left: 900, bottom: 40 }, { width: 1000 }, 300)).toEqual({ top: 44, left: 684 });
    expect(menuSearchPlace({ left: 2, bottom: 40 }, { width: 1000 }, 300)).toEqual({ top: 44, left: 16 });
  });

  it("is only available inside an editor", () => {
    function Outside() {
      useCommandPalette();
      return null;
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Outside />)).toThrow("Command palette is only available in an editor.");
  });
});

describe("menu search", () => {
  it("opens from the Menus button under it and runs a command on click", async () => {
    vi.useFakeTimers();
    runs.length = 0;
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ left: 50, bottom: 30, width: 80, height: 24 } as DOMRect);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Menus" }));
    const dialog = screen.getByRole("dialog", { name: "Search the menus" });
    expect(dialog.style.top).toBe("34px");
    expect(dialog.style.left).toBe("50px");
    rect.mockRestore();
    const input = within(dialog).getByRole("textbox");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "link" } });
    const link = options().find((o) => o.textContent?.startsWith("Insert › Insert link"))!;
    expect(link.textContent).toContain("Ctrl+K");
    fireEvent.mouseEnter(link);
    expect(link.getAttribute("aria-selected")).toBe("true");
    fireEvent.mouseDown(link);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => vi.runOnlyPendingTimers());
    expect(runs).toEqual(["Insert link"]);
    // The command just run is listed first, under Recent.
    await openSearch();
    expect(screen.getByText("Recent")).toBeTruthy();
    expect(options()[0].textContent).toContain("Insert link");
    expect(options()[1].closest("li")?.className).toBe("command-gap");
  });

  it("moves with the arrow keys and runs the highlighted command with Enter", async () => {
    runs.length = 0;
    render(<Harness />);
    await openSearch();
    expect(options().map((o) => o.textContent)).toEqual([
      "Edit › Bold textCtrl+B",
      "Insert › Insert linkCtrl+K",
    ]);
    await key({ key: "ArrowUp" });
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    await key({ key: "ArrowDown" });
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    await key({ key: "Enter" });
    expect(runs).toEqual(["Bold text"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows why a command cannot run and does not run it", async () => {
    vi.useFakeTimers();
    runs.length = 0;
    render(<Harness />);
    await openSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "Search the menus" }), {
      target: { value: "word count" },
    });
    const word = options().find((o) => o.textContent?.includes("Word count"))!;
    expect(word.getAttribute("aria-disabled")).toBe("true");
    expect(word.textContent).toContain("Open a document first.");
    fireEvent.mouseDown(word);
    await key({ key: "Enter" });
    act(() => vi.runOnlyPendingTimers());
    expect(runs).toEqual([]);
    fireEvent.change(screen.getByRole("textbox", { name: "Search the menus" }), {
      target: { value: "voice typing" },
    });
    const voice = options().find((o) => o.textContent?.includes("Voice typing"))!;
    expect(voice.querySelector(".command-reason")?.textContent).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search the menus" }), {
      target: { value: "qqqqzzzz" },
    });
    expect(screen.getByText("No matching commands")).toBeTruthy();
    await key({ key: "ArrowDown" });
    await key({ key: "Enter" });
    expect(runs).toEqual([]);
  });

  it("refreshes commands while open and closes with Escape, the shortcut, or the backdrop", async () => {
    vi.useFakeTimers();
    function Late() {
      const [ready, setReady] = useState(false);
      useRegisterCommand(command("Freeze", { availability: () => (ready ? true : "Wait.") }));
      return <button onClick={() => setReady(true)}>ready</button>;
    }
    render(<Harness commands={[]} extra={<Late />} />);
    await openSearch();
    expect(options()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "ready" }));
    act(() => vi.advanceTimersByTime(450));
    expect(options().map((o) => o.textContent)).toEqual(["Edit › Freeze"]);
    await key({ key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await openSearch();
    await openSearch();
    expect(screen.queryByRole("dialog")).toBeNull();
    await openSearch();
    fireEvent.mouseDown(document.querySelector(".command-backdrop")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("keyboard shortcuts dialog", () => {
  it("lists menu and editor shortcuts and searches them", async () => {
    render(<Harness />);
    await key({ key: "/", code: "Slash", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(document.activeElement).toBe(within(dialog).getByRole("textbox"));
    expect(dialog.textContent).toContain("Edit › Bold text");
    expect(dialog.textContent).toContain("Ctrl+Alt+M or F10 focuses the menu bar.");
    // The pending command is not offered as a shortcut.
    expect(dialog.textContent).not.toContain("Voice typing");
    const search = within(dialog).getByRole("textbox", { name: "Search shortcuts" });
    fireEvent.change(search, { target: { value: "ctrl+b" } });
    expect(within(dialog).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Edit › Bold textCtrl+B",
    ]);
    fireEvent.change(search, { target: { value: "save" } });
    expect(dialog.textContent).toContain("Save");
    fireEvent.change(search, { target: { value: "mod+k" } });
    expect(dialog.textContent).toContain("Insert link");
    fireEvent.change(search, { target: { value: "nothing like this" } });
    expect(screen.getByText("No matching shortcuts")).toBeTruthy();
    await key({ key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens from an editor button, toggles with its shortcut, and closes with its button", async () => {
    function Open() {
      const { openShortcuts } = useCommandPalette();
      return <button onClick={openShortcuts}>Shortcuts</button>;
    }
    render(<Harness kind="slide" extra={<Open />} />);
    fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
    expect(screen.getByText(/Ctrl\+Alt\+M comments on the selected object/)).toBeTruthy();
    await key({ key: "/", code: "Slash", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses Mac key names on a Mac", async () => {
    const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    render(<Harness kind="slide" />);
    await key({ key: "/", code: "Slash", metaKey: true });
    expect(screen.getByText(/⌘⌥M comments on the selected object/)).toBeTruthy();
    cleanup();
    render(<Harness kind="sheet" />);
    await key({ key: "/", code: "Slash", metaKey: true });
    expect(screen.getByText(/⌃⌥M or F10 focuses the menu bar/)).toBeTruthy();
    platform.mockRestore();
  });
});

describe("menu bar keys", () => {
  const triggers = () => screen.getAllByRole("button").filter((b) => b.classList.contains("menu-trigger"));

  it("focuses the menu bar with F10 or Ctrl+Alt+M and moves along it", async () => {
    render(<Harness />);
    await key({ key: "F10", code: "F10" });
    expect(document.activeElement).toBe(triggers()[0]);
    await key({ key: "ArrowLeft" }, triggers()[0]);
    expect(document.activeElement).toBe(triggers()[2]);
    await key({ key: "ArrowRight" }, triggers()[2]);
    expect(document.activeElement).toBe(triggers()[0]);
    act(() => (document.activeElement as HTMLElement).blur());
    await key({ key: "m", code: "KeyM", ctrlKey: true, altKey: true });
    expect(document.activeElement).toBe(triggers()[0]);
  });

  it("leaves Ctrl+Alt+M to commenting in a document and on a slide", async () => {
    render(
      <Harness
        extra={
          <div className="document-content">
            <p tabIndex={0}>text</p>
          </div>
        }
      />,
    );
    await key({ key: "m", code: "KeyM", ctrlKey: true, altKey: true }, screen.getByText("text"));
    expect(document.activeElement).not.toBe(triggers()[0]);
    cleanup();
    render(<Harness kind="slide" extra={<div className="slides-editor" />} />);
    await key({ key: "m", code: "KeyM", ctrlKey: true, altKey: true });
    expect(document.activeElement).not.toBe(triggers()[0]);
  });

  it("moves an open menu to the next one, except into a submenu or out of one", async () => {
    render(
      <Harness
        extra={
          <>
            <div role="menuitem" data-highlighted="" aria-haspopup="menu" />
            <div className="menu-content" />
          </>
        }
      />,
    );
    const [file, edit] = triggers();
    file.setAttribute("data-state", "open");
    const opened = vi.fn();
    edit.addEventListener("keydown", (event) => opened(event.key));
    // A highlighted submenu item takes ArrowRight itself.
    await key({ key: "ArrowRight" });
    expect(opened).not.toHaveBeenCalled();
    document.querySelector("[role='menuitem']")!.removeAttribute("aria-haspopup");
    await key({ key: "ArrowRight" });
    expect(opened).toHaveBeenCalledWith("ArrowDown");
    expect(document.activeElement).toBe(edit);
    // ArrowLeft from the first menu has nowhere to go.
    act(() => (document.activeElement as HTMLElement).blur());
    await key({ key: "ArrowLeft" });
    expect(opened).toHaveBeenCalledTimes(1);
    // ArrowLeft inside a submenu closes the submenu instead.
    document.body.appendChild(Object.assign(document.createElement("div"), { className: "menu-content" }));
    edit.setAttribute("data-state", "open");
    file.removeAttribute("data-state");
    await key({ key: "ArrowLeft" });
    expect(document.activeElement).not.toBe(file);
  });
});

describe("command shortcuts", () => {
  it("runs the editor's own shortcuts only outside text fields", async () => {
    runs.length = 0;
    render(
      <Harness
        commands={[
          command("Insert link", { shortcut: "Mod+K" }),
          command("Bold text", { shortcut: "Mod+B" }),
        ]}
        extra={<input aria-label="field" />}
      />,
    );
    await key({ key: "k", code: "KeyK", ctrlKey: true });
    expect(runs).toEqual(["Insert link"]);
    // Tiptap handles bold itself.
    await key({ key: "b", code: "KeyB", ctrlKey: true });
    await key({ key: "k", code: "KeyK", ctrlKey: true }, screen.getByRole("textbox", { name: "field" }));
    await key({ key: "k", code: "KeyK", ctrlKey: true, repeat: true });
    expect(runs).toEqual(["Insert link"]);
  });

  it("stays out of a layer with its own shortcuts and of the comment box", async () => {
    runs.length = 0;
    render(
      <Harness
        commands={[command("Insert link", { shortcut: "Mod+K" })]}
        extra={<div className="doc-mention-field" tabIndex={0}>@</div>}
      />,
    );
    await key({ key: "k", code: "KeyK", ctrlKey: true }, screen.getByText("@"));
    expect(runs).toEqual([]);
    const layer = document.body.appendChild(document.createElement("div"));
    layer.setAttribute("data-own-shortcuts", "");
    await openSearch();
    expect(screen.queryByRole("dialog")).toBeNull();
    layer.remove();
  });
});

describe("command registration", () => {
  it("keeps a working command over a pending copy and drops unmounted ones", async () => {
    function Toggle() {
      const [on, setOn] = useState(true);
      return (
        <>
          <button onClick={() => setOn((v) => !v)}>toggle</button>
          {on ? <Command {...command("Undo", { shortcut: "Mod+Z" })} /> : null}
          <Command {...command("Undo", { pending: true })} />
          <Command off id="ignored" />
          <Command {...command("", { id: "blank" })} />
        </>
      );
    }
    render(<Harness commands={[]} extra={<Toggle />} />);
    await openSearch();
    expect(options().map((o) => o.textContent)).toEqual(["Edit › UndoCtrl+Z"]);
    await key({ key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    await openSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "Search the menus" }), {
      target: { value: "undo" },
    });
    const undo = options().find((o) => o.textContent?.includes("Undo"))!;
    expect(undo.getAttribute("aria-disabled")).toBe("true");
  });

  it("reads the command a component registered most recently", async () => {
    runs.length = 0;
    function Changing() {
      const [n, setN] = useState(1);
      useRegisterCommand(command("Count", { run: () => runs.push(`count ${n}`) }));
      return <button onClick={() => setN(2)}>two</button>;
    }
    render(<Harness commands={[]} extra={<Changing />} />);
    fireEvent.click(screen.getByRole("button", { name: "two" }));
    await openSearch();
    await key({ key: "Enter" });
    expect(runs).toEqual(["count 2"]);
  });
});
