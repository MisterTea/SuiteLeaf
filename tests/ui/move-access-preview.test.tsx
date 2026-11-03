// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AccessGrant } from "../../apps/web/src/node-client";
import { MoveDialog } from "../../apps/web/src/drive/MoveDialog";

const state = vi.hoisted(() => ({
  updates: [] as string[],
  fail: false,
  changed: false,
}));

function grant(id: string, name: string, inherited: boolean, expired = false): AccessGrant {
  return {
    principalType: "user",
    principalId: id,
    role: "editor",
    name,
    email: null,
    inheritedFrom: inherited ? { id: "old-folder", name: "Old" } : null,
    expired,
  };
}

vi.mock("../../apps/web/src/node-client", () => ({
  drive: {
    listFolders: async () => [{ id: "folder-beds", name: "Beds", parentId: null }],
    access: async (id: string) => {
      if (state.fail) throw new Error("secret-value");
      if (id === "file-notes") {
        return {
          grants: [
            grant("sam", "Sam", true),
            grant("ada", "Ada", false),
            grant("gone", "Expired", true, true),
            grant("secret-value", "", true),
          ],
          parent: null,
          yourRole: "owner",
        };
      }
      return {
        grants: state.changed
          ? [grant("priya", "Priya", false), grant("noor", "Noor", false)]
          : [grant("priya", "Priya", false)],
        parent: null,
        yourRole: "owner",
      };
    },
    update: async (id: string) => {
      state.updates.push(id);
      return { id, name: "Notes", parentId: "folder-beds", parentName: "Beds", kind: "file" };
    },
  },
}));

afterEach(cleanup);
beforeEach(() => {
  state.updates = [];
  state.fail = false;
  state.changed = false;
});

function open() {
  render(
    <MoveDialog
      item={{ id: "file-notes", name: "Notes", parentId: null, kind: "file" }}
      currentName="My Drive"
      includeMyDrive={false}
      onClose={() => {}}
      onMoved={() => {}}
    />,
  );
}

it("shows who would gain or lose access and moves only while that plan holds", async () => {
  open();
  fireEvent.click(await screen.findByRole("button", { name: "Beds" }));
  const dialog = await screen.findByRole("dialog", { name: "Move" });
  await waitFor(() => expect(dialog.textContent).toContain("This move changes who has access."));
  expect(dialog.textContent).toContain("Priya would gain access.");
  expect(dialog.textContent).toContain("Sam would lose access.");
  expect(dialog.textContent).not.toContain("secret-value");
  expect(dialog.textContent).not.toContain("Expired");
  fireEvent.click(screen.getByRole("button", { name: "Move here" }));
  await waitFor(() => expect(state.updates).toEqual(["file-notes"]));
});

it("does not move when access changes after the preview", async () => {
  open();
  fireEvent.click(await screen.findByRole("button", { name: "Beds" }));
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "Move" }).textContent).toContain("Priya would gain access."),
  );
  state.changed = true;
  fireEvent.click(screen.getByRole("button", { name: "Move here" }));
  const dialog = screen.getByRole("dialog", { name: "Move" });
  await waitFor(() => expect(dialog.textContent).toContain("The access plan changed. Review it again."));
  expect(dialog.textContent).not.toContain("secret-value");
  expect(state.updates).toEqual([]);
});

it("does not repeat an access error", async () => {
  state.fail = true;
  open();
  fireEvent.click(await screen.findByRole("button", { name: "Beds" }));
  const dialog = screen.getByRole("dialog", { name: "Move" });
  await waitFor(() => expect(dialog.textContent).toContain("The access plan could not be read."));
  expect(dialog.textContent).not.toContain("secret-value");
  expect(state.updates).toEqual([]);
});
