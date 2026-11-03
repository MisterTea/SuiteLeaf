// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { shareChangePreview } from "../../apps/web/src/drive/share-change";
import { ShareDialog } from "../../apps/web/src/drive/ShareDialog";

const shared = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("../../apps/web/src/node-client", () => ({
  getSession: () => ({ user: { id: "ada" } }),
  drive: {
    access: async () => ({
      grants: [
        {
          principalType: "user",
          principalId: "secret-value",
          role: "editor",
          name: "Priya",
          email: null,
          inheritedFrom: null,
          expired: false,
        },
      ],
      parent: null,
      yourRole: "owner",
    }),
    explanation: async () => null,
    accounts: async () => [],
    searchGroups: async () => [],
    share: async (_id: string, principalId: string, role: string | null) => {
      shared.calls.push(`${principalId}:${role}`);
    },
  },
}));

afterEach(cleanup);
beforeEach(() => {
  shared.calls = [];
});

it("names a real role change and hides a role that is not one", () => {
  expect(shareChangePreview({ name: "Priya", fromRole: "editor", toRole: "viewer" })).toEqual({
    note: "Priya would change from editor to viewer.",
    changes: true,
  });
  const hidden = shareChangePreview({
    name: "Priya",
    fromRole: "secret-value",
    toRole: null,
  });
  expect(hidden.note).toBe("Priya would lose access.");
  expect(hidden.note).not.toContain("secret-value");
  expect(shareChangePreview({ name: "   ", fromRole: null, toRole: "editor" }).note).toBe(
    "Someone would gain editor access.",
  );
  expect(shareChangePreview({ name: "Priya", fromRole: "responder", toRole: "editor" }).note).toBe(
    "Priya would change from responder to editor.",
  );
  expect(shareChangePreview({ name: "Priya", fromRole: "owner", toRole: "editor" }).note).toBe(
    "Priya would change from owner to editor.",
  );
  const unnamed = shareChangePreview({ name: "Priya", fromRole: "secret-value", toRole: "editor" });
  expect(unnamed.note).toBe("Priya would change from another role to editor.");
  expect(unnamed.note).not.toContain("secret-value");
});

it("waits to share until the access change is applied", async () => {
  render(<ShareDialog itemId="file-notes" itemName="Notes" kind="doc" onClose={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Role for Priya" }));
  fireEvent.click(screen.getByRole("option", { name: /Viewer/ }));
  expect(await screen.findByText("Priya would change from editor to viewer.")).toBeTruthy();
  expect(document.body.textContent).not.toContain("secret-value");
  expect(shared.calls).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Apply this access change" }));
  await waitFor(() => expect(shared.calls).toEqual(["secret-value:viewer"]));
});
