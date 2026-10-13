import type { Page } from "@playwright/test";
import { askAgent, beat, caption, clusterReady, describeRun, expect, startServer, test, typeSlowly } from "../harness";

const password = "garden-party-2026";
const rota = "Mon Rosa, Tue Leo, Wed Priya, Thu Sam.";

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

const driveItem = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** Scroll the home screen so the SuiteDrive file list is in view. */
async function showDrive(page: Page) {
  await page
    .getByRole("heading", { name: "SuiteDrive" })
    .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  await beat(page, 700);
}

test.describe("cluster mode", () => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");

  test("23-start-a-document-in-suitedrive-ai", async ({ page }) => {
    const server = await startServer();
    try {
      await page.goto(server.url);
      await caption(page, "Rosa opens her team's SuiteLeaf server in the browser and creates her account.");
      await createAccount(page, "Rosa Diaz", "rosa@riverside-garden.org");
      await expect(page.getByRole("heading", { name: "SuiteDrive" })).toBeVisible();
      await expect(page.getByText("This folder is empty.")).toBeVisible();
      await caption(page, "Her SuiteDrive is empty.", 1200);
      await caption(page, "She asks the on-device assistant to set up the garden club's watering rota.", 1000);

      const run = await askAgent(
        page,
        `Make a Garden club folder and start a document in it called Watering rota. It should say: ${rota}`,
      );
      const why = describeRun(run);
      expect(run.state, why).toBe("done");

      const editor = page.getByRole("textbox", { name: "Document content" });
      await expect(page.getByLabel("File title"), why).toHaveValue("Watering rota");
      await expect(editor, why).toContainText(/Mon Rosa.*Tue Leo.*Wed Priya.*Thu Sam/);
      await expect(page.getByRole("status"), why).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
      await caption(page, "Gemma made the folder and the document. It saved itself to SuiteDrive, with no Save button.", 2200);

      await page.getByRole("button", { name: "Close assistant" }).click();
      await caption(page, "Back to files takes her to the folder the document is in.", 1000);
      await page.getByRole("button", { name: "Back to files" }).click();
      await showDrive(page);
      await expect(page.getByLabel("Folder path"), why).toContainText("Garden club");
      const file = driveItem(page, "Watering rota.sldoc");
      await expect(file, why).toBeVisible();
      await file.hover();
      await caption(page, "\"Watering rota.sldoc\" is in Garden club, ready for the rest of the team.", 1800);

      await page.getByLabel("Folder path").getByRole("button", { name: "My Drive" }).click();
      await expect(driveItem(page, "Garden club"), why).toBeVisible();
      await expect(driveItem(page, "Watering rota.sldoc"), why).toHaveCount(0);
      await caption(page, "In My Drive there is just the Garden club folder.", 1600);
      await beat(page, 600);
    } finally {
      server.stop();
    }
  });
});
