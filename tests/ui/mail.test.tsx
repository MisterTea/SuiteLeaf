// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { MailApp, MailRoute } from "../../apps/web/src/mail/MailApp";
import {
  AccountSettings,
  newAccount,
} from "../../apps/web/src/mail/AccountSettings";
import { Composer } from "../../apps/web/src/mail/Composer";
import {
  MessageView,
  safeEmailHtml,
} from "../../apps/web/src/mail/MessageView";
import {
  downloadAttachment,
  emptyCompose,
  mailCall,
  replyTo,
  type Account,
  type Message,
} from "../../apps/web/src/mail/client";
import { ModeContext } from "../../apps/web/src/mode";

const state = vi.hoisted(() => ({
  session: { url: "https://suite.example", token: "session" } as any,
}));
vi.mock("../../apps/web/src/node-client", () => ({
  getSession: () => state.session,
  signOut: vi.fn(),
}));
const account: Account = {
  id: "a",
  name: "Ada",
  email: "ada@example.com",
  signature: "Regards",
  imap: {
    host: "imap.example.com",
    port: 993,
    secure: true,
    user: "ada",
    password: "",
  },
  smtp: {
    host: "smtp.example.com",
    port: 587,
    secure: false,
    user: "ada",
    password: "",
  },
};
const message: Message = {
  uid: 9,
  subject: "Project",
  from: "Lin <lin@example.com>",
  to: { text: "ada@example.com", value: [{ address: "ada@example.com" }] },
  cc: { text: "sam@example.com", value: [{ address: "sam@example.com" }] },
  messageId: "<id@example.com>",
  references: ["<root@example.com>"],
  date: "2026-10-01T12:00:00Z",
  text: "Hello\nWorld",
  html: "",
  attachments: [
    {
      index: 0,
      filename: "report.pdf",
      contentType: "application/pdf",
      size: 2048,
    },
  ],
};
const folders = [
  { path: "INBOX", name: "Inbox", selectable: true, unseen: 2 },
  ...["Drafts", "Sent", "Archive", "Trash", "Junk"].map((name) => ({
    path: name,
    name,
    selectable: true,
    specialUse: `\\${name}`,
  })),
];
const rows = [
  {
    uid: 9,
    subject: "Project",
    from: [{ name: "Lin", address: "lin@example.com" }],
    date: message.date,
    flags: [],
  },
  {
    uid: 8,
    subject: "Earlier",
    from: [{ address: "sam@example.com" }],
    flags: ["\\Seen", "\\Flagged"],
  },
];
let requests: any[];
let respond: (body: any) => unknown;
beforeEach(() => {
  state.session = { url: "https://suite.example", token: "session" };
  requests = [];
  respond = (body) =>
    body.action === "accounts"
      ? [account]
      : body.action === "folders"
        ? folders
        : body.action === "list"
          ? { total: 65, uidValidity: "42", messages: rows }
          : body.action === "read"
            ? message
            : body.action === "attachment"
              ? {
                  filename: "report.pdf",
                  contentType: "application/pdf",
                  content: "aGk=",
                }
              : body.action === "saveAccount"
                ? { ...body.account, id: "a" }
                : { ok: true };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      const data = await respond(body);
      return Response.json(data);
    }),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "prompt").mockReturnValue("Projects");
  vi.spyOn(window, "print").mockImplementation(() => {});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:download"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

it("downloads original mail and blocks senders through the appropriate server rule", async () => {
  const original = respond;
  respond = (b) =>
    b.action === "original"
      ? {
          filename: "message.eml",
          contentType: "message/rfc822",
          content: "aGk=",
        }
      : original(b);
  const props = {
    accountId: "a",
    folder: "INBOX",
    uidValidity: "42",
    message: { ...message, senderAddress: "lin@example.com" },
    onReply: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<MessageView {...props} />);
  click("Download original");
  await waitFor(() =>
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled(),
  );
  click("Block sender");
  await screen.findByText(/Sender blocked/);
  expect(requests.find((r) => r.action === "saveRule")).toMatchObject({
    rule: {
      query: "from:lin@example.com",
      moveTo: "SuiteLeaf Blocked",
      enabled: true,
    },
  });
  view.rerender(<MessageView {...props} gmail />);
  click("Block sender");
  await waitFor(() =>
    expect(requests.some((r) => r.action === "gmailFilter")).toBe(true),
  );
  expect(requests.find((r) => r.action === "gmailFilter")).toMatchObject({
    query: "from:lin@example.com",
    addLabelIds: ["TRASH"],
    removeLabelIds: ["INBOX"],
  });
  respond = () => {
    throw new Error("Provider unavailable");
  };
  click("Download original");
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Provider unavailable",
  );
  click("Block sender");
  await waitFor(() =>
    expect(requests.filter((r) => r.action === "gmailFilter")).toHaveLength(2),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const app = () =>
  render(
    <MemoryRouter>
      <MailApp />
    </MemoryRouter>,
  );
const ready = async () => {
  await waitFor(() =>
    expect(screen.getByLabelText("Messages").getAttribute("aria-busy")).toBe(
      "false",
    ),
  );
  await screen.findByRole("button", { name: /Lin.*Project/ });
};
const click = (name: string | RegExp) =>
  fireEvent.click(
    (name === "Archive" || name === "Trash"
      ? within(screen.getByLabelText("Message actions"))
      : screen
    ).getAllByRole("button", { name, exact: typeof name === "string" })[0],
  );
const change = (name: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });

describe("mail frontend boundary", () => {
  it("gates standalone mode", () => {
    render(
      <MemoryRouter>
        <MailRoute />
      </MemoryRouter>,
    );
    expect(screen.getByText("Mail requires server mode")).toBeTruthy();
  });
  it("gates server mode through the mail route", async () => {
    render(
      <ModeContext.Provider
        value={{
          mode: { kind: "cluster", serverUrl: "https://suite.example" },
          locked: true,
          demo: false,
        }}
      >
        <MemoryRouter>
          <MailRoute />
        </MemoryRouter>
      </ModeContext.Provider>,
    );
    await ready();
  });
  it("uses the session token and reports malformed and rejected responses", async () => {
    await mailCall("accounts");
    expect(fetch).toHaveBeenCalledWith(
      "https://suite.example/api/auth/suiteleaf/mail",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer session" }),
      }),
    );
    state.session = null;
    await expect(mailCall("accounts")).rejects.toThrow("Sign in");
    state.session = { url: "https://suite.example", token: "s" };
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: "Denied" }, { status: 403 }),
    );
    await expect(mailCall("list")).rejects.toThrow("Denied");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("invalid", { status: 500 }),
    );
    await expect(mailCall("list")).rejects.toThrow("invalid response");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 500 }));
    await expect(mailCall("list")).rejects.toThrow("Mail request failed");
  });
  it("builds replies with recipients, references, quotes and signatures", () => {
    expect(replyTo(message, account, "reply")).toMatchObject({
      to: message.from,
      subject: "Re: Project",
      inReplyTo: message.messageId,
      references: ["<root@example.com>", message.messageId],
    });
    expect(replyTo(message, account, "all").cc).toBe("sam@example.com");
    expect(replyTo(message, account, "forward")).toMatchObject({
      to: "",
      subject: "Fwd: Project",
    });
    expect(
      replyTo(
        {
          ...message,
          subject: "Re: Project",
          references: "root",
          replyTo: "reply@example.com",
        },
        { ...account, signature: "" },
        "reply",
      ),
    ).toMatchObject({
      subject: "Re: Project",
      to: "reply@example.com",
      references: ["root", message.messageId],
    });
    expect(
      replyTo(
        {
          ...message,
          from: undefined,
          messageId: undefined,
          references: undefined,
          date: undefined,
        },
        account,
        "reply",
      ).references,
    ).toEqual([]);
  });
  it("downloads attachments as files and revokes blob URLs", () => {
    vi.useFakeTimers();
    downloadAttachment({
      filename: "report.pdf",
      contentType: "application/pdf",
      content: "aGk=",
    });
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:download");
    vi.useRealTimers();
  });
  it("sanitizes active HTML, CSS tracking, SVG, remote and inline images", () => {
    const html =
      '<script>alert(1)</script><form><input></form><img src="https://tracker.example/pixel" onerror="alert(1)" srcset="https://evil/x"><img src="data:image/png;base64,aGk="><img src="data:image/svg+xml;base64,aGk="><img><a href="javascript:alert(1)" style="background:url(https://evil/x)">link</a><svg onload="alert(1)"></svg>';
    const output = safeEmailHtml(html, false);
    const doc = new DOMParser().parseFromString(output, "text/html");
    expect(doc.querySelector("script,form,input,svg")).toBeNull();
    expect(doc.body.innerHTML).not.toContain("https://tracker");
    expect(doc.body.innerHTML).not.toContain("onerror");
    expect(doc.body.innerHTML).not.toContain("background");
    expect(doc.querySelectorAll("img")[1].src).toContain("data:image/png");
    expect(doc.querySelector("a")?.getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
    expect(safeEmailHtml(html, true)).toContain(
      'src="https://tracker.example/pixel"',
    );
  });
});

describe("mail settings and message tools", () => {
  it("edits both connection settings and verifies before saving", async () => {
    const onSaved = vi.fn(),
      onClose = vi.fn();
    render(<AccountSettings onSaved={onSaved} onClose={onClose} />);
    change("Display name", "Ada");
    change("Email address", "ada@example.com");
    change("Signature", "Thanks");
    for (const name of ["IMAP", "SMTP"]) {
      const section = within(screen.getByRole("group", { name }));
      for (const [label, value] of [
        ["Host", "mail.example.com"],
        ["Port", "465"],
        ["Username", "ada"],
        ["Password or app password", "secret"],
      ])
        fireEvent.change(section.getByLabelText(label), { target: { value } });
      fireEvent.click(section.getByLabelText(/Implicit TLS/));
    }
    click("Test connections and save");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests[0].account.smtp.password).toBe("secret");
    expect(requests[0].account.signature).toBe("Thanks");
    click("Close settings");
    expect(onClose).toHaveBeenCalled();
  });
  it("keeps existing passwords blank and reports connection failure", async () => {
    respond = () => {
      throw new Error("Connection refused");
    };
    render(
      <AccountSettings initial={account} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    click("Test connections and save");
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Connection refused",
    );
    expect(
      screen.getAllByPlaceholderText("Leave blank to keep password"),
    ).toHaveLength(2);
    expect(newAccount().imap.port).toBe(993);
  });
  it("composes, attaches, removes, saves drafts, sends and handles failures", async () => {
    const onDone = vi.fn();
    const onClose = vi.fn();
    const view = render(
      <Composer
        accountId="a"
        initial={emptyCompose()}
        onDone={onDone}
        onClose={onClose}
      />,
    );
    for (const [label, value] of [
      ["To", "lin@example.com"],
      ["Cc", "cc@example.com"],
      ["Bcc", "bcc@example.com"],
      ["Subject", "Hello"],
      ["Message", "Body"],
    ])
      change(label, value);
    fireEvent.change(screen.getByLabelText(/Attach files/), {
      target: {
        files: [new File(["hello"], "data.txt", { type: "text/plain" })],
      },
    });
    await screen.findByRole("button", { name: "Remove data.txt" });
    click("Remove data.txt");
    expect(screen.queryByText("data.txt")).toBeNull();
    click("Save draft");
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("Draft saved."));
    click("Send");
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("Message sent."));
    expect(requests.find((r) => r.action === "send").message.bcc).toBe(
      "bcc@example.com",
    );
    respond = () => {
      throw new Error("Offline");
    };
    click("Save draft");
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Offline",
    );
    click("Discard");
    expect(onClose).toHaveBeenCalled();
    view.unmount();
    render(
      <Composer
        accountId="a"
        initial={emptyCompose()}
        onDone={onDone}
        onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Attach files/), {
      target: {
        files: Array.from({ length: 31 }, () => new File(["x"], "x.txt")),
      },
    });
    expect(screen.getByRole("alert").textContent).toContain("30 attachments");
  });
  it("shows provider warnings and file read errors", async () => {
    const onDone = vi.fn();
    respond = () => ({ warning: "Sent copy failed" });
    render(
      <Composer
        accountId="a"
        initial={{ ...emptyCompose(), to: "a@b.com" }}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );
    click("Send");
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith("Sent copy failed"),
    );
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(
      function (this: FileReader) {
        this.dispatchEvent(new Event("error"));
      },
    );
    fireEvent.change(screen.getByLabelText(/Attach files/), {
      target: { files: [new File(["x"], "x")] },
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not read",
    );
  });
  it("renders safe HTML, toggles images, downloads, replies and prints", async () => {
    const onReply = vi.fn(),
      onClose = vi.fn();
    render(
      <MessageView
        accountId="a"
        folder="INBOX"
        uidValidity="42"
        message={{
          ...message,
          html: '<p>Hello<img src="https://example.com/a.png"></p>',
        }}
        onReply={onReply}
        onClose={onClose}
      />,
    );
    expect(
      screen.getByTitle("Email content").getAttribute("sandbox"),
    ).not.toContain("allow-scripts");
    click("Show remote images");
    expect(screen.getByTitle("Email content").getAttribute("srcdoc")).toContain(
      'src="https://example.com/a.png"',
    );
    click("Hide remote images");
    click(/report.pdf/);
    await waitFor(() =>
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled(),
    );
    for (const name of ["Reply", "Reply all", "Forward"]) click(name);
    expect(onReply.mock.calls.map((c) => c[0])).toEqual([
      "reply",
      "all",
      "forward",
    ]);
    click("Print");
    expect(window.print).toHaveBeenCalled();
    click("Back to messages");
    expect(onClose).toHaveBeenCalled();
    respond = () => {
      throw new Error("Missing attachment");
    };
    click(/report.pdf/);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Missing attachment",
    );
  });
});

describe("mail workspace", () => {
  it("handles empty accounts, settings, saves and disconnects", async () => {
    const original = respond;
    respond = (b) => (b.action === "accounts" ? [] : original(b));
    app();
    await screen.findByText("A home for your email.");
    click("Connect email account");
    expect(screen.getByRole("region", { name: "Mail settings" })).toBeTruthy();
    click("Close settings");
    click("Add account");
    click("Close settings");
    click("Mail settings");
    click("Close settings");
    cleanup();
    respond = original;
    app();
    await ready();
    click("Mail settings");
    click("Test connections and save");
    await ready();
    expect(screen.getByRole("status").textContent).toContain("verified");
    click("Disconnect account");
    await screen.findByText("A home for your email.");
    expect(requests.some((r) => r.action === "removeAccount")).toBe(true);
  });
  it("searches, paginates, switches folders, bulk acts and stars", async () => {
    app();
    await ready();
    change("Search this folder", "is:unread");
    click("Search");
    await ready();
    expect(requests.filter((r) => r.action === "list").at(-1).query).toBe(
      "is:unread",
    );
    click("Next");
    await ready();
    expect(requests.filter((r) => r.action === "list").at(-1).page).toBe(1);
    click("Previous");
    await ready();
    click("Refresh");
    await ready();
    for (const name of [
      "Archive",
      "Trash",
      "Spam",
      "Mark read",
      "Mark unread",
      "Delete forever",
    ]) {
      fireEvent.click(screen.getByLabelText("Select all messages"));
      click(name);
      await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
      await ready();
    }
    expect(
      requests.filter((r) => r.action === "move").map((r) => r.destination),
    ).toEqual(["Archive", "Trash", "Junk"]);
    for (const label of ["Move to", "Copy to folder"]) {
      fireEvent.click(screen.getByLabelText("Select Project"));
      change(label, "Drafts");
      await ready();
    }
    click("Star Project");
    await ready();
    click("Unstar Earlier");
    await ready();
    expect(requests.filter((r) => r.action === "flags").at(-1).add).toBe(false);
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Mail folders" }),
      ).getByRole("button", { name: "Drafts" }),
    );
    await ready();
    expect(requests.filter((r) => r.action === "list").at(-1).folder).toBe(
      "Drafts",
    );
  });
  it("reads, replies, forwards attachments and saves from composer", async () => {
    app();
    await ready();
    click(/Lin.*Project/);
    await screen
      .findByText("Hello World", { exact: false })
      .catch(() => screen.getByText(/Hello/));
    click("Reply all");
    await screen.findByRole("region", { name: "Compose message" });
    expect((screen.getByLabelText("Cc") as HTMLInputElement).value).toBe(
      "sam@example.com",
    );
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    click("Discard");
    click("Forward");
    await screen.findByRole("button", { name: "Remove report.pdf" });
    click("Save draft");
    await ready();
    expect(screen.getByRole("status").textContent).toBe("Draft saved.Dismiss");
    click(/Lin.*Project/);
    await screen.findByRole("button", { name: "Reply", exact: true });
    click("Reply");
    await screen.findByRole("region", { name: "Compose message" });
    click("Send");
    await ready();
  });
  it("edits a provider draft and removes old copy only after saving succeeds", async () => {
    app();
    await ready();
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Mail folders" }),
      ).getByRole("button", { name: "Drafts" }),
    );
    await ready();
    click(/Lin.*Project/);
    await screen.findByRole("button", { name: "Edit draft" });
    click("Edit draft");
    await screen.findByRole("region", { name: "Compose message" });
    expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe(
      "ada@example.com",
    );
    click("Save draft");
    await ready();
    expect(requests.find((r) => r.action === "delete")).toMatchObject({
      folder: "Drafts",
      uidValidity: "42",
      uids: [9],
    });
  });
  it("creates, renames and deletes folders without changing folder on failure", async () => {
    app();
    await ready();
    click("New folder");
    await ready();
    expect(requests.some((r) => r.action === "createFolder")).toBe(true);
    click("Rename folder");
    await ready();
    expect(requests.filter((r) => r.action === "list").at(-1).folder).toBe(
      "Projects",
    );
    click("Delete folder");
    await ready();
    expect(requests.filter((r) => r.action === "list").at(-1).folder).toBe(
      "INBOX",
    );
    const original = respond;
    respond = (b) => {
      if (b.action === "renameFolder") throw new Error("Rename failed");
      return original(b);
    };
    click("Rename folder");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Rename failed",
    );
    expect(requests.filter((r) => r.action === "list").at(-1).folder).toBe(
      "INBOX",
    );
    click("Dismiss");
  });
  it("handles read, folder, list and initial account errors", async () => {
    const original = respond;
    respond = (b) => {
      if (b.action === "read") throw new Error("Read failed");
      return original(b);
    };
    app();
    await ready();
    click(/Lin.*Project/);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Read failed",
    );
    click("Dismiss");
    cleanup();
    respond = (b) => {
      if (b.action === "list") throw new Error("List failed");
      return original(b);
    };
    app();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "List failed",
    );
    cleanup();
    respond = (b) => {
      if (b.action === "folders") throw new Error("Folders failed");
      return original(b);
    };
    app();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Folders failed",
    );
    cleanup();
    respond = () => {
      throw new Error("Accounts failed");
    };
    app();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Accounts failed",
    );
  });
  it("reports absent special folders and no matching results", async () => {
    const original = respond;
    respond = (b) => (b.action === "folders" ? [folders[0]] : original(b));
    app();
    await ready();
    fireEvent.click(screen.getByLabelText("Select Project"));
    click("Archive");
    expect(screen.getByRole("alert").textContent).toContain("does not expose");
    click("Dismiss");
    respond = (b) =>
      b.action === "list"
        ? { total: 0, uidValidity: "42", messages: [] }
        : original(b);
    change("Search this folder", "missing");
    click("Search");
    await screen.findByText("No messages match your search.");
    change("Search this folder", "");
    click("Search");
    await screen.findByText("This folder is empty.");
  });
});
