import type { Page } from "@playwright/test";
import { askAgent, beat, caption, clusterReady, describeRun, expect, startServer, test, typeSlowly } from "../harness";

const password = "garden-party-2026";
const inventory = "3 spades, 2 rakes, 1 wheelbarrow.";

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

/** Note what the sign-in card says each time it shows, while the agent works (it may reload the page). */
function watchSignIn(page: Page) {
  const seen = new Set<string>();
  let stop = false;
  const done = (async () => {
    while (!stop) {
      const text = await page
        .locator(".sign-in-ended")
        .textContent({ timeout: 250 })
        .catch(() => null);
      if (text) seen.add(text);
      await page.waitForTimeout(250).catch(() => {});
    }
  })();
  return async () => {
    stop = true;
    await done;
    return [...seen];
  };
}

test.describe("cluster mode", () => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");

  test("26-sign-out-and-disconnect-ai", async ({ page }) => {
    await page.goto("/");
    const server = await startServer(undefined, [new URL(page.url()).origin]);
    const host = new URL(server.url).host;
    const serverSession = async (token: string) =>
      (await fetch(`${server.url}/api/auth/get-session`, { headers: { authorization: `Bearer ${token}` } })).json();
    try {
      await caption(page, "Leo keeps a personal to-do list on this computer.");
      await page.getByRole("button", { name: "New document" }).click();
      await page.getByLabel("File title").fill("Personal to-do");
      await page.getByRole("textbox", { name: "Document content" }).click();
      await typeSlowly(page, "Renew library card. Buy tomato stakes.");
      await expect(page.getByRole("status")).toHaveText("Saved on this device");
      await page.getByRole("button", { name: "Back to files" }).click();

      await caption(page, "He connects to the garden club's server to work on shared files.", 1000);
      await page.getByRole("button", { name: "Connect to a server" }).click();
      const dialog = page.getByRole("dialog", { name: "Connect to a SuiteLeaf server" });
      await dialog.getByLabel("Server address").fill(server.url);
      await dialog.getByRole("button", { name: "Connect", exact: true }).click();
      await createAccount(page, "Leo Martins", "leo@riverside-garden.org");
      await caption(page, "He asks the on-device assistant to start the club's shed inventory.", 1200);
      await caption(page, "", 0);

      const make = await askAgent(page, `Make a document called Shed inventory that says: ${inventory}`);
      let why = describeRun(make);
      expect(make.state, why).toBe("done");
      await expect(page.getByLabel("File title"), why).toHaveValue("Shed inventory");
      await expect(page.getByRole("textbox", { name: "Document content" }), why).toContainText(inventory);
      await expect(page.getByRole("status"), why).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
      await caption(page, "Gemma wrote it, and it saved itself to SuiteDrive on the server.", 2000);

      await page.getByRole("button", { name: "Close assistant" }).click();
      await page.getByRole("button", { name: "Back to files" }).click();
      await showDrive(page);
      await expect(driveItem(page, "Shed inventory.sldoc"), why).toBeVisible();
      await expect(page.getByText("Personal to-do")).toHaveCount(0);
      await caption(page, "SuiteDrive shows the club's files. His personal list isn't mixed in.", 1800);

      const token = await page.evaluate(() => JSON.parse(localStorage.getItem("suiteleaf:node-session")!).token as string);
      expect((await serverSession(token))?.user?.email).toBe("leo@riverside-garden.org");
      await caption(page, "Done for the day, he asks the assistant to sign him out and go back to his own computer.", 1400);
      await caption(page, "", 0);

      const signInCard = watchSignIn(page);
      const leave = await askAgent(page, "I'm done for today. Sign me out of the server and go back to working on this computer.");
      const cardSaid = await signInCard();
      why = describeRun(leave);
      expect(leave.state, why).toBe("done");

      // Signing out said it worked: on the sign-in card if Gemma signed out first, and in the notice after leaving.
      for (const said of cardSaid) expect(said, why).toBe(`You signed out of ${host}. Your SuiteDrive files stay on the server.`);
      await expect(page.getByText("Your workspace, in this browser."), why).toBeVisible();
      await expect(page.locator(".notice[role=status]"), why).toContainText(`Disconnected from ${host} and signed out.`);
      // The conversation carried on after the page reloaded: the disconnect finished and Gemma replied.
      const tools = leave.items.filter((i) => i.kind === "tool");
      expect(tools.find((i) => i.name === "disconnect")?.status, why).toBe("ok");
      expect(leave.items.at(-1)?.kind, why).toBe("assistant");
      await caption(page, "SuiteLeaf says where he is now, and that SuiteDrive files stayed on the server.", 2400);

      await page.getByRole("button", { name: "Close assistant" }).click();
      await page
        .getByRole("heading", { name: "Your files" })
        .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
      await beat(page, 700);
      await expect(page.getByRole("link", { name: /Personal to-do/ }), why).toBeVisible();
      await expect(page.getByText("Shed inventory"), why).toHaveCount(0);
      await caption(page, "His personal list is right where he left it. Shed inventory stays on the server.", 2200);
      expect(await page.evaluate(() => localStorage.getItem("suiteleaf:node-session")), why).toBeNull();
      expect(await serverSession(token), why).toBeNull();
      await caption(page, "This browser no longer holds his sign-in, and the server ended his session.", 2000);
    } finally {
      server.stop();
    }
  });
});
