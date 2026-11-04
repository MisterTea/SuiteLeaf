// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessGrant, ItemAccess } from "../../apps/web/src/node-client";

const hoisted = vi.hoisted(() => ({
  access: vi.fn(),
  explanation: vi.fn(),
  accounts: vi.fn(),
  searchGroups: vi.fn(),
  share: vi.fn(),
  transfer: vi.fn(),
  expire: vi.fn(),
}));

vi.mock("../../apps/web/src/node-client", () => ({
  getSession: () => ({ user: { id: "ada" } }),
  drive: hoisted,
}));

import { ShareDialog } from "../../apps/web/src/drive/ShareDialog";

function person(
  principalId: string,
  name: string | null,
  role: AccessGrant["role"],
  extra: Partial<AccessGrant> = {},
): AccessGrant {
  return {
    principalType: "user",
    principalId,
    role,
    name,
    email: null,
    inheritedFrom: null,
    expired: false,
    ...extra,
  };
}

const owned = (grants: AccessGrant[], extra: Partial<ItemAccess> = {}): ItemAccess => ({
  grants,
  parent: null,
  yourRole: "owner",
  ...extra,
});

beforeEach(() => {
  for (const fn of Object.values(hoisted)) fn.mockReset();
  hoisted.explanation.mockResolvedValue(null);
  hoisted.accounts.mockResolvedValue([]);
  hoisted.searchGroups.mockResolvedValue([]);
  hoisted.share.mockResolvedValue(undefined);
  hoisted.transfer.mockResolvedValue(undefined);
  hoisted.expire.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const openDialog = (kind = "doc") => {
  const onClose = vi.fn();
  render(<ShareDialog itemId="file-1" itemName="Notes" kind={kind} onClose={onClose} />);
  return onClose;
};
const apply = () => fireEvent.click(screen.getByRole("button", { name: "Apply this access change" }));

describe("ShareDialog", () => {
  it("finds people and groups, and shares with the one picked", async () => {
    hoisted.access.mockResolvedValue(owned([person("ada", "Ada Lovelace", "owner")]));
    hoisted.accounts.mockResolvedValue([
      { id: "sam", name: "Sam Okafor", email: "sam@example.com", username: "sam" },
    ]);
    hoisted.searchGroups.mockResolvedValue([{ id: "g1", name: "Gardeners" }]);
    openDialog();
    expect(await screen.findByText("Ada Lovelace (you)")).toBeTruthy();
    const input = screen.getByLabelText("Add people or groups");
    fireEvent.change(input, { target: { value: "sa" } });
    const option = await screen.findByRole("option", { name: /Sam Okafor/ });
    expect(option.textContent).toContain("sam@example.com · sam");
    expect(screen.getByRole("option", { name: /Gardeners/ }).textContent).toContain("Group");
    fireEvent.click(screen.getByRole("option", { name: /Gardeners/ }));
    expect((input as HTMLInputElement).value).toBe("Gardeners");
    fireEvent.click(screen.getByRole("button", { name: "Role for Gardeners" }));
    fireEvent.click(screen.getByRole("option", { name: /Commenter/ }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(screen.getByRole("group", { name: "Access change" }).textContent).toContain(
      "Gardeners would gain commenter access.",
    );
    apply();
    await waitFor(() => expect(hoisted.share).toHaveBeenCalledWith("file-1", "g1", "commenter", "group"));
    expect(await screen.findByText("Gardeners can now comment")).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("picks the first match with Enter and starts a form share as Responder", async () => {
    hoisted.access.mockResolvedValue(owned([]));
    hoisted.accounts.mockResolvedValue([{ id: "sam", name: "Sam Okafor", email: null, username: null }]);
    openDialog("form");
    const input = await screen.findByLabelText("Add people or groups");
    fireEvent.change(input, { target: { value: "Sam" } });
    await screen.findByRole("option", { name: /Sam Okafor/ });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Role for Sam Okafor" }).textContent).toContain(
      "Responder",
    );
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Access change" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    apply();
    await waitFor(() => expect(hoisted.share).toHaveBeenCalledWith("file-1", "sam", "responder", "user"));
    expect(await screen.findByText("Sam can now respond")).toBeTruthy();
  });

  it("says when nobody matches a name or an email", async () => {
    hoisted.access.mockResolvedValue(owned([]));
    hoisted.searchGroups.mockRejectedValue(new Error("groups down"));
    openDialog();
    const input = await screen.findByLabelText("Add people or groups");
    fireEvent.change(input, { target: { value: "nobody@example.com" } });
    expect(
      (await screen.findByRole("alert")).textContent,
    ).toBe("No account on this server uses nobody@example.com. Ask them to sign up first.");
    expect((screen.getByRole("button", { name: "Share" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "Zed" } });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("No account on this server matches “Zed”."),
    );
    fireEvent.change(input, { target: { value: "Z" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a failed account search", async () => {
    hoisted.access.mockResolvedValue(owned([]));
    hoisted.accounts.mockRejectedValue(new Error("Search is down."));
    openDialog();
    fireEvent.change(await screen.findByLabelText("Add people or groups"), { target: { value: "ab" } });
    expect((await screen.findByRole("alert")).textContent).toBe("Search is down.");
  });

  it("removes someone and puts their access back with Undo", async () => {
    hoisted.access.mockResolvedValue(
      owned([person("ada", "Ada", "owner"), person("pat", "Pat Lee", "viewer", { email: "pat@x.org" })]),
    );
    openDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Role for Pat Lee" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove access" }));
    expect(screen.getByRole("group", { name: "Access change" }).textContent).toContain(
      "Pat Lee would lose access.",
    );
    apply();
    await waitFor(() => expect(hoisted.share).toHaveBeenCalledWith("file-1", "pat", null, "user"));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Pat Lee no longer has access");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(hoisted.share).toHaveBeenLastCalledWith("file-1", "pat", "viewer", "user"));
    expect(await screen.findByText("Pat Lee has access again")).toBeTruthy();
  });

  it("drops the Undo offer when its time runs out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    hoisted.access.mockResolvedValue(owned([person("pat", "Pat", "editor")]));
    openDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Role for Pat" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove access" }));
    apply();
    await screen.findByRole("button", { name: "Undo" });
    await act(() => vi.advanceTimersByTimeAsync(8100));
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("changes a group's role and says when a pick changes nothing", async () => {
    hoisted.access.mockResolvedValue(
      owned([person("g1", "Gardeners", "viewer", { principalType: "group" })]),
    );
    openDialog();
    expect((await screen.findByText("Gardeners")).parentElement?.textContent).toContain("Group");
    fireEvent.click(screen.getByRole("button", { name: "Role for Gardeners" }));
    fireEvent.click(screen.getByRole("option", { name: /Viewer/ }));
    expect(screen.queryByRole("group", { name: "Access change" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Role for Gardeners" }));
    expect(screen.queryByRole("button", { name: "Make owner" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /Editor/ }));
    apply();
    await waitFor(() => expect(hoisted.share).toHaveBeenCalledWith("file-1", "g1", "editor", "group"));
  });

  it("hands the file over after confirming", async () => {
    hoisted.access.mockResolvedValue(owned([person("pat", "Pat Lee", "editor")]));
    openDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Role for Pat Lee" }));
    fireEvent.click(screen.getByRole("button", { name: /Make owner/ }));
    const confirm = screen.getByRole("group", { name: "Hand over this file" });
    expect(confirm.textContent).toContain("Make Pat Lee the owner?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Hand over this file" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Role for Pat Lee" }));
    fireEvent.click(screen.getByRole("button", { name: /Make owner/ }));
    fireEvent.click(screen.getByRole("button", { name: "Make owner" }));
    await waitFor(() => expect(hoisted.transfer).toHaveBeenCalledWith("file-1", "pat"));
    expect(await screen.findByText("Pat Lee owns this file now")).toBeTruthy();
  });

  it("sets the day access ends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 12, 10));
    hoisted.access.mockResolvedValue(
      owned([person("g1", "Gardeners", "viewer", { principalType: "group" })]),
    );
    openDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Role for Gardeners" }));
    fireEvent.click(screen.getByRole("button", { name: /Access expires/ }));
    expect(screen.getByRole("group", { name: "Access ends for Gardeners" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /October 17$/ })[0]!);
    const iso = new Date(2026, 9, 17).toISOString();
    await waitFor(() => expect(hoisted.expire).toHaveBeenCalledWith("file-1", "g1", iso, "group"));
    expect(await screen.findByText("Gardeners's access ends Saturday")).toBeTruthy();
  });

  it("shows when access ends or ended, and lets an owner remove an ended grant", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 12, 10));
    hoisted.access.mockResolvedValue(
      owned([
        person("pat", "Pat", "viewer", { expiresAt: new Date(2026, 9, 17).toISOString() }),
        person("old", "Old Friend", "viewer", {
          expired: true,
          expiresAt: new Date(2026, 9, 10).toISOString(),
        }),
        person("org", "Whole org", "commenter", {
          principalType: "org",
          inheritedFrom: { id: "f1", name: "Beds" },
        }),
      ]),
    );
    openDialog();
    expect(await screen.findByText("Viewer · until Saturday")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Role for Pat" }).textContent).toContain("until Saturday");
    expect(screen.getByText("Access ended Saturday")).toBeTruthy();
    expect(screen.getByText("from Beds")).toBeTruthy();
    expect(screen.getByText("Commenter")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    apply();
    await waitFor(() => expect(hoisted.share).toHaveBeenCalledWith("file-1", "old", null, "user"));
  });

  it("explains a reader's access instead of offering changes", async () => {
    const notes: Record<string, string> = {
      editor: "You can edit this file. Only the owner can change who has access.",
      responder: "You can sign up on this form. Only the owner can change who has access.",
      commenter: "You can comment on this file. Only the owner can change who has access.",
      viewer: "You can view this file. Only the owner can change who has access.",
      none: "Only the owner can change who has access.",
    };
    for (const [role, note] of Object.entries(notes)) {
      hoisted.access.mockResolvedValue(
        owned([person("pat", "Pat", "viewer")], { yourRole: role === "none" ? undefined : (role as never) }),
      );
      hoisted.explanation.mockResolvedValue({
        role: "viewer",
        reason: { kind: "grant", principalType: "user", principalId: "x", itemId: "i", itemName: "", inherited: false },
        folderChainTruncated: false,
        groupLoops: [],
      });
      openDialog();
      expect(await screen.findByText(note)).toBeTruthy();
      expect(screen.getByText("You were given access on this item as a viewer.")).toBeTruthy();
      expect(screen.queryByLabelText("Add people or groups")).toBeNull();
      cleanup();
    }
  });

  it("opens the parent folder's sharing and comes back", async () => {
    hoisted.access.mockImplementation(async (id: string) =>
      id === "file-1"
        ? owned([person("pat", "Pat", "viewer")], { parent: { id: "f1", name: "Beds" } })
        : owned([person("sam", "Sam", "editor")]),
    );
    openDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Share “Beds”" }));
    expect(await screen.findByRole("heading", { name: "Share “Beds”" })).toBeTruthy();
    expect(await screen.findByText("Sam")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to “Notes”" }));
    expect(await screen.findByRole("heading", { name: "Share “Notes”" })).toBeTruthy();
    expect(await screen.findByText("Pat")).toBeTruthy();
  });

  it("shows a load or share failure", async () => {
    hoisted.access.mockRejectedValueOnce(new Error("No access list."));
    openDialog();
    expect((await screen.findByRole("alert")).textContent).toBe("No access list.");
    cleanup();
    hoisted.access.mockResolvedValue(owned([person("pat", "Pat", "viewer")]));
    hoisted.share.mockRejectedValue("refused");
    openDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Role for Pat" }));
    fireEvent.click(screen.getByRole("option", { name: /Editor/ }));
    apply();
    expect((await screen.findByRole("alert")).textContent).toBe("refused");
  });

  it("closes its role menu on Escape or a click elsewhere, and the dialog on Escape", async () => {
    hoisted.access.mockResolvedValue(owned([person("pat", "Pat", "viewer")]));
    const onClose = openDialog();
    const button = await screen.findByRole("button", { name: "Role for Pat" });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
