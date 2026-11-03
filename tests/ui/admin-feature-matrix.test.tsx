// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const store = new Map<string, string>();
  const memory = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
  Object.defineProperty(globalThis, "localStorage", { value: memory, configurable: true });
});

import { AdminApp } from "../../apps/web/src/admin/Admin";

vi.mock("../../apps/web/src/node-client", () => ({
  adminApi: {
    users: async () => [],
    groups: async () => [],
    backup: async () => ({ configured: false }),
    replication: async () => ({ pending: 0, peers: [] }),
    organizationExport: async () => ({}),
  },
  currentAccount: async () => ({ role: "admin" }),
}));

afterEach(cleanup);

it("shows the feature matrix on the cluster admin page", async () => {
  render(
    <MemoryRouter>
      <AdminApp />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("region", { name: "What SuiteLeaf includes" })).toBeTruthy();
  expect(screen.getByText(/does not publish a hosting price/)).toBeTruthy();
  expect(screen.getByText(/Share a file through SuiteDrive. Requires an account/)).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[$€£]/);
  expect(document.body.textContent).not.toContain("secret-value");
});
