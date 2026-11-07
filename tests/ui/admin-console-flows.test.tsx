// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
  return {
    session: null as null | { user: { id: string; role?: string | null }; idleSecs?: number },
    api: null as unknown as import("vitest").Mock<
      (path: string, init?: RequestInit) => Promise<Response>
    >,
  };
});

const people = () => ({
  u1: {
    user: { id: "u1", name: "Ann", email: "ann@x", username: null, role: "admin", banned: false, createdAt: null },
    groups: [{ id: "g1", name: "Ops" }],
    directGroupIds: ["g1"],
    files: [],
    bytes: 0,
    documents: [],
    signIns: [],
    sessions: [],
    changes: [],
  },
  u2: {
    user: { id: "u2", name: "", email: "bob@x", username: null, role: "user", banned: true, createdAt: null },
    groups: [
      { id: "g1", name: "Ops" },
      { id: "g2", name: "Dev" },
    ],
    directGroupIds: ["g1"],
    files: [
      { id: "f1", name: "Plan.sldoc", size: 2048, via: "owned", groupName: null },
      { id: "f2", name: "Team.slsheet", size: 10, via: "group", groupName: "Ops" },
      { id: "f3", name: "Other.slsheet", size: 10, via: "group", groupName: null },
    ],
    bytes: 2058,
    documents: [{ at: "2026-10-01T00:00:00.000Z", action: "edit", itemId: "f1", name: "Plan.sldoc" }],
    signIns: [{ id: "a1", at: "2026-10-02T00:00:00.000Z", targetId: "s1", name: "1.2.3.4 · Firefox" }],
    sessions: [{ id: "s2", at: "2026-10-03T00:00:00.000Z", ipAddress: "5.6.7.8", userAgent: null }],
    changes: [
      { id: "c1", at: "2026-10-04T00:00:00.000Z", actorId: "u1", action: "user.ban", name: "bob@x" },
      { id: "c2", at: "2026-10-05T00:00:00.000Z", actorId: "u1", action: "user.update", name: "" },
    ],
  },
});

const admin = vi.hoisted(() => {
  const users = [
    { id: "u1", name: "Ann", email: "ann@x", username: null, role: "admin", banned: false, createdAt: null, groups: ["Ops"] },
    { id: "u2", name: "", email: "bob@x", username: null, role: "user", banned: true, createdAt: null },
  ];
  const groups = [
    { id: "g1", name: "Ops", createdAt: "", updatedAt: "" },
    { id: "g2", name: "Dev", createdAt: "", updatedAt: "" },
  ];
  return { users, groups };
});

const detail = (loopPresent = false) => ({
  group: admin.groups[0],
  members: [
    { memberType: "user", memberId: "u1", direct: true },
    { memberType: "group", memberId: "g2", direct: true },
    { memberType: "user", memberId: "gone", direct: true },
  ],
  people: ["u1", "ghost"],
  loopPresent,
});

const adminApi = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    users: fn(),
    groups: fn(),
    user: fn(),
    group: fn(),
    backup: fn(),
    replication: fn(),
    organizationExport: fn(),
    createUser: fn(),
    updateUser: fn(),
    setRole: fn(),
    setBanned: fn(),
    setPassword: fn(),
    revokeSessions: fn(),
    removeUser: fn(),
    createGroup: fn(),
    renameGroup: fn(),
    deleteGroup: fn(),
    addMember: fn(),
    removeMember: fn(),
    memberPlan: fn(),
    editorPolicy: fn(),
    applyEditorPolicy: fn(),
  };
});
const currentAccount = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());

vi.mock("../../apps/web/src/node-client", () => {
  fake.api = vi.fn();
  return {
    adminApi,
    providers: vi.fn(async () => ({inviteOnly:false})),
    api: (path: string, init?: RequestInit) => fake.api(path, init),
    json: (body: unknown) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    currentAccount,
    getSession: () => fake.session,
    onSession: () => () => {},
  };
});
vi.mock("../../apps/web/src/storage", () => ({ download }));

import { AdminApp, AdminScreen } from "../../apps/web/src/admin/Admin";
import { ModeContext } from "../../apps/web/src/mode";

const routes: Record<string, () => Response> = {};
const respond = (path: string, body: unknown, status = 200) =>
  (routes[path] = () => Response.json(body, { status }));

beforeEach(() => {
  const data = people();
  adminApi.users.mockImplementation(async (query = "", group = "") =>
    admin.users.filter(
      (u) => (!query || (u.name || u.email).toLowerCase().includes(query.toLowerCase())) && (!group || group === "g1"),
    ),
  );
  adminApi.groups.mockResolvedValue(admin.groups);
  adminApi.user.mockImplementation(async (id: keyof typeof data) => data[id]);
  adminApi.group.mockResolvedValue(detail());
  adminApi.backup.mockResolvedValue({ configured: false });
  adminApi.replication.mockResolvedValue({ pending: 3, peers: [] });
  adminApi.organizationExport.mockResolvedValue({ users: 2 });
  for (const name of [
    "createUser",
    "updateUser",
    "setRole",
    "setBanned",
    "setPassword",
    "revokeSessions",
    "removeUser",
    "createGroup",
    "renameGroup",
    "deleteGroup",
    "addMember",
    "removeMember",
  ] as const)
    adminApi[name].mockResolvedValue({});
  adminApi.memberPlan.mockResolvedValue({
    groupId: "g1",
    groupName: "Ops",
    changes: [{ principalId: "u2", itemId: "f", itemName: "Plan", before: null, after: "editor" }],
  });
  for (const key of Object.keys(routes)) delete routes[key];
  respond("/api/node/sessions", {
    sessions: [
      { id: "s1", userAgent: "Laptop", current: true },
      { id: "s2", userAgent: "Phone", current: false },
    ],
  });
  respond("/api/drive/people/u2/access", {
    files: [{ itemId: "f1", itemName: "Plan", role: "owner", source: "direct" }],
  });
  fake.api.mockImplementation(async (path: string) => routes[path]?.() ?? Response.json({}));
  fake.session = { user: { id: "u1", role: "admin" } };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderApp = () =>
  render(
    <MemoryRouter>
      <AdminApp />
    </MemoryRouter>,
  );
const peopleList = () => screen.findByRole("list", { name: "People" });

describe("Admin screen access", () => {
  const renderScreen = (cluster: boolean) =>
    render(
      <ModeContext.Provider
        value={{
          mode: cluster ? { kind: "cluster", serverUrl: "https://suite.test" } : { kind: "single" },
          locked: false,
          demo: false,
        }}
      >
        <MemoryRouter initialEntries={["/admin"]}>
          <Routes>
            <Route path="/" element={<p>Home page</p>} />
            <Route path="/admin" element={<AdminScreen />} />
          </Routes>
        </MemoryRouter>
      </ModeContext.Provider>,
    );

  it("sends single-user mode home", () => {
    renderScreen(false);
    expect(screen.getByText("Home page")).toBeTruthy();
  });

  it("checks the account before turning a non-admin away", async () => {
    fake.session = { user: { id: "u2", role: "user" } };
    let answer!: (user: unknown) => void;
    currentAccount.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderScreen(true);
    expect(screen.getByText("Opening Admin…")).toBeTruthy();
    answer({ id: "u2", role: "user" });
    expect(await screen.findByText("You do not have access to Admin.")).toBeTruthy();
  });

  it("opens Admin when the node says the account was promoted", async () => {
    fake.session = { user: { id: "u2", role: "user" } };
    currentAccount.mockResolvedValue({ id: "u2", role: "admin" });
    renderScreen(true);
    expect(await peopleList()).toBeTruthy();
  });

  it("falls back to the saved role when the account check fails", async () => {
    fake.session = { user: { id: "u2", role: null } };
    currentAccount.mockRejectedValue(new Error("offline"));
    renderScreen(true);
    expect(await screen.findByText("You do not have access to Admin.")).toBeTruthy();
  });
});

describe("Admin status cards", () => {
  it("downloads the organization export and shows a failure", async () => {
    renderApp();
    const button = screen.getByRole("button", { name: "Download export" });
    await userEvent.click(button);
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        "suiteleaf-organization-export.json",
        '{"users":2}',
        "application/json",
      ),
    );
    adminApi.organizationExport.mockRejectedValueOnce(new Error("Export failed."));
    await userEvent.click(screen.getByRole("button", { name: "Download export" }));
    const card = screen.getByRole("region", { name: "Organization export" });
    expect(await within(card).findByRole("alert")).toHaveProperty("textContent", "Export failed.");
  });

  it("reports an unreadable backup and unavailable replication", async () => {
    adminApi.backup.mockRejectedValue(new Error("x"));
    adminApi.replication.mockRejectedValue(new Error("x"));
    renderApp();
    expect(await screen.findByText("The backup directory could not be read.")).toBeTruthy();
    expect(await screen.findByText("Replication status is unavailable.")).toBeTruthy();
  });

  it("shows replication counts", async () => {
    renderApp();
    expect(await screen.findByText(/3 operations waiting to apply/)).toBeTruthy();
  });

  it("ends a session and a lost device", async () => {
    respond("/api/node/sessions/lost-device", { ended: 1 });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Sign out Phone" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Sign out Phone" })).toBeNull());
    expect(fake.api).toHaveBeenCalledWith("/api/node/sessions/s2", { method: "DELETE" });
    await userEvent.click(screen.getByRole("button", { name: "Rotate Laptop" }));
    await userEvent.click(screen.getByRole("button", { name: "Ask Laptop to sign in again" }));
    expect(fake.api).toHaveBeenCalledWith("/api/node/sessions/s1/rotate", { method: "POST" });
    expect(fake.api).toHaveBeenCalledWith("/api/node/sessions/s1/reauth", { method: "POST" });
    await userEvent.type(screen.getByRole("textbox", { name: "Lost device name" }), " Laptop ");
    await userEvent.click(screen.getByRole("button", { name: "Sign out that device" }));
    await waitFor(() => expect(screen.queryByText("Laptop")).toBeNull());
  });

  it("keeps the session list when no session matches the lost device", async () => {
    respond("/api/node/sessions/lost-device", { ended: 0 });
    renderApp();
    await userEvent.type(await screen.findByRole("textbox", { name: "Lost device name" }), "Laptop");
    await userEvent.click(screen.getByRole("button", { name: "Sign out that device" }));
    expect(await screen.findByText("No session uses that device name.")).toBeTruthy();
    expect(screen.getByText("Laptop")).toBeTruthy();
  });

  it("shows no sessions when they cannot be read", async () => {
    fake.api.mockRejectedValue(new Error("offline"));
    renderApp();
    expect(await screen.findByText("No sessions.")).toBeTruthy();
  });

  it("reviews and applies the editor policy", async () => {
    adminApi.editorPolicy.mockResolvedValue({ changes: [], effects: [], stamp: "st", recovery: "" });
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Review editor access" }));
    const apply = screen.getAllByRole("button", { name: "Apply reviewed plan" })[0];
    await waitFor(() => expect(apply).toHaveProperty("disabled", false));
    await userEvent.click(apply);
    await waitFor(() => expect(adminApi.applyEditorPolicy).toHaveBeenCalledWith("st"));
  });
});

describe("Admin people", () => {
  it("lists people with their role, status, and groups, and filters them", async () => {
    renderApp();
    const list = await peopleList();
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    expect(list.textContent).toContain("AnnAdmin · Ops");
    expect(list.textContent).toContain("bob@xUser · Disabled");
    await userEvent.type(screen.getByRole("textbox", { name: "Search people" }), "bo");
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(1));
    expect(adminApi.users).toHaveBeenLastCalledWith("bo", "");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Filter by group" }), "g2");
    await waitFor(() => expect(within(list).queryAllByRole("listitem")).toHaveLength(0));
  });

  it("reports a failed search and a failed first load", async () => {
    adminApi.groups.mockRejectedValueOnce(new Error("Admin is unavailable."));
    renderApp();
    expect((await screen.findByRole("alert")).textContent).toBe("Admin is unavailable.");
    adminApi.users.mockRejectedValue(new Error("Search failed."));
    await userEvent.type(screen.getByRole("textbox", { name: "Search people" }), "x");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Search failed."));
  });

  it("creates an account and clears the form", async () => {
    renderApp();
    await peopleList();
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Cy");
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "cy@x");
    await userEvent.type(screen.getByLabelText("Password"), "longpassword");
    await userEvent.click(screen.getByRole("checkbox", { name: "Admin" }));
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() =>
      expect(adminApi.createUser).toHaveBeenCalledWith({
        name: "Cy",
        email: "cy@x",
        password: "longpassword",
        admin: true,
      }),
    );
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", ""));
    expect(screen.getByRole("checkbox", { name: "Admin" })).toHaveProperty("checked", false);

    adminApi.createUser.mockRejectedValueOnce(new Error("Email in use."));
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Cy");
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "cy@x");
    await userEvent.type(screen.getByLabelText("Password"), "longpassword");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Email in use.");
  });

  it("shows a person's files, groups, sign-ins, and admin changes", async () => {
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "bob@x" }));
    expect(await screen.findByRole("heading", { name: "bob@x" })).toBeTruthy();
    const files = screen.getByRole("list", { name: "Files" });
    expect(files.textContent).toContain("Plan.sldocOwns · 2.0 KB");
    expect(files.textContent).toContain("Team.slsheetVia Ops · 10 B");
    expect(files.textContent).toContain("Other.slsheetVia a group · 10 B");
    expect(screen.getByText("Using 2.0 KB.")).toBeTruthy();
    expect(screen.getByText("Direct")).toBeTruthy();
    expect(screen.getByText("Through another group")).toBeTruthy();
    const signIns = within(screen.getByRole("list", { name: "Sign-ins" })).getAllByRole("listitem");
    expect(signIns.map((li) => li.textContent)).toEqual([
      "2026-10-03T00:00:00.000Z5.6.7.8",
      "2026-10-02T00:00:00.000Z1.2.3.4 · Firefox",
    ]);
    const changes = screen.getByRole("list", { name: "Admin changes" });
    expect(changes.textContent).toContain("user.ban · bob@x");
    expect(changes.textContent).toContain("user.update2026");
    expect(screen.getByText("Edited Plan.sldoc")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Files this person can open" }));
    expect(await screen.findByText("Plan as owner.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "All people" }));
    expect(await peopleList()).toBeTruthy();
  });

  it("shows empty trails for a new account", async () => {
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Ann" }));
    expect(await screen.findByText("No sign-ins recorded.")).toBeTruthy();
    expect(screen.getByText("No admin changes yet.")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Who should own their files" })).toBeNull();
  });

  it("edits a person and reloads after each change", async () => {
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "bob@x" }));
    const name = await screen.findByRole("textbox", { name: "Person name" });
    await userEvent.type(name, "Bob");
    await userEvent.click(screen.getByRole("button", { name: "Save person" }));
    await waitFor(() => expect(adminApi.updateUser).toHaveBeenCalledWith("u2", { name: "Bob", email: "bob@x" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role" }), "admin");
    await waitFor(() => expect(adminApi.setRole).toHaveBeenCalledWith("u2", "admin"));
    await userEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(adminApi.setBanned).toHaveBeenCalledWith("u2", false));
    await userEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }));
    await waitFor(() => expect(adminApi.revokeSessions).toHaveBeenCalledWith("u2"));
    const password = screen.getByLabelText("New password");
    await userEvent.type(password, "newpassword");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    await waitFor(() => expect(adminApi.setPassword).toHaveBeenCalledWith("u2", "newpassword"));
    await waitFor(() => expect(password).toHaveProperty("value", ""));
    expect(adminApi.user.mock.calls.length).toBeGreaterThanOrEqual(6);

    adminApi.setRole.mockRejectedValueOnce(new Error("The server needs at least one admin."));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role" }), "user");
    expect((await screen.findByRole("alert")).textContent).toBe("The server needs at least one admin.");
  });

  it("disables an enabled person", async () => {
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Ann" }));
    await userEvent.click(await screen.findByRole("button", { name: "Disable" }));
    await waitFor(() => expect(adminApi.setBanned).toHaveBeenCalledWith("u1", true));
  });

  it("removes an account after choosing who owns its files", async () => {
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "bob@x" }));
    const owner = await screen.findByRole("combobox", { name: "Who should own their files" });
    expect(within(owner).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Choose a person",
      "Ann",
    ]);
    await userEvent.selectOptions(owner, "u1");
    adminApi.removeUser.mockRejectedValueOnce(new Error("Try again."));
    await userEvent.click(screen.getByRole("button", { name: "Remove account" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Try again.");
    await userEvent.click(screen.getByRole("button", { name: "Remove account" }));
    await waitFor(() => expect(adminApi.removeUser).toHaveBeenLastCalledWith("u2", "u1"));
    expect(await peopleList()).toBeTruthy();
  });

  it("removes an account with no files without an owner", async () => {
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Ann" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove account" }));
    await waitFor(() => expect(adminApi.removeUser).toHaveBeenCalledWith("u1", undefined));
  });

  it("says why a person could not be loaded", async () => {
    adminApi.user.mockRejectedValue(new Error("No such person."));
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Ann" }));
    expect((await screen.findByRole("alert")).textContent).toBe("No such person.");
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
});

describe("Admin groups", () => {
  const openGroups = async () => {
    renderApp();
    await peopleList();
    await userEvent.click(screen.getByRole("button", { name: "Groups" }));
    return screen.findByRole("list", { name: "Groups" });
  };

  it("creates a group and reports a failure", async () => {
    await openGroups();
    await userEvent.type(screen.getByRole("textbox", { name: "New group" }), "Sales");
    await userEvent.click(screen.getByRole("button", { name: "Create group" }));
    await waitFor(() => expect(adminApi.createGroup).toHaveBeenCalledWith("Sales"));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "New group" })).toHaveProperty("value", ""));
    adminApi.createGroup.mockRejectedValueOnce(new Error("That name is taken."));
    await userEvent.type(screen.getByRole("textbox", { name: "New group" }), "Ops");
    await userEvent.click(screen.getByRole("button", { name: "Create group" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That name is taken.");
  });

  it("shows members by name and edits the group", async () => {
    adminApi.group.mockResolvedValue(detail(true));
    const list = await openGroups();
    await userEvent.click(within(list).getByRole("button", { name: "Ops" }));
    expect(await screen.findByRole("heading", { name: "Ops" })).toBeTruthy();
    expect(screen.getByText("This group contains a loop. Remove one membership to break it.")).toBeTruthy();
    const members = screen.getByRole("list", { name: "Members" });
    expect(within(members).getAllByRole("listitem").map((li) => li.firstChild!.textContent)).toEqual([
      "Ann",
      "Dev",
      "gone",
    ]);
    expect(screen.getByRole("list", { name: "People in this group" }).textContent).toBe("Annghost");
    expect(
      within(screen.getByRole("combobox", { name: "Add a group" }))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Choose a group", "Dev"]);

    const name = screen.getByRole("textbox", { name: "Group name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Operations");
    await userEvent.click(screen.getByRole("button", { name: "Rename group" }));
    await waitFor(() => expect(adminApi.renameGroup).toHaveBeenCalledWith("g1", "Operations"));

    const removes = within(members).getAllByRole("button", { name: "Remove" });
    await userEvent.click(removes[1]);
    await waitFor(() => expect(adminApi.removeMember).toHaveBeenCalledWith("g1", "group", "g2"));
    await userEvent.click(removes[0]);
    await waitFor(() => expect(adminApi.removeMember).toHaveBeenCalledWith("g1", "user", "u1"));

    const addPerson = screen.getByRole("button", { name: "Add person" });
    expect(addPerson).toHaveProperty("disabled", true);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Add a person" }), "u2");
    await userEvent.click(addPerson);
    await waitFor(() => expect(adminApi.addMember).toHaveBeenCalledWith("g1", "user", "u2"));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Add a group" }), "g2");
    await userEvent.click(screen.getByRole("button", { name: "Add group" }));
    await waitFor(() => expect(adminApi.addMember).toHaveBeenCalledWith("g1", "group", "g2"));

    adminApi.addMember.mockRejectedValueOnce(new Error("That would make a loop."));
    await userEvent.click(screen.getByRole("button", { name: "Add group" }));
    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain("That would make a loop."),
    );
  });

  it("previews and applies a membership plan for a person and a group", async () => {
    const list = await openGroups();
    await userEvent.click(within(list).getByRole("button", { name: "Ops" }));
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Add a person" }), "u2");
    const [personPreview, groupPreview] = screen.getAllByRole("button", { name: "Preview" });
    await userEvent.click(personPreview);
    expect(
      await screen.findByText(
        "Adding bob@x to Ops would change Plan from no role to editor. Nothing is changed.",
      ),
    ).toBeTruthy();
    expect(adminApi.memberPlan).toHaveBeenCalledWith("g1", "u2", true);
    // The first "Apply reviewed plan" belongs to the editor policy review.
    const personApply = screen.getAllByRole("button", { name: "Apply reviewed plan" }).at(-1)!;
    await userEvent.click(personApply);
    expect(await screen.findByText("The reviewed plan was applied.")).toBeTruthy();
    expect(fake.api).toHaveBeenCalledWith(
      "/api/admin/groups/g1/member-commit",
      expect.objectContaining({ method: "POST" }),
    );
    const commit = fake.api.mock.calls.find(([p]) => p.endsWith("member-commit"))!;
    expect(JSON.parse(String(commit[1]?.body))).toEqual({
      memberId: "u2",
      adding: true,
      changes: [{ principalId: "u2", itemId: "f", itemName: "Plan", before: null, after: "editor" }],
    });
    // The reviewed plan is used once.
    await userEvent.click(personApply);
    expect(await screen.findByText("The reviewed plan was not applied.")).toBeTruthy();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Add a group" }), "g2");
    await userEvent.click(groupPreview);
    expect(await screen.findByText(/^Adding Dev to Ops would change/)).toBeTruthy();
    const applies = screen.getAllByRole("button", { name: "Apply reviewed plan" });
    await userEvent.click(applies.at(-1)!);
    await waitFor(() =>
      expect(fake.api.mock.calls.filter(([p]) => p.endsWith("member-commit"))).toHaveLength(2),
    );
    await userEvent.click(applies.at(-1)!);
    await waitFor(() =>
      expect(screen.getAllByText("The reviewed plan was not applied.")).toHaveLength(2),
    );
  });

  it("removes a group and returns to the list, or explains a failure", async () => {
    const list = await openGroups();
    await userEvent.click(within(list).getByRole("button", { name: "Ops" }));
    adminApi.deleteGroup.mockRejectedValueOnce(new Error("Not empty."));
    await userEvent.click(await screen.findByRole("button", { name: "Remove group" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Not empty.");
    await userEvent.click(screen.getByRole("button", { name: "Remove group" }));
    expect(await screen.findByRole("list", { name: "Groups" })).toBeTruthy();
    expect(adminApi.deleteGroup).toHaveBeenLastCalledWith("g1");
  });

  it("goes back to all groups and says why a group could not load", async () => {
    adminApi.group.mockRejectedValueOnce(new Error("Gone."));
    let list = await openGroups();
    await userEvent.click(within(list).getByRole("button", { name: "Dev" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Gone.");
    await userEvent.click(screen.getByRole("button", { name: "Groups" }));
    list = await screen.findByRole("list", { name: "Groups" });
    await userEvent.click(within(list).getByRole("button", { name: "Ops" }));
    await userEvent.click(await screen.findByRole("button", { name: "All groups" }));
    expect(await screen.findByRole("list", { name: "Groups" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "People" }));
    expect(await peopleList()).toBeTruthy();
  });
});
