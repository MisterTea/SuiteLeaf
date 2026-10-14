import type { Page } from "@playwright/test";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";
import { ready } from "./fixtures";

/** Keep the caption above the tab row so the page and the letters stay visible. */
async function say(page: Page, text: string, hold = 1500) {
  await caption(page, text, 0);
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption") as HTMLElement | null;
    const tabs = document.querySelector(".doc-tab-bar");
    if (!bar) return;
    bar.style.top = "auto";
    bar.style.bottom = tabs
      ? `${window.innerHeight - tabs.getBoundingClientRect().top + 12}px`
      : "28px";
  });
  await beat(page, hold);
}

async function typeGrid(page: Page, rows: string[][]) {
  await selectCells(page, "A1");
  for (const row of rows) {
    for (const [index, value] of row.entries()) {
      await typeSlowly(page, value, 40);
      await page.keyboard.press(index < row.length - 1 ? "Tab" : "Enter");
    }
  }
}

async function fileTitles(page: Page) {
  const titles = await page.locator(".file-row a").allTextContents();
  return titles.map((title) => title.replace(/\s+/g, " ").trim()).sort();
}

/** The home screen keeps the file list under the templates, so bring it up. */
async function showFiles(page: Page) {
  const list = page.locator(".file-list");
  await expect(list).toBeVisible();
  await list.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await beat(page, 500);
}

test("149-write-each-member-the-same-letter", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Maya has one letter for every garden member. She wants to read them all, and she does not want them emailed.",
  );
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await ready(page);

  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Garden members");
  await caption(page, "The list is Name and Plot. Rosa is Sunny. Leo is Shade.", 900);
  await typeGrid(page, [
    ["Name", "Plot"],
    ["Rosa", "Sunny"],
    ["Leo", "Shade"],
  ]);
  await expect(page.locator(".sheet-host input.univer-size-full")).toHaveValue("A4");
  await caption(page, "Name, Plot, Rosa, Sunny, Leo, Shade. That is the whole list.", 1600);

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByRole("button", { name: "New document" })).toBeVisible();
  await page.getByRole("button", { name: "New document" }).click();
  await expect(title).toBeVisible();
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Plot letter");
  const body = page.getByRole("textbox", { name: "Document content" });
  await body.click({ position: { x: 160, y: 120 } });
  await typeSlowly(page, "Hello {{Name}}, your plot is {{Plot}}.");
  await expect(body).toContainText("Hello {{Name}}, your plot is {{Plot}}.");
  await say(page, "The letter says Hello {{Name}}, your plot is {{Plot}}.");

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await beat(page, 600);
  await page.getByRole("menuitem", { name: "Merge from a spreadsheet" }).click();
  const dialog = page.getByRole("dialog", { name: "Merge from a spreadsheet" });
  await expect(dialog).toContainText("Nothing is emailed");
  await expect(dialog.getByRole("radio", { name: "Garden members" })).toBeVisible();
  await say(page, "She merges from the Garden members spreadsheet. Nothing is emailed.", 1200);
  await dialog.getByRole("radio", { name: "Garden members" }).click();
  await beat(page, 700);
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();

  await expect(title).toHaveValue("Plot letter merged");
  await expect(body).toContainText("Hello Rosa, your plot is Sunny.");
  await expect(body).toContainText("Hello Leo, your plot is Shade.");
  await expect(page.locator(".manual-page-break")).toHaveCount(1);
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  const order = await page.locator(".document-content").evaluate((root) =>
    [...root.querySelectorAll("p, .manual-page-break")].map((el) =>
      el.classList.contains("manual-page-break") ? "break" : (el.textContent ?? ""),
    ),
  );
  const rosa = order.findIndex((line) => line.includes("Hello Rosa"));
  const gap = order.indexOf("break");
  const leo = order.findIndex((line) => line.includes("Hello Leo"));
  expect(rosa).toBeGreaterThanOrEqual(0);
  expect(gap).toBeGreaterThan(rosa);
  expect(leo).toBeGreaterThan(gap);

  await page.getByText("Hello Rosa, your plot is Sunny.").scrollIntoViewIfNeeded();
  await say(page, "Hello Rosa, your plot is Sunny.", 1600);
  await page.getByText("Hello Leo, your plot is Shade.").scrollIntoViewIfNeeded();
  await say(page, "Hello Leo, your plot is Shade. His letter starts on the next page.", 1800);

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByRole("link", { name: "Plot letter", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Garden members" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Plot letter merged" })).toBeVisible();
  const before = await fileTitles(page);
  expect(before.filter((name) => name.includes("merged"))).toEqual(["Plot letter merged"]);
  await showFiles(page);
  await caption(page, "The letter and the member list are still here, beside the merged letters.", 1800);

  await page.getByRole("link", { name: "Plot letter", exact: true }).click();
  await expect(body).toContainText("Hello {{Name}}, your plot is {{Plot}}.");
  await say(page, "The original letter still says {{Name}} and {{Plot}}.", 1400);

  await page.getByText("Hello {{Name}}, your plot is {{Plot}}.").click();
  await page.keyboard.press("ControlOrMeta+A");
  await typeSlowly(page, "Hello {{Bed}}, your plot is {{Plot}}.");
  await expect(body).toContainText("Hello {{Bed}}, your plot is {{Plot}}.");
  await expect(body).not.toContainText("{{Name}}");
  await say(page, "She changes the placeholder to {{Bed}}. The sheet has no Bed column.", 1500);

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Merge from a spreadsheet" }).click();
  await dialog.getByRole("radio", { name: "Garden members" }).click();
  await beat(page, 500);
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Bed is not a column.");
  await expect(title).toHaveValue("Plot letter");
  await say(page, "Bed is not a column. No new letter is created.", 2200);

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByRole("link", { name: "Plot letter merged" })).toBeVisible();
  expect(await fileTitles(page)).toEqual(before);
  await showFiles(page);
  await caption(page, "The library still has the same three files. Nothing was emailed.", 2200);
});
