// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, type SuiteFile, type FileRecord } from "../../packages/core/src";

type BrowserProps = {
  control: { current: unknown };
  onFolderChange: (id: string | null, name: string) => void;
  onOpen: (item: unknown) => unknown;
  refreshKey: string;
};
type ImportProps = {
  onImport: (r: FileRecord, name?: string, progress?: (completed: number, total: number) => void) => Promise<void>;
  onError: (s: string) => void;
  placeInFolder: (file: SuiteFile, folder: string, progress?: (completed: number, total: number) => void) => Promise<unknown>;
  keepImported: (file: SuiteFile, progress?: (completed: number, total: number) => void) => Promise<void>;
  onBatchDone: () => void;
};

const hoisted = vi.hoisted(() => ({
  session: null as null | { user: Record<string, string | undefined> },
  sync: null as null | { peers: number; replicating: number; heads: string },
  locked: false,
  browser: null as null | BrowserProps,
  importer: null as null | ImportProps,
  host: null as null | (() => { kind: string; place: () => string; snapshot: () => string; tools: unknown }),
  ctx: null as null | Record<string, unknown>,
  folders: [] as { id: string; name: string; parentId: string | null }[],
  createInDrive: vi.fn<(file: SuiteFile, folder: string | null, navigate: unknown) => Promise<void>>(async () => {}),
  keepCreated: vi.fn(async (file: SuiteFile) => ({ file })),
  openFromDrive: vi.fn(async () => {}),
  forgetDriveFiles: vi.fn(async () => true),
  disconnectFromServer: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  create: vi.fn(),
}));

vi.mock("../../apps/web/src/node-client", () => ({
  drive: {
    listFolders: async () => hoisted.folders.map((f) => ({ ...f })),
    create: hoisted.create,
  },
  signOut: hoisted.signOut,
}));
vi.mock("../../apps/web/src/drive/DriveBrowser", () => ({
  DriveBrowser: (props: BrowserProps) => {
    hoisted.browser = props;
    return <p data-testid="browser">{props.refreshKey}</p>;
  },
}));
vi.mock("../../apps/web/src/home/ImportButton", () => ({
  ImportButton: (props: ImportProps) => {
    hoisted.importer = props;
    return null;
  },
}));
vi.mock("../../apps/web/src/drive/SignIn", () => ({ useNodeSession: () => hoisted.session }));
vi.mock("../../apps/web/src/drive/status", async () => ({
  ...(await vi.importActual<object>("../../apps/web/src/drive/status")),
  useServerSync: () => hoisted.sync,
}));
vi.mock("../../apps/web/src/admin/Admin", () => ({
  AdminLink: ({ role }: { role?: string }) => (role ? <span>Admin for {role}</span> : null),
}));
vi.mock("../../apps/web/src/mode", () => ({
  useMode: () => ({ locked: hoisted.locked }),
  disconnect: hoisted.disconnect,
}));
vi.mock("../../apps/web/src/ai/host", () => ({
  useAgentHost: (_id: string, build: never) => {
    hoisted.host = build;
  },
}));
vi.mock("../../apps/web/src/ai/tools/cluster", () => ({
  driveSnapshot: () => "drive snapshot",
  driveTools: (ctx: Record<string, unknown>) => {
    hoisted.ctx = ctx;
    return [];
  },
}));
vi.mock("../../apps/web/src/ai/AgentSidebar", () => ({ AiButton: () => null }));
vi.mock("../../apps/web/src/document-settings", () => ({ SettingsButton: () => null }));
vi.mock("../../apps/web/src/drive/drive-files", () => ({
  createInDrive: hoisted.createInDrive,
  keepCreated: hoisted.keepCreated,
  openFromDrive: hoisted.openFromDrive,
  forgetDriveFiles: hoisted.forgetDriveFiles,
  disconnectFromServer: hoisted.disconnectFromServer,
}));

import { ClusterHome } from "../../apps/web/src/home/ClusterHome";

const server = "https://drive.example";
const renderHome = () =>
  render(
    <MemoryRouter>
      <ClusterHome serverUrl={server} />
    </MemoryRouter>,
  );

beforeEach(() => {
  hoisted.session = { user: { id: "ada", name: "Ada Lovelace", email: "ada@x.org", role: "admin" } };
  hoisted.sync = null;
  hoisted.locked = false;
  hoisted.folders = [{ id: "f-work", name: "Work", parentId: null }];
  for (const fn of [
    hoisted.createInDrive,
    hoisted.keepCreated,
    hoisted.openFromDrive,
    hoisted.forgetDriveFiles,
    hoisted.disconnectFromServer,
    hoisted.signOut,
    hoisted.disconnect,
    hoisted.create,
  ])
    fn.mockClear();
  hoisted.forgetDriveFiles.mockResolvedValue(true);
  hoisted.create.mockImplementation(async (input: { name: string; parentId: string | null }) => ({
    id: `id-${input.name}`,
    name: input.name,
    parentId: input.parentId,
  }));
});
afterEach(() => {
  cleanup();
  delete window.suiteleaf;
});

describe("ClusterHome", () => {
  it("names the account and server, and signs out after the cache is cleared", async () => {
    renderHome();
    expect(screen.getByText("Files are saved to SuiteDrive on drive.example.", { exact: false })).toBeTruthy();
    expect(screen.getByText(/kept for when you disconnect/)).toBeTruthy();
    expect(screen.getByText("Admin for admin")).toBeTruthy();
    expect(document.querySelector(".account-avatar")?.textContent).toBe("A");
    expect(document.querySelector(".account-who")?.getAttribute("title")).toBe(
      "Ada Lovelace (ada@x.org) on drive.example",
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(hoisted.signOut).toHaveBeenCalled());
    hoisted.forgetDriveFiles.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(hoisted.forgetDriveFiles).toHaveBeenCalledTimes(2));
    expect(hoisted.signOut).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect from server" }));
    await waitFor(() => expect(hoisted.disconnectFromServer).toHaveBeenCalledWith(server));
  });

  it("shows a failed sign-out and hides Disconnect in a locked build", async () => {
    hoisted.locked = true;
    hoisted.session = { user: { id: "ada", username: "ada" } };
    hoisted.forgetDriveFiles.mockRejectedValueOnce(new Error("Uploads are still running."));
    renderHome();
    expect(screen.queryByRole("button", { name: "Disconnect from server" })).toBeNull();
    expect(screen.queryByText(/kept for when you disconnect/)).toBeNull();
    expect(document.querySelector(".account-who")?.getAttribute("title")).toBe("ada on drive.example");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Uploads are still running.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hides the account without a session and shows the sync icon", () => {
    hoisted.session = { user: { id: "x" } };
    hoisted.sync = { peers: 2, replicating: 1, heads: "h1" };
    renderHome();
    expect(document.querySelector(".account-avatar")?.textContent).toBe("?");
    expect(screen.getByTitle("Copying 1 file from other servers… · drive.example").dataset.state).toBe("busy");
    expect(screen.getByTestId("browser").textContent).toBe("h1:1:0");
    cleanup();
    hoisted.session = null;
    hoisted.sync = { peers: 1, replicating: 0, heads: "h2" };
    renderHome();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(screen.getByTitle("Connected to 1 other server · drive.example").dataset.state).toBe("connected");
  });

  it("creates new files in the open SuiteDrive folder", async () => {
    renderHome();
    fireEvent.click(screen.getByRole("button", { name: /New document/ }));
    await waitFor(() => expect(hoisted.createInDrive).toHaveBeenCalledWith(expect.objectContaining({ kind: "doc" }), null, expect.any(Function)));
    act(() => hoisted.browser!.onFolderChange("f-work", "Work"));
    expect(screen.getAllByText("In Work").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /New spreadsheet/ }));
    await waitFor(() => expect(hoisted.createInDrive).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "sheet" }), "f-work", expect.any(Function)));
    hoisted.createInDrive.mockRejectedValueOnce(new Error("Quota reached."));
    fireEvent.click(screen.getByRole("button", { name: /New presentation/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Quota reached.");
    act(() => hoisted.browser!.onFolderChange(null, "My Drive"));
    expect(screen.queryByText("In Work")).toBeNull();
    await hoisted.browser!.onOpen({ id: "item" });
    expect(hoisted.openFromDrive).toHaveBeenCalledWith({ id: "item" }, expect.any(Function));
  });

  it("answers the desktop menu", async () => {
    let menu: (action: string) => void = () => {};
    window.suiteleaf = { onMenu: (listener: typeof menu) => ((menu = listener), () => {}) } as never;
    renderHome();
    for (const action of ["new-doc", "new-sheet", "new-slide", "new-marp", "new-drawing-mermaid", "other"])
      act(() => menu(action));
    await waitFor(() => expect(hoisted.createInDrive).toHaveBeenCalledTimes(5));
    expect(hoisted.createInDrive.mock.calls.map((call) => (call[0] as SuiteFile).kind)).toEqual([
      "doc",
      "sheet",
      "slide",
      "slide",
      "drawing",
    ]);
  });

  it("opens an import already placed in SuiteDrive without uploading it twice", async () => {
    renderHome();
    const file = createFile("slide", "Lecture");
    await act(async () => hoisted.importer!.onImport({
      file,
      drive: { nodeUrl: server, itemId: "placed", name: "Lecture.slslides" },
    }));
    expect(hoisted.createInDrive).not.toHaveBeenCalled();
  });

  it("imports into SuiteDrive, building the dropped folder path", async () => {
    renderHome();
    const props = hoisted.importer!;
    const file = createFile("doc", "Lesson");
    const report = vi.fn();
    await props.onImport({ file }, "Lesson.sldoc", report);
    expect(hoisted.createInDrive).toHaveBeenCalledWith(file, null, expect.any(Function), report);
    act(() => hoisted.browser!.onFolderChange("f-root", "Root"));
    hoisted.folders = [
      { id: "f-work", name: "Work", parentId: "f-root" },
      { id: "f-other", name: "Work", parentId: null },
    ];
    await hoisted.importer!.placeInFolder(file, "Work/New/Deep", report);
    expect(hoisted.create.mock.calls).toEqual([
      [{ name: "New", parentId: "f-work", kind: "folder" }],
      [{ name: "Deep", parentId: "id-New", kind: "folder" }],
    ]);
    expect(hoisted.keepCreated).toHaveBeenLastCalledWith(file, "id-Deep", true, report);
    await hoisted.importer!.keepImported(file, report);
    expect(hoisted.keepCreated).toHaveBeenLastCalledWith(file, "f-root", true, report);
    act(() => hoisted.importer!.onBatchDone());
    expect(hoisted.browser!.refreshKey).toBe("1");
    act(() => hoisted.importer!.onError("Import failed."));
    expect(screen.getByRole("alert").textContent).toContain("Import failed.");
  });

  it("gives the assistant the drive, account and server", async () => {
    hoisted.session = { user: { id: "ada", email: "ada@x.org" } };
    renderHome();
    const host = hoisted.host!();
    expect(host.kind).toBe("home");
    expect(host.place()).toBe("No document open");
    expect(host.snapshot()).toBe("drive snapshot");
    const ctx = hoisted.ctx as {
      host: string;
      user: string;
      drive: () => unknown;
      create: (kind: string, title: string) => Promise<void>;
      open: (item: unknown) => Promise<void>;
      signOut: () => Promise<boolean>;
      canDisconnect: boolean;
      mayDisconnect: () => Promise<boolean>;
      disconnect: () => Promise<void>;
    };
    expect(ctx).toMatchObject({ host: "drive.example", user: "ada@x.org", canDisconnect: true });
    hoisted.browser!.control.current = { path: ["My Drive"] };
    expect(ctx.drive()).toEqual({ path: ["My Drive"] });
    await ctx.create("sheet", "Budget");
    expect(hoisted.createInDrive).toHaveBeenCalledWith(expect.objectContaining({ title: "Budget" }), null, expect.any(Function));
    await ctx.open({ id: "item" });
    expect(hoisted.openFromDrive).toHaveBeenCalled();
    expect(await ctx.signOut()).toBe(true);
    hoisted.forgetDriveFiles.mockResolvedValueOnce(false);
    expect(await ctx.signOut()).toBe(false);
    expect(hoisted.signOut).toHaveBeenCalledTimes(1);
    expect(await ctx.mayDisconnect()).toBe(true);
    await ctx.disconnect();
    expect(hoisted.disconnect).toHaveBeenCalledWith(server);
    cleanup();
    hoisted.session = null;
    renderHome();
    hoisted.host!();
    expect((hoisted.ctx as { user: string }).user).toBe("");
  });
});
