import type { Page } from "@playwright/test";
import { askAgent, beat, caption, clusterReady, describeRun, expect, startServer, test, typeSlowly } from "../harness";

const password = "garden-party-2026";
const subtitle = "Seeds $120 · Tools $85 · Compost $60";

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

const info = async (url: string) => (await fetch(`${url}/api/node/info`)).json();

test.describe("cluster mode", () => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");

  test("24-pick-up-on-another-server-ai", async ({ page }) => {
    await caption(page, "The garden club runs two SuiteLeaf servers: one at the office, one at the library.", 0);
    const office = await startServer();
    const library = await startServer({ dataDir: office.dataDir, p2p: office.p2p });
    const officeHost = new URL(office.url).host;
    const libraryHost = new URL(library.url).host;
    try {
      await page.goto(office.url);
      await caption(page, `Priya works on her talk at the office, on server ${officeHost}.`);
      await createAccount(page, "Priya Shah", "priya@riverside-garden.org");
      await expect(page.getByText("Connected to 1 other server")).toBeVisible({ timeout: 20000 });
      await caption(page, "The sidebar shows which server she's on, and that it shares files with one other.", 2200);
      await caption(page, "She asks the on-device assistant to start her budget slide.", 1200);
      await caption(page, "", 0);

      const make = await askAgent(
        page,
        `Make a presentation called Budget update with a title slide: Budget update, and the subtitle ${subtitle}.`,
      );
      let why = describeRun(make);
      expect(make.state, why).toBe("done");
      await expect(page.getByLabel("File title"), why).toHaveValue("Budget update");
      const boxes = page.locator(".slide-canvas .slide-element textarea");
      await expect(boxes.nth(0), why).toHaveValue("Budget update");
      await expect(boxes.nth(1), why).toHaveValue(subtitle);
      await expect(page.getByTitle(`Saving to SuiteDrive on ${officeHost}`), why).toBeVisible();
      await expect(page.getByRole("status"), why).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
      await caption(page, `Saved to SuiteDrive on ${officeHost}, as the top bar shows. She heads home.`, 2000);

      await expect
        .poll(async () => (await info(office.url)).suitedb.heads.join() === (await info(library.url)).suitedb.heads.join(), {
          timeout: 30000,
        })
        .toBe(true);
      await expect.poll(async () => (await info(library.url)).suitedrive.replicating, { timeout: 30000 }).toBe(0);

      await page.goto(library.url);
      const card = page.getByLabel("Sign in to SuiteLeaf");
      await expect(card).toContainText(libraryHost);
      await expect(card).toContainText("An account made on any of them works here.");
      await caption(page, `That evening she opens the team's other server, ${libraryHost}.`, 1600);
      await caption(page, "It's a new address, so she signs in. The card says her office account works here too.", 2200);
      await signIn(page, "priya@riverside-garden.org");
      await expect(page.getByText(libraryHost).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Budget update.slslides", exact: true })).toBeVisible();
      await caption(page, "She's in, and her presentation is already here. She asks the assistant to add one more cost.", 2200);
      await caption(page, "", 0);

      const edit = await askAgent(page, 'Open Budget update and add " · Hoses $40" to the end of the subtitle.');
      why = describeRun(edit);
      expect(edit.state, why).toBe("done");
      await expect(page.getByLabel("File title"), why).toHaveValue("Budget update");
      await expect(page.getByTitle(`Saving to SuiteDrive on ${libraryHost}`), why).toBeVisible();
      await expect(boxes.nth(0), why).toHaveValue("Budget update");
      await expect(boxes.nth(1), why).toHaveValue(`${subtitle} · Hoses $40`);
      await expect(page.getByRole("status"), why).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
      await page.getByRole("button", { name: "Close assistant" }).click();
      await beat(page, 500);
      await caption(page, `Gemma opened the office's file on ${libraryHost} and added the hoses. Saved on the library server.`, 2200);

      // The edit is on the server, in the same file: reopening shows it, and there's still just one Budget update.
      await page.reload();
      await expect(boxes.nth(1), why).toHaveValue(`${subtitle} · Hoses $40`);
      await page.getByRole("button", { name: "Back to files" }).click();
      await expect(page.locator(".drive-item").filter({ hasText: "Budget update" }), why).toHaveCount(1);
      await caption(page, "Every server in the cluster keeps a full copy, so her work follows her.", 2200);
    } finally {
      library.stop();
      office.stop();
    }
  });
});
