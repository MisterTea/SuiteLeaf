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
  // The mock DB has no mail accounts, so SuperMail opens Add Account on
  // startup. Dismiss it so Compose and the layout under test are reachable.
  const addAccount = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(addAccount.getByRole("heading", { name: "Add Account" })).toBeVisible({
    timeout: 20000,
  });
  await addAccount.getByRole("button", { name: "Close" }).click();
  await expect(addAccount).toHaveCount(0);
  await expect(composeButton(page)).toBeVisible();
}

/** Sidebar and mobile nav both expose a Compose control; pick the one on screen. */
function composeButton(page: Page) {
  return page.getByRole("button", { name: "Compose", exact: true }).filter({ visible: true }).first();
}

async function openComposer(page: Page) {
  const scrim = page.locator(".fixed.inset-0.z-40");
  if (await scrim.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(scrim).toBeHidden();
  }
  const compose = composeButton(page);
  await expect(compose).toBeVisible();
  await expect(compose).toBeEnabled();
  await compose.click();
}

test("embedded Mail composer and settings fit narrow and desktop viewports", async ({
  page,
}) => {
  await openMail(page);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    const compose = composeButton(page);
    await expect(compose).toBeInViewport();
    await openComposer(page);
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
  await openComposer(page);
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
