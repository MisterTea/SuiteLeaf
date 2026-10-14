// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AdminLink, CycleNotice, DocumentTrail } from "../apps/web/src/admin/admin-view";
import {
  adminDestination,
  documentLabel,
  formatBytes,
  signInRows,
} from "../apps/web/src/admin/admin-model";

describe("admin access", () => {
  it("hides Admin outside cluster mode and for someone who is not an admin", () => {
    expect(adminDestination(false, "admin")).toBe("home");
    expect(adminDestination(true, "user")).toBe("denied");
    expect(adminDestination(true, null)).toBe("denied");
    expect(adminDestination(true, "admin")).toBe("admin");
    const { rerender } = render(
      <MemoryRouter>
        <AdminLink cluster={false} role="admin" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    rerender(
      <MemoryRouter>
        <AdminLink cluster role="user" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    rerender(
      <MemoryRouter>
        <AdminLink cluster role="admin" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Admin" })).toBeTruthy();
  });
});

describe("a person's document trail", () => {
  it("labels opens and edits, and shows a cycle error from the server", () => {
    render(
      <>
        <DocumentTrail
          entries={[
            { at: "2026-10-14T12:00:00.000Z", action: "edit", name: "Watering rota" },
            { at: "2026-10-14T11:00:00.000Z", action: "open", name: "Watering rota" },
          ]}
        />
        <CycleNotice message="That group is already inside this one, so adding it would make a loop." />
      </>,
    );
    expect(screen.getByText(documentLabel("edit", "Watering rota"))).toBeTruthy();
    expect(screen.getByText(documentLabel("open", "Watering rota"))).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("would make a loop");
  });

  it("keeps a sign-in after the session row is gone", () => {
    const rows = signInRows(
      [],
      [
        {
          id: "audit-1",
          at: "2026-10-14T09:00:00.000Z",
          targetId: "session-1",
          name: "127.0.0.1 · Firefox",
        },
      ],
    );
    expect(rows).toEqual([
      {
        id: "audit-1",
        at: "2026-10-14T09:00:00.000Z",
        detail: "127.0.0.1 · Firefox",
      },
    ]);
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
});
