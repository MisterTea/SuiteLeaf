import type { Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

/** Keep the caption above the tab row, and clear of the history panel. */
async function say(page: Page, text: string, hold = 1400) {
  await caption(page, text, 0);
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption") as HTMLElement | null;
    const tabs = document.querySelector(".doc-tab-bar");
    const history = document.querySelector(".version-history");
    if (!bar) return;
    bar.style.bottom = tabs
      ? `${window.innerHeight - tabs.getBoundingClientRect().top + 10}px`
      : "24px";
    if (history) {
      const width = history.getBoundingClientRect().width;
      bar.style.left = `calc(50% - ${width / 2}px)`;
      bar.style.maxWidth = `calc(76% - ${width}px)`;
    }
  });
  await beat(page, hold);
}

async function saveNow(page: Page) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save now" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
}

/** Snapshot text for this file, newest writes included. */
async function versionNatives(page: Page) {
  return page.evaluate(async () => {
    const id = location.hash.split("/file/")[1]?.split(/[?#]/)[0];
    if (!id) return [];
    const rows = await new Promise<{ native: string }[]>((resolve, reject) => {
      const request = indexedDB.open("SuiteLeafVersions");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("versions", "readonly");
        const get = tx.objectStore("versions").index("fileId").getAll(id);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          resolve(get.result as { native: string }[]);
          db.close();
        };
      };
    });
    return rows.map((row) => row.native);
  });
}

test("148-see-the-vote-that-changed", async ({ page }) => {
  await page.goto("/");
  await say(page, "Maya is writing up the October garden club meeting.");
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await expect(title).toBeVisible();
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "October meeting");

  const tabName = page.getByLabel("Tab name");
  await tabName.click();
  await tabName.press("ControlOrMeta+A");
  await typeSlowly(page, "Agenda");
  await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();
  await say(page, "The first tab is the agenda.", 1200);

  const body = page.getByRole("textbox", { name: "Document content" });
  await body.click({ position: { x: 120, y: 100 } });
  await typeSlowly(page, "Call to order. Treasurer's report.");
  await expect(body).toContainText("Call to order. Treasurer's report.");
  await say(page, "Call to order, then the treasurer's report.", 1200);

  await page.getByRole("button", { name: "Add tab" }).click();
  await expect(tabName).toHaveValue("Tab 2");
  await expect(body).not.toContainText("Call to order");
  await tabName.click();
  await tabName.press("ControlOrMeta+A");
  await typeSlowly(page, "Minutes");
  await expect(page.getByRole("tab", { name: "Minutes" })).toHaveAttribute("aria-selected", "true");
  await body.click({ position: { x: 120, y: 100 } });
  await typeSlowly(page, "Voted to buy compost.");
  await expect(body).toContainText("Voted to buy compost.");
  await expect(body).not.toContainText("Call to order");
  await say(page, "The minutes record a vote to buy compost. She saves that version.", 1400);

  await saveNow(page);
  await expect.poll(async () => {
    const natives = await versionNatives(page);
    return natives.some(
      (native) =>
        native.includes("Call to order") &&
        native.includes("Voted to buy compost.") &&
        native.includes("Agenda") &&
        native.includes("Minutes"),
    );
  }).toBe(true);

  await body.click({ position: { x: 120, y: 100 } });
  await page.keyboard.press("ControlOrMeta+A");
  await typeSlowly(page, "Voted to buy mulch.");
  await expect(body).toContainText("Voted to buy mulch.");
  await expect(body).not.toContainText("compost");
  await say(page, "She changes only the minutes: compost becomes mulch.", 1400);

  await page.getByRole("tab", { name: "Agenda" }).click();
  await expect(body).toContainText("Call to order. Treasurer's report.");
  await expect(body).not.toContainText("mulch");
  await say(page, "The agenda is untouched. She saves again, still looking at it.", 1400);
  await saveNow(page);
  await expect.poll(async () => {
    const natives = await versionNatives(page);
    const hasCompost = natives.some((native) => native.includes("Voted to buy compost."));
    const hasMulch = natives.some(
      (native) => native.includes("Voted to buy mulch.") && !native.includes("compost"),
    );
    return hasCompost && hasMulch;
  }).toBe(true);

  await page.getByRole("button", { name: "Version history", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Version history" });
  await expect(panel.getByText("Current version")).toBeVisible();
  await say(page, "Version history. She selects the earlier save, from before the vote changed.", 1200);
  await panel.getByRole("button", { name: "Show earlier autosaves" }).click();
  const entries = panel.locator(".version-row.nested .version-entry");
  await expect(entries.first()).toBeVisible();
  const summary = panel.locator(".version-compare-summary");
  const earlier = await entries.count();
  for (let i = 0; i < earlier; i++) {
    await entries.nth(i).click();
    try {
      await expect(summary).toHaveText("1 paragraph changes on Minutes", { timeout: 4000 });
      break;
    } catch (error) {
      if (i === earlier - 1) throw error;
    }
  }
  await expect(summary).not.toContainText("Agenda");
  await expect(panel).not.toContainText("Nothing will change");
  await expect(panel).not.toContainText(/nothing changed/i);
  await say(page, "One paragraph changed, and the summary names Minutes. Agenda is not listed.", 1800);

  const preview = page.locator(".version-preview");
  const minutes = preview.getByRole("tab", { name: "Minutes" });
  if ((await minutes.getAttribute("aria-selected")) !== "true") await minutes.click();
  await expect(preview.locator("s").filter({ hasText: "compost" })).toBeVisible();
  await expect(preview.locator("u").filter({ hasText: "mulch" })).toBeVisible();
  await say(page, "On Minutes, compost is struck in red and mulch is marked as added.", 1800);

  await preview.getByRole("tab", { name: "Agenda" }).click();
  const paper = preview.locator(".document-content");
  await expect(paper).toContainText("Call to order. Treasurer's report.");
  await expect(paper).not.toContainText("compost");
  await expect(paper).not.toContainText("mulch");
  await expect(paper.locator("s")).toHaveCount(0);
  await expect(paper.locator("u")).toHaveCount(0);
  await say(page, "Agenda is the same call to order. Nothing is struck or added.", 1800);

  await page.getByRole("button", { name: "Close version history" }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("tab", { name: "Minutes" }).click();
  await expect(body).toContainText("Voted to buy mulch.");
  await expect(body).not.toContainText("compost");
  await say(page, "She closes history and does not restore. The live minutes still say mulch.", 1600);
});
