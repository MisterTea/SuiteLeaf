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

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
}

test("137-let-someone-else-sign-up", async ({ page }) => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");
  const server = await startServer();
  try {
    const rosa = await signup(server.url, "Rosa Diaz", "rosa@gardenclub.org");
    await signup(server.url, "Sam Okafor", "sam@gardenclub.org");
    const file = createFile("form", "Plot sign-ups");
    if (file.kind !== "form") throw new Error("Expected a form.");
    file.content = {
      questions: [
        { id: "name", prompt: "Your name", kind: "text", required: true },
        {
          id: "plot",
          prompt: "Plot size",
          kind: "choice",
          required: true,
          choices: ["Small", "Medium", "Large"],
        },
        { id: "notes", prompt: "Notes", kind: "text", required: false },
      ],
      responses: [],
    };
    const item = await (
      await authed(server.url, rosa.token, "/api/drive/items", {
        method: "POST",
        body: JSON.stringify({
          name: nativeFilename(file),
          kind: "file",
          mime: mimeFor("form"),
        }),
      })
    ).json();
    await authed(server.url, rosa.token, `/api/drive/items/${item.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor("form") },
      body: serializeFile(file),
    });

    await page.addInitScript(
      (session) => localStorage.setItem("suiteleaf:node-session", JSON.stringify(session)),
      { url: server.url, token: rosa.token, user: rosa.user },
    );
    await page.goto(server.url);
    await caption(page, "Rosa opens the plot sign-up. The questions are already here.");
    await showDrive(page);
    await page.getByRole("button", { name: "Plot sign-ups.slform", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Questions" })).toBeVisible();
    const prompts = page.getByRole("textbox", { name: "Question", exact: true });
    await expect(prompts.nth(0)).toHaveValue("Your name");
    await expect(prompts.nth(1)).toHaveValue("Plot size");
    await expect(prompts.nth(2)).toHaveValue("Notes");
    await beat(page, 800);

    await caption(page, "She shares it with Sam.", 900);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const dialog = page.locator(".share-dialog");
    await expect(dialog.getByRole("heading", { name: "Share “Plot sign-ups”" })).toBeVisible();
    const add = dialog.getByLabel("Add people");
    await add.click();
    await typeSlowly(page, "sam");
    await dialog.getByRole("option", { name: /Sam Okafor/ }).click();
    const samRole = dialog.getByRole("button", { name: "Role for Sam Okafor" });
    await expect(samRole).toContainText("Responder");
    await expect(samRole).toContainText("Can sign up, not change the questions");
    await caption(
      page,
      "Responder is already chosen. Sam can sign up, not change the questions.",
      1800,
    );
    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByText("Sam can now respond")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Role for Sam Okafor" })).toContainText(
      "Responder",
    );
    await beat(page, 900);
    await dialog.getByRole("button", { name: "Close" }).click();

    await caption(page, "Sam signs in on his own.", 800);
    await signOut(page);
    await signIn(page, "sam@gardenclub.org");
    await showDrive(page);
    await page.getByRole("tab", { name: "Shared with me" }).click();
    const shared = page.getByRole("button", { name: "Plot sign-ups.slform", exact: true });
    await expect(shared).toContainText("Rosa Diaz");
    await expect(shared).toContainText("Can respond");
    await caption(page, "The form is under Shared with me.", 1400);
    await shared.click();
    await expect(page.getByRole("tab", { name: "Questions" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Responses" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Add a response" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Question", exact: true })).toHaveCount(0);
    await caption(page, "Sam can sign up. There is no Questions tab.", 1600);

    await page.getByLabel("Your name").click();
    await typeSlowly(page, "Sam");
    await page.getByRole("radio", { name: "Medium" }).check();
    await caption(page, "Sam, Medium, and no notes.", 1200);
    await page.getByRole("button", { name: "Submit response" }).click();
    await expect(page.getByLabel("Your name")).toHaveValue("");
    await expect(page.getByRole("status").filter({ hasText: "Saved to SuiteDrive" })).toBeVisible({
      timeout: 20000,
    });
    await caption(page, "He submits. The form clears for the next person.", 1400);

    await caption(page, "Rosa signs back in.", 800);
    await signOut(page);
    await signIn(page, "rosa@gardenclub.org");
    await showDrive(page);
    await page.getByRole("button", { name: "Plot sign-ups.slform", exact: true }).click();
    await page.getByRole("tab", { name: "Responses" }).click();
    const table = page.locator(".form-responses table");
    await expect(table).toContainText("Sam");
    await expect(table).toContainText("Medium");
    await expect(table.locator("tbody td").nth(2)).toHaveText("");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await caption(page, "Sam's row is in this file. The questions are unchanged.", 1200);
    await page.getByRole("tab", { name: "Questions" }).click();
    await expect(prompts.nth(0)).toHaveValue("Your name");
    await expect(prompts.nth(1)).toHaveValue("Plot size");
    await expect(prompts.nth(2)).toHaveValue("Notes");
    await beat(page, 1600);
  } finally {
    server.stop();
  }
});
