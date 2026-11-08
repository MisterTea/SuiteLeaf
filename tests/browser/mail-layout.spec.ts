import { test, expect } from "@playwright/test";

test("Mail list, composer and settings fit narrow and desktop viewports", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "suiteleaf:node-session",
      JSON.stringify({
        url: location.origin,
        token: "layout-session",
        user: { id: "ada", name: "Ada" },
      }),
    ),
  );
  const endpoint = {
    host: "mail.example.com",
    port: 993,
    secure: true,
    user: "ada",
    password: "",
  };
  const account = {
    id: "a",
    name: "Ada",
    email: "ada@example.com",
    signature: "Regards",
    imap: endpoint,
    smtp: endpoint,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/node/info")
      return route.fulfill({
        json: {
          name: "SuiteLeaf node",
          mode: "cluster",
          auth: { enabled: true },
        },
      });
    if (path === "/api/auth/suiteleaf/mail") {
      const body = route.request().postDataJSON();
      const result =
        body.action === "accounts"
          ? [account]
          : body.action === "folders"
            ? [
                { path: "INBOX", name: "Inbox", selectable: true, unseen: 4 },
                ...["Drafts", "Sent", "Archive", "Trash"].map((name) => ({
                  path: name,
                  name,
                  selectable: true,
                  specialUse: `\\${name}`,
                })),
              ]
            : body.action === "list"
              ? {
                  total: 24,
                  uidValidity: "42",
                  messages: Array.from({ length: 24 }, (_, i) => ({
                    uid: 24 - i,
                    subject: `A project update with a long subject ${i}`,
                    from: [{ name: "A colleague with a long name" }],
                    date: "2026-11-07T12:00:00Z",
                    flags: i % 2 ? ["\\Seen"] : [],
                  })),
                }
              : body.action === "read"
                ? {
                    uid: body.uid,
                    subject:
                      "A long message subject that should wrap at narrow widths",
                    from: "colleague@example.com",
                    senderAddress: "colleague@example.com",
                    to: { text: account.email },
                    text: "A readable message",
                    html: "",
                    attachments: [
                      {
                        index: 0,
                        filename: "a-long-report-attachment-name.pdf",
                        contentType: "application/pdf",
                        size: 2048,
                      },
                    ],
                  }
                : { ok: true };
      return route.fulfill({ json: result });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/#/mail");
  await expect(page.locator(".mail-row")).toHaveCount(24);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    const main = (await page.locator(".mail-main").boundingBox())!;
    const sidebar = (await page.locator(".mail-sidebar").boundingBox())!;
    if (width > 600)
      expect(main.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width - 1);
    else expect(main.y).toBeGreaterThanOrEqual(sidebar.y + sidebar.height - 1);
    await page.locator(".mail-row-open").first().click();
    await page
      .getByRole("button", { name: "Forward", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Reply all", exact: true }),
    ).toBeInViewport();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    await page
      .getByRole("button", { name: "Back to messages", exact: true })
      .click();
    await page.getByRole("button", { name: "＋ Compose", exact: true }).click();
    await page
      .getByRole("button", { name: "Send", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Send", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeInViewport();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await page
      .getByRole("button", { name: "Mail settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Test connections and save" })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Test connections and save" }),
    ).toBeInViewport();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    await page
      .getByRole("button", { name: "Close settings", exact: true })
      .click();
    await page.locator(".mail-main").scrollIntoViewIfNeeded();
    if (width === 1440 || width === 390)
      await page.screenshot({
        path: `output/mail-${width}.png`,
        fullPage: true,
      });
  }
});

test("Rich mail preserves real keyboard formatting in the submitted MIME content", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "suiteleaf:node-session",
      JSON.stringify({
        url: location.origin,
        token: "typing-session",
        user: { id: "ada", name: "Ada" },
      }),
    ),
  );
  let sent: { text: string; html: string } | undefined;
  const endpoint = {
    host: "mail.example.com",
    port: 993,
    secure: true,
    user: "ada",
    password: "",
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/node/info")
      return route.fulfill({
        json: {
          name: "SuiteLeaf node",
          mode: "cluster",
          auth: { enabled: true },
        },
      });
    if (path === "/api/auth/suiteleaf/mail") {
      const b = route.request().postDataJSON();
      if (b.action === "send") sent = b.message;
      return route.fulfill({
        json:
          b.action === "accounts"
            ? [
                {
                  id: "a",
                  name: "Ada",
                  email: "ada@example.com",
                  signature: "",
                  imap: endpoint,
                  smtp: endpoint,
                },
              ]
            : b.action === "folders"
              ? [{ path: "INBOX", name: "Inbox", selectable: true }]
              : b.action === "list"
                ? { total: 0, uidValidity: "42", messages: [] }
                : b.action === "contacts" || b.action === "templates"
                  ? []
                  : { ok: true },
      });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/#/mail");
  await page.getByRole("button", { name: "＋ Compose", exact: true }).click();
  await page.getByLabel("To", { exact: true }).fill("lin@example.com");
  await page
    .getByRole("button", { name: "Use rich text", exact: true })
    .click();
  const body = page.getByRole("textbox", { name: "Rich message", exact: true });
  await body.click();
  await body.press("ControlOrMeta+b");
  await body.pressSequentially("Important");
  await body.press("ControlOrMeta+b");
  await body.press("Enter");
  await body.pressSequentially("Please review");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => sent?.text).toContain("Please review");
  expect(sent?.html).toContain("<strong>Important</strong>");
});
