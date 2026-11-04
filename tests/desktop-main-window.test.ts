import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createFile, serializeFile } from "../packages/core/src";
import { fakeElectron, FakeWindow } from "./desktop-electron-fake";

const mocks = vi.hoisted(() => ({
  startReleasePoll: vi.fn(),
  restartWhileDirty: vi.fn<(dirty: boolean) => { action: string; reason?: string }>(() => ({
    action: "now",
  })),
  convertOffice: vi.fn(async (_bytes: Uint8Array, format: string, name: string) => ({
    kind: "doc",
    title: `${name} from ${format}`,
  })),
  renderPresentationPngs: vi.fn(async () => [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ]),
  registerAppProtocol: vi.fn(),
  registerAi: vi.fn(),
  watcher: {
    set: vi.fn<(directory: string) => Promise<void>>(async () => {}),
    close: vi.fn(),
    onChange: () => {},
  },
  store: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("electron", async () =>
  (await import("./desktop-electron-fake")).electronModule(),
);
vi.mock("../apps/desktop/src/updates", () => ({
  consumeFailedStart: async (options: {
    text: string | null;
    writePlan: (version: string) => Promise<void>;
    removeRecord: () => Promise<void>;
  }) => {
    if (!options.text) return;
    await options.writePlan(JSON.parse(options.text).version);
    await options.removeRecord();
  },
  restartWhileDirty: mocks.restartWhileDirty,
  startReleasePoll: mocks.startReleasePoll,
}));
vi.mock("../apps/desktop/src/office-converter", () => ({
  convertOffice: mocks.convertOffice,
}));
vi.mock("../apps/desktop/src/pdf-export-host", () => ({
  openPdfExportWindow: vi.fn(),
  openPngExportWindow: vi.fn(),
  renderPresentationPngs: mocks.renderPresentationPngs,
}));
vi.mock("../apps/desktop/src/app-protocol", () => ({
  registerAppProtocol: mocks.registerAppProtocol,
}));
vi.mock("../apps/desktop/src/ai", () => ({ registerAi: mocks.registerAi }));
vi.mock("../apps/desktop/src/documents-directory", () => ({
  DocumentsDirectory: class {
    constructor(_store: unknown, onChange: () => void) {
      mocks.watcher.onChange = onChange;
    }
    set = mocks.watcher.set;
    close = mocks.watcher.close;
  },
}));
vi.mock("../apps/desktop/src/store", async (load) => {
  const { basename, join } = await import("node:path");
  const store = {
    init: vi.fn(async () => {}),
    close: vi.fn(),
    list: vi.fn(async () => ["listed"]),
    get: vi.fn(async (id: string) => ({ got: id })),
    save: vi.fn(async (record: unknown) => record),
    remove: vi.fn(async (id: string) => ({ removed: id })),
    openPath: vi.fn(async (path: string) => ({ opened: path })),
    saveAs: vi.fn(async (_record: unknown, path: string) => ({ savedAs: path })),
    reload: vi.fn(async (id: string) => ({ reloaded: id })),
    folderPaths: vi.fn((root: string) => [`${root}/a`]),
    createFolder: vi.fn(async (parent: string, name: string) => join(parent, name)),
    moveFolder: vi.fn(async (path: string, parent: string, name?: string) =>
      join(parent, name ?? basename(path)),
    ),
    moveFile: vi.fn(async (id: string, folder: string) => ({ id, folder })),
  };
  Object.assign(mocks.store, store);
  return {
    ...(await load<typeof import("../apps/desktop/src/store")>()),
    FileStore: class {
      constructor() {
        return store;
      }
    },
  };
});

const fake = fakeElectron();
let root: string;
let documents: string;
const argv = process.argv;

const win = () => FakeWindow.all[0];
const sender = () => ({
  sender: win().webContents,
  senderFrame: win().webContents.mainFrame,
});
const invoke = (channel: string, ...args: unknown[]) =>
  Promise.resolve().then(() => fake.handlers.get(channel)!(sender(), ...args));
const menuActions = () => win().webContents.sent.filter(([c]) => c === "menu");
const menuItem = (top: string, label: string) => {
  const menu = fake.menus.at(-1) as {
    label: string;
    submenu: { label?: string; click?: () => void; submenu?: unknown[] }[];
  }[];
  return menu
    .find((m) => m.label === top)!
    .submenu.find((item) => item.label === label)!;
};
const record = () => ({ file: createFile("doc", "Report") });
const opens = (...paths: string[]) =>
  fake.electron.dialog.showOpenDialog.mockResolvedValueOnce({
    canceled: false,
    filePaths: paths,
  } as never);
const saves = (filePath: string) =>
  fake.electron.dialog.showSaveDialog.mockResolvedValueOnce({
    canceled: false,
    filePath,
  } as never);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "suiteleaf-main-window-"));
  documents = join(root, "SuiteLeaf");
  process.env.SUITELEAF_TEST_DATA = root;
  process.env.SUITELEAF_SETTINGS = join(root, "settings.json");
  delete process.env.ELECTRON_RENDERER_URL;
  await writeFile(join(root, "update-policy.json"), '{"channel":"pilot"}');
  await writeFile(join(root, "failed-start.json"), '{"version":"0.9.0"}');
  await writeFile(
    process.env.SUITELEAF_SETTINGS,
    JSON.stringify({ mode: { kind: "single" } }),
  );
  process.argv = ["electron", "main.js"];
  (process as unknown as { getSystemVersion: () => string }).getSystemVersion =
    () => "15.0.0";
  await import("../apps/desktop/src/main");
  fake.ready();
  await vi.waitFor(() => expect(FakeWindow.all).toHaveLength(1));
});

afterAll(async () => {
  process.argv = argv;
  delete process.env.SUITELEAF_TEST_DATA;
  delete process.env.SUITELEAF_SETTINGS;
  await rm(root, { recursive: true, force: true });
});

describe("desktop app start", () => {
  it("turns a failed start into a rollback plan and starts the release poll", async () => {
    expect(JSON.parse(await readFile(join(root, "rollback-plan.json"), "utf8"))).toEqual({
      version: "0.9.0",
    });
    await expect(stat(join(root, "failed-start.json"))).rejects.toThrow();
    const options = mocks.startReleasePoll.mock.calls[0][0];
    expect(options).toMatchObject({
      currentVersion: "1.2.3",
      currentSchema: 5,
      managedText: '{"channel":"pilot"}',
      rollbackText: '{"version":"0.9.0"}',
      installerDirectory: join(root, "updates"),
    });
    expect(options.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readFile(join(root, "update-ring-id"), "utf8")).toBe(options.deviceId);
  });

  it("watches the default documents folder and loads the app page", () => {
    expect(mocks.watcher.set).toHaveBeenCalledWith(documents);
    expect(mocks.registerAppProtocol).toHaveBeenCalled();
    expect(win().webContents.loaded).toEqual(["suiteleaf://app/index.html"]);
    expect(win().options).toMatchObject({ show: false, skipTaskbar: false });
    win().emit("ready-to-show");
    expect(win().show).toHaveBeenCalled();
    mocks.watcher.onChange();
    expect(win().webContents.sent).toContainEqual(["files:changed"]);
  });

  it("shares the model API with the app window only", () => {
    const [register, owner, isOwner] = mocks.registerAi.mock.calls[0];
    expect(typeof register).toBe("function");
    expect(owner()).toBe(win().webContents);
    expect(isOwner(win().webContents)).toBe(true);
    expect(isOwner({})).toBe(false);
  });

  it("answers only the app window's main frame", () => {
    const handler = fake.handlers.get("files:list")!;
    expect(() => handler({ sender: {}, senderFrame: {} })).toThrow(
      "Unauthorized request.",
    );
    expect(() =>
      handler({ sender: win().webContents, senderFrame: {} }),
    ).toThrow("Unauthorized request.");
  });
});

describe("app window", () => {
  it("allows clipboard access to the app page only", () => {
    const contents = win().webContents;
    const callback = vi.fn();
    contents.permissionRequest!(contents, "clipboard-read", callback);
    contents.permissionRequest!(contents, "camera", callback);
    contents.permissionRequest!({}, "clipboard-read", callback);
    expect(callback.mock.calls).toEqual([[true], [false], [false]]);
    expect(contents.permissionCheck!(contents, "clipboard-sanitized-write")).toBe(true);
    contents.url = "https://elsewhere.example/";
    expect(contents.permissionCheck!(contents, "clipboard-read")).toBe(false);
    process.env.ELECTRON_RENDERER_URL = "https://elsewhere.example/";
    expect(contents.permissionCheck!(contents, "clipboard-read")).toBe(true);
    delete process.env.ELECTRON_RENDERER_URL;
    contents.url = "suiteleaf://app/index.html";
  });

  it("sends a strict content security policy", () => {
    const callback = vi.fn();
    win().webContents.headers!({ responseHeaders: { X: ["1"] } }, callback);
    const headers = callback.mock.calls[0][0].responseHeaders;
    expect(headers.X).toEqual(["1"]);
    expect(headers["Content-Security-Policy"][0]).toContain(
      "script-src 'self' 'unsafe-eval';",
    );
    expect(headers["Content-Security-Policy"][0]).toContain("object-src 'none'");
  });

  it("opens web links in the browser and stays on the app page", () => {
    const { shell } = fake.electron;
    expect(win().webContents.openHandler!({ url: "https://example.com" })).toEqual({
      action: "deny",
    });
    win().webContents.openHandler!({ url: "file:///etc/passwd" });
    expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith("https://example.com");
    const away = { preventDefault: vi.fn() };
    win().webContents.emit("will-navigate", away, "https://example.com/");
    expect(away.preventDefault).toHaveBeenCalled();
    const hash = { preventDefault: vi.fn() };
    win().webContents.emit("will-navigate", hash, "suiteleaf://app/index.html#/x");
    expect(hash.preventDefault).not.toHaveBeenCalled();
  });

  it("asks before closing while a save is in progress", () => {
    const { dialog } = fake.electron;
    fake.ipcListeners.get("dirty")!({ sender: {} }, true);
    fake.ipcListeners.get("dirty")!({ sender: win().webContents }, "yes");
    const clean = { preventDefault: vi.fn() };
    win().emit("close", clean);
    expect(clean.preventDefault).not.toHaveBeenCalled();
    expect(mocks.restartWhileDirty).toHaveBeenLastCalledWith(false);

    fake.ipcListeners.get("dirty")!({ sender: win().webContents }, true);
    mocks.restartWhileDirty.mockReturnValueOnce({
      action: "wait",
      reason: "An update is waiting for this save.",
    });
    const waiting = { preventDefault: vi.fn() };
    win().emit("close", waiting);
    expect(waiting.preventDefault).toHaveBeenCalled();
    expect(dialog.showMessageBoxSync).toHaveBeenLastCalledWith(win(), {
      type: "warning",
      buttons: ["Keep editing"],
      message: "An update is waiting for this save.",
    });

    dialog.showMessageBoxSync.mockReturnValueOnce(0);
    const kept = { preventDefault: vi.fn() };
    win().emit("close", kept);
    expect(kept.preventDefault).toHaveBeenCalled();

    dialog.showMessageBoxSync.mockReturnValueOnce(1);
    const closing = { preventDefault: vi.fn() };
    win().emit("close", closing);
    expect(closing.preventDefault).not.toHaveBeenCalled();
    // Once chosen, the page's unload guard does not ask again.
    const unload = { preventDefault: vi.fn() };
    win().webContents.emit("will-prevent-unload", unload);
    expect(unload.preventDefault).toHaveBeenCalled();
    fake.ipcListeners.get("dirty")!({ sender: win().webContents }, false);
  });

  it("brings the window forward for a second launch", () => {
    fake.app.emit("second-instance");
    expect(win().show).toHaveBeenCalled();
    expect(win().focus).toHaveBeenCalled();
  });

  it("sends menu actions to the app", () => {
    const before = menuActions().length;
    for (const label of [
      "New document",
      "New spreadsheet",
      "New presentation",
      "New MARP presentation",
      "Open…",
      "Save",
      "Save As…",
      "Print…",
    ])
      menuItem("File", label).click!();
    for (const item of menuItem("File", "New drawing").submenu as {
      click: () => void;
    }[])
      item.click();
    menuItem("SuiteLeaf", "Settings…").click!();
    menuItem("Server", "Connect to a SuiteLeaf server…").click!();
    expect(menuActions().slice(before).map(([, action]) => action)).toEqual([
      "new-doc",
      "new-sheet",
      "new-slide",
      "new-marp",
      "open",
      "save",
      "save-as",
      "print",
      "new-drawing-svg",
      "new-drawing-mermaid",
      "new-drawing-graphviz",
      "settings",
      "connect-server",
    ]);
  });
});

describe("documents folder", () => {
  it("returns the folder and keeps it when the chooser is cancelled", async () => {
    expect(await invoke("documents:get")).toBe(documents);
    expect(await invoke("documents:choose")).toBeNull();
  });

  it("restores the old folder when the setting cannot be saved", async () => {
    const elsewhere = join(root, "Elsewhere");
    opens(elsewhere);
    process.env.SUITELEAF_SETTINGS = join(root, "missing", "settings.json");
    await expect(invoke("documents:choose")).rejects.toThrow();
    process.env.SUITELEAF_SETTINGS = join(root, "settings.json");
    expect(mocks.watcher.set.mock.calls.slice(-2)).toEqual([[elsewhere], [documents]]);
    expect(await invoke("documents:get")).toBe(documents);
  });

  it("switches to a chosen folder and saves it in settings", async () => {
    const chosen = join(root, "Chosen");
    opens(chosen);
    expect(await invoke("documents:choose")).toBe(chosen);
    const settings = JSON.parse(await readFile(join(root, "settings.json"), "utf8"));
    expect(settings).toEqual({ mode: { kind: "single" }, documentsDirectory: chosen });
    documents = chosen;
  });
});

describe("folders", () => {
  it("lists, creates, renames, and moves folders inside the documents folder", async () => {
    expect(await invoke("folders:list")).toEqual([`${documents}/a`]);
    expect(await invoke("folders:create", "Work/2026", "  Plans ")).toBe("Work/2026/Plans");
    expect(mocks.store.createFolder).toHaveBeenLastCalledWith(
      join(documents, "Work", "2026"),
      "Plans",
    );
    expect(await invoke("folders:rename", "Work/Old", "New")).toBe("Work/New");
    expect(await invoke("folders:move", "Work/New", "Archive")).toBe("Archive/New");
  });

  it("refuses paths that leave the folder and bad folder names", async () => {
    for (const folder of ["../x", "a/./b", ".hidden", "a\\b", 3])
      await expect(invoke("folders:create", folder, "x")).rejects.toThrow("Invalid folder.");
    for (const [name, message] of [
      ["", "Choose a folder name."],
      ["..", "Choose a folder name."],
      ["x".repeat(121), "Choose a folder name."],
      [7, "Choose a folder name."],
      [".git", "Folder names cannot start with a dot."],
      ["a/b", "Folder names cannot contain / \\ or :."],
      ["a:b", "Folder names cannot contain / \\ or :."],
    ])
      await expect(invoke("folders:create", "", name)).rejects.toThrow(message as string);
    await expect(invoke("folders:rename", "", "x")).rejects.toThrow(
      "Choose a folder to rename.",
    );
    await expect(invoke("folders:move", "/", "x")).rejects.toThrow(
      "Choose a folder to move.",
    );
  });
});

describe("file handlers", () => {
  it("validate file IDs before reaching the store", async () => {
    for (const channel of ["files:get", "files:remove", "files:move"])
      await expect(invoke(channel, 42)).rejects.toThrow("Invalid file ID.");
    expect(await invoke("files:list")).toEqual(["listed"]);
    expect(await invoke("files:get", "a")).toEqual({ got: "a" });
    expect(await invoke("files:remove", "a")).toEqual({ removed: "a" });
    expect(await invoke("files:move", "a", "Work")).toEqual({
      id: "a",
      folder: join(documents, "Work"),
    });
    expect(await invoke("files:reload", "a")).toEqual({ reloaded: "a" });
  });

  it("saves a re-validated record and drops a bad fingerprint or drive link", async () => {
    const input = {
      ...record(),
      fingerprint: "not-a-hash",
      drive: { nope: true },
    };
    const saved = (await invoke("files:save", input)) as Record<string, unknown>;
    expect(saved.fingerprint).toBeUndefined();
    expect(saved.drive).toBeUndefined();
    expect((saved.file as { title: string }).title).toBe("Report");
    const hash = "a".repeat(64);
    const kept = (await invoke("files:save", { ...record(), fingerprint: hash })) as {
      fingerprint: string;
    };
    expect(kept.fingerprint).toBe(hash);
  });

  it("saves as a native file in the documents folder", async () => {
    const { dialog } = fake.electron;
    expect(await invoke("files:save-as", record())).toBeNull();
    expect(dialog.showSaveDialog.mock.calls.at(-1)![1]).toMatchObject({
      defaultPath: join(documents, "Report.sldoc"),
    });
    saves(join(root, "Copy.sldoc"));
    expect(await invoke("files:save-as", record())).toEqual({
      savedAs: join(root, "Copy.sldoc"),
    });
    saves(join(root, "Copy"));
    expect(await invoke("files:save-as", record())).toEqual({
      savedAs: join(root, "Copy.sldoc"),
    });
    saves(join(root, "Old.suiteleaf"));
    expect(await invoke("files:save-as", record())).toEqual({
      savedAs: join(root, "Old.suiteleaf"),
    });
    saves(join(root, "Copy.slsheet"));
    expect(await invoke("files:save-as", record())).toEqual({
      savedAs: join(root, "Copy.slsheet.sldoc"),
    });
  });

  it("exports text and bytes where the person chooses", async () => {
    await expect(invoke("files:export", 1, "x")).rejects.toThrow("Invalid export.");
    await expect(invoke("files:export", "a.txt", 5)).rejects.toThrow("Invalid export.");
    expect(await invoke("files:export", "a.txt", "x")).toBeNull();
    expect(fake.electron.dialog.showSaveDialog.mock.calls.at(-1)![1]).toEqual({
      defaultPath: "a.txt",
    });
    saves(join(root, "out.csv"));
    expect(await invoke("files:export", "out.csv", "a,b")).toBe(join(root, "out.csv"));
    expect(await readFile(join(root, "out.csv"), "utf8")).toBe("a,b");
    saves(join(root, "out.bin"));
    await invoke("files:export", "noext", new Uint8Array([1, 2]));
    expect(fake.electron.dialog.showSaveDialog.mock.calls.at(-1)![1]).toEqual({
      defaultPath: "noext.txt",
    });
    expect([...(await readFile(join(root, "out.bin")))]).toEqual([1, 2]);
  });
});

describe("opening files", () => {
  it("returns nothing when the person cancels", async () => {
    expect(await invoke("files:open")).toBeNull();
  });

  it("opens a MARP deck with the pictures beside it", async () => {
    const folder = join(root, "deck");
    await mkdir(folder);
    await writeFile(join(folder, "a.png"), new Uint8Array([0x89, 0x50]));
    await writeFile(
      join(folder, "Talk.md"),
      "---\nmarp: true\n---\n# Hi\n![](a.png)\n![](missing.png)\n![](../outside.png)\n",
    );
    opens(join(folder, "Talk.md"));
    const saved = (await invoke("files:open")) as {
      file: { kind: string; title: string; content: unknown };
    };
    expect(saved.file.kind).toBe("slide");
    expect(saved.file.title).toBe("Talk");
    const text = JSON.stringify(saved.file.content);
    expect(text).toContain("data:image/png;base64,");
    expect(text).toContain("missing.png");
  });

  it("imports a drawing and refuses one over 50 MB", async () => {
    const svg = join(root, "Logo.svg");
    await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    opens(svg);
    const saved = (await invoke("files:open")) as { file: { kind: string; title: string } };
    expect(saved.file).toMatchObject({ kind: "drawing", title: "Logo" });
    await truncate(svg, 51 * 1024 * 1024);
    opens(svg);
    await expect(invoke("files:open")).rejects.toThrow("Choose a file smaller than 50 MB.");
    await rm(svg);
  });

  it("converts Office files and opens native files directly", async () => {
    const docx = join(root, "Letter.docx");
    await writeFile(docx, "fake");
    opens(docx);
    expect(await invoke("files:open")).toEqual({
      file: { kind: "doc", title: "Letter.docx from docx" },
    });
    const native = join(root, "Mine.sldoc");
    opens(native);
    expect(await invoke("files:open")).toEqual({ opened: native });
  });
});

describe("slide pictures", () => {
  const deckJson = () => serializeFile(createFile("slide", "Deck"));

  it("only exports a presentation", async () => {
    await expect(invoke("slides:export-png", 4)).rejects.toThrow("Invalid presentation.");
    await expect(
      invoke("slides:export-png", serializeFile(createFile("doc", "D"))),
    ).rejects.toThrow("Only a presentation can be exported as PNG.");
    expect(await invoke("slides:export-png", deckJson())).toBeNull();
  });

  it("writes Slide pictures into a new folder", async () => {
    saves(join(root, "Pictures.png"));
    expect(await invoke("slides:export-png", deckJson())).toBe(join(root, "Pictures"));
    expect(await readdir(join(root, "Pictures"))).toEqual(["Slide1.png"]);
  });

  it("asks before replacing pictures already in the folder", async () => {
    const folder = join(root, "Pictures");
    await writeFile(join(folder, "Slide7.png"), "old");
    await writeFile(join(folder, "notes.txt"), "keep");
    fake.electron.dialog.showMessageBoxSync.mockReturnValueOnce(1);
    saves(folder);
    expect(await invoke("slides:export-png", deckJson())).toBeNull();
    expect((await readdir(folder)).sort()).toEqual(["Slide1.png", "Slide7.png", "notes.txt"]);
    fake.electron.dialog.showMessageBoxSync.mockReturnValueOnce(0);
    saves(folder);
    expect(await invoke("slides:export-png", deckJson())).toBe(folder);
    expect((await readdir(folder)).sort()).toEqual(["Slide1.png", "notes.txt"]);
  });

  it("passes on errors reading the chosen folder", async () => {
    const file = join(root, "plain-file");
    await writeFile(file, "x");
    saves(file);
    await expect(invoke("slides:export-png", deckJson())).rejects.toMatchObject({
      code: "ENOTDIR",
    });
  });
});

describe("printing", () => {
  it("checks the title", async () => {
    await expect(invoke("print", 5)).rejects.toThrow("Invalid print title.");
  });

  it("saves a PDF when there are no printers", async () => {
    expect(await invoke("print")).toBeUndefined();
    expect(fake.electron.dialog.showSaveDialog.mock.calls.at(-1)![1]).toMatchObject({
      defaultPath: "Document.pdf",
    });
    saves(join(root, "Printed"));
    await invoke("print", "Memo");
    expect((await readFile(join(root, "Printed.pdf"))).subarray(0, 4).toString()).toBe("%PDF");
    saves(join(root, "Kept.PDF"));
    await invoke("print", "Memo");
    expect((await stat(join(root, "Kept.PDF"))).size).toBe(4);
  });

  it("prints to a printer and handles its failures", async () => {
    const contents = win().webContents;
    contents.printers = [{ name: "Office" }];
    expect(await invoke("print", "Memo")).toBeUndefined();
    contents.printResult = [false, "cancelled"];
    expect(await invoke("print", "Memo")).toBeUndefined();
    contents.printResult = [false, "Paper jam"];
    await expect(invoke("print", "Memo")).rejects.toThrow("Paper jam");
    contents.printResult = [false, "No printers available"];
    saves(join(root, "Fallback.pdf"));
    await invoke("print", "Memo");
    expect((await stat(join(root, "Fallback.pdf"))).size).toBe(4);
    contents.printers = [];
    contents.printResult = [true, ""];
  });
});

describe("sign-in window", () => {
  it("refuses addresses that are not web pages", async () => {
    await expect(invoke("auth:window", 5)).rejects.toThrow("Invalid sign-in address.");
    await expect(invoke("auth:window", "file:///x")).rejects.toThrow(
      "Invalid sign-in address.",
    );
  });

  it("returns the token the provider redirects back with", async () => {
    const pending = invoke("auth:window", "https://node.example/auth/start");
    await vi.waitFor(() => expect(FakeWindow.all).toHaveLength(2));
    const child = FakeWindow.all[1];
    expect(child.options).toMatchObject({ modal: true, parent: win() });
    expect(child.webContents.loaded).toEqual(["https://node.example/auth/start"]);
    expect(child.webContents.openHandler!()).toEqual({ action: "deny" });
    const other = { preventDefault: vi.fn() };
    child.webContents.emit("will-navigate", other, "https://node.example/login");
    expect(other.preventDefault).not.toHaveBeenCalled();
    const done = { preventDefault: vi.fn() };
    child.webContents.emit(
      "will-redirect",
      done,
      "https://node.example/#/auth-complete?token=a%20b&x=1",
    );
    expect(done.preventDefault).toHaveBeenCalled();
    expect(await pending).toBe("a b");
    expect(child.closed).toBe(true);
    child.emit("closed");
  });

  it("returns null when the person closes the window", async () => {
    const pending = invoke("auth:window", "http://localhost:8080/");
    await vi.waitFor(() => expect(FakeWindow.all).toHaveLength(3));
    FakeWindow.all[2].emit("closed");
    expect(await pending).toBeNull();
  });
});

describe("server mode", () => {
  it("switches to a SuiteLeaf server and back", async () => {
    await expect(invoke("mode:set", { kind: "cluster", serverUrl: "ftp://x" })).rejects.toThrow();
    await invoke("mode:set", { kind: "cluster", serverUrl: "https://suite.example.com" });
    expect(await invoke("mode:get")).toEqual({
      kind: "cluster",
      serverUrl: "https://suite.example.com",
    });
    expect(mocks.watcher.close).toHaveBeenCalled();
    expect(win().webContents.reload).toHaveBeenCalled();
    const settings = JSON.parse(await readFile(join(root, "settings.json"), "utf8"));
    expect(settings.mode.kind).toBe("cluster");
    expect(menuItem("Server", "Connected to suite.example.com")).toMatchObject({
      enabled: false,
    });
    menuItem("Server", "Disconnect and work on this computer").click!();
    expect(menuActions().at(-1)).toEqual(["menu", "disconnect"]);
    const callback = vi.fn();
    win().webContents.headers!({ responseHeaders: {} }, callback);
    expect(callback.mock.calls[0][0].responseHeaders["Content-Security-Policy"][0]).toContain(
      "connect-src 'self' https://suite.example.com",
    );

    await expect(invoke("documents:choose")).rejects.toThrow(
      "Document folders are available in single-user mode.",
    );
    expect(await invoke("folders:list")).toEqual([]);
    await expect(invoke("folders:create", "", "x")).rejects.toThrow(
      "Folders are available in single-user mode.",
    );
    await invoke("files:save-as", record());
    expect(fake.electron.dialog.showSaveDialog.mock.calls.at(-1)![1]).toMatchObject({
      defaultPath: "Report.sldoc",
    });

    mocks.watcher.set.mockClear();
    await invoke("mode:set", { kind: "single" });
    expect(mocks.watcher.set).toHaveBeenCalledWith(documents);
  });
});

describe("app lifecycle", () => {
  it("reopens a window on activate and quits off macOS when all close", () => {
    win().emit("closed");
    fake.app.emit("activate");
    expect(FakeWindow.all).toHaveLength(4);
    fake.app.emit("activate");
    expect(FakeWindow.all).toHaveLength(4);
    fake.app.emit("window-all-closed");
    expect(fake.app.quit).toHaveBeenCalledTimes(process.platform === "darwin" ? 0 : 1);
  });

  it("stops watching and closes the store on quit", () => {
    fake.app.emit("will-quit");
    expect(mocks.watcher.close).toHaveBeenCalled();
    expect(mocks.store.close).toHaveBeenCalled();
    expect(basename(documents)).toBe("Chosen");
  });
});
