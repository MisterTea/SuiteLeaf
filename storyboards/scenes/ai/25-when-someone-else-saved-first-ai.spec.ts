import type { Locator, Page } from "@playwright/test";
import { askAgent, beat, caption, clusterReady, describeRun, expect, startServer, test, typeSlowly } from "../harness";

const password = "garden-party-2026";

async function createAccount(page: Page, name: string, email: string) {
  const card = page.getByLabel("Sign in to SuiteLeaf");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Create an account" }).click();
  await card.getByLabel("Name", { exact: true }).click();
  await typeSlowly(page, name);
  await card.getByLabel("Email", { exact: true }).click();
  await typeSlowly(page, email);
  await card.getByLabel("Password", { exact: true }).click();
  await typeSlowly(page, password, 20);
  await card.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

/** Put the caret after the last character of a document and type there. */
async function typeAtEnd(page: Page, editor: Locator, text: string) {
  const line = (await editor.locator("p").last().boundingBox())!;
  await page.mouse.click(line.x + line.width - 4, line.y + line.height / 2);
  await page.keyboard.press("End");
  await typeSlowly(page, text);
}

/** Scroll the home screen so the SuiteDrive file list is in view. */
async function showDrive(page: Page) {
  await page
    .getByRole("heading", { name: "SuiteDrive" })
    .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  await beat(page, 700);
}

const driveItem = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** Save a new version of a file the way another person's app would. */
const saveElsewhere = (page: Page, name: string, from: string, to: string) =>
  page.evaluate(
    async ([name, from, to]) => {
      const s = JSON.parse(localStorage.getItem("suiteleaf:node-session")!);
      const headers = { authorization: `Bearer ${s.token}` };
      const { items } = await (await fetch(`${s.url}/api/drive/items`, { headers })).json();
      const id = items.find((i: { name: string }) => i.name === name).id;
      const url = `${s.url}/api/drive/items/${id}/content`;
      const text = await (await fetch(url, { headers })).text();
      const r = await fetch(url, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: text.replace(from, to),
      });
      if (!r.ok) throw new Error(`upload failed: ${r.status}`);
    },
    [name, from, to],
  );

/** Every file in SuiteDrive with its saved content, as the server has it. */
const driveFiles = (page: Page) =>
  page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem("suiteleaf:node-session")!);
    const headers = { authorization: `Bearer ${s.token}` };
    const { items } = await (await fetch(`${s.url}/api/drive/items`, { headers })).json();
    const files: Record<string, string> = {};
    for (const i of items as { id: string; name: string; kind: string }[])
      if (i.kind === "file")
        files[i.name] = await (await fetch(`${s.url}/api/drive/items/${i.id}/content`, { headers })).text();
    return files;
  });

test.describe("cluster mode", () => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");

  test("25-when-someone-else-saved-first-ai", async ({ page }) => {
    const server = await startServer();
    try {
      await page.goto(server.url);
      await caption(page, "Sam signs in to the garden club's server to write the bake sale flyer.");
      await createAccount(page, "Sam Okafor", "sam@riverside-garden.org");
      await caption(page, "He asks the on-device assistant to start the flyer.", 1000);

      const first = await askAgent(
        page,
        "Start a new document called Bake sale flyer that says: Bake sale on Saturday, 10 am to noon.",
      );
      const why1 = describeRun(first);
      expect(first.state, why1).toBe("done");
      const editor = page.getByRole("textbox", { name: "Document content" });
      const title = page.getByLabel("File title");
      const status = page.getByRole("status");
      await expect(title, why1).toHaveValue("Bake sale flyer");
      await expect(editor, why1).toContainText("Bake sale on Saturday, 10 am to noon.");
      await expect(status, why1).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
      await caption(page, "Gemma made the flyer, and it saved itself to SuiteDrive.", 1800);

      await caption(page, "Meanwhile, Jordan changes the time on their own computer and saves.", 1600);
      await saveElsewhere(page, "Bake sale flyer.sldoc", "10 am to noon", "9 am to 1 pm");
      await caption(page, "Sam doesn't know yet, and keeps typing.", 900);
      await typeAtEnd(page, editor, " All proceeds go to new raised beds.");

      const banner = page.getByText("This file was changed in SuiteDrive after you opened it");
      await expect(banner).toBeVisible({ timeout: 20000 });
      await expect(status).toHaveText("SuiteDrive has a newer version");
      await expect(page.getByRole("alert")).toContainText("A newer version was saved at");
      await caption(page, "SuiteLeaf won't overwrite Jordan's version. Sam's edits are safe on this device.", 2600);
      await caption(page, "Sam wants to keep both, with his own copy clearly named.", 1200);

      const second = await askAgent(
        page,
        "Jordan saved the flyer before me. Keep both versions, and name my copy \"Bake sale flyer (Sam's draft)\".",
      );
      const why2 = describeRun(second);
      expect(second.state, why2).toBe("done");
      await expect(banner, why2).toHaveCount(0);
      await expect(title, why2).toHaveValue("Bake sale flyer (Sam's draft)");
      await expect(editor, why2).toContainText("raised beds");
      await expect(status, why2).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
      await expect
        .poll(async () => Object.keys(await driveFiles(page)).sort(), { message: why2 })
        .toEqual(["Bake sale flyer (Sam's draft).sldoc", "Bake sale flyer.sldoc"]);
      let files = await driveFiles(page);
      expect(files["Bake sale flyer.sldoc"], why2).toContain("9 am to 1 pm");
      expect(files["Bake sale flyer.sldoc"], why2).not.toContain("raised beds");
      expect(files["Bake sale flyer (Sam's draft).sldoc"], why2).toContain("raised beds");
      await caption(page, "Gemma saved Sam's version as a copy and named it. Jordan's version is untouched.", 2200);

      await page.getByRole("button", { name: "Back to files" }).click();
      await showDrive(page);
      await expect(page.locator(".drive-list .drive-item")).toHaveCount(2);
      await expect(driveItem(page, "Bake sale flyer (Sam's draft).sldoc")).toBeVisible();
      await caption(page, "SuiteDrive now has Jordan's version and Sam's copy.", 2000);

      await caption(page, "Sam opens Jordan's version, with the new time.", 1000);
      await driveItem(page, "Bake sale flyer.sldoc").click();
      await expect(editor).toContainText("9 am to 1 pm");
      await beat(page, 1200);

      await caption(page, "While Sam adds a line, Jordan saves again first.", 1200);
      await saveElsewhere(page, "Bake sale flyer.sldoc", "Saturday", "Saturday 14 June");
      await typeAtEnd(page, editor, " Bring a cake!");
      await expect(banner).toBeVisible({ timeout: 20000 });
      await caption(page, "This time Jordan's version is the one to keep.", 1400);

      const third = await askAgent(page, "Jordan saved again. Throw away my change and take Jordan's version.");
      const why3 = describeRun(third);
      expect(third.state, why3).toBe("done");
      await expect(banner, why3).toHaveCount(0);
      await expect(editor, why3).toContainText("Saturday 14 June, 9 am to 1 pm");
      await expect(editor, why3).not.toContainText("Bring a cake!");
      await expect(status, why3).toHaveText("Saved to SuiteDrive");
      files = await driveFiles(page);
      expect(files["Bake sale flyer.sldoc"], why3).toContain("Saturday 14 June");
      expect(files["Bake sale flyer.sldoc"], why3).not.toContain("Bring a cake!");
      expect(files["Bake sale flyer (Sam's draft).sldoc"], why3).toContain("raised beds");
      await caption(page, "Gemma reloaded Jordan's version and dropped Sam's unsaved line, as he asked.", 2200);
      await caption(page, "Nothing was overwritten without Sam choosing.", 2400);
    } finally {
      server.stop();
    }
  });
});
