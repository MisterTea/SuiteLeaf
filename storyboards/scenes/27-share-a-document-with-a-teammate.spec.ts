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

test("27-share-a-document-with-a-teammate", async ({ page }) => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");
  const server = await startServer();
  try {
    const rosa = await signup(server.url, "Rosa Diaz", "rosa@gardenclub.org");
    await signup(server.url, "Sam Okafor", "sam@gardenclub.org");
    await signup(server.url, "Priya Shah", "priya@gardenclub.org");
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
          content: [
            {
              type: "text",
              text: "Monday: Rosa. Tuesday: Sam. Wednesday: Priya.",
            },
          ],
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

    await page.addInitScript(
      (session) => localStorage.setItem("suiteleaf:node-session", JSON.stringify(session)),
      { url: server.url, token: rosa.token, user: rosa.user },
    );
    await page.goto(server.url);
    await caption(page, "Rosa is signed in to the club's server. She opens the watering rota.");
    await showDrive(page);
    await page.getByRole("button", { name: "Garden club", exact: true }).click();
    await page.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Document content" });
    await expect(editor).toContainText("Monday: Rosa");
    const share = page.getByRole("button", { name: "Share", exact: true });
    await expect(share).toBeVisible();
    await expect(page.getByTitle(/Saving to SuiteDrive/)).toBeVisible();
    await caption(page, "Share sits in the header, next to the server name.", 1600);

    await share.click();
    const dialog = page.locator(".share-dialog");
    await expect(dialog.getByRole("heading", { name: "Share “Watering rota”" })).toBeVisible();
    await expect(dialog.getByText("Rosa Diaz (you)")).toBeVisible();
    await expect(dialog.getByText("Owner")).toBeVisible();
    await expect(
      dialog.getByText("Only the people and groups listed here can open this file."),
    ).toBeVisible();
    await caption(page, "The dialog lists who can open it. Right now, only Rosa.", 1800);

    const add = dialog.getByLabel("Add people");
    await add.click();
    await typeSlowly(page, "sa");
    const samOption = dialog.getByRole("option", { name: /Sam Okafor/ });
    await expect(samOption).toContainText("sam@gardenclub.org");
    await caption(page, "Two letters are enough. Sam's name and email come up.", 1600);
    await samOption.click();
    const samRole = dialog.getByRole("button", { name: "Role for Sam Okafor" });
    await expect(samRole).toContainText("Editor");
    await expect(samRole).toContainText("Can change anything");
    await caption(page, "Editor is already chosen, and it says what that means, before she shares.", 1800);
    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByText("Sam can now edit")).toBeVisible();
    await expect(dialog.getByText("sam@gardenclub.org")).toBeVisible();
    await beat(page);

    await caption(page, "Priya only needs to comment. Rosa picks her, then Commenter.", 1200);
    await add.click();
    await typeSlowly(page, "priya");
    await dialog.getByRole("option", { name: /Priya Shah/ }).click();
    await dialog.getByRole("button", { name: "Role for Priya Shah" }).click();
    const commenter = dialog.getByRole("option", { name: /Commenter/ });
    await expect(commenter).toContainText("Can read and comment");
    await expect(dialog.getByRole("option", { name: /Viewer/ })).toContainText("Can read");
    await beat(page, 700);
    await commenter.click();
    await expect(dialog.getByRole("button", { name: "Role for Priya Shah" })).toContainText(
      "Can read and comment",
    );
    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByText("Priya Shah")).toBeVisible();
    await beat(page);

    await caption(page, "Lee isn't on this server. The dialog says so, and Share stays off.", 1000);
    await add.click();
    await typeSlowly(page, "lee@example.com");
    await expect(
      dialog.getByText(
        "No account on this server uses lee@example.com. Ask them to sign up first.",
      ),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
    await beat(page, 1800);
    await add.fill("");

    await caption(page, "Sam only needs to read this week. His role changes straight away.", 1200);
    await dialog.getByRole("button", { name: "Role for Sam Okafor" }).click();
    await dialog.getByRole("option", { name: /^Viewer/ }).click();
    await expect(dialog.getByText("Sam can now view")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
    await beat(page, 800);

    await caption(page, "Priya has left the club. Remove access, and Undo stays up if that was a mistake.", 1200);
    await dialog.getByRole("button", { name: "Role for Priya Shah" }).click();
    await dialog.getByRole("button", { name: "Remove access" }).click();
    await expect(dialog.locator(".share-people")).not.toContainText("Priya Shah");
    const undo = dialog.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();
    await expect(dialog.getByText("Priya Shah no longer has access")).toBeVisible();
    const alex = signup(server.url, "Alex Rivera", "alex@gardenclub.org");
    await caption(page, "Undo stays up, so a mis-click isn't permanent.", 2200);
    await page.waitForTimeout(3200);
    await expect(undo).toBeVisible();

    await caption(page, "The rota lives in Garden club. Rosa shares that folder with Sam as an editor.", 1400);
    await dialog.getByRole("button", { name: "Share “Garden club”" }).click();
    await expect(dialog.getByRole("heading", { name: "Share “Garden club”" })).toBeVisible();
    await dialog.getByLabel("Add people").click();
    await typeSlowly(page, "sam");
    await dialog.getByRole("option", { name: /Sam Okafor/ }).click();
    await expect(dialog.getByRole("button", { name: "Role for Sam Okafor" })).toContainText("Editor");
    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByText("Sam can now edit")).toBeVisible();
    await beat(page, 800);
    await dialog.getByRole("button", { name: "Close" }).click();

    await caption(page, "She reopens Share on the rota. Sam's edit access comes from the folder.", 1400);
    await share.click();
    await expect(dialog.getByText("Sam Okafor")).toBeVisible();
    await expect(dialog.getByText("from Garden club")).toBeVisible();
    await expect(dialog.getByText("Priya Shah")).toHaveCount(0);
    await expect(dialog.getByText("Editor").first()).toBeVisible();
    await beat(page, 2200);
    await dialog.getByRole("button", { name: "Close" }).click();

    const alexAccount = await alex;
    await authed(server.url, rosa.token, `/api/drive/items/${item.id}/acl`, {
      method: "PUT",
      body: JSON.stringify({
        principalType: "user",
        principalId: alexAccount.user.id,
        role: "viewer",
      }),
    });

    await caption(page, "Sam signs in on his own.", 900);
    await page.getByRole("button", { name: "Back to files" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, "sam@gardenclub.org");
    await showDrive(page);
    await page.getByRole("tab", { name: "Shared with me" }).click();
    const shared = page.getByRole("button", { name: "Watering rota.sldoc", exact: true });
    await expect(shared).toContainText("Rosa Diaz");
    await expect(shared).toContainText("Can edit");
    await caption(page, "Shared with me already lists the rota, with Rosa's name and Sam's role. No refresh.", 2200);
    await shared.click();
    await expect(editor).toContainText("Monday: Rosa");
    await editor.click();
    await typeSlowly(page, " Thursday: ask Alex to cover.");
    await expect(page.getByRole("status").filter({ hasText: "Saved to SuiteDrive" })).toBeVisible({
      timeout: 20000,
    });
    await expect(editor).toContainText("Thursday: ask Alex to cover.");
    await caption(page, "Sam can change the rota. It saves to SuiteDrive.", 1800);

    await caption(page, "Alex can open it too, but only to read.", 1000);
    await page.getByRole("button", { name: "Back to files" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, "alex@gardenclub.org");
    await showDrive(page);
    await page.getByRole("tab", { name: "Shared with me" }).click();
    const alexRow = page.getByRole("button", { name: "Watering rota.sldoc", exact: true });
    await expect(alexRow).toContainText("Rosa Diaz");
    await expect(alexRow).toContainText("Can view");
    await beat(page, 800);
    await alexRow.click();
    await expect(page.getByText("View only")).toBeVisible();
    await expect(page.getByRole("button", { name: "Bold" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Italic" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Print" })).toBeEnabled();
    await expect(editor).toContainText("Thursday: ask Alex to cover.");
    let uploads = 0;
    page.on("request", (request) => {
      if (request.method() === "PUT" && request.url().includes("/content")) uploads += 1;
    });
    await editor.click();
    await page.keyboard.type("I should not be able to type this");
    await beat(page, 1800);
    await expect(editor).toContainText("Thursday: ask Alex to cover.");
    await expect(editor).not.toContainText("I should not be able to type this");
    expect(uploads).toBe(0);
    await expect(page.getByText("Save failed")).toHaveCount(0);
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
    await caption(page, "View only. The toolbar is off, typing does nothing, and nothing tries to save.", 2200);
  } finally {
    server.stop();
  }
});
