import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

function minutes(): DocFile {
  const file = createFile("doc", "Minutes") as DocFile;
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: 72,
        header: "Garden club minutes",
        footer: "",
        pageNumbers: true,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "October meeting" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "The committee agreed the budget for the new shed and set the date of the dinner.",
          },
        ],
      },
      { type: "pageBreak" },
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Plot assignments" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "North beds take the first twelve plots. South beds take the rest.",
          },
        ],
      },
    ],
  };
  return file;
}

async function openMinutes(page: Page) {
  const file = minutes();
  await page.goto("/");
  await expect(page.getByLabel("Search files")).toBeVisible();
  await page.evaluate(async (record) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("encoded", "readwrite");
        tx.objectStore("encoded").put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, {
    id: file.id,
    title: file.title,
    updatedAt: file.updatedAt,
    native: serializeFile(file),
  });
  await page.reload();
  const link = page.getByRole("link", { name: "Minutes" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(page.locator(".page-header")).toHaveCount(2);
}

async function showTop(page: Page) {
  await page.locator(".document-stage").evaluate((el) => {
    el.scrollTo({ top: 0, behavior: "smooth" });
  });
  await beat(page, 800);
}

async function showSeam(page: Page) {
  await page.locator(".page-header").nth(1).evaluate((el) => {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  await beat(page, 900);
}

async function showFooter(page: Page, index: number) {
  await page
    .locator(".page-furniture-page")
    .nth(index)
    .locator(".page-footer")
    .evaluate((el) => {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  await beat(page, 1000);
}

async function parkOnTitle(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  const box = await dialog.boundingBox();
  if (box) await page.mouse.move(box.x + 180, box.y + 28, { steps: 8 });
}

test("61-different-first-page", async ({ page }) => {
  await openMinutes(page);
  const headers = page.locator(".page-header");
  await caption(
    page,
    "Ben opens the minutes. One header and a page number sit on every page.",
    1400,
  );
  await showTop(page);
  await expect(headers.nth(0)).toHaveText("Garden club minutes");
  await expect(headers.nth(1)).toHaveText("Garden club minutes");
  await expect(page.locator(".page-number")).toHaveText(["1 / 2", "2 / 2"]);
  await caption(page, "Page 1 says “Garden club minutes” and “1 / 2”.", 900);
  await showSeam(page);
  await caption(page, "Page 2 repeats that header, and its footer says “2 / 2”.", 400);
  await showFooter(page, 1);
  await beat(page, 1400);

  await caption(
    page,
    "Page setup has one Different first page checkbox. It is in the dialog, not another menu.",
    1200,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup.getByLabel("Page header")).toHaveValue("Garden club minutes");
  await expect(setup.getByLabel("Page numbers")).toBeChecked();
  const different = setup.getByLabel("Different first page");
  await expect(different).not.toBeChecked();
  await beat(page, 700);
  await different.check();
  await parkOnTitle(page);
  await expect(setup.getByLabel("First page header")).toHaveValue("");
  await expect(setup.getByLabel("First page footer")).toHaveValue("");
  await expect(setup.getByText("Page 1 has no number. Page 2 shows 2.")).toBeVisible();
  await caption(
    page,
    "Ticking it clears page 1’s header and footer. Page 2 keeps its header, and page 1 gets no number.",
    1600,
  );
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  await expect(headers.nth(0)).toHaveText("");
  await expect(headers.nth(1)).toHaveText("Garden club minutes");
  await caption(page, "Page 1’s header is empty. The minutes themselves stay.", 1400);
  await showSeam(page);
  await expect(page.locator(".page-furniture-page").nth(0).locator(".page-number")).toHaveCount(0);
  await showFooter(page, 1);
  await expect(page.locator(".page-furniture-page").nth(1).locator(".page-number")).toHaveText("2 / 2");
  await caption(page, "Page 2 still says “Garden club minutes”. Its footer still says “2 / 2”.", 1800);

  await caption(page, "Untick the box. Page 1 uses the shared header again, in one step.", 900);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await beat(page, 500);
  await different.uncheck();
  await parkOnTitle(page);
  await beat(page, 1200);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await showTop(page);
  await expect(headers.nth(0)).toHaveText("Garden club minutes");
  await showFooter(page, 0);
  await expect(page.locator(".page-number").first()).toHaveText("1 / 2");
  await caption(page, "Page 1 shows “Garden club minutes” and “1 / 2” again.", 1500);

  await caption(page, "He ticks it again, and types the letterhead into the first-page header only.", 1100);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await different.check();
  const firstHeader = setup.getByLabel("First page header");
  await expect(firstHeader).toHaveValue("");
  await firstHeader.click();
  await typeSlowly(page, "Riverside Garden Club", 45);
  await beat(page, 900);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await showTop(page);
  await expect(headers.nth(0)).toHaveText("Riverside Garden Club");
  await expect(headers.nth(1)).toHaveText("Garden club minutes");
  await caption(page, "Page 1 is the club letterhead. Page 2 does not gain that line.", 1600);
  await showSeam(page);
  await showFooter(page, 0);
  await expect(page.locator(".page-furniture-page").nth(0).locator(".page-number")).toHaveCount(0);
  await caption(page, "The first-page footer has no number.", 1200);
  await showFooter(page, 1);
  await expect(page.locator(".page-furniture-page").nth(1).locator(".page-number")).toHaveText("2 / 2");
  await caption(page, "Page 2 still shows 2.", 1600);

  await expect(page.getByRole("status")).toContainText("Saved");
  await caption(page, "He reopens the file.", 800);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 600);
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await showTop(page);
  await expect(headers.nth(0)).toHaveText("Riverside Garden Club");
  await caption(page, "Page 1 is still the letterhead.", 1200);
  await showSeam(page);
  await expect(headers.nth(1)).toHaveText("Garden club minutes");
  await showFooter(page, 1);
  await expect(page.locator(".page-furniture-page").nth(0).locator(".page-number")).toHaveCount(0);
  await expect(page.locator(".page-furniture-page").nth(1).locator(".page-number")).toHaveText("2 / 2");
  await caption(page, "Page 2 still has the running header, and its number is still 2.", 2200);
});
