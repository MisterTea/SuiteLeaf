// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  providers: vi.fn(),
  api: vi.fn(),
  server: true,
}));
vi.mock("../../apps/web/src/node-client", () => ({
  providers: fake.providers,
  api: fake.api,
}));
vi.mock("../../apps/web/src/mode", () => ({
  useMode: () => ({
    mode: fake.server
      ? { kind: "cluster", serverUrl: "https://suiteleaf.test" }
      : { kind: "single" },
  }),
}));
import { Invitations } from "../../apps/web/src/admin/invitations";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  fake.server = true;
});
it("only offers invitation links on invite-only servers", async () => {
  fake.providers.mockResolvedValue({ inviteOnly: false });
  const view = render(<Invitations />);
  await waitFor(() => expect(fake.providers).toHaveBeenCalled());
  expect(screen.queryByText("Invite a person")).toBeNull();
  view.unmount();
  fake.server = false;
  render(<Invitations />);
  expect(screen.queryByText("Invite a person")).toBeNull();
});
it("creates an invitation without choosing the person's password", async () => {
  fake.providers.mockResolvedValue({ inviteOnly: true });
  fake.api.mockResolvedValue(
    Response.json({ url: "https://suiteleaf.test/#/?invite=private" }),
  );
  render(<Invitations />);
  await screen.findByText("Invite a person");
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "person@example.com" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Create invitation link" }),
  );
  const link = (await screen.findByLabelText(
    "Invitation link",
  )) as HTMLInputElement;
  expect(link.value).toBe("https://suiteleaf.test/#/?invite=private");
  expect(link.readOnly).toBe(true);
  expect(fake.api).toHaveBeenCalledWith(
    "/api/admin/invitations",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "person@example.com" }),
    }),
  );
  fireEvent.focus(link);
  expect(link.selectionStart).toBe(0);
});
it("shows creation errors and permits another attempt", async () => {
  fake.providers.mockResolvedValue({ inviteOnly: true });
  fake.api.mockRejectedValue(new Error("Server unavailable"));
  render(<Invitations />);
  await screen.findByText("Invite a person");
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "person@example.com" },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Create invitation link" })
      .closest("form")!,
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Server unavailable",
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Create invitation link",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});
it("handles an unavailable provider endpoint and a late unmounted response", async () => {
  fake.providers.mockRejectedValue(new Error("offline"));
  const first = render(<Invitations />);
  await waitFor(() => expect(fake.providers).toHaveBeenCalled());
  first.unmount();
  let finish: (value: unknown) => void = () => {};
  fake.providers.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const second = render(<Invitations />);
  second.unmount();
  finish({ inviteOnly: true });
  await Promise.resolve();
  expect(screen.queryByText("Invite a person")).toBeNull();
});
