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
import { GoogleSettings } from "../../apps/web/src/mail/GoogleSettings";
import { GoogleAdministration } from "../../apps/web/src/mail/GoogleAdministration";
import { GoogleSidebar } from "../../apps/web/src/mail/GoogleSidebar";
import { JobList } from "../../apps/web/src/mail/JobList";
import { Conversation } from "../../apps/web/src/mail/Conversation";
import { AttachmentPreview } from "../../apps/web/src/mail/AttachmentPreview";
import {
  PreferencesPanel,
  defaults,
} from "../../apps/web/src/mail/PreferencesPanel";
import { Composer } from "../../apps/web/src/mail/Composer";
import { AccountSettings } from "../../apps/web/src/mail/AccountSettings";
import { MailApp } from "../../apps/web/src/mail/MailApp";
import { GmailViews } from "../../apps/web/src/mail/GmailViews";
import { groupMailRows } from "../../apps/web/src/mail/threading";
import { emptyCompose, type Account } from "../../apps/web/src/mail/client";

const editor = vi.hoisted(() => {
  const chain: any = {};
  for (const key of [
    "focus",
    "toggleBold",
    "toggleItalic",
    "toggleUnderline",
    "toggleBulletList",
    "toggleOrderedList",
    "setLink",
    "unsetAllMarks",
    "clearNodes",
    "undo",
    "redo",
  ])
    chain[key] = vi.fn(() => chain);
  chain.run = vi.fn();
  return { chain, config: undefined as any };
});
vi.mock("@tiptap/react", () => ({
  useEditor: (config: any) => {
    editor.config = config;
    return {
      chain: () => editor.chain,
      isActive: () => false,
      getText: () => "Rich body",
      getHTML: () => "<p><b>Rich body</b></p>",
    };
  },
  EditorContent: () => <div role="textbox" aria-label="Rich message" />,
}));
vi.mock("../../apps/web/src/node-client", () => ({
  getSession: () => ({ url: "https://suite.example", token: "session" }),
  signOut: vi.fn(),
}));
const endpoint = {
  host: "mail.example.com",
  port: 993,
  secure: true,
  user: "ada",
  password: "",
};
const account: Account = {
  id: "a",
  name: "Ada",
  email: "ada@example.com",
  signature: "Regards",
  provider: "gmail",
  oauthConnected: true,
  imap: endpoint,
  smtp: endpoint,
};
const gmail = {
  labels: [{ id: "Label_1", name: "News", type: "user" }],
  filters: [{ id: "filter_1", criteria: { query: "from:news" } }],
  vacation: {
    enableAutoReply: true,
    responseSubject: "Away",
    responseBodyPlainText: "Back soon",
  },
  sendAs: [{ sendAsEmail: "ada@example.com", signature: "Ada" }],
};
const job = {
  id: "job1",
  key: "key1",
  type: "send",
  subject: "Scheduled report",
  dueAt: "2026-12-01T12:00:00Z",
  state: "scheduled",
};
let requests: any[], respond: (body: any) => unknown;
beforeEach(() => {
  requests = [];
  respond = (b) =>
    b.action === "gmailSettings"
      ? gmail
      : b.action === "googleCalendar"
        ? {
            items: [
              {
                id: "e",
                summary: "Standup",
                htmlLink: "https://calendar.google.com/event",
                start: { dateTime: "2026-12-01T12:00:00Z" },
              },
            ],
          }
        : b.action === "googleTasks"
          ? { items: [{ id: "task1", title: "Follow up" }] }
          : b.action === "jobs"
            ? [
                job,
                {
                  ...job,
                  id: "job2",
                  key: "key2",
                  type: "snooze",
                  subject: "Snoozed report",
                  result: "Waiting",
                },
              ]
            : b.action === "conversation"
              ? {
                  total: 25,
                  messages: [
                    {
                      uid: 9,
                      from: "Lin",
                      subject: "Thread",
                      date: "2026-11-01",
                      text: "Earlier message",
                      html: "",
                      attachments: [],
                    },
                  ],
                }
              : b.action === "attachment"
                ? {
                    filename: "note.txt",
                    contentType: "text/plain",
                    content: "SGVsbG8=",
                  }
                : b.action === "rules"
                  ? [
                      {
                        id: "r",
                        name: "Rule",
                        query: "from:news",
                        enabled: true,
                      },
                    ]
                  : b.action === "contacts"
                    ? [{ id: "c", name: "Lin", email: "lin@example.com" }]
                    : b.action === "syncStatus"
                      ? { syncedAt: "2026-11-01", error: "Reconnect required" }
                      : b.action === "preferences"
                        ? defaults
                        : b.action === "templates"
                          ? [{ id: "t", name: "Thanks", text: "Thank you" }]
                          : b.action === "googleContacts"
                            ? [{ name: "Sam", email: "sam@example.com" }]
                            : b.action === "draft"
                              ? { uid: 10, folder: "Drafts", uidValidity: "42" }
                              : b.action === "accounts"
                                ? [account]
                                : b.action === "folders"
                                  ? [
                                      {
                                        path: "INBOX",
                                        name: "Inbox",
                                        selectable: true,
                                      },
                                    ]
                                  : b.action === "list"
                                    ? {
                                        total: 1,
                                        uidValidity: "42",
                                        messages: [
                                          {
                                            uid: 9,
                                            subject: "Hello",
                                            from: [{ name: "Lin" }],
                                            flags: [],
                                          },
                                        ],
                                      }
                                    : b.action === "read"
                                      ? {
                                          uid: 9,
                                          subject: "Hello",
                                          from: "Lin",
                                          text: "Body",
                                          html: "",
                                          attachments: [],
                                        }
                                      : b.action === "googleConnect"
                                        ? {
                                            url: "https://accounts.google.com/authorize",
                                          }
                                        : { ok: true, key: "queued" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return Response.json(await respond(body));
    }),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "prompt").mockReturnValue("Projects");
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const click = (name: string | RegExp) =>
  fireEvent.click(
    screen.getByRole("button", { name, exact: typeof name === "string" }),
  );
const change = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const settled = async () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe("Gmail provider settings", () => {
  it("manages Workspace delegates, verified forwarding and aliases", async () => {
    respond = (body) =>
      body.action === "gmailAdministration"
        ? {
            available: true,
            delegates: [
              {
                delegateEmail: "delegate@example.com",
                verificationStatus: "accepted",
              },
            ],
            forwardingAddresses: [
              {
                forwardingEmail: "forward@example.com",
                verificationStatus: "accepted",
              },
              {
                forwardingEmail: "pending@example.com",
                verificationStatus: "pending",
              },
            ],
            autoForwarding: { enabled: false },
          }
        : { ok: true };
    render(<GoogleAdministration accountId="a" />);
    await screen.findByRole("button", { name: "Add delegate" });
    change("Delegate email", "new@example.com");
    click("Add delegate");
    await settled();
    click("Remove delegate");
    await settled();
    change("New forwarding address", "new-forward@example.com");
    click("Verify forwarding address");
    await settled();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Remove forwarding address" })[1],
    );
    await settled();
    expect(
      within(screen.getByLabelText("Forward to")).queryByText(
        "pending@example.com",
      ),
    ).toBeNull();
    fireEvent.click(screen.getByLabelText("Automatic forwarding"));
    change("Forward to", "forward@example.com");
    change("After forwarding", "archive");
    click("Save forwarding");
    await settled();
    change("Alias email", "alias@example.com");
    change("Alias display name", "Alias");
    click("Create send-as alias");
    await settled();
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "gmailDelegate",
          email: "new@example.com",
        }),
        expect.objectContaining({
          action: "gmailDelegate",
          operation: "delete",
        }),
        expect.objectContaining({
          action: "gmailForwarding",
          operation: "create",
        }),
        expect.objectContaining({
          action: "gmailForwarding",
          operation: "delete",
        }),
        expect.objectContaining({
          action: "gmailForwarding",
          enabled: true,
          email: "forward@example.com",
          disposition: "archive",
        }),
        expect.objectContaining({
          action: "gmailAlias",
          email: "alias@example.com",
          name: "Alias",
        }),
      ]),
    );
    respond = () => {
      throw new Error("Administrator policy denied access");
    };
    click("Create send-as alias");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "policy denied",
    );
  });
  it("manages labels, filters, vacation replies and signatures", async () => {
    render(<GoogleSettings accountId="a" />);
    await screen.findByRole("button", { name: "Rename label" });
    change("New Gmail label", "Projects");
    click("Create label");
    await settled();
    expect(
      requests.some((r) => r.action === "gmailLabel" && r.name === "Projects"),
    ).toBe(true);
    click("Rename label");
    await settled();
    click("Delete label");
    await settled();
    change("Gmail search criteria", "from:news");
    change("Apply label", "Label_1");
    fireEvent.click(screen.getByLabelText("Skip inbox"));
    fireEvent.click(screen.getByLabelText("Mark matching mail read"));
    click("Create filter");
    await settled();
    expect(
      requests.find((r) => r.action === "gmailFilter" && !r.operation),
    ).toMatchObject({
      addLabelIds: ["Label_1"],
      removeLabelIds: ["INBOX", "UNREAD"],
    });
    click("Delete filter");
    await settled();
    fireEvent.click(screen.getByLabelText("Automatic replies enabled"));
    change("Vacation subject", "On leave");
    change("Vacation message", "Back Monday");
    fireEvent.click(screen.getByLabelText("Only reply to contacts"));
    click("Save vacation responder");
    await settled();
    expect(
      requests.some(
        (r) => r.action === "gmailVacation" && r.text === "Back Monday",
      ),
    ).toBe(true);
    fireEvent.blur(screen.getByLabelText("Signature for ada@example.com"), {
      target: { value: "<b>Ada</b>" },
    });
    await settled();
    expect(requests.some((r) => r.action === "gmailSignature")).toBe(true);
  });
  it("reports provider permission and initial load failures", async () => {
    const original = respond;
    respond = (b) => {
      if (b.action === "gmailLabel") throw new Error("Denied");
      return original(b);
    };
    render(<GoogleSettings accountId="a" />);
    await screen.findByRole("button", { name: "Rename label" });
    change("New Gmail label", "Projects");
    click("Create label");
    expect((await screen.findByRole("alert")).textContent).toBe("Denied");
    cleanup();
    respond = () => {
      throw new Error("Settings unavailable");
    };
    render(<GoogleSettings accountId="a" />);
    expect(
      (await screen.findAllByRole("alert")).every(
        (a) => a.textContent === "Settings unavailable",
      ),
    ).toBe(true);
  });
  it("offers OAuth authorization in the system browser and reports errors", async () => {
    render(<AccountSettings onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Also connect Google/));
    click("Connect with Google");
    expect(
      (
        await screen.findByRole("link", { name: "Continue to Google" })
      ).getAttribute("href"),
    ).toBe("https://accounts.google.com/authorize");
    expect(requests.find((r) => r.action === "googleConnect").services).toBe(
      true,
    );
    respond = () => {
      throw new Error("OAuth unavailable");
    };
    click("Connect with Google");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "OAuth unavailable",
    );
  });
  it("shows OAuth account settings without requesting password reentry", async () => {
    render(
      <AccountSettings initial={account} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    await screen.findByText("Gmail settings");
    expect(
      screen.getByRole("button", { name: "Reconnect Google" }),
    ).toBeTruthy();
  });
});

describe("Google sidebar and jobs", () => {
  it("reads Calendar, creates tasks and completes them", async () => {
    const close = vi.fn();
    render(<GoogleSidebar accountId="a" onClose={close} />);
    await screen.findByText("Standup");
    click("Complete Follow up");
    await settled();
    change("New task", "New followup");
    click("Add task");
    await settled();
    expect(
      requests.some(
        (r) => r.action === "googleAddTask" && r.title === "New followup",
      ),
    ).toBe(true);
    click("Close panel");
    expect(close).toHaveBeenCalled();
  });
  it("surfaces integration errors", async () => {
    respond = () => {
      throw new Error("Scope missing");
    };
    render(<GoogleSidebar accountId="a" onClose={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Scope missing",
    );
    change("New task", "Task");
    click("Add task");
    await settled();
    expect(screen.getByRole("alert").textContent).toBe("Scope missing");
  });
  it("lists scheduled and snoozed jobs, cancels and refreshes them", async () => {
    const close = vi.fn();
    render(<JobList accountId="a" onClose={close} />);
    await screen.findByText("Scheduled report");
    click("Cancel send");
    await settled();
    click("Unsnooze now");
    await settled();
    expect(
      requests.filter((r) => r.action === "cancelJob").map((r) => r.key),
    ).toEqual(["key1", "key2"]);
    click("Back to inbox");
    expect(close).toHaveBeenCalled();
  });
  it("handles job load and cancellation failures and empty lists", async () => {
    const original = respond;
    respond = (b) => {
      if (b.action === "cancelJob") throw new Error("Job started");
      return original(b);
    };
    render(<JobList accountId="a" onClose={vi.fn()} />);
    await screen.findByText("Scheduled report");
    click("Cancel send");
    expect((await screen.findByRole("alert")).textContent).toBe("Job started");
    cleanup();
    respond = () => {
      throw new Error("Jobs offline");
    };
    render(<JobList accountId="a" onClose={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Jobs offline");
  });
});

describe("mail reader tools", () => {
  it("groups only provider thread identifiers and exposes Gmail inbox categories", () => {
    const rows = [
      { uid: 3, threadId: "t", subject: "Same", flags: ["\\Seen"] },
      { uid: 2, threadId: "t", subject: "Same", flags: [] },
      { uid: 1, subject: "Same", flags: [] },
    ];
    expect(groupMailRows(rows, true)).toMatchObject([
      { uid: 3, uids: [3, 2], flags: [] },
      { uid: 1, uids: [1] },
    ]);
    expect(groupMailRows(rows, false)).toHaveLength(3);
    const onView = vi.fn();
    render(
      <GmailViews
        disabled={false}
        folders={[
          { path: "All", name: "All", specialUse: "\\All", selectable: true },
        ]}
        onView={onView}
      />,
    );
    for (const name of [
      "Primary",
      "Social",
      "Promotions",
      "Updates",
      "Forums",
      "Starred",
      "Important",
      "All mail",
    ])
      click(name);
    expect(onView).toHaveBeenCalledWith("INBOX", "category:promotions");
    expect(onView).toHaveBeenLastCalledWith("All", "");
  });
  it("paginates conversation messages and keeps HTML sandboxed", async () => {
    render(
      <Conversation accountId="a" folder="INBOX" uidValidity="42" uid={9} />,
    );
    click("Show conversation");
    await screen.findByText("Earlier message");
    click("Later conversation page");
    await screen.findByRole("button", {
      name: "Hide conversation",
      exact: true,
    });
    expect(
      requests.filter((r) => r.action === "conversation").at(-1).page,
    ).toBe(1);
    click("Earlier conversation page");
    await screen.findByRole("button", {
      name: "Hide conversation",
      exact: true,
    });
    click("Hide conversation");
    expect(screen.queryByText("Earlier message")).toBeNull();
    respond = () => {
      throw new Error("Thread gone");
    };
    click("Show conversation");
    expect((await screen.findByRole("alert")).textContent).toBe("Thread gone");
  });
  it("renders HTML conversation bodies", async () => {
    respond = () => ({
      total: 1,
      messages: [
        { uid: 9, subject: "HTML", from: "Lin", html: "<b>Hi</b>", text: "Hi" },
      ],
    });
    render(
      <Conversation accountId="a" folder="INBOX" uidValidity="42" uid={9} />,
    );
    click("Show conversation");
    expect(
      (await screen.findByTitle("Conversation message 9")).getAttribute(
        "sandbox",
      ),
    ).toBe("");
  });
  it("previews text, images and PDFs with cleanup and rejects active content", async () => {
    const attachments = [
      { index: 0, filename: "note.txt", size: 5, contentType: "text/plain" },
    ];
    render(
      <AttachmentPreview
        accountId="a"
        folder="INBOX"
        uidValidity="42"
        uid={9}
        attachments={attachments}
      />,
    );
    change("Preview attachment", "0");
    await screen.findByText("Hello");
    click("Close attachment preview");
    respond = () => ({
      filename: "image.png",
      contentType: "image/png",
      content: "aGk=",
    });
    change("Preview attachment", "0");
    await screen.findByAltText("image.png");
    click("Close attachment preview");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    respond = () => ({
      filename: "doc.pdf",
      contentType: "application/pdf",
      content: "aGk=",
    });
    change("Preview attachment", "0");
    await screen.findByTitle("doc.pdf");
    respond = () => ({
      filename: "active.html",
      contentType: "text/html",
      content: "aGk=",
    });
    change("Preview attachment", "0");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "must be downloaded",
    );
  });
});

describe("composer advanced behavior", () => {
  it("autosaves dirty drafts and deletes their saved copy on discard", async () => {
    vi.useFakeTimers();
    render(
      <Composer
        accountId="a"
        initial={emptyCompose()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    await settled();
    change("Subject", "Autosave");
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(screen.getByRole("status").textContent).toBe("Draft autosaved.");
    change("Message", "More");
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(
      requests.filter((r) => r.action === "draft").at(-1).draftRef.uid,
    ).toBe(10);
    click("Discard");
    await settled();
    expect(requests.find((r) => r.action === "delete")).toMatchObject({
      uids: [10],
      folder: "Drafts",
      uidValidity: "42",
    });
  });
  it("reports autosave and queued-send failures and sends with an undo window", async () => {
    const done = vi.fn(),
      queued = vi.fn();
    render(
      <Composer
        accountId="a"
        initial={{ ...emptyCompose(), to: "lin@example.com" }}
        onClose={vi.fn()}
        onDone={done}
        onQueued={queued}
      />,
    );
    click("Send with 10-second undo");
    await waitFor(() =>
      expect(queued).toHaveBeenCalledWith(
        "queued",
        expect.stringContaining("scheduled"),
      ),
    );
    change("Send later", "2026-12-01T12:00");
    click("Schedule send");
    await waitFor(() => expect(queued).toHaveBeenCalledTimes(2));
    const original = respond;
    respond = (b) => {
      if (b.action === "scheduleSend") throw new Error("Worker missing");
      return original(b);
    };
    click("Schedule send");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Worker missing",
    );
  });
  it("loads contacts, saves/uses/deletes templates and maps rich-format commands", async () => {
    render(
      <Composer
        accountId="a"
        google
        initial={emptyCompose()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    await screen.findByRole("option", { name: "Thanks" });
    await waitFor(() =>
      expect(
        document.querySelector(
          '#mail-contacts option[value="sam@example.com"]',
        ),
      ).toBeTruthy(),
    );
    change("Message template", "t");
    expect(
      (screen.getByLabelText("Message") as HTMLTextAreaElement).value,
    ).toBe("Thank you");
    click("Save as template");
    await settled();
    expect(requests.some((r) => r.action === "saveTemplate")).toBe(true);
    vi.mocked(window.prompt).mockReturnValue("Thanks");
    click("Delete template");
    await settled();
    expect(
      requests.some((r) => r.action === "deleteTemplate" && r.id === "t"),
    ).toBe(true);
    click("Use rich text");
    for (const name of [
      "Bold",
      "Italic",
      "Underline",
      "Bullet list",
      "Numbered list",
      "Clear formatting",
      "Undo",
      "Redo",
    ])
      click(name);
    vi.mocked(window.prompt).mockReturnValue("https://example.com");
    click("Insert link");
    expect(editor.chain.setLink).toHaveBeenCalledWith({
      href: "https://example.com",
    });
    act(() =>
      editor.config.onUpdate({
        editor: {
          getText: () => "Rich body",
          getHTML: () => "<p><b>Rich body</b></p>",
        },
      }),
    );
    click("Use plain text");
    expect(
      (screen.getByLabelText("Message") as HTMLTextAreaElement).value,
    ).toBe("Rich body");
  });
  it("supports initial rich HTML and reports template failures", async () => {
    respond = (b) => {
      if (b.action === "templates") throw new Error("Templates unavailable");
      return [];
    };
    render(
      <Composer
        accountId="a"
        initial={{ ...emptyCompose(), html: "<p>Hello</p>" }}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Templates unavailable",
    );
    expect(editor.config.content).toBe("<p>Hello</p>");
  });
});

describe("mail preferences panel", () => {
  it("saves preferences, rules and contacts", async () => {
    const preferences = vi.fn(),
      close = vi.fn();
    render(
      <PreferencesPanel
        accountId="a"
        preferences={defaults}
        onPreferences={preferences}
        onClose={close}
      />,
    );
    await screen.findByText("Rule");
    fireEvent.click(screen.getByLabelText("Keyboard shortcuts"));
    await waitFor(() => expect(preferences).toHaveBeenCalled());
    change("Density", "compact");
    change("Theme", "dark");
    await settled();
    expect(
      requests.some(
        (r) => r.action === "savePreferences" && r.preferences.theme === "dark",
      ),
    ).toBe(true);
    change("Rule name", "New rule");
    change("Match search", "from:alerts");
    change("Move matching messages to folder", "Alerts");
    fireEvent.click(screen.getByLabelText("Mark read"));
    fireEvent.click(screen.getByLabelText("Star matching messages"));
    click("Create rule");
    await settled();
    click("Disable rule");
    await settled();
    click("Delete rule");
    await settled();
    change("Contact name", "Sam");
    change("Contact email", "sam@example.com");
    click("Save contact");
    await settled();
    click("Delete contact");
    await settled();
    expect(
      requests.some(
        (r) => r.action === "saveContact" && r.email === "sam@example.com",
      ),
    ).toBe(true);
    click("Close preferences");
    expect(close).toHaveBeenCalled();
  });
  it("requests notification permission and surfaces errors", async () => {
    vi.stubGlobal("Notification", {
      requestPermission: vi.fn().mockResolvedValue("denied"),
    });
    render(
      <PreferencesPanel
        accountId="a"
        preferences={defaults}
        onPreferences={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText("Rule");
    fireEvent.click(screen.getByLabelText("New-mail notifications"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "not allowed",
    );
    cleanup();
    respond = () => {
      throw new Error("Settings offline");
    };
    render(
      <PreferencesPanel
        accountId="a"
        preferences={defaults}
        onPreferences={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Settings offline",
    );
    fireEvent.click(screen.getByLabelText("Keyboard shortcuts"));
    await settled();
  });
});

describe("mail app advanced navigation", () => {
  const ready = async () => {
    await waitFor(() =>
      expect(screen.getByLabelText("Messages").getAttribute("aria-busy")).toBe(
        "false",
      ),
    );
    await screen.findByRole("button", { name: /Lin.*Hello/ });
  };
  it("opens jobs, preferences and Google integrations and handles keyboard shortcuts", async () => {
    render(
      <MemoryRouter>
        <MailApp />
      </MemoryRouter>,
    );
    await ready();
    click("Refresh accounts");
    await settled();
    click("Scheduled & snoozed");
    await screen.findByText("Scheduled report");
    click("Back to inbox");
    await ready();
    click("Mail preferences");
    await screen.findByText("Rule");
    click("Close preferences");
    await ready();
    click("Calendar & tasks");
    await screen.findByText("Standup");
    click("Close panel");
    fireEvent.keyDown(document, { key: "/" });
    expect(document.activeElement).toBe(
      screen.getByLabelText("Search this folder"),
    );
    fireEvent.keyDown(document, { key: "c" });
    await screen.findByRole("region", { name: "Compose message" });
    click("Discard");
    await ready();
    fireEvent.click(screen.getByLabelText("Select Hello"));
    click("Apply label");
    await ready();
    expect(requests.some((r) => r.action === "labels" && r.add)).toBe(true);
    fireEvent.click(screen.getByLabelText("Select Hello"));
    click("Remove label");
    await ready();
    vi.mocked(window.prompt).mockReturnValue("2026-12-01T12:00");
    fireEvent.click(screen.getByLabelText("Select Hello"));
    click("Snooze");
    await ready();
    expect(requests.some((r) => r.action === "snooze")).toBe(true);
    fireEvent.keyDown(document, { key: "c" });
    await screen.findByRole("region", { name: "Compose message" });
    change("To", "lin@example.com");
    click("Send with 10-second undo");
    await ready();
    click("Undo send");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("cancelled"),
    );
  });
});
