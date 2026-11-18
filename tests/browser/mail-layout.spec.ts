import { test, expect, type Page } from "@playwright/test";

async function openMail(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "suiteleaf:node-session",
      JSON.stringify({
        url: location.origin,
        token: "layout-session",
        user: { id: "ada", name: "Ada", email: "ada@example.com" },
      }),
    );
    // Exercise the real embedded UI with a deterministic native bridge.
    (window as any).supermail = {
      isElectron: true,
      invoke: async () => null,
      db: {
        select: async (sql: string) => {
          if (sql.includes("FROM _migrations")) return [{ version: 999 }];
          if (sql.includes("FROM settings")) return [{ value: "false" }];
          return [];
        },
        execute: async () => ({ rowsAffected: 1, lastInsertId: 1 }),
      },
    };
  });
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json:
        new URL(route.request().url()).pathname === "/api/node/info"
          ? { name: "SuiteLeaf node", mode: "cluster", auth: { enabled: true } }
          : {},
    }),
  );
  await page.goto("/#/mail");
  await expect(
    page.getByRole("button", { name: "Compose", exact: true }),
  ).toBeVisible();
}

test("embedded Mail composer and settings fit narrow and desktop viewports", async ({
  page,
}) => {
  await openMail(page);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    const compose =
      width >= 768
        ? page.getByRole("button", { name: "Compose", exact: true })
        : page.getByTitle("Compose Email");
    await expect(compose).toBeInViewport();
    await compose.click();
    await expect(
      page.getByPlaceholder("Subject", { exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Send", exact: true }),
    ).toBeInViewport();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    await page.getByRole("button", { name: "×", exact: true }).click();
    await page
      .getByRole("button", { name: "Settings", exact: true })
      .filter({ visible: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    await expect(page).toHaveURL(/#\/mail$/);
    await expect(page.getByTitle("Back to Inbox")).toBeInViewport();
    await page.getByTitle("Back to Inbox").click();
  }
});

test("embedded Mail preserves real keyboard formatting while composing", async ({
  page,
}) => {
  await openMail(page);
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page
    .getByPlaceholder("Subject", { exact: true })
    .fill("Project update");
  const body = page.locator(".tiptap[contenteditable=true]");
  await body.click();
  await body.press("ControlOrMeta+b");
  await body.pressSequentially("Important");
  await body.press("ControlOrMeta+b");
  await body.press("Enter");
  await body.pressSequentially("Please review");
  await expect(body.locator("strong")).toHaveText("Important");
  await expect(body).toContainText("Please review");
});
