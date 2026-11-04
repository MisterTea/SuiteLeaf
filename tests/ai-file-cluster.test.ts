// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveControl } from "../apps/web/src/drive/DriveBrowser";
import type { DriveItem } from "../apps/web/src/node-client";
import type { SuiteTool } from "../apps/web/src/ai/host";
import { closeEditor, openEditor, outText, settle, useFileTimers } from "./ai-file-harness";
import { memoryStorage } from "./ai-memory-storage";

const resumes: { result: string; reload: () => unknown }[] = [];
vi.mock("../apps/web/src/ai/agent", () => ({
  agentSession: {
    reloadAndResume: async (result: string, reload: () => unknown) => {
      resumes.push({ result, reload });
      await reload();
      return result;
    },
  },
}));

const { conflictTools, connectTools, driveSnapshot, driveTools, signInSnapshot, signInTools } = await import("../apps/web/src/ai/tools/cluster");

beforeEach(() => {
  useFileTimers();
  memoryStorage();
  resumes.length = 0;
  document.body.innerHTML = "";
});
afterEach(() => {
  closeEditor();
  vi.useRealTimers();
});

const byName = (tools: SuiteTool[]) => Object.fromEntries(tools.map((t) => [t.name, t])) as Record<string, SuiteTool>;
const run = async (t: SuiteTool, args: Record<string, unknown> = {}) => outText(await settle(() => t.execute(args as never)));

describe("connecting to a server", () => {
  it("probes the address, then reloads and resumes", async () => {
    const connected: string[] = [];
    const tools = byName(connectTools({ probe: async (a) => `https://${a}`, connect: async (url) => void connected.push(url) }));
    expect(await run(tools.connect_to_server, { address: "team.example.org" })).toBe("Connected to the SuiteLeaf server at https://team.example.org. The app reloaded.");
    expect(connected).toEqual(["https://team.example.org"]);
    document.body.innerHTML = `<button>Connect to a server</button>`;
    expect((tools.connect_to_server.target?.({} as never) as Element).textContent).toBe("Connect to a server");
  });

  it("explains an address that is not a server", async () => {
    const tools = byName(connectTools({ probe: async () => Promise.reject(new Error("No SuiteLeaf server answered at x.")), connect: async () => {} }));
    await expect(run(tools.connect_to_server, { address: "x" })).rejects.toThrow("No SuiteLeaf server answered at x.");
    expect(resumes).toEqual([]);
  });
});

describe("signing in", () => {
  it("waits for the user to sign in, then for SuiteDrive to load", async () => {
    let signedIn = false;
    let left = false;
    const tools = byName(signInTools({ host: "team.example.org", signedIn: () => signedIn, canLeave: true, leave: async () => void (left = true) }));
    document.body.innerHTML = `<div aria-label="Sign in to SuiteLeaf"></div><div class="account-chip"></div><button>Work on this computer</button>`;
    expect(tools.wait_for_sign_in.target?.({} as never)).toEqual({ x: 0, y: -28 });
    setTimeout(() => {
      signedIn = true;
      openEditor("home", "Screen: SuiteDrive. still loading");
      setTimeout(() => openEditor("home", "Screen: SuiteDrive, 2 files."), 1000);
    }, 2000);
    expect(await run(tools.wait_for_sign_in)).toBe(
      "The user signed in to team.example.org. New files are saved to SuiteDrive on that server; the files on this computer are kept and come back when they disconnect.\nScreen: SuiteDrive, 2 files.",
    );
    expect(await run(tools.disconnect)).toBe(
      "Signed out of team.example.org and left the server. SuiteLeaf is back to the files on this computer (listed below); files in SuiteDrive stayed on the server.",
    );
    expect(left).toBe(true);
    expect((tools.disconnect.target?.({} as never) as Element).textContent).toBe("Work on this computer");
  });

  it("gives up after a few minutes and offers no way out when the server is required", async () => {
    const tools = signInTools({ host: "h", signedIn: () => false, canLeave: false, leave: async () => {} });
    expect(tools.map((t) => t.name)).toEqual(["wait_for_sign_in"]);
    expect(tools[0].target?.({} as never)).toBeUndefined();
    expect(await run(tools[0])).toBe("The user has not signed in yet.");
    expect(signInSnapshot("h")).toBe(
      "Screen: sign in to the SuiteLeaf server h. Only the user can sign in or create an account here; ask them to, then call wait_for_sign_in.",
    );
  });
});

describe("SuiteDrive", () => {
  const item = (name: string, kind: DriveItem["kind"] = "file", extra: Partial<DriveItem> = {}) =>
    ({ id: name, name, kind, available: true, ...extra }) as DriveItem;

  function drive(extra: Record<string, unknown> = {}) {
    const state = {
      path: ["My Drive"],
      items: [item("Projects", "folder"), item("Budget.slsheet"), item("Plan.sldoc"), item("Deck.slslides"), item("Sketch.sldraw"), item("Copying.sldoc", "file", { available: false })],
      loading: false,
      opened: [] as string[],
      created: [] as string[],
      folders: [] as string[],
    };
    const control: DriveControl = {
      get path() {
        return state.path;
      },
      get items() {
        return state.items;
      },
      get loading() {
        return state.loading;
      },
      choose: (i) => {
        state.path = [...state.path, i.name];
        state.items = [item("Inside.sldoc")];
      },
      goTo: (depth) => {
        state.path = state.path.slice(0, depth);
      },
      switchView: () => {},
      newFolder: async (name) => void state.folders.push(name),
    };
    const ctx = {
      host: "team.example.org",
      user: "sam@example.org",
      drive: () => control as DriveControl | null,
      create: async (kind: string, title?: string) => {
        state.created.push(`${kind}:${title ?? ""}`);
        openEditor(kind as "doc");
      },
      open: async (i: DriveItem) => {
        state.opened.push(i.name);
        openEditor(/\.slsheet$/.test(i.name) ? "sheet" : /\.slslides$/.test(i.name) ? "slide" : /\.sldraw$/.test(i.name) ? "drawing" : "doc");
      },
      signOut: async () => true,
      canDisconnect: true,
      mayDisconnect: async () => true,
      disconnect: async () => {},
      ...extra,
    };
    return { state, ctx, tools: byName(driveTools(ctx)) };
  }

  it("lists the folder on screen and describes it", async () => {
    const { state, ctx, tools } = drive();
    expect(await run(tools.list_drive)).toBe(
      'My Drive: 📁 "Projects", "Budget.slsheet", "Plan.sldoc", "Deck.slslides", "Sketch.sldraw", "Copying.sldoc" (still copying from another server)',
    );
    expect(driveSnapshot(ctx)).toMatch(/^Screen: SuiteDrive on team.example.org, signed in as sam@example.org. Folder My Drive: 📁 "Projects"/);
    state.loading = true;
    expect(driveSnapshot(ctx)).toBe("Screen: SuiteDrive on team.example.org, signed in as sam@example.org. Folder My Drive: still loading.");
    state.loading = false;
    state.items = [];
    expect(await run(tools.list_drive)).toBe("My Drive: empty");
    expect(driveSnapshot({ ...ctx, drive: () => null })).toBe("Screen: SuiteDrive on team.example.org, signed in as sam@example.org.");
  });

  it("opens folders, goes back to the top and makes new folders", async () => {
    const { state, tools } = drive();
    expect(await run(tools.open_folder, { name: "projects" })).toBe('In My Drive › Projects: "Inside.sldoc"');
    expect(await run(tools.open_folder, { name: "My Drive" })).toBe('In My Drive: "Inside.sldoc"');
    expect(await run(tools.new_folder, { name: "Receipts" })).toBe(
      'Made the folder "Receipts" in My Drive. It is not open yet: call open_folder for "Receipts" before creating a file that belongs in it.',
    );
    expect(state.folders).toEqual(["Receipts"]);
    await expect(run(tools.open_folder, { name: "Taxes" })).rejects.toThrow('Nothing called "Taxes" in My Drive. Here: nothing.');
  });

  it("creates and opens files and waits for their editor", async () => {
    const { state, tools } = drive();
    expect(await run(tools.create_file, { kind: "spreadsheet", title: "Costs" })).toBe('Created "Costs" in My Drive and opened it.\nOpen sheet editor.');
    expect(await run(tools.create_file, { kind: "document" })).toBe("Created a new document in My Drive and opened it.\nOpen doc editor.");
    await expect(run(tools.create_file, { kind: "poster" })).rejects.toThrow('Unknown kind "poster".');
    for (const [name, kind] of [["budget", "sheet"], ["Deck", "slide"], ["Sketch.sldraw", "drawing"], ["plan", "doc"]]) {
      expect(await run(tools.open_file, { name })).toBe(`Opened "${state.opened.at(-1)}".\nOpen ${kind} editor.`);
    }
    expect(state.opened).toEqual(["Budget.slsheet", "Deck.slslides", "Sketch.sldraw", "Plan.sldoc"]);
    await expect(run(tools.open_file, { name: "Projects" })).rejects.toThrow('"Projects" is a folder; use open_folder.');
  });

  it("brings SuiteDrive and the row on screen before pointing at it", async () => {
    const { tools } = drive();
    document.body.innerHTML = `<section><div class="drive-browser"><div class="drive-crumbs"><button>My Drive</button></div><ul class="drive-list"><li class="drive-item" aria-label="Projects"></li><li class="drive-item" aria-label="Plan.sldoc"></li></ul><button class="drive-new-folder"></button></div></section><button class="new-card">New spreadsheet</button>`;
    const section = document.querySelector("section")!;
    const row = document.querySelector('[aria-label="Plan.sldoc"]')!;
    let sectionTop = 2000;
    section.getBoundingClientRect = () => ({ top: sectionTop, bottom: sectionTop + 100 }) as DOMRect;
    section.scrollIntoView = vi.fn(() => void (sectionTop = 10));
    row.getBoundingClientRect = () => ({ top: -50, bottom: -10 }) as DOMRect;
    row.scrollIntoView = vi.fn();
    expect(await settle(() => tools.open_file.target?.({ name: "Plan" } as never))).toBe(row);
    expect(section.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(row.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(await settle(() => tools.open_file.target?.({ name: "Nope" } as never))).toBeUndefined();
    expect(await settle(() => tools.open_folder.target?.({ name: "my drive" } as never))).toBe(document.querySelector(".drive-crumbs button"));
    expect(await settle(() => tools.open_folder.target?.({ name: "Projects" } as never))).toBe(document.querySelector('[aria-label="Projects"]'));
    expect(await settle(() => tools.list_drive.target?.({} as never))).toBe(document.querySelector(".drive-list"));
    expect(await settle(() => tools.new_folder.target?.({} as never))).toBe(document.querySelector(".drive-new-folder"));
    expect(await settle(() => tools.create_file.target?.({ kind: "spreadsheet" } as never))).toBe(document.querySelector(".new-card"));
  });

  it("signs out and disconnects only with the user's agreement", async () => {
    const yes = drive();
    expect(await run(yes.tools.sign_out)).toBe(
      "Signed out of team.example.org. The sign-in screen shows now; the server's files are hidden until someone signs in.",
    );
    expect(await run(yes.tools.disconnect)).toMatch(/^Signed out of team.example.org and left the server\./);
    const no = drive({ signOut: async () => false, mayDisconnect: async () => false });
    expect(await run(no.tools.sign_out)).toBe("The user chose not to sign out.");
    expect(await run(no.tools.disconnect)).toBe(
      "The user chose to stay connected, because a SuiteDrive file has changes that haven't uploaded yet.",
    );
    expect(Object.keys(drive({ canDisconnect: false }).tools)).not.toContain("disconnect");
    document.body.innerHTML = `<button aria-label="Sign out"></button><button aria-label="Disconnect from server"></button>`;
    expect(yes.tools.sign_out.target?.({} as never)).toBe(document.querySelector('[aria-label="Sign out"]'));
    expect(yes.tools.disconnect.target?.({} as never)).toBe(document.querySelector('[aria-label="Disconnect from server"]'));
  });

  it("says when SuiteDrive is not on screen", async () => {
    const { tools } = drive({ drive: () => null });
    await expect(run(tools.list_drive)).rejects.toThrow("SuiteDrive is not showing.");
  });
});

describe("a SuiteDrive conflict", () => {
  function conflict(has = true) {
    const state = { title: "Plan", saved: 0, reloaded: 0 };
    const tools = byName(
      conflictTools({
        conflict: () => has,
        saveCopy: async () => {
          state.saved++;
        },
        reload: async () => {
          state.reloaded++;
        },
        title: () => state.title,
        rename: (t) => void (state.title = t),
      }),
    );
    return { state, tools };
  }

  it("keeps your version as a named copy", async () => {
    const { state, tools } = conflict();
    document.body.innerHTML = `<div class="workspace-header"><input /></div><div class="drive-conflict"><button>Save as copy</button><button>Reload</button></div>`;
    expect(await run(tools.resolve_conflict, { choice: "save_copy", copy_name: "Plan (mine).sldoc" })).toBe(
      'Saved your version as a separate file in SuiteDrive called "Plan (mine)"; that copy is now the open file. The other person\'s version is still "Plan", unchanged.',
    );
    expect(state.saved).toBe(1);
    expect((tools.resolve_conflict.target?.({ choice: "reload" } as never) as Element).textContent).toBe("Reload");
  });

  it("says when both files share a name, reloads on request, and does nothing without a conflict", async () => {
    const { state, tools } = conflict();
    expect(await run(tools.resolve_conflict, { choice: "save_copy" })).toContain("Both files have the same name; rename_this_file gives the open copy its own name");
    expect(await run(tools.resolve_conflict, { choice: "reload" })).toBe("Reloaded the file from SuiteDrive; it now shows the other version.");
    expect(state.reloaded).toBe(1);
    expect(await run(conflict(false).tools.resolve_conflict, { choice: "reload" })).toBe("There is no conflict on this file.");
  });
});
