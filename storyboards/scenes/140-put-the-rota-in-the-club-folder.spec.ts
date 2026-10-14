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

async function signup(
  url: string,
  name: string,
  email: string,
): Promise<Account> {
  const response = await fetch(`${url}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify({ name, email, password }),
  });
  if (!response.ok)
    throw new Error(
      `Could not create ${email}: ${response.status} ${await response.text()}`,
    );
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
    throw new Error(
      `${path} failed: ${response.status} ${await response.text()}`,
    );
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
    .evaluate((el) =>
      el.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  await beat(page, 700);
}

async function moveTo(page: Page, folder: string) {
  await page.getByRole("button", { name: "Move", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Move" });
  const row = dialog.getByRole("button", { name: folder, exact: true });
  await expect(row).toBeVisible();
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await beat(page, 700);
  await dialog.getByRole("button", { name: "Move here" }).click();
  await expect(dialog).toHaveCount(0);
}

test("140-put-the-rota-in-the-club-folder", async ({ page }) => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");
  const server = await startServer();
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  try {
    const rosa = await signup(server.url, "Rosa Diaz", "rosa@gardenclub.org");
    await authed(server.url, rosa.token, "/api/drive/items", {
      method: "POST",
      body: JSON.stringify({ name: "Garden club", kind: "folder" }),
    });
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
          mime: mimeFor("doc"),
        }),
      })
    ).json();
    await authed(
      server.url,
      rosa.token,
      `/api/drive/items/${item.id}/content`,
      {
        method: "PUT",
        headers: { "content-type": mimeFor("doc") },
        body: serializeFile(file),
      },
    );

    await page.goto(server.url);
    await caption(
      page,
      "Rosa signs in. The rota and Garden club are both in My Drive.",
    );
    await signIn(page, "rosa@gardenclub.org");
    await showDrive(page);
    const rota = page.getByRole("button", {
      name: "Watering rota.sldoc",
      exact: true,
    });
    const club = page.getByRole("button", { name: "Garden club", exact: true });
    await expect(rota).toBeVisible();
    await expect(club).toBeVisible();
    await beat(page, 800);

    await caption(page, "Garden club does not have the rota yet.", 700);
    await club.click();
    await expect(page.getByLabel("Folder path")).toContainText("Garden club");
    await expect(rota).toHaveCount(0);
    await expect(page.getByText("This folder is empty.")).toBeVisible();
    await beat(page, 800);
    await page.getByRole("tab", { name: "My Drive" }).click();
    await expect(rota).toBeVisible();

    await caption(
      page,
      "She opens the rota. Next to the title, it says My Drive.",
      700,
    );
    await rota.click();
    const inMyDrive = page.getByRole("button", { name: "Folder My Drive" });
    await expect(inMyDrive).toBeVisible();
    await beat(page, 900);

    await caption(
      page,
      "Move lists Garden club by name. She chooses it. The banner stays.",
      600,
    );
    await moveTo(page, "Garden club");
    const banner = page
      .getByRole("status")
      .filter({ hasText: "Moved Watering rota.sldoc to Garden club." });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(banner.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Folder Garden club" }),
    ).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(banner).toBeVisible();
    expect(dialogs).toEqual([]);
    await beat(page, 600);

    await caption(
      page,
      "Undo puts the rota back. The title says My Drive again.",
      700,
    );
    await banner.getByRole("button", { name: "Undo" }).click();
    await expect(banner).toHaveCount(0);
    await expect(inMyDrive).toBeVisible();
    await beat(page, 900);

    await caption(
      page,
      "She moves it to Garden club again, then opens that folder.",
      700,
    );
    await moveTo(page, "Garden club");
    await expect(
      page.getByRole("button", { name: "Folder Garden club" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Folder Garden club" }).click();
    await showDrive(page);
    await expect(page.getByLabel("Folder path")).toContainText("Garden club");
    await expect(rota).toBeVisible();
    await beat(page, 900);

    await caption(
      page,
      "My Drive no longer lists the rota. It lives in Garden club.",
      800,
    );
    await page.getByRole("tab", { name: "My Drive" }).click();
    await expect(rota).toHaveCount(0);
    await expect(club).toBeVisible();
    expect(dialogs).toEqual([]);
    await beat(page, 1600);
  } finally {
    server.stop();
  }
});
