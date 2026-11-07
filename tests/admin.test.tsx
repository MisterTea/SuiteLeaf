// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  AdminBackButton,
  AdminLink,
  CycleNotice,
  DocumentTrail,
} from "../apps/web/src/admin/admin-view";
import {
  adminDestination,
  documentLabel,
  formatBytes,
  signInRows,
} from "../apps/web/src/admin/admin-model";

afterEach(cleanup);

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
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
    rerender(
      <MemoryRouter>
        <AdminLink cluster role="user" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
    rerender(
      <MemoryRouter>
        <AdminLink cluster role="admin" />
      </MemoryRouter>,
    );
    const button = screen.getByRole("button", { name: "Admin" });
    expect(button.textContent).toBe("");
    expect(button.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });

  it("opens Admin and returns to files using the icon buttons", async () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <h1>Files</h1>
                <AdminLink cluster role="admin" />
              </>
            }
          />
          <Route path="/admin" element={<AdminBackButton />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Admin" }));
    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
    const back = screen.getByRole("button", { name: "Back to files" });
    expect(back.textContent).toBe("");
    expect(back.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    await userEvent.click(back);
    expect(screen.getByRole("heading", { name: "Files" })).toBeTruthy();
  });
});

describe("a person's document trail", () => {
  it("labels opens and edits, and shows a cycle error from the server", () => {
    render(
      <>
        <DocumentTrail
          entries={[
            {
              at: "2026-10-14T12:00:00.000Z",
              action: "edit",
              name: "Watering rota",
            },
            {
              at: "2026-10-14T11:00:00.000Z",
              action: "open",
              name: "Watering rota",
            },
          ]}
        />
        <CycleNotice message="That group is already inside this one, so adding it would make a loop." />
      </>,
    );
    expect(
      screen.getByText(documentLabel("edit", "Watering rota")),
    ).toBeTruthy();
    expect(
      screen.getByText(documentLabel("open", "Watering rota")),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "would make a loop",
    );
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
