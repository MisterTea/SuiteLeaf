import {
  createFile,
  mimeFor,
  nativeFilename,
  serializeFile,
} from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { beat, caption, clusterReady, expect, startServer, test, typeSlowly } from "./harness";

const password = "garden-club";

async function signup(url: string, name: string, email: string) {
  const response = await fetch(`${url}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify({ name, email, password }),
  });
  if (!response.ok)
    throw new Error(`Could not create ${email}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<{
    token: string;
    user: { id: string; name: string; email: string; role?: string };
  }>;
}

async function authed(url: string, token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
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

test("153-see-who-opened-the-rota", async ({ page }) => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");
  const server = await startServer();
  try {
    const rosa = await signup(server.url, "Rosa Diaz", "rosa@gardenclub.org");
    expect(rosa.user.role).toBe("admin");
    const sam = await signup(server.url, "Sam Lee", "sam@gardenclub.org");
    const file = createFile("doc", "Watering rota");
    file.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Thursday: Sam waters the beds." }],
        },
      ],
    };
    const item = await (
      await authed(server.url, sam.token, "/api/drive/items", {
        method: "POST",
        body: JSON.stringify({
          name: nativeFilename(file),
          kind: "file",
          mime: mimeFor("doc"),
        }),
      })
    ).json();
    await authed(server.url, sam.token, `/api/drive/items/${item.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor("doc") },
      body: serializeFile(file),
    });
    await authed(server.url, sam.token, `/api/drive/items/${item.id}/content`);

    await page.goto(server.url);
    await caption(page, "Rosa signs in. Admin is in the sidebar.");
    await signIn(page, "rosa@gardenclub.org");
    const admin = page.getByRole("link", { name: "Admin" });
    await expect(admin).toBeVisible();
    await beat(page, 600);

    await caption(page, "She creates Garden club, then Volunteers.");
    await admin.click();
    await page.getByRole("button", { name: "Groups" }).click();
    const groupName = page.getByLabel("New group");
    await groupName.fill("Garden club");
    await page.getByRole("button", { name: "Create group" }).click();
    await expect(page.getByRole("button", { name: "Garden club" })).toBeVisible();
    await groupName.fill("Volunteers");
    await page.getByRole("button", { name: "Create group" }).click();
    await expect(page.getByRole("button", { name: "Volunteers" })).toBeVisible();
    await beat(page, 500);

    await caption(page, "Garden club contains Volunteers.");
    await page.getByRole("button", { name: "Garden club" }).click();
    await page.getByLabel("Add a group").selectOption({ label: "Volunteers" });
    await page.getByRole("button", { name: "Add group" }).click();
    await expect(page.getByRole("list", { name: "Members" })).toContainText("Volunteers");
    await beat(page, 500);

    await caption(page, "Adding Garden club inside Volunteers would make a loop.");
    await page.getByRole("button", { name: "All groups" }).click();
    await page.getByRole("button", { name: "Volunteers" }).click();
    await page.getByLabel("Add a group").selectOption({ label: "Garden club" });
    await page.getByRole("button", { name: "Add group" }).click();
    await expect(page.getByRole("alert")).toContainText("loop");
    await expect(page.getByRole("list", { name: "Members" })).not.toContainText("Garden club");
    await beat(page, 500);

    await caption(page, "Sam edited the rota, and he opened it.");
    await page.getByRole("button", { name: "People" }).click();
    await page.getByRole("button", { name: "Sam Lee" }).click();
    const documents = page.getByRole("list", { name: "Documents" });
    await expect(documents).toContainText("Edited");
    await expect(documents).toContainText("Opened");
    await expect(documents).toContainText("Watering rota");
    await expect(page.getByRole("list", { name: "Sign-ins" })).toBeVisible();
    await beat(page, 600);

    await caption(page, "Sam signs in. He does not see Admin.");
    await page.getByRole("link", { name: "Back to files" }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await signIn(page, "sam@gardenclub.org");
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
    await beat(page, 800);
  } finally {
    server.stop();
  }
});
