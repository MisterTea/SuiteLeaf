import {
  createFile,
  mimeFor,
  nativeFilename,
  serializeFile,
  type SuiteFile,
} from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import {
  beat,
  caption,
  clusterReady,
  expect,
  selectCells,
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

async function upload(url: string, token: string, file: SuiteFile) {
  const item = await (
    await authed(url, token, "/api/drive/items", {
      method: "POST",
      body: JSON.stringify({
        name: nativeFilename(file),
        kind: "file",
        mime: mimeFor(file.kind),
      }),
    })
  ).json();
  await authed(url, token, `/api/drive/items/${item.id}/content`, {
    method: "PUT",
    headers: { "content-type": mimeFor(file.kind) },
    body: serializeFile(file),
  });
  return item as { id: string };
}

/** A session that is not the one the page will sign out of. */
async function freshToken(url: string, email: string) {
  const response = await fetch(`${url}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(await response.text());
  return ((await response.json()) as { token: string }).token;
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

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Sign in to SuiteLeaf")).toBeVisible();
}

async function showDrive(page: Page) {
  await page
    .getByRole("heading", { name: "SuiteDrive" })
    .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  await beat(page, 700);
}

test("42-notice-when-a-file-is-shared", async ({ page }) => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");
  test.setTimeout(360_000);
  page.setDefaultTimeout(25_000);
  const server = await startServer();
  try {
    const rosa = await signup(server.url, "Rosa Diaz", "rosa@gardenclub.org");
    const sam = await signup(server.url, "Sam Okafor", "sam@gardenclub.org");
    const rotaFile = createFile("doc", "Watering rota");
    rotaFile.content = {
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
    const plotFile = createFile("sheet", "Plot assignments");
    if (plotFile.kind !== "sheet") throw new Error("expected a sheet");
    const grid = plotFile.content.workbook.sheets[plotFile.content.workbook.sheetOrder[0]];
    grid.cellData = {
      0: { 0: { v: "Plot", t: 1 }, 1: { v: "Notes", t: 1 } },
      1: { 0: { v: "North bed", t: 1 }, 1: { v: "Water Monday", t: 1 } },
    };
    (grid as { columnData?: Record<string, { w: number }> }).columnData = {
      0: { w: 140 },
      1: { w: 180 },
    };
    const rota = await upload(server.url, rosa.token, rotaFile);
    const plot = await upload(server.url, rosa.token, plotFile);

    await page.addInitScript(
      (session) => localStorage.setItem("suiteleaf:node-session", JSON.stringify(session)),
      { url: server.url, token: sam.token, user: sam.user },
    );
    await page.goto(server.url);
    await caption(page, "Sam is signed in, looking at My Drive. He has not opened Shared with me.");
    await showDrive(page);
    await expect(page.getByRole("tab", { name: "My Drive" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("This folder is empty.")).toBeVisible();
    await expect(page.getByLabel("Files shared with you")).toHaveCount(0);
    await beat(page, 1200);

    await caption(page, "Rosa shares the watering rota with Sam as an editor. Nothing asks her to send email.", 1600);
    await signOut(page);
    await signIn(page, "rosa@gardenclub.org");
    await showDrive(page);
    await page.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
      "Monday: Rosa",
    );
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const dialog = page.locator(".share-dialog");
    await expect(dialog.getByRole("heading", { name: "Share “Watering rota”" })).toBeVisible();
    const add = dialog.getByLabel("Add people");
    await add.click();
    await typeSlowly(page, "sam");
    await dialog.getByRole("option", { name: /Sam Okafor/ }).click();
    await expect(dialog.getByRole("button", { name: "Role for Sam Okafor" })).toContainText(
      "Editor",
    );
    await expect(dialog.getByText("Notify people")).toHaveCount(0);
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /send/i })).toHaveCount(0);
    const mailed: string[] = [];
    page.on("request", (request) => {
      if (/\/mail|smtp|notify/i.test(request.url())) mailed.push(request.url());
    });
    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByText("Sam can now edit")).toBeVisible();
    expect(mailed).toEqual([]);
    await beat(page, 1600);
    await dialog.getByRole("button", { name: "Close" }).click();

    await caption(page, "Sam is back in My Drive. He does not reload, and he does not open Shared with me.", 1400);
    await page.getByRole("button", { name: "Back to files" }).click();
    await signOut(page);
    await signIn(page, "sam@gardenclub.org");
    await showDrive(page);
    await expect(page.getByRole("tab", { name: "My Drive" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const rotaNotice = page.getByText(
      "Rosa Diaz shared “Watering rota” with you · Can edit",
    );
    await expect(rotaNotice).toBeVisible({ timeout: 5000 });
    await rotaNotice.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
    await caption(page, "Rosa Diaz shared “Watering rota” with you · Can edit. Open is one click.", 2200);
    await page.getByRole("button", { name: "Open Watering rota" }).click();
    const editor = page.getByRole("textbox", { name: "Document content" });
    await expect(editor).toContainText("Monday: Rosa");
    const rotaAddress = page.url();
    await beat(page, 1600);

    await caption(page, "Rosa shares the plot sheet as a viewer. Sam stays in My Drive and does not reload.", 1400);
    await page.getByRole("button", { name: "Back to files" }).click();
    await showDrive(page);
    const sharedAt = Date.now();
    await authed(server.url, rosa.token, `/api/drive/items/${plot.id}/acl`, {
      method: "PUT",
      body: JSON.stringify({
        principalType: "user",
        principalId: sam.user.id,
        role: "viewer",
      }),
    });
    const plotNotice = page.getByText(
      "Rosa Diaz shared “Plot assignments” with you · Can view",
    );
    await expect(plotNotice).toBeVisible({ timeout: 5000 });
    expect(Date.now() - sharedAt).toBeLessThan(5000);
    await plotNotice.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
    await caption(page, "Dismiss clears the notice. The sheet stays in Shared with me.", 1800);
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(plotNotice).toHaveCount(0);
    await page.getByRole("tab", { name: "Shared with me" }).click();
    const plotRow = page.getByRole("listitem").filter({ hasText: "Plot assignments.slsheet" });
    await expect(plotRow).toContainText("Rosa Diaz");
    await expect(plotRow).toContainText("Can view");
    await expect(page.getByRole("button", { name: "Watering rota.sldoc", exact: true })).toContainText(
      "Can edit",
    );
    await beat(page, 800);

    await caption(page, "Keep a copy puts the same file in My Drive. Rosa's original stays shared.", 1600);
    await plotRow.getByRole("button", { name: "Keep a copy", exact: true }).click();
    await expect(
      page.getByText("Kept a copy of Plot assignments.slsheet in My Drive. This copy is yours."),
    ).toBeVisible();
    await expect(plotRow).toContainText("Can view");
    await beat(page, 1400);
    await page.getByRole("tab", { name: "My Drive" }).click();
    const copyButton = page.getByRole("button", { name: "Plot assignments.slsheet", exact: true });
    await expect(copyButton).toBeVisible();
    await beat(page, 800);
    await copyButton.click();
    await expect(page.getByRole("button", { name: "Sheet tools", exact: true })).toBeVisible();
    await expect(page.getByText("View only")).toHaveCount(0);
    await caption(page, "The copy is his. He can change it, even though he can only view Rosa's sheet.", 1400);
    await selectCells(page, "B2");
    await typeSlowly(page, "Sam's notes", 40);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Saved to SuiteDrive" })).toBeVisible({
      timeout: 20_000,
    });
    await beat(page, 800);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByText("Sam Okafor (you)")).toBeVisible();
    await expect(dialog.getByText("Owner")).toBeVisible();
    await beat(page, 1600);
    await dialog.getByRole("button", { name: "Close" }).click();

    const samApi = await freshToken(server.url, "sam@gardenclub.org");
    const rosaApi = await freshToken(server.url, "rosa@gardenclub.org");
    const mine = (await (await authed(server.url, samApi, "/api/drive/items")).json()) as {
      items: { id: string; name: string }[];
    };
    const copy = mine.items.find((item) => item.name === "Plot assignments.slsheet");
    if (!copy) throw new Error("Sam's copy is missing");
    await expect
      .poll(async () =>
        (await authed(server.url, samApi, `/api/drive/items/${copy.id}/content`)).text(),
      )
      .toContain("Sam's notes");
    const original = await (
      await authed(server.url, rosaApi, `/api/drive/items/${plot.id}/content`)
    ).text();
    expect(original).toContain("Water Monday");
    expect(original).not.toContain("Sam's notes");

    await caption(page, "Rosa removes Sam from both files. He does not reload.", 1200);
    await page.getByRole("button", { name: "Back to files" }).click();
    await showDrive(page);
    await page.getByRole("tab", { name: "Shared with me" }).click();
    await expect(page.getByRole("button", { name: "Watering rota.sldoc", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Plot assignments.slsheet", exact: true })).toBeVisible();
    for (const id of [rota.id, plot.id]) {
      await authed(server.url, rosaApi, `/api/drive/items/${id}/acl`, {
        method: "PUT",
        body: JSON.stringify({
          principalType: "user",
          principalId: sam.user.id,
          role: null,
        }),
      });
    }
    await expect(page.getByRole("button", { name: "Watering rota.sldoc" })).toHaveCount(0, {
      timeout: 8000,
    });
    await expect(page.getByRole("button", { name: "Plot assignments.slsheet" })).toHaveCount(0);
    await expect(page.getByText("Nothing has been shared with you yet.")).toBeVisible();
    await beat(page, 1200);
    const refused = await fetch(`${server.url}/api/drive/items/${rota.id}`, {
      headers: { authorization: `Bearer ${samApi}` },
    });
    expect(refused.status).toBe(403);
    await page.evaluate((hash) => {
      location.hash = hash;
    }, new URL(rotaAddress).hash);
    await expect(page.getByText("You no longer have access to this file.")).toBeVisible();
    await caption(page, "Opening the rota by its old address is refused.", 2200);
    await page.getByRole("link", { name: "Return to files" }).click();
    await showDrive(page);
    await page.getByRole("tab", { name: "My Drive" }).click();
    await expect(copyButton).toBeVisible();
    await caption(page, "His copy of the plot sheet is still in My Drive, with the note only he wrote.", 2400);
  } finally {
    server.stop();
  }
});
