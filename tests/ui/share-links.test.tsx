// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareLinks } from "../../apps/web/src/drive/share-links";
import { PublicSharingPolicy } from "../../apps/web/src/admin/public-sharing-policy";
import {
  publicLink,
  publicSharingPolicy,
  shareUrl,
} from "../../apps/web/src/drive/share-links-client";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  session: { url: "https://suiteleaf.example", user: { id: "owner" } } as {
    url: string;
    user: { id: string };
  } | null,
}));
vi.mock("../../apps/web/src/node-client", () => ({
  api: mocks.api,
  getSession: () => mocks.session,
}));
const clipboard = vi.fn();
const response = (body: unknown) => ({ json: async () => body }) as Response;
beforeEach(() => {
  mocks.api
    .mockReset()
    .mockResolvedValue(response({ allowed: true, token: null }));
  mocks.session = { url: "https://suiteleaf.example", user: { id: "owner" } };
  clipboard.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
});
afterEach(cleanup);

describe("share links", () => {
  it("copies a stable server-item link without changing access", async () => {
    render(<ShareLinks itemId="drive/item" canManage isFile />);
    await screen.findByRole("button", { name: "Share publicly" });
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await screen.findByText("Link copied.");
    expect(clipboard).toHaveBeenCalledWith(
      "https://suiteleaf.example/#/shared/drive%2Fitem",
    );
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Only the people/)).toBeTruthy();
  });
  it("publishes, copies a public link, then revokes it", async () => {
    render(<ShareLinks itemId="file" canManage isFile />);
    const publish = await screen.findByRole("button", {
      name: "Share publicly",
    });
    mocks.api.mockResolvedValueOnce(
      response({ allowed: true, token: "capability" }),
    );
    fireEvent.click(publish);
    const revoke = await screen.findByRole("button", {
      name: "Stop public sharing",
    });
    expect(mocks.api).toHaveBeenLastCalledWith(
      "/api/drive/items/file/public-link",
      { method: "POST" },
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() =>
      expect(clipboard).toHaveBeenCalledWith(
        "https://suiteleaf.example/#/public/capability",
      ),
    );
    fireEvent.click(revoke);
    await screen.findByText("Public link revoked.");
    expect(mocks.api).toHaveBeenLastCalledWith(
      "/api/drive/items/file/public-link",
      { method: "DELETE" },
    );
    expect(screen.getByRole("button", { name: "Share publicly" })).toBeTruthy();
  });
  it("offers a selectable link when clipboard access fails", async () => {
    clipboard.mockRejectedValue(new Error("denied"));
    render(<ShareLinks itemId="file" canManage={false} isFile={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    const input = (await screen.findByRole("textbox", {
      name: "Link to copy",
    })) as HTMLInputElement;
    fireEvent.focus(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(screen.getByRole("alert").textContent).toContain(
      "Clipboard access is unavailable",
    );
    expect(mocks.api).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "hides publication controls when policy forbids sharing (owner=%s)",
    async (canManage) => {
      mocks.api.mockResolvedValue(
        response({ allowed: false, token: "old-disabled-token" }),
      );
      render(<ShareLinks itemId="file" canManage={canManage} isFile />);
      await waitFor(() => expect(mocks.api).toHaveBeenCalled());
      expect(
        screen.queryByRole("button", { name: /public sharing|Share publicly/ }),
      ).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
      await waitFor(() =>
        expect(clipboard).toHaveBeenCalledWith(
          "https://suiteleaf.example/#/shared/file",
        ),
      );
    },
  );
  it("lets existing viewers copy a public link without managing it", async () => {
    mocks.api.mockResolvedValue(response({ allowed: true, token: "public" }));
    render(<ShareLinks itemId="file" canManage={false} isFile />);
    await screen.findByText(/Anyone with the public link can view/);
    expect(
      screen.queryByRole("button", { name: "Stop public sharing" }),
    ).toBeNull();
  });
  it("keeps private copying usable if status cannot load and reports mutation failures", async () => {
    mocks.api.mockRejectedValueOnce(new Error("offline"));
    const view = render(<ShareLinks itemId="offline" canManage isFile />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    view.unmount();
    render(<ShareLinks itemId="file" canManage isFile />);
    const publish = await screen.findByRole("button", {
      name: "Share publicly",
    });
    mocks.api.mockRejectedValueOnce(
      new Error("Public sharing was disabled by your administrator."),
    );
    fireEvent.click(publish);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "administrator",
    );
  });
  it("ignores status responses after unmount", async () => {
    let resolve!: (value: Response) => void;
    mocks.api.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    const view = render(<ShareLinks itemId="file" canManage isFile />);
    view.unmount();
    resolve(response({ allowed: true, token: null }));
    await Promise.resolve();
  });
  it("builds links without invite query strings or local cache routes", async () => {
    mocks.session = null;
    window.history.replaceState(null, "", "/?invite=secret#/file/local-id");
    expect(shareUrl("shared", "server-id")).toBe(
      "http://127.0.0.1:4173/#/shared/server-id",
    );
    window.history.replaceState(null, "", "/");
    await publicLink("file", "DELETE");
    await publicSharingPolicy(false);
    expect(mocks.api).toHaveBeenLastCalledWith("/api/admin/public-sharing", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: '{"allowed":false}',
    });
  });
});

describe("public sharing policy", () => {
  it("loads the persisted switch and saves changes", async () => {
    mocks.api.mockResolvedValue(response({ allowed: true }));
    render(<PublicSharingPolicy />);
    const toggle = screen.getByRole("checkbox", {
      name: "Allow public file sharing",
    }) as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(true));
    mocks.api.mockResolvedValueOnce(response({ allowed: false }));
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.checked).toBe(false));
    expect(screen.getByText(/permanently revokes/)).toBeTruthy();
  });
  it("retains the saved policy on failure and reports load failures", async () => {
    mocks.api.mockResolvedValueOnce(response({ allowed: true }));
    const view = render(<PublicSharingPolicy />);
    const toggle = screen.getByRole("checkbox") as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(true));
    mocks.api.mockRejectedValueOnce(new Error("Save failed"));
    fireEvent.click(toggle);
    await screen.findByText("Save failed");
    expect(toggle.checked).toBe(true);
    view.unmount();
    mocks.api.mockRejectedValueOnce(new Error("Load failed"));
    render(<PublicSharingPolicy />);
    await screen.findByText("Load failed");
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(
      true,
    );
  });
});
