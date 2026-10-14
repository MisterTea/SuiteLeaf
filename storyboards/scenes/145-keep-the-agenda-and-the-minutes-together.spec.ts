import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

/** Keep the caption above the tab row so the names stay on screen. */
async function say(page: Page, text: string, hold = 1400) {
  await caption(page, text, 0);
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption") as HTMLElement | null;
    const tabs = document.querySelector(".doc-tab-bar");
    if (!bar) return;
    bar.style.bottom = tabs
      ? `${window.innerHeight - tabs.getBoundingClientRect().top + 10}px`
      : "24px";
  });
  await beat(page, hold);
}

function plain(node: { text?: string; content?: unknown[] }): string {
  const kids = Array.isArray(node.content) ? node.content : [];
  return (
    (node.text ?? "") +
    kids
      .map((child) => plain(child as { text?: string; content?: unknown[] }))
      .join("")
  );
}

test("145-keep-the-agenda-and-the-minutes-together", async ({ page }) => {
  await page.goto("/");
  await say(page, "Maya is writing up the October garden club meeting.");
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await expect(title).toBeVisible();
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "October meeting");
  await expect(page.getByRole("tab", { name: "Document" })).toBeVisible();
  await say(page, "One document. The tab row is already along the bottom.", 1600);

  const tabName = page.getByLabel("Tab name");
  await tabName.click();
  await tabName.press("ControlOrMeta+A");
  await typeSlowly(page, "Agenda");
  await expect(page.getByRole("tab", { name: "Agenda" })).toBeVisible();
  await say(page, "She renames that tab Agenda, on the row itself.", 1200);

  const body = page.locator(".document-content");
  await body.click({ position: { x: 120, y: 100 } });
  await typeSlowly(page, "Call to order. Treasurer's report.");
  await expect(body).toContainText("Call to order. Treasurer's report.");
  await say(page, "The agenda goes on this tab.", 1400);

  await page.getByRole("button", { name: "Add tab" }).click();
  await expect(tabName).toHaveValue("Tab 2");
  await expect(body).not.toContainText("Call to order");
  await tabName.click();
  await tabName.press("ControlOrMeta+A");
  await typeSlowly(page, "Minutes");
  await expect(page.getByRole("tab", { name: "Minutes" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await say(page, "Add tab starts a blank page. She names it Minutes.", 1400);

  await body.click({ position: { x: 120, y: 100 } });
  await typeSlowly(page, "Voted to buy compost.");
  await expect(body).toContainText("Voted to buy compost.");
  await expect(body).not.toContainText("Call to order");
  await say(page, "The minutes stay on their own page.", 1400);

  await page.getByRole("tab", { name: "Agenda" }).click();
  await expect(body).toContainText("Call to order. Treasurer's report.");
  await expect(body).not.toContainText("compost");
  await say(page, "Back on Agenda. The compost vote is not on this page.", 1600);

  await page.getByRole("tab", { name: "Minutes" }).click();
  await expect(body).toContainText("Voted to buy compost.");
  await expect(body).not.toContainText("Call to order");
  await say(page, "Minutes still has the vote.", 1400);

  await say(page, "She downloads the file. Both tabs come with it.", 1200);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: /Download SuiteLeaf file/ }).click();
  const download = await downloadPromise;
  const saved = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(saved.kind).toBe("doc");
  expect(saved.version).toBe(1);
  expect(saved.tabTitle).toBe("Agenda");
  expect(saved.tabs).toHaveLength(1);
  expect(saved.tabs[0].title).toBe("Minutes");
  expect(plain(saved.content)).toContain("Call to order. Treasurer's report.");
  expect(plain(saved.content)).not.toContain("compost");
  expect(plain(saved.tabs[0].content)).toContain("Voted to buy compost.");
  expect(plain(saved.tabs[0].content)).not.toContain("Call to order");
  await beat(page, 800);
});
