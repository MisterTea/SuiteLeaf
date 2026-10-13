import type { Page } from "@playwright/test";
import { askAgent, beat, caption, clusterReady, describeRun, expect, startServer, test, typeSlowly } from "../harness";

const password = "garden-party-2026";

/** Leo's own files, in this browser's storage, before he connects. */
async function seedLocalFiles(page: Page) {
  await page.evaluate(async () => {
    const doc = (title: string, text: string, daysAgo: number) => {
      const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
      return {
        format: "suiteleaf",
        version: 1,
        id: crypto.randomUUID(),
        title,
        createdAt: at,
        updatedAt: at,
        kind: "doc",
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
      };
    };
    const files = [
      doc("Tomato planting notes", "Start seeds indoors in March.", 2),
      doc("Allotment wish list", "Rhubarb, a second water butt, a bench.", 5),
    ];
    const db = await new Promise<IDBDatabase>((done, fail) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onsuccess = () => done(open.result);
      open.onerror = () => fail(open.error);
    });
    const tx = db.transaction("encoded", "readwrite");
    for (const f of files)
      tx.objectStore("encoded").put({ id: f.id, title: f.title, updatedAt: f.updatedAt, native: JSON.stringify(f) });
    await new Promise((done, fail) => {
      tx.oncomplete = done;
      tx.onerror = () => fail(tx.error);
    });
    db.close();
  });
}

/** The person creates their account on the sign-in card (the assistant never types passwords). */
async function createAccount(page: Page, name: string, email: string) {
  const card = page.getByLabel("Sign in to SuiteLeaf");
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

type Item = { kind: string; name?: string; status?: string };
const agentItems = (page: Page) =>
  page.evaluate(() => (window as unknown as { __suiteleafAgent: { items: () => Item[] } }).__suiteleafAgent.items());

test.describe("cluster mode", () => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");

  test("22-connect-to-your-team-server-ai", async ({ page, baseURL }) => {
    const starting = startServer(undefined, [new URL(baseURL!).origin]);
    try {
      await page.goto("/");
      await expect(page.getByText("A workspace waiting for you")).toBeVisible();
      await seedLocalFiles(page);
      await page.reload();
      await expect(page.getByText("Your workspace, in this browser.")).toBeVisible();
      await page
        .getByRole("heading", { name: "Your files" })
        .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
      await expect(page.getByRole("link", { name: /Tomato planting notes/ })).toBeVisible();
      await caption(page, "Leo keeps his own files in SuiteLeaf, on this computer.", 1800);
      const server = await starting;
      const host = new URL(server.url).host;
      await caption(page, "The garden club now has a SuiteLeaf server. Leo asks the assistant to connect him.", 1800);

      const asking = askAgent(page, `The garden club has a SuiteLeaf server now. Connect me to it, the address is ${host}`);

      // The app reloads onto the server's sign-in card; the assistant carries on there.
      const card = page.getByLabel("Sign in to SuiteLeaf");
      await expect(card).toBeVisible({ timeout: 10 * 60_000 });
      await expect(card).toContainText(host);
      await expect(page.locator(".agent-sidebar")).toBeVisible();
      await expect
        .poll(
          async () => {
            const state = await page.locator(".agent-sidebar").getAttribute("data-agent-state");
            const items = await agentItems(page);
            const waiting = items.some((i) => i.name === "wait_for_sign_in" && i.status === "running");
            return waiting || state === "done" || state === "error";
          },
          { timeout: 10 * 60_000, intervals: [500] },
        )
        .toBe(true);
      await caption(page, "Only Leo types his password. It's his first time, so he creates an account.", 1600);
      await caption(page, "");
      await createAccount(page, "Leo Martins", "leo@riverside-garden.org");

      const run = await asking;
      const why = describeRun(run);
      expect(run.state, why).toBe("done");
      const connect = run.items.findIndex((i) => i.name === "connect_to_server" && i.status === "ok");
      expect(connect, why).toBeGreaterThanOrEqual(0);
      // The conversation survived the reload and Gemma carried on after it, ending with a reply in words.
      expect(run.items.length, why).toBeGreaterThan(connect + 1);
      const last = run.items.at(-1)!;
      expect(last.kind, why).toBe("assistant");
      expect(last.text, why).not.toMatch(/call:|tool_call/);

      await expect
        .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("suiteleaf:mode") ?? "null")), { message: why })
        .toEqual({ kind: "cluster", serverUrl: server.url });
      await expect(page.getByRole("heading", { name: "SuiteDrive" }), why).toBeVisible();
      await expect(page.getByText("YOUR TEAM WORKSPACE"), why).toBeVisible();
      await caption(page, "Signed in. Gemma carried on after the reload.", 2600);
      await caption(page, "");
      await page.getByRole("button", { name: "Close assistant" }).click();

      const chip = page.locator(".account-chip");
      await expect(chip, why).toContainText("Leo Martins");
      await expect(chip, why).toContainText(host);
      await expect(page.locator(".home").getByText("Connect to a server"), why).toHaveCount(0);
      const chipBox = (await chip.boundingBox())!;
      await page.mouse.move(chipBox.x + chipBox.width - 16, chipBox.y + 20, { steps: 15 });
      await caption(page, "The sidebar shows who he is and which server he's on, with Sign out and Disconnect.", 2400);

      await page
        .getByRole("heading", { name: "SuiteDrive" })
        .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
      await beat(page, 700);
      await expect(page.getByText("This folder is empty."), why).toBeVisible();
      await caption(page, "SuiteDrive, his drive on the server, is empty. New files he makes are saved here.", 2200);
      await expect(page.locator(".home").getByText("Tomato planting notes"), why).toHaveCount(0);
      await caption(page, "His own files aren't mixed in. They stay on this computer for when he disconnects.", 2400);
    } finally {
      (await starting).stop();
    }
  });
});
