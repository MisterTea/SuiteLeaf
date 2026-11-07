// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  notices: vi.fn(),
  dismissNotice: vi.fn(),
  createRespondLink: vi.fn(),
  clearRespondLink: vi.fn(),
  listFolders: vi.fn(),
  access: vi.fn(),
}));

vi.mock("../../apps/web/src/node-client", () => ({ drive: hoisted }));

import { ExpiryCalendar } from "../../apps/web/src/drive/ExpiryCalendar";
import { LastEdited } from "../../apps/web/src/drive/LastEdited";
import { SignUpLinkDialog } from "../../apps/web/src/drive/SignUpLinkDialog";
import { FolderControls, MoveBanner, useDriveFolder } from "../../apps/web/src/drive/file-folder";
import { ShareNotices, sharedFileTitle } from "../../apps/web/src/drive/share-notices";
import { useServerSync } from "../../apps/web/src/drive/status";
import { DriveDialog } from "../../apps/web/src/drive/drive-dialog";
import { MoveDialog } from "../../apps/web/src/drive/MoveDialog";
import { DRIVE_SAVED } from "../../apps/web/src/drive/last-edit";

beforeEach(() => {
  for (const fn of Object.values(hoisted)) fn.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ExpiryCalendar", () => {
  it("moves between months and applies the day that is picked", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 12, 10));
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<ExpiryCalendar person="Priya" onPick={onPick} onClose={onClose} />);
    const group = screen.getByRole("group", { name: "Access ends for Priya" });
    const month = (d: Date) => d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    expect(group.textContent).toContain(month(new Date(2026, 9, 1)));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(group.textContent).toContain(month(new Date(2026, 10, 1)));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(group.textContent).toContain(month(new Date(2026, 8, 1)));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    const today = screen.getAllByRole("button", { name: /October 12$/ })[0] as HTMLButtonElement;
    expect(today.disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: /October 17$/ })[0]!);
    expect(onPick).toHaveBeenCalledWith(new Date(2026, 9, 17).toISOString());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("LastEdited", () => {
  it("shows the head author, and refreshes when this window saves", async () => {
    hoisted.get.mockResolvedValueOnce({ kind: "file", lastAuthorName: null, lastEditedAt: null });
    const { container } = render(<LastEdited itemId="item-1" />);
    await waitFor(() => expect(hoisted.get).toHaveBeenCalledWith("item-1"));
    expect(container.textContent).toBe("");
    hoisted.get.mockResolvedValue({
      kind: "file",
      lastAuthorName: "Sam Okafor",
      lastEditedAt: "2026-10-12T09:14:00.000Z",
    });
    act(() => void window.dispatchEvent(new Event(DRIVE_SAVED)));
    expect(await screen.findByText("Sam Okafor")).toBeTruthy();
    expect(container.querySelector("time")?.getAttribute("dateTime")).toBe(
      "2026-10-12T09:14:00.000Z",
    );
  });

  it("keeps quiet when the item cannot be read", async () => {
    hoisted.get.mockRejectedValue(new Error("offline"));
    const { container } = render(<LastEdited itemId="item-1" />);
    await waitFor(() => expect(hoisted.get).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});

describe("SignUpLinkDialog", () => {
  it("creates a link, copies it, and turns it off", async () => {
    hoisted.createRespondLink.mockResolvedValue({ token: "tok123" });
    hoisted.clearRespondLink.mockResolvedValue(undefined);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onClose = vi.fn();
    render(<SignUpLinkDialog itemId="form-1" onClose={onClose} />);
    const field = (await screen.findByDisplayValue(/sign-up\/tok123$/)) as HTMLTextAreaElement;
    expect(field.value).toBe(`${location.origin}/sign-up/tok123`);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Copied.");
    expect(writeText).toHaveBeenCalledWith(field.value);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(hoisted.clearRespondLink).toHaveBeenCalledWith("form-1");
  });

  it("says when the link cannot be made, copied or turned off", async () => {
    hoisted.createRespondLink.mockRejectedValueOnce("nope");
    const onClose = vi.fn();
    const first = render(<SignUpLinkDialog itemId="form-1" onClose={onClose} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Could not create the sign-up link.");
    expect((screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    first.unmount();
    hoisted.createRespondLink.mockResolvedValue({ token: "t" });
    hoisted.clearRespondLink.mockRejectedValueOnce(new Error("Server said no."));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
    render(<SignUpLinkDialog itemId="form-1" onClose={onClose} />);
    await screen.findByDisplayValue(/sign-up\/t$/);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await act(async () => {});
    expect(screen.queryByText("Copied.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Server said no.");
    hoisted.clearRespondLink.mockRejectedValueOnce("x");
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Could not turn off the sign-up link."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("folder chip and move banner", () => {
  it("names the folder, offers Move only to editors, and reports a move", () => {
    const onOpen = vi.fn();
    const onMove = vi.fn();
    const { rerender, container } = render(
      <FolderControls place={null} canMove onOpen={onOpen} onMove={onMove} />,
    );
    expect(container.textContent).toBe("");
    rerender(
      <FolderControls place={{ parentId: "f", name: "Beds" }} canMove={false} onOpen={onOpen} onMove={onMove} />,
    );
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
    rerender(
      <FolderControls place={{ parentId: "f", name: "Beds" }} canMove onOpen={onOpen} onMove={onMove} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Folder Beds" }));
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("undoes or dismisses a move notice", () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(
      <MoveBanner
        notice={{ fileName: "Notes", folderName: "Beds", previousParentId: null }}
        busy={false}
        onUndo={onUndo}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Notes");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onUndo).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it("loads the open file's folder, follows a move, and undoes it", async () => {
    hoisted.get.mockResolvedValue({ id: "item-1", parentId: "f1", parentName: "" });
    const { result, rerender } = renderHook(
      ({ id, active }) => useDriveFolder(id, active),
      { initialProps: { id: "item-1" as string | undefined, active: true } },
    );
    await waitFor(() => expect(result.current.place).toEqual({ parentId: "f1", name: "A folder" }));
    act(() => result.current.setOpen(true));
    act(() =>
      result.current.moved({
        item: { id: "item-1", name: "Notes", parentId: "f2", parentName: null } as never,
        previousParentId: "f1",
        folderName: "Beds",
      }),
    );
    expect(result.current.place).toEqual({ parentId: "f2", name: "Beds" });
    expect(result.current.open).toBe(false);
    expect(result.current.notice).toEqual({
      fileName: "Notes",
      folderName: "Beds",
      previousParentId: "f1",
    });
    hoisted.update.mockResolvedValue({ id: "item-1", parentId: "f1", parentName: "Plots" });
    await act(() => result.current.undo());
    expect(hoisted.update).toHaveBeenCalledWith("item-1", { parentId: "f1" });
    expect(result.current.place).toEqual({ parentId: "f1", name: "Plots" });
    expect(result.current.notice).toBeNull();
    await act(() => result.current.undo());
    expect(hoisted.update).toHaveBeenCalledTimes(1);
    act(() =>
      result.current.moved({
        item: { id: "item-1", name: "Notes", parentId: null } as never,
        previousParentId: null,
        folderName: "My Drive",
      }),
    );
    hoisted.update.mockResolvedValue({ id: "item-1", parentId: null });
    await act(() => result.current.undo());
    expect(result.current.place?.parentId).toBeNull();
    act(() =>
      result.current.moved({
        item: { id: "item-1", name: "Notes", parentId: "f3", parentName: "Herbs" } as never,
        previousParentId: null,
        folderName: "Ignored",
      }),
    );
    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();
    rerender({ id: undefined, active: true });
    expect(result.current.place).toBeNull();
  });

  it("stays empty when signed out or when the item cannot be read", async () => {
    hoisted.get.mockRejectedValue(new Error("gone"));
    const { result } = renderHook(() => useDriveFolder("item-1", true));
    await waitFor(() => expect(hoisted.get).toHaveBeenCalled());
    expect(result.current.place).toBeNull();
    const inactive = renderHook(() => useDriveFolder("item-1", false));
    expect(inactive.result.current.place).toBeNull();
    expect(hoisted.get).toHaveBeenCalledTimes(1);
  });
});

describe("ShareNotices", () => {
  const notice = {
    id: "n1",
    itemId: "item-1",
    itemName: "Shared/Plan.sldoc",
    sharerName: "Priya",
    role: "editor",
  };

  it("drops the SuiteLeaf extension and folder from a shared title", () => {
    expect(sharedFileTitle("a/b\\Plan.slsheet")).toBe("Plan");
    expect(sharedFileTitle(".sldoc")).toBe(".sldoc");
  });

  it("opens a shared file and dismisses the notice", async () => {
    hoisted.notices.mockResolvedValue([notice]);
    hoisted.dismissNotice.mockResolvedValue(undefined);
    hoisted.get.mockResolvedValue({ id: "item-1" });
    const onOpen = vi.fn();
    render(<ShareNotices floating onOpen={onOpen} />);
    const region = await screen.findByLabelText("Files shared with you");
    expect(region.className).toContain("floating");
    expect(region.textContent).toContain("Priya shared “Plan” with you · Can edit");
    hoisted.notices.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Open Plan" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith({ id: "item-1" }));
    expect(hoisted.dismissNotice).toHaveBeenCalledWith("n1");
    await waitFor(() => expect(screen.queryByLabelText("Files shared with you")).toBeNull());
  });

  it("shows why a notice could not be opened or dismissed", async () => {
    hoisted.notices.mockResolvedValue([notice, { ...notice, id: "n2", sharerName: null }]);
    hoisted.dismissNotice.mockRejectedValueOnce(new Error("Could not open it."));
    render(<ShareNotices onOpen={vi.fn()} />);
    await screen.findAllByRole("button", { name: "Open Plan" });
    expect(screen.getByLabelText("Files shared with you").textContent).toContain(
      "Someone shared “Plan” with you",
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Open Plan" })[0]!);
    expect((await screen.findByRole("alert")).textContent).toBe("Could not open it.");
    hoisted.notices.mockResolvedValue([{ ...notice, id: "n2" }]);
    hoisted.dismissNotice.mockRejectedValueOnce("nope");
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("nope"));
  });

  it("keeps the last list when a poll fails", async () => {
    vi.useFakeTimers();
    hoisted.notices.mockResolvedValueOnce([notice]).mockRejectedValue(new Error("offline"));
    render(<ShareNotices onOpen={vi.fn()} />);
    await act(async () => {});
    expect(screen.getByLabelText("Files shared with you")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(hoisted.notices).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Files shared with you")).toBeTruthy();
  });
});

describe("useServerSync", () => {
  it("polls while visible, on focus, and stops after unmount", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => Response.json({ peers: ["a"], suitedb: { heads: ["h"] } }));
    vi.stubGlobal("fetch", fetch);
    const { result, unmount } = renderHook(() => useServerSync("https://drive.example", 1000));
    await act(async () => {});
    expect(result.current).toEqual({ peers: 1, replicating: 0, heads: "h" });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetch).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetch).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(fetch).toHaveBeenCalledTimes(3);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("DriveDialog", () => {
  it("submits only when allowed and closes from the overlay or Escape", () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <DriveDialog title="Rename" submitLabel="OK" canSubmit={false} onSubmit={onSubmit} onClose={onClose}>
        <p>Body</p>
      </DriveDialog>,
    );
    fireEvent.submit(screen.getByRole("dialog", { name: "Rename" }));
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(
      <DriveDialog title="Rename" submitLabel="OK" onSubmit={onSubmit} onClose={onClose}>
        <p>Body</p>
      </DriveDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(".modal-overlay")!);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "a" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe("MoveDialog errors", () => {
  const item = { id: "file-1", name: "Notes", parentId: "f-old", kind: "file" };
  const grants = { grants: [], parent: null, yourRole: "owner" };

  it("says when folders cannot be listed", async () => {
    hoisted.listFolders.mockRejectedValue(new Error("Folders are unavailable."));
    render(
      <MoveDialog item={item} currentName="Old" includeMyDrive onClose={vi.fn()} onMoved={vi.fn()} />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Folders are unavailable.");
  });

  it("reports a failed move and stays open", async () => {
    hoisted.listFolders.mockResolvedValue([
      { id: "f-old", name: "Old", parentId: null },
      { id: "f-new", name: "New", parentId: null },
    ]);
    hoisted.access.mockResolvedValue(grants);
    hoisted.update.mockRejectedValue(new Error("Move refused."));
    const onClose = vi.fn();
    render(
      <MoveDialog item={item} currentName="Old" includeMyDrive onClose={onClose} onMoved={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "New" }));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Move here" }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Move here" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Move refused.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves a file to the top of My Drive", async () => {
    hoisted.listFolders.mockResolvedValue([{ id: "f-old", name: "Old", parentId: null }]);
    hoisted.access.mockResolvedValue(grants);
    hoisted.update.mockResolvedValue({ id: "file-1", name: "Notes", parentId: null });
    const onMoved = vi.fn();
    render(
      <MoveDialog item={item} currentName="Old" includeMyDrive onClose={vi.fn()} onMoved={onMoved} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "My Drive" }));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Move here" }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Move here" }));
    await waitFor(() =>
      expect(onMoved).toHaveBeenCalledWith(
        expect.objectContaining({ folderName: "My Drive", previousParentId: "f-old" }),
      ),
    );
  });
});
