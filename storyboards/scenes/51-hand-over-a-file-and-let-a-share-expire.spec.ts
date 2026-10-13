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

async function authed(url: string, token: string, path: string, init: RequestInit = {}) {
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
  await beat(page, 500);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Sign in to SuiteLeaf")).toBeVisible();
}

/** A Saturday already in the past, so the recording can show the day access ends. */
function pastSaturday(now = new Date()): string {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const since = (day.getDay() + 1) % 7;
  day.setDate(day.getDate() - (since === 0 ? 7 : since));
  return day.toISOString();
}

test("51-hand-over-a-file-and-let-a-share-expire", async ({ page }) => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");
  test.setTimeout(240000);
  const office = await startServer();
  const library = await startServer({ dataDir: office.dataDir, p2p: office.p2p });
  try {
    const rosa = await signup(office.url, "Rosa Diaz", "rosa@gardenclub.org");
    const sam = await signup(office.url, "Sam Okafor", "sam@gardenclub.org");
    const priya = await signup(office.url, "Priya Shah", "priya@gardenclub.org");
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
      await authed(office.url, rosa.token, "/api/drive/items", {
        method: "POST",
        body: JSON.stringify({
          name: nativeFilename(file),
          kind: "file",
          mime: mimeFor("doc"),
        }),
      })
    ).json();
    await authed(office.url, rosa.token, `/api/drive/items/${item.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor("doc") },
      body: serializeFile(file),
    });
    await authed(office.url, rosa.token, `/api/drive/items/${item.id}/acl`, {
      method: "PUT",
      body: JSON.stringify({
        principalType: "user",
        principalId: sam.user.id,
        role: "editor",
      }),
    });
    await authed(office.url, rosa.token, `/api/drive/items/${item.id}/acl`, {
      method: "PUT",
      body: JSON.stringify({
        principalType: "user",
        principalId: priya.user.id,
        role: "commenter",
      }),
    });

    await page.addInitScript(
      (session) => localStorage.setItem("suiteleaf:node-session", JSON.stringify(session)),
      { url: office.url, token: rosa.token, user: rosa.user },
    );
    await page.goto(office.url);
    await caption(page, "Rosa is leaving the committee. Sam should own the watering rota, and Priya's help ends Saturday.");
    await showDrive(page);
    await page.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Document content" });
    await expect(editor).toContainText("Monday: Rosa");
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const dialog = page.locator(".share-dialog");
    await expect(dialog.getByText("Rosa Diaz (you)")).toBeVisible();
    await expect(dialog.getByText("Sam Okafor")).toBeVisible();
    await expect(dialog.getByText("Priya Shah")).toBeVisible();
    await expect(dialog.getByText("Owner").first()).toBeVisible();
    await caption(page, "Today: Rosa owns it, Sam can edit, and Priya can comment.", 1800);

    await dialog.getByRole("button", { name: "Role for Priya Shah" }).click();
    await expect(dialog.getByRole("button", { name: "Access expires" })).toBeVisible();
    await beat(page, 900);
    await dialog.getByRole("button", { name: "Access expires" }).click();
    await expect(dialog.getByText("It takes effect as soon as you pick a day.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
    await caption(page, "Priya is helping through Friday. Rosa picks Saturday. There is no Save.", 1600);
    await dialog
      .getByRole("button", { name: /^Saturday,/, disabled: false })
      .first()
      .click();
    await expect(dialog.getByText("Commenter · until Saturday")).toBeVisible();
    await expect(dialog.getByText(/Priya's access ends Saturday/)).toBeVisible();
    await beat(page, 1200);

    await caption(page, "She hands the rota to Sam. He owns it as soon as she confirms.", 1200);
    await dialog.getByRole("button", { name: "Role for Sam Okafor" }).click();
    await expect(dialog.getByRole("button", { name: "Make owner" })).toBeVisible();
    await beat(page, 900);
    await dialog.getByRole("button", { name: "Make owner" }).click();
    await expect(
      dialog.getByText("Make Sam Okafor the owner? You will become an editor."),
    ).toBeVisible();
    await beat(page, 900);
    await dialog.getByRole("button", { name: "Make owner", exact: true }).click();
    await expect(dialog.getByText("Sam Okafor owns this file now")).toBeVisible();
    await expect(dialog.getByText("You can edit this file.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Make owner" })).toHaveCount(0);
    await expect(dialog.getByText("Commenter · until Saturday")).toBeVisible();
    const people = dialog.locator(".share-people");
    await expect(people).toContainText("Sam Okafor");
    await expect(people).toContainText("Owner");
    await expect(people).toContainText("Rosa Diaz");
    await expect(people).toContainText("Editor");
    await caption(page, "Sam is the owner now. Rosa can still edit. Priya's Saturday is unchanged. No email, nothing to accept.", 2400);
    await dialog.getByRole("button", { name: "Close" }).click();

    await caption(page, "Rosa adds Sunday, to show she can still change the rota.", 1000);
    await expect(page.getByRole("button", { name: "Bold" })).toBeEnabled();
    await editor.click();
    await editor.press("ControlOrMeta+End");
    await typeSlowly(page, " Sunday: rotate the beds.");
    await expect(page.getByRole("status")).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
    await expect(editor).toContainText("Sunday: rotate the beds.");
    await beat(page, 800);

    await caption(page, "Sam signs in. The rota is already in his drive.", 1000);
    await page.getByRole("button", { name: "Back to files" }).click();
    await signOut(page);
    await signIn(page, "sam@gardenclub.org");
    await showDrive(page);
    const samFile = page.getByRole("button", { name: "Watering rota.sldoc", exact: true });
    await expect(samFile).toBeVisible();
    await expect(page.getByRole("tab", { name: "My Drive" })).toHaveAttribute("aria-selected", "true");
    await caption(page, "No invitation was waiting. Sam opens his file and can still change who has access.", 1800);
    await samFile.click();
    await expect(editor).toContainText("Sunday: rotate the beds.");
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByText("Commenter · until Saturday")).toBeVisible();
    await dialog.getByRole("button", { name: "Role for Rosa Diaz" }).click();
    await expect(dialog.getByRole("option", { name: /^Editor/ })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /^Viewer/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Make owner" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Access expires" })).toBeVisible();
    await beat(page, 1600);
    await dialog.getByRole("button", { name: "Role for Rosa Diaz" }).click();
    await expect(dialog.getByText("Commenter · until Saturday")).toBeVisible();
    await caption(page, "Priya's end date is still Saturday. Sam can change roles. Rosa cannot hand the file on.", 2000);
    await dialog.getByRole("button", { name: "Close" }).click();

    await caption(page, "Rosa's turn. She can edit, and Make owner is not offered.", 1000);
    await page.getByRole("button", { name: "Back to files" }).click();
    await signOut(page);
    await signIn(page, "rosa@gardenclub.org");
    await showDrive(page);
    await page.getByRole("tab", { name: "Shared with me" }).click();
    const rosaShared = page.getByRole("button", { name: "Watering rota.sldoc", exact: true });
    await expect(rosaShared).toContainText("Can edit");
    await rosaShared.click();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByText("You can edit this file.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Make owner" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Access expires" })).toHaveCount(0);
    await beat(page, 1600);
    await dialog.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Back to files" }).click();

    await caption(page, "It's still Friday. Priya can comment, and she cannot change the wording.", 1200);
    await signOut(page);
    await signIn(page, "priya@gardenclub.org");
    await showDrive(page);
    await page.getByRole("tab", { name: "Shared with me" }).click();
    const priyaShared = page.getByRole("button", { name: "Watering rota.sldoc", exact: true });
    await expect(priyaShared).toContainText("Can comment");
    await priyaShared.click();
    await expect(page.getByText("Can comment", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bold" })).toBeDisabled();
    const commentBox = page.getByLabel("Add a comment");
    await commentBox.click();
    await typeSlowly(page, "I can cover Wednesday morning.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByLabel("Comments on this file")).toContainText(
      "I can cover Wednesday morning.",
    );
    await beat(page, 800);
    const rotaUrl = page.url();
    await editor.click();
    await page.keyboard.type("I should not be able to change this.");
    await beat(page, 1000);
    await expect(editor).toContainText("Monday: Rosa");
    await expect(editor).not.toContainText("I should not be able to change this.");
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
    await caption(page, "Her comment is saved. The rota's words are unchanged.", 1800);

    await caption(page, "Saturday arrives. Priya's access ends on its own. Nobody has to remember to remove her.", 1600);
    await authed(office.url, sam.token, `/api/drive/items/${item.id}/expiry`, {
      method: "PUT",
      body: JSON.stringify({ principalId: priya.user.id, expiresAt: pastSaturday() }),
    });
    await page.getByRole("button", { name: "Back to files" }).click();
    await showDrive(page);
    await page.getByRole("tab", { name: "Shared with me" }).click();
    await expect(page.getByText("Nothing has been shared with you yet.")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("button", { name: "Watering rota.sldoc" })).toHaveCount(0);
    await caption(page, "The rota is gone from Shared with me.", 1600);
    await page.goto(rotaUrl);
    await expect(page.getByRole("alert")).toHaveText("You no longer have access to this file.");
    await caption(page, "Opening it is refused.", 1800);

    await caption(page, "Sam still owns it. Priya's row now says her access ended Saturday.", 1200);
    await page.getByRole("link", { name: "Return to files" }).click();
    await signOut(page);
    await signIn(page, "sam@gardenclub.org");
    await showDrive(page);
    await page.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByText("Access ended Saturday")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Role for Priya Shah" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Remove" })).toBeVisible();
    await beat(page, 1800);
    await dialog.getByRole("button", { name: "Close" }).click();

    const heads = async (url: string) =>
      (await (await fetch(`${url}/api/node/info`)).json()).suitedb.heads.join();
    await expect
      .poll(async () => (await heads(office.url)) === (await heads(library.url)), {
        timeout: 30000,
      })
      .toBe(true);
    await expect
      .poll(
        async () =>
          (await (await fetch(`${library.url}/api/node/info`)).json()).suitedrive.replicating,
        { timeout: 30000 },
      )
      .toBe(0);
    await caption(page, "Sam signs in on the club's other server. The same owner, and the same Saturday.", 1200);
    await page.goto(library.url);
    await signIn(page, "sam@gardenclub.org");
    await showDrive(page);
    await expect(page.getByRole("button", { name: "Watering rota.sldoc", exact: true })).toBeVisible({
      timeout: 20000,
    });
    await page.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    await expect(editor).toContainText("Sunday: rotate the beds.");
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByText("Sam Okafor (you)")).toBeVisible();
    await expect(dialog.getByText("Owner").first()).toBeVisible();
    await expect(dialog.getByText("Access ended Saturday")).toBeVisible();
    await expect(dialog.getByText("Rosa Diaz")).toBeVisible();
    await expect(dialog.getByText("Editor").first()).toBeVisible();
    await caption(page, "Same owner, same Saturday, on the other server.", 2000);
    await dialog.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Back to files" }).click();
    await signOut(page);

    await caption(page, "Rosa signs in there too. She is still an editor, and she can still change the rota.", 1200);
    await signIn(page, "rosa@gardenclub.org");
    await showDrive(page);
    await page.getByRole("tab", { name: "Shared with me" }).click();
    const rosaThere = page.getByRole("button", { name: "Watering rota.sldoc", exact: true });
    await expect(rosaThere).toContainText("Can edit");
    await rosaThere.click();
    await expect(editor).toContainText("Sunday: rotate the beds.");
    await editor.click();
    await editor.press("ControlOrMeta+End");
    await typeSlowly(page, " Bring the spare key.");
    await expect(page.getByRole("status")).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
    await expect(editor).toContainText("Bring the spare key.");
    await caption(page, "Sam owns the rota. Rosa can still edit it. Priya's Saturday ended on its own.", 2400);
  } finally {
    await library.stop();
    await office.stop();
  }
});
