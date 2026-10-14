import {
  createFile,
  mimeFor,
  nativeFilename,
  serializeFile,
} from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import {
  beat,
  caption,
  clusterReady,
  expect,
  startServer,
  test,
  typeSlowly,
} from "./harness";

const password = "garden-club";

interface Account {
  token: string;
  user: { id: string; name: string; email: string };
}

async function signup(url: string, name: string, email: string): Promise<Account> {
  const response = await fetch(`${url}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify({ name, email, password }),
  });
  if (!response.ok)
    throw new Error(`Could not create ${email}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function authed(
  url: string,
  token: string,
  path: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const response = await fetch(`${url}${path}`, { ...init, headers });
  if (!response.ok)
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  return response;
}

async function signIn(page: Page, email: string) {
  const card = page.getByLabel("Sign in to SuiteLeaf");
  await expect(card).toBeVisible();
  await card.getByLabel("Email or username", { exact: true }).click();
  await typeSlowly(page, email);
  await card.getByLabel("Password", { exact: true }).click();
  await typeSlowly(page, password, 20);
  await card.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function showDrive(page: Page) {
  await page
    .getByRole("heading", { name: "SuiteDrive" })
    .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  await beat(page, 700);
}

test("139-get-a-shared-file-back", async ({ page }) => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");
  const server = await startServer();
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  try {
    const rosa = await signup(server.url, "Rosa Diaz", "rosa@gardenclub.org");
    const folder = await (
      await authed(server.url, rosa.token, "/api/drive/items", {
        method: "POST",
        body: JSON.stringify({ name: "Garden club", kind: "folder" }),
      })
    ).json();
    const file = createFile("doc", "Watering rota");
    file.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Thursday: Rosa waters the beds." }],
        },
      ],
    };
    const item = await (
      await authed(server.url, rosa.token, "/api/drive/items", {
        method: "POST",
        body: JSON.stringify({
          name: nativeFilename(file),
          kind: "file",
          parentId: folder.id,
          mime: mimeFor("doc"),
        }),
      })
    ).json();
    await authed(server.url, rosa.token, `/api/drive/items/${item.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor("doc") },
      body: serializeFile(file),
    });

    await page.goto(server.url);
    await caption(page, "Rosa signs in. The watering rota is in Garden club.");
    await signIn(page, "rosa@gardenclub.org");
    await showDrive(page);
    const rota = page.getByRole("button", { name: "Watering rota.sldoc", exact: true });
    const club = page.getByRole("button", { name: "Garden club", exact: true });
    await club.click();
    await expect(page.getByLabel("Folder path")).toContainText("Garden club");
    await expect(rota).toBeVisible();
    await beat(page, 900);

    await caption(page, "She clicks the trash icon. There is no dialog.", 700);
    await page.getByRole("button", { name: "Move Watering rota.sldoc to trash" }).click();
    expect(dialogs).toEqual([]);
    await expect(rota).toHaveCount(0);
    const banner = page.getByRole("status").filter({ hasText: "Watering rota.sldoc" });
    await expect(banner).toContainText("Trash");
    await expect(banner.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(banner.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await caption(page, "Watering rota is in Trash. Undo stays. It does not vanish on its own.", 400);
    await page.waitForTimeout(3000);
    await expect(banner).toBeVisible();
    expect(dialogs).toEqual([]);

    await caption(page, "Undo puts the rota back in Garden club.", 700);
    await banner.getByRole("button", { name: "Undo" }).click();
    await expect(rota).toBeVisible();
    await expect(banner).toHaveCount(0);
    await beat(page, 900);

    await caption(page, "She moves it again, then opens Trash.", 700);
    await page.getByRole("button", { name: "Move Watering rota.sldoc to trash" }).click();
    await expect(rota).toHaveCount(0);
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: "Watering rota.sldoc" });
    await expect(row).toContainText("Garden club");
    await expect(club).toHaveCount(0);
    await beat(page, 1200);

    await caption(page, "Restore sends it back to Garden club, not the top of My Drive.", 800);
    await row.getByRole("button", { name: "Restore Watering rota.sldoc" }).click();
    await expect(page.getByText("The trash is empty.")).toBeVisible();
    await page.getByRole("tab", { name: "My Drive" }).click();
    await expect(rota).toHaveCount(0);
    await expect(club).toBeVisible();
    await club.click();
    await expect(rota).toBeVisible();
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expect(page.getByText("The trash is empty.")).toBeVisible();
    await expect(page.getByText("Watering rota")).toHaveCount(0);
    await beat(page, 800);

    await caption(page, "Delete forever asks first, and it names the file.", 800);
    await page.getByRole("tab", { name: "My Drive" }).click();
    await club.click();
    await page.getByRole("button", { name: "Move Watering rota.sldoc to trash" }).click();
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await page.getByRole("button", { name: "Delete Watering rota.sldoc forever" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete forever" });
    await expect(dialog).toContainText("Watering rota");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toContainText("Garden club");
    await beat(page, 700);

    await page.getByRole("button", { name: "Delete Watering rota.sldoc forever" }).click();
    await dialog.getByRole("button", { name: "Delete forever", exact: true }).click();
    await expect(page.getByText("The trash is empty.")).toBeVisible();
    await page.getByRole("tab", { name: "My Drive" }).click();
    await club.click();
    await expect(rota).toHaveCount(0);
    await expect(page.getByText("This folder is empty.")).toBeVisible();
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    await expect(page.getByText("The trash is empty.")).toBeVisible();
    expect(dialogs).toEqual([]);
    await caption(page, "The rota is gone from Trash and from Garden club. Nothing else deletes it.", 2200);
  } finally {
    server.stop();
  }
});
