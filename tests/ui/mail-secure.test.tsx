// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { PublicMail } from "../../apps/web/src/mail/PublicMail";
import { ConfidentialManager } from "../../apps/web/src/mail/ConfidentialManager";
import { MailAssistant } from "../../apps/web/src/mail/MailAssistant";
import { Composer } from "../../apps/web/src/mail/Composer";
import { emptyCompose } from "../../apps/web/src/mail/client";
const fake = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("../../apps/web/src/mail/assistant", () => ({
  generateMailText: fake.generate,
}));
vi.mock("../../apps/web/src/node-client", () => ({
  getSession: () => ({ url: "https://suite.example", token: "session" }),
}));
let requests: any[], respond: (body: any) => unknown;
const secure = {
  sender: "Ada <ada@example.com>",
  subject: "Secure report",
  text: "Protected body",
  html: "",
  expiresAt: Date.now() + 86400000,
  attachments: [],
};
beforeEach(() => {
  requests = [];
  respond = (b) =>
    b.action === "confidentialItems"
      ? [
          {
            key: "secure",
            subject: "Secure report",
            state: "active",
            expiresAt: Date.now() + 86400000,
          },
        ]
      : b.action === "contacts" || b.action === "templates"
        ? []
        : b.action
          ? { ok: true }
          : secure;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return Response.json(await respond(body));
    }),
  );
  fake.generate.mockReset().mockResolvedValue("Suggested reply");
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name, exact: true }));
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const openPublic = () =>
  render(
    <MemoryRouter initialEntries={["/confidential/test-token"]}>
      <Routes>
        <Route path="/confidential/:token" element={<PublicMail />} />
      </Routes>
    </MemoryRouter>,
  );
describe("secure message recipient page", () => {
  it("checks revocation while open and clears the recipient's passcode", async () => {
    vi.useFakeTimers();
    openPublic();
    change("Message passcode", "out-of-band");
    click("Open secure message");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Protected body")).toBeTruthy();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: "Revoked" }, { status: 403 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(requests[0].passcode).toBe("out-of-band");
    expect(screen.queryByText("Protected body")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("revoked");
    expect(
      (screen.getByLabelText("Message passcode") as HTMLInputElement).value,
    ).toBe("");
  });
  it("requires a passcode, renders the message without a SuiteLeaf session and locks it", async () => {
    openPublic();
    change("Message passcode", "out-of-band");
    click("Open secure message");
    await screen.findByText("Protected body");
    expect(requests[0]).toEqual({
      token: "test-token",
      passcode: "out-of-band",
    });
    expect(vi.mocked(fetch).mock.calls[0][1]?.credentials).toBe("omit");
    click("Lock message");
    expect(screen.queryByText("Protected body")).toBeNull();
    expect(
      (screen.getByLabelText("Message passcode") as HTMLInputElement).value,
    ).toBe("");
  });
  it("sanitizes HTML, denies failed access and clears expired messages", async () => {
    respond = () => ({
      ...secure,
      html: "<p>Body</p><script>alert(1)</script>",
    });
    openPublic();
    change("Message passcode", "passcode");
    click("Open secure message");
    const frame = await screen.findByTitle("Secure message content");
    expect(frame.getAttribute("srcdoc")).not.toContain("<script>");
    expect(frame.getAttribute("sandbox")).toBe("");
    click("Lock message");
    change("Message passcode", "passcode");
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: "Expired" }, { status: 403 }),
    );
    click("Open secure message");
    expect((await screen.findByRole("alert")).textContent).toBe("Expired");
    cleanup();
    vi.useFakeTimers();
    respond = () => ({ ...secure, expiresAt: Date.now() + 1000 });
    openPublic();
    change("Message passcode", "passcode");
    click("Open secure message");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(1001));
    expect(screen.queryByText("Protected body")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("expired");
  });
  it("lets the sender revoke a link and reports failures", async () => {
    const close = vi.fn();
    render(<ConfidentialManager accountId="a" onClose={close} />);
    await screen.findByText("Secure report");
    click("Revoke access");
    await waitFor(() =>
      expect(requests.some((r) => r.action === "revokeConfidential")).toBe(
        true,
      ),
    );
    click("Close expiring messages");
    expect(close).toHaveBeenCalled();
    cleanup();
    respond = () => {
      throw new Error("Unavailable");
    };
    render(<ConfidentialManager accountId="a" onClose={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Unavailable");
  });
});
describe("mail suggestions and expiring composition", () => {
  it("reviews, inserts, discards and cancels assistant suggestions", async () => {
    const insert = vi.fn();
    render(<MailAssistant text="Original" onInsert={insert} />);
    fireEvent.click(screen.getByText("SuiteLeaf writing assistant"));
    change("Writing task", "translate");
    change("Instructions (include a language for translation)", "French");
    click("Generate suggestion");
    await screen.findByText("Suggested reply");
    expect(fake.generate).toHaveBeenCalledWith(
      "translate",
      "Original",
      "French",
      expect.any(AbortSignal),
    );
    click("Use suggestion");
    expect(insert).toHaveBeenCalledWith("Suggested reply");
    click("Discard suggestion");
    expect(screen.queryByText("Suggested reply")).toBeNull();
    fake.generate.mockImplementation(
      (_task, _text, _instruction, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () =>
            reject(new Error("Cancelled")),
          ),
        ),
    );
    click("Generate suggestion");
    click("Cancel suggestion");
    expect((await screen.findByRole("alert")).textContent).toBe("Cancelled");
  });
  it("sends secure links with expiry and passcode and keeps content out of ordinary SMTP", async () => {
    const done = vi.fn();
    render(
      <Composer
        accountId="a"
        initial={{ ...emptyCompose(), to: "lin@example.com", text: "Original" }}
        onClose={vi.fn()}
        onDone={done}
      />,
    );
    fireEvent.click(
      screen.getByLabelText("Send as an expiring, passcode-protected link"),
    );
    change("Secure message passcode", "separate-passcode");
    change("Access expires after", "30");
    expect(
      (
        screen.getByRole("button", {
          name: "Save draft",
          exact: true,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    click("Send");
    await waitFor(() =>
      expect(done).toHaveBeenCalledWith(
        expect.stringContaining("Share the passcode"),
      ),
    );
    expect(requests.find((r) => r.action === "confidentialSend")).toMatchObject(
      { passcode: "separate-passcode", message: { text: "Original" } },
    );
    expect(requests.some((r) => r.action === "send")).toBe(false);
  });
  it("inserts a reviewed suggestion into the composer", async () => {
    render(
      <Composer
        accountId="a"
        initial={emptyCompose()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("SuiteLeaf writing assistant"));
    click("Generate suggestion");
    await screen.findByText("Suggested reply");
    click("Use suggestion");
    expect(
      (screen.getByLabelText("Message") as HTMLTextAreaElement).value,
    ).toBe("Suggested reply");
  });
});
