// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile } from "../../packages/core/src";
import {
  PublicFileRoute,
  loadPublicFile,
} from "../../apps/web/src/drive/public-file-route";
import { SharedFileRoute } from "../../apps/web/src/drive/shared-file-route";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  open: vi.fn(),
  folder: vi.fn(),
  renderError: false,
  mode: { kind: "cluster", serverUrl: "https://suiteleaf.example" } as {
    kind: string;
    serverUrl?: string;
  },
}));
vi.mock("../../apps/web/src/node-client", () => ({
  drive: { get: mocks.get },
}));
vi.mock("../../apps/web/src/drive/drive-files", () => ({
  openFromDrive: mocks.open,
}));
vi.mock("../../apps/web/src/drive/DriveBrowser", () => ({
  rememberDriveFolder: mocks.folder,
}));
vi.mock("../../apps/web/src/mode", () => ({
  useMode: () => ({ mode: mocks.mode }),
}));
function Editor({
  readOnly,
  file,
  onChange,
  onError,
  canComment,
  canSubmit,
  onCreateDocument,
  onActions,
}: {
  readOnly: boolean;
  file: { kind: string };
  onChange: () => void;
  onError: (message: string) => void;
  canComment?: boolean;
  canSubmit?: boolean;
  onCreateDocument?: () => Promise<void>;
  onActions: () => void;
}) {
  if (mocks.renderError) throw new Error("Viewer failed");
  return (
    <div
      data-testid="editor"
      data-readonly={readOnly}
      data-comment={canComment}
      data-submit={canSubmit}
    >
      {file.kind}
      <button
        onClick={() => {
          onChange();
          onActions();
          void onCreateDocument?.();
        }}
      >
        Attempt edit
      </button>
      <button onClick={() => onError("Editor message")}>Report error</button>
    </div>
  );
}
vi.mock("../../apps/web/src/editors/Docs", () => ({ default: Editor }));
vi.mock("../../apps/web/src/editors/Sheets", () => ({ default: Editor }));
vi.mock("../../apps/web/src/editors/Slides", () => ({ default: Editor }));
vi.mock("../../apps/web/src/editors/Drawing", () => ({ default: Editor }));
vi.mock("../../apps/web/src/editors/Form", () => ({ default: Editor }));
const request = vi.fn();
function publicView(token = "token") {
  return render(
    <MemoryRouter initialEntries={[`/public/${token}`]}>
      <Routes>
        <Route path="/public/:token" element={<PublicFileRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}
function sharedView() {
  return render(
    <MemoryRouter initialEntries={["/shared/server-id"]}>
      <Routes>
        <Route path="/shared/:itemId" element={<SharedFileRoute />} />
        <Route path="/file/:id" element={<p>Opened editor</p>} />
        <Route path="/" element={<p>Opened folder</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.stubGlobal("fetch", request);
  request.mockReset();
  mocks.get.mockReset();
  mocks.open.mockReset();
  mocks.folder.mockReset();
  mocks.renderError = false;
  mocks.mode = { kind: "cluster", serverUrl: "https://suiteleaf.example" };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("anonymous public viewer", () => {
  it.each(["doc", "sheet", "slide", "drawing", "form"] as const)(
    "opens a %s read-only without credentials or a cache write",
    async (kind) => {
      const file = createFile(kind, "Public example");
      request.mockResolvedValue(new Response(JSON.stringify(file)));
      publicView();
      const editor = await screen.findByTestId("editor");
      expect(editor.getAttribute("data-readonly")).toBe("true");
      if (kind === "sheet")
        expect(editor.getAttribute("data-comment")).toBe("false");
      if (kind === "form")
        expect(editor.getAttribute("data-submit")).toBe("false");
      expect(
        screen.getByRole("heading", { name: "Public example" }),
      ).toBeTruthy();
      expect(request).toHaveBeenCalledWith(
        "https://suiteleaf.example/api/public/files/token",
        expect.objectContaining({
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Attempt edit" }));
      fireEvent.click(screen.getByRole("button", { name: "Report error" }));
      await screen.findByText("Editor message");
      expect(request).toHaveBeenCalledTimes(1);
      expect(mocks.get).not.toHaveBeenCalled();
      expect(mocks.open).not.toHaveBeenCalled();
    },
  );
  it("explains revoked public links without asking for sign-in", async () => {
    request.mockResolvedValue(new Response("", { status: 404 }));
    publicView();
    expect((await screen.findByRole("alert")).textContent).toContain("revoked");
    expect(screen.queryByText(/sign in to/i)).toBeNull();
  });
  it("reports server, network, and malformed-file failures", async () => {
    request.mockResolvedValueOnce(new Response("", { status: 503 }));
    await expect(
      loadPublicFile("https://suiteleaf.example", "token"),
    ).rejects.toThrow("Try again later");
    request.mockResolvedValueOnce(new Response("not JSON"));
    await expect(
      loadPublicFile("https://suiteleaf.example", "token"),
    ).rejects.toThrow();
    request.mockRejectedValueOnce(new Error("Network unavailable"));
    publicView();
    await screen.findByText("Network unavailable");
  });
  it("uses the serving origin in local mode and cancels pending reads", async () => {
    mocks.mode = { kind: "local" };
    let resolve!: (response: Response) => void;
    request.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    const view = publicView();
    const signal = request.mock.calls[0][1].signal as AbortSignal;
    expect(request.mock.calls[0][0]).toBe(
      "http://127.0.0.1:4173/api/public/files/token",
    );
    view.unmount();
    expect(signal.aborted).toBe(true);
    resolve(new Response(JSON.stringify(createFile("doc", "Late"))));
    await Promise.resolve();
  });
  it("contains an editor crash", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.renderError = true;
    request.mockResolvedValue(
      new Response(JSON.stringify(createFile("doc", "Example"))),
    );
    publicView();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Viewer failed",
    );
  });
});

describe("authenticated stable links", () => {
  it("resolves the server item before opening its local editor", async () => {
    const item = { id: "server-id", kind: "file", name: "Example.sldoc" };
    mocks.get.mockResolvedValue(item);
    mocks.open.mockImplementation(async (_, navigate) => {
      await navigate("/file/local-cache-id");
    });
    sharedView();
    await screen.findByText("Opened editor");
    expect(mocks.get).toHaveBeenCalledWith("server-id");
    expect(mocks.open.mock.calls[0][0]).toEqual(item);
  });
  it("opens a shared parent folder at home", async () => {
    mocks.get.mockResolvedValue({
      id: "server-id",
      kind: "folder",
      name: "Reports",
    });
    sharedView();
    await screen.findByText("Opened folder");
    expect(mocks.folder).toHaveBeenCalledWith("server-id", "Reports");
  });
  it("reports denied access or a failed content read", async () => {
    mocks.get.mockRejectedValue(
      new Error("You do not have access to this file."),
    );
    sharedView();
    await screen.findByText("You do not have access to this file.");
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("does not open an item after navigation away", async () => {
    let resolve!: (value: unknown) => void;
    mocks.get.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = sharedView();
    view.unmount();
    resolve({ id: "server-id", kind: "file" });
    await waitFor(() => expect(mocks.open).not.toHaveBeenCalled());
  });
});
