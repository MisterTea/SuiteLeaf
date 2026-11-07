// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  listeners: new Set<(s: unknown) => void>(),
  ended: null as null | string,
  providers: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  completeHandoff: vi.fn(),
  probeServer: vi.fn(),
  switchMode: vi.fn(),
  hosts: {} as Record<string, () => { snapshot: () => string; tools: { name: string }[] }>,
  signInTools: vi.fn((ctx: unknown) => {
    hoisted.signInCtx = ctx as never;
    return [];
  }),
  signInCtx: null as null | {
    host: string;
    signedIn: () => boolean;
    canLeave: boolean;
    leave: () => Promise<void>;
  },
}));

vi.mock("../../apps/web/src/node-client", () => ({
  getSession: () => hoisted.session,
  onSession: (listener: (s: unknown) => void) => {
    hoisted.listeners.add(listener);
    return () => void hoisted.listeners.delete(listener);
  },
  providers: hoisted.providers,
  sessionEndReason: () => hoisted.ended,
  signIn: hoisted.signIn,
  signUp: hoisted.signUp,
  completeHandoff: hoisted.completeHandoff,
  socialStartUrl: (url: string, provider: string) => `${url}/start/${provider}`,
}));
vi.mock("../../apps/web/src/mode", () => ({
  probeServer: hoisted.probeServer,
  switchMode: hoisted.switchMode,
}));
vi.mock("../../apps/web/src/ai/host", () => ({
  useAgentHost: (id: string, build: () => never) => {
    hoisted.hosts[id] = build;
  },
}));
vi.mock("../../apps/web/src/ai/tools/cluster", () => ({
  signInSnapshot: (host: string) => `Sign in on ${host}`,
  signInTools: hoisted.signInTools,
}));
vi.mock("../../apps/web/src/ai/AgentSidebar", () => ({
  AiButton: () => <button aria-label="AI assistant">AI</button>,
}));

import { ConnectDialog, SignInScreen, useNodeSession } from "../../apps/web/src/drive/SignIn";

const server = "https://drive.example";

beforeEach(() => {
  hoisted.session = null;
  hoisted.ended = null;
  hoisted.listeners.clear();
  for (const fn of [
    hoisted.providers,
    hoisted.signIn,
    hoisted.signUp,
    hoisted.completeHandoff,
    hoisted.probeServer,
    hoisted.switchMode,
  ])
    fn.mockReset();
  hoisted.providers.mockResolvedValue({ providers: [] });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ peers: [] })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.suiteleaf;
});

describe("useNodeSession", () => {
  it("follows sign-in and sign-out", () => {
    const { result } = renderHook(() => useNodeSession());
    expect(result.current).toBeNull();
    act(() => hoisted.listeners.forEach((l) => l({ user: { id: "ada" } })));
    expect(result.current).toEqual({ user: { id: "ada" } });
  });
});

describe("SignInScreen", () => {
  it("signs in with the typed name and password", async () => {
    hoisted.signIn.mockResolvedValue(undefined);
    render(<SignInScreen serverUrl={server} />);
    const submit = screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    expect(screen.getByRole("heading").textContent).toBe("Sign indrive.example");
    expect(screen.queryByRole("button", { name: "AI assistant" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Email or username"), { target: { value: " ada " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "garden-path" } });
    fireEvent.submit(screen.getByRole("form", { name: "Sign in to SuiteLeaf" }));
    await waitFor(() => expect(hoisted.signIn).toHaveBeenCalledWith(server, "ada", "garden-path"));
    const build = hoisted.hosts.signin!();
    expect(build.snapshot()).toBe("Sign in on drive.example");
    expect(hoisted.signInCtx).toMatchObject({ host: "drive.example", canLeave: false });
    expect(hoisted.signInCtx!.signedIn()).toBe(false);
    await expect(hoisted.signInCtx!.leave()).resolves.toBeUndefined();
  });

  it("creates an account, naming it after the username when no name is given", async () => {
    hoisted.signUp.mockRejectedValue(new Error("That email is taken."));
    render(<SignInScreen serverUrl={server} />);
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByRole("heading").textContent).toContain("Create an account");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@x.org" } });
    fireEvent.change(screen.getByLabelText("Username (optional)"), { target: { value: "ada" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "garden-path" } });
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() =>
      expect(hoisted.signUp).toHaveBeenCalledWith(server, {
        name: "ada",
        email: "ada@x.org",
        username: "ada",
        password: "garden-path",
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe("That email is taken.");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Ada L " } });
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(hoisted.signUp.mock.calls[1]![1].name).toBe("Ada L"));
    fireEvent.click(screen.getByRole("button", { name: "I have an account" }));
    expect(screen.getByLabelText("Email or username")).toBeTruthy();
  });

  it("says why the last session ended", () => {
    for (const [reason, text] of [
      ["signed-out", "You signed out of drive.example. Your SuiteDrive files stay on the server."],
      ["idle", "This device is idle. Sign in again. Changes you made are safe on this device."],
      [
        "expired",
        "Your session ended. Sign in again to keep working in SuiteDrive. Changes you made are safe on this device.",
      ],
    ]) {
      hoisted.ended = reason!;
      render(<SignInScreen serverUrl={server} />);
      expect(screen.getByRole("status").textContent).toBe(text);
      cleanup();
    }
  });

  it("mentions the shared accounts of a clustered server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ peers: ["b"] })));
    render(<SignInScreen serverUrl={server} />);
    expect(await screen.findByText(/shares accounts and files/)).toBeTruthy();
  });

  it("continues with a social provider in the desktop window or the browser", async () => {
    hoisted.providers.mockResolvedValue({ providers: ["github", "sso"] });
    const authWindow = vi.fn(async () => "one-time");
    window.suiteleaf = { authWindow } as never;
    render(<SignInScreen serverUrl={server} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue with GitHub" }));
    await waitFor(() => expect(hoisted.completeHandoff).toHaveBeenCalledWith(server, "one-time"));
    expect(authWindow).toHaveBeenCalledWith(`${server}/start/github`);
    authWindow.mockResolvedValueOnce(null as never);
    fireEvent.click(screen.getByRole("button", { name: "Continue with sso" }));
    await waitFor(() => expect(authWindow).toHaveBeenCalledTimes(2));
    expect(hoisted.completeHandoff).toHaveBeenCalledTimes(1);
  });

  it("shows a server that offers no sign-in, and leaves for this computer", async () => {
    hoisted.providers.mockRejectedValue(new Error("This node does not offer sign-in."));
    const onDisconnect = vi.fn(async () => {});
    render(<SignInScreen serverUrl={server} onDisconnect={onDisconnect} />);
    expect((await screen.findByRole("alert")).textContent).toBe("This node does not offer sign-in.");
    expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Work on this computer without a server" }));
    await waitFor(() => expect(onDisconnect).toHaveBeenCalled());
    hoisted.hosts.signin!();
    expect(hoisted.signInCtx!.canLeave).toBe(true);
    await hoisted.signInCtx!.leave();
    expect(onDisconnect).toHaveBeenCalledTimes(2);
  });
});

describe("ConnectDialog", () => {
  it("switches to a server that answers", async () => {
    hoisted.probeServer.mockResolvedValue("https://drive.example");
    render(<ConnectDialog onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Server address"), { target: { value: "drive.example" } });
    fireEvent.submit(screen.getByRole("dialog", { name: "Connect to a SuiteLeaf server" }));
    await waitFor(() =>
      expect(hoisted.switchMode).toHaveBeenCalledWith({ kind: "cluster", serverUrl: "https://drive.example" }),
    );
    expect(hoisted.probeServer).toHaveBeenCalledWith("drive.example");
    expect(screen.getByRole("button", { name: "Connecting…" })).toBeTruthy();
  });

  it("shows why a server could not be used and closes", async () => {
    hoisted.probeServer.mockRejectedValue(new Error("No SuiteLeaf server answered at that address."));
    const onClose = vi.fn();
    render(<ConnectDialog onClose={onClose} />);
    fireEvent.submit(screen.getByRole("dialog"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "No SuiteLeaf server answered at that address.",
    );
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(document.querySelector(".modal-overlay")!);
    expect(onClose).toHaveBeenCalledTimes(4);
  });
});
