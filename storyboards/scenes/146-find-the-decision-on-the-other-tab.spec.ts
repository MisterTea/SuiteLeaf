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

test("146-find-the-decision-on-the-other-tab", async ({ page }) => {
  await page.goto("/");
  await say(page, "Maya is looking for the vote. It is on the other tab.");
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await expect(title).toBeVisible();
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "October meeting");
  await expect(page.getByRole("tab", { name: "Document" })).toBeVisible();

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
  await say(page, "Call to order. Treasurer's report.", 1200);

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
  await say(page, "She adds a Minutes tab.", 1000);

  await body.click({ position: { x: 120, y: 100 } });
  await typeSlowly(page, "Voted to buy compost.");
  await expect(body).toContainText("Voted to buy compost.");
  await expect(body).not.toContainText("Call to order");
  await say(page, "The vote is written here. Voted to buy compost.", 1400);

  await page.getByRole("tab", { name: "Agenda" }).click();
  await expect(body).toContainText("Call to order. Treasurer's report.");
  await expect(body).not.toContainText("compost");
  await say(page, "She is looking at Agenda. Compost is not on this page.", 1600);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: /Find and replace/ }).click();
  const find = page.getByRole("search", { name: "Find and replace" });
  await expect(find).toBeVisible();
  await find.getByLabel("Find text").click();
  await say(page, "Find and replace. She types compost.", 700);
  await typeSlowly(page, "compost", 90);

  await expect(page.getByRole("tab", { name: "Minutes" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(body).toContainText("Voted to buy compost.");
  await expect(find).toContainText("on Minutes");
  await expect(body).not.toContainText("Call to order");
  await say(page, "Find opens Minutes and says the match is on that tab.", 2400);

  await page.getByRole("tab", { name: "Agenda" }).click();
  await expect(body).toContainText("Call to order. Treasurer's report.");
  await expect(body).not.toContainText("compost");
  await say(page, "Agenda is unchanged. The vote stayed on Minutes.", 2000);
});
