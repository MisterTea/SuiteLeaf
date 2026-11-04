// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedMode } from "../../apps/web/src/mode";

const fake = vi.hoisted(() => ({
  mode: { mode: { kind: "single" }, locked: false, demo: false } as ResolvedMode,
  session: null as null | { url: string },
  handoffUrl: null as string | null,
  completeHandoff: vi.fn(async () => ({})),
  finishSignOut: vi.fn(async () => {}),
  disconnectFromServer: vi.fn(async () => {}),
  signInProps: null as null | { serverUrl: string; onDisconnect?: () => void },
}));

vi.mock("../../apps/web/src/node-client", () => ({
  completeHandoff: fake.completeHandoff,
  finishSignOut: fake.finishSignOut,
  pendingHandoffUrl: () => fake.handoffUrl,
}));
vi.mock("../../apps/web/src/mode", async (load) => ({
  ...(await load<typeof import("../../apps/web/src/mode")>()),
  resolveMode: async () => fake.mode,
}));
vi.mock("../../apps/web/src/drive/SignIn", () => ({
  useNodeSession: () => fake.session,
  SignInScreen: (props: { serverUrl: string; onDisconnect?: () => void }) => {
    fake.signInProps = props;
    return <p>Sign in to {props.serverUrl}</p>;
  },
}));
vi.mock("../../apps/web/src/drive/drive-files", () => ({
  disconnectFromServer: fake.disconnectFromServer,
}));
vi.mock("../../apps/web/src/sign-up", () => ({
  default: ({ token }: { token: string }) => <p>Sign-up {token}</p>,
}));
vi.mock("../../apps/web/src/admin/Admin", () => ({ AdminScreen: () => <p>Admin screen</p> }));
vi.mock("../../apps/web/src/ai/AgentSidebar", () => ({ AgentLayer: () => null }));
vi.mock("../../apps/web/src/templates/gallery", () => ({ TemplateGallery: () => <p>Gallery</p> }));
vi.mock("../../apps/web/src/home/LocalHome", () => ({ LocalHome: () => <p>Local home</p> }));
vi.mock("../../apps/web/src/home/ClusterHome", () => ({
  ClusterHome: ({ serverUrl }: { serverUrl: string }) => <p>Cluster home {serverUrl}</p>,
}));
vi.mock("../../apps/web/src/workspace/Workspace", async () => {
  const { useParams } = await import("react-router-dom");
  return {
    Workspace: () => {
      const { id, slideId } = useParams();
      return <p>{`Workspace ${id} ${slideId ?? ""}`}</p>;
    },
  };
});
vi.mock("../../apps/web/src/document-settings", () => ({
  DocumentSettings: () => null,
  SettingsPage: () => <p>Settings page</p>,
}));

import App from "../../apps/web/src/App";

const cluster: ResolvedMode = {
  mode: { kind: "cluster", serverUrl: "https://suite.test" },
  locked: false,
  demo: false,
};

async function show(hash: string, path = "/") {
  window.history.replaceState(null, "", `${path}#${hash}`);
  render(<App />);
  await act(async () => {});
}

beforeEach(() => {
  fake.mode = { mode: { kind: "single" }, locked: false, demo: false };
  fake.session = null;
  fake.handoffUrl = null;
  fake.signInProps = null;
  delete window.suiteleaf;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("app routes", () => {
  it("opens the local home after finishing a pending sign-out", async () => {
    await show("/");
    expect(screen.getByText("Local home")).toBeTruthy();
    expect(fake.finishSignOut).toHaveBeenCalled();
  });

  it("opens files, templates, settings, and Admin", async () => {
    await show("/file/abc/s2");
    expect(screen.getByText("Workspace abc s2")).toBeTruthy();
    cleanup();
    await show("/templates");
    expect(screen.getByText("Gallery")).toBeTruthy();
    cleanup();
    await show("/settings");
    expect(screen.getByText("Settings page")).toBeTruthy();
    cleanup();
    await show("/admin");
    expect(screen.getByText("Admin screen")).toBeTruthy();
  });

  it("serves a public sign-up page without resolving a mode", async () => {
    await show("/", "/sign-up/a%20b/");
    expect(screen.getByText("Sign-up a b")).toBeTruthy();
    expect(fake.finishSignOut).not.toHaveBeenCalled();
    cleanup();
    await show("/", "/sign-up/%E0%A4%A");
    expect(screen.getByText("Local home")).toBeTruthy();
  });

  it("asks for sign-in to the server before showing cluster pages", async () => {
    fake.mode = cluster;
    await show("/");
    expect(screen.getByText("Sign in to https://suite.test")).toBeTruthy();
    fake.signInProps!.onDisconnect!();
    expect(fake.disconnectFromServer).toHaveBeenCalledWith("https://suite.test");
    cleanup();
    fake.session = { url: "https://suite.test" };
    await show("/");
    expect(screen.getByText("Cluster home https://suite.test")).toBeTruthy();
  });

  it("offers no disconnect when the server mode is locked", async () => {
    fake.mode = { ...cluster, locked: true };
    await show("/");
    expect(fake.signInProps!.onDisconnect).toBeUndefined();
  });

  it("disconnects from the desktop menu and reports a failure", async () => {
    fake.mode = cluster;
    fake.session = { url: "https://suite.test" };
    let menu: (action: string) => void = () => {};
    const stop = vi.fn();
    window.suiteleaf = {
      onMenu: (callback: (action: string) => void) => {
        menu = callback;
        return stop;
      },
    } as never;
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    await show("/");
    menu("save");
    expect(fake.disconnectFromServer).not.toHaveBeenCalled();
    fake.disconnectFromServer.mockRejectedValueOnce(new Error("Upload first."));
    await act(async () => menu("disconnect"));
    expect(alert).toHaveBeenCalledWith("Upload first.");
    cleanup();
    expect(stop).toHaveBeenCalled();
  });
});

describe("social sign-in hand-off", () => {
  it("completes the hand-off with the pending server and goes home", async () => {
    fake.handoffUrl = "https://suite.test";
    await show("/auth-complete?token=t1");
    expect(fake.completeHandoff).toHaveBeenCalledWith("https://suite.test", "t1");
    expect(screen.getByText("Local home")).toBeTruthy();
  });

  it("uses the connected server and reports a failed hand-off once", async () => {
    fake.mode = cluster;
    fake.completeHandoff.mockRejectedValueOnce(new Error("Token expired."));
    await show("/auth-complete?token=t2");
    expect(screen.getByRole("heading", { name: "Sign-in did not complete" })).toBeTruthy();
    expect(screen.getByText("Token expired.")).toBeTruthy();
    expect(fake.completeHandoff).toHaveBeenCalledWith("https://suite.test", "t2");
    cleanup();
    await show("/auth-complete?token=t2");
    expect(screen.getByText("Signing you in…")).toBeTruthy();
    expect(fake.completeHandoff).toHaveBeenCalledTimes(1);
  });

  it("explains a hand-off with no server and goes home without a token", async () => {
    await show("/auth-complete?token=t3");
    expect(screen.getByText("This app is not connected to a SuiteLeaf server.")).toBeTruthy();
    await userEvent.click(screen.getByRole("link", { name: "Return to files" }));
    expect(screen.getByText("Local home")).toBeTruthy();
    cleanup();
    await show("/auth-complete");
    expect(screen.getByText("Local home")).toBeTruthy();
  });
});
