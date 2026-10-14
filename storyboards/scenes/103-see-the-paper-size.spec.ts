import { beat, caption, expect, test, typeSlowly } from "./harness";
import type { Page } from "@playwright/test";

const editorOf = (page: Page) =>
  page.getByRole("textbox", { name: "Document content" });

async function sheet(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement;
    const content = document.querySelector(".document-content") as HTMLElement;
    const header = paper.querySelector(".page-header") as HTMLElement | null;
    const title = content.querySelector("h1") as HTMLElement;
    const furniture = (header?.closest(".page-furniture-page") ??
      paper.querySelector(".page-furniture-page")) as HTMLElement;
    const pageBox = furniture.getBoundingClientRect();
    const zoom = paper.getBoundingClientRect().width / paper.offsetWidth || 1;
    const style = getComputedStyle(content);
    return {
      width: parseFloat(paper.style.getPropertyValue("--page-width")),
      height: parseFloat(paper.style.getPropertyValue("--page-height")),
      headerText: header?.textContent ?? "",
      headerTop: header
        ? (header.getBoundingClientRect().top - pageBox.top) / zoom / 96
        : 0,
      textTop: (title.getBoundingClientRect().top - pageBox.top) / zoom / 96,
      padTop: parseFloat(style.paddingTop) / 96,
      titleOnPage: title.getBoundingClientRect().bottom <= pageBox.bottom + 1,
      pageRight: paper.getBoundingClientRect().right,
      pageTop: paper.getBoundingClientRect().top,
      pageBottom: paper.getBoundingClientRect().bottom,
    };
  });
}

function near(actual: number, expected: number) {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(0.12);
}

async function showTop(page: Page) {
  await page.locator(".document-stage").evaluate((el) => {
    el.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  });
  await beat(page, 500);
}

async function replaceField(page: Page, label: string, value: string) {
  const field = page.getByRole("dialog", { name: "Page setup" }).getByLabel(label);
  await field.click();
  await field.press("ControlOrMeta+A");
  await beat(page, 180);
  await typeSlowly(page, value, 140);
  return field;
}

test("103-see-the-paper-size", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Sam's printer takes A4. She needs to see the page change before she applies.", 1800);
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Minutes");
  const editor = editorOf(page);
  await editor.click();
  await page.getByLabel("Paragraph style").selectOption("1");
  await typeSlowly(page, "Minutes", 70);
  await editor.press("Enter");
  await typeSlowly(page, "The hearing opens at seven.", 28);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await beat(page, 400);

  await caption(page, "Page setup. A 1 inch margin, and Town council on the letterhead.", 1400);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup).toBeVisible();
  await showTop(page);
  for (const label of ["Top margin", "Bottom margin", "Left margin", "Right margin"]) {
    await setup.getByLabel(label).fill("1");
    await beat(page, 120);
  }
  const header = setup.getByLabel("Page header");
  await header.click();
  await typeSlowly(page, "Town council", 40);
  await beat(page, 250);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const started = await sheet(page);
  expect(started.width).toBe(816);
  expect(started.height).toBe(1056);
  near(started.textTop, 1);
  near(started.headerTop, 0.75);
  await caption(page, "The page is Letter, 8.5 by 11 inches. Minutes starts 1 inch in.", 2000);

  await caption(page, "She opens Page setup again and chooses A4. She has not applied.", 1500);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup).toBeVisible();
  await showTop(page);
  await beat(page, 700);
  const paperSize = setup.getByLabel("Paper size");
  await expect(paperSize).toHaveValue("letter");
  await expect(page.locator(".paper-size-live")).toHaveText("Letter, 8.5 × 11 in");
  await paperSize.click();
  await beat(page, 400);
  await paperSize.selectOption("a4");
  await expect.poll(async () => (await sheet(page)).width).toBe(794);
  await expect.poll(async () => (await sheet(page)).height).toBe(1123);
  const grown = await sheet(page);
  expect(grown.titleOnPage).toBe(true);
  expect(grown.headerText).toBe("Town council");
  near(grown.headerTop, 0.75);
  await expect(paperSize).toHaveValue("a4");
  await expect(page.locator(".paper-size-live")).toHaveText("A4, 8.27 × 11.7 in");
  await expect(setup).toBeVisible();
  await caption(
    page,
    "Before Apply, the page is taller and a little narrower. Minutes is still on it.",
    2600,
  );

  await caption(page, "Cancel puts Letter back.", 1100);
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const restored = await sheet(page);
  expect(restored.width).toBe(816);
  expect(restored.height).toBe(1056);
  near(restored.textTop, 1);
  await caption(page, "The page is Letter again, 8.5 by 11 inches.", 1800);

  await caption(page, "She chooses A4 again, sees the page change, and applies.", 1400);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup).toBeVisible();
  await showTop(page);
  await beat(page, 400);
  await setup.getByLabel("Paper size").selectOption("a4");
  await expect.poll(async () => (await sheet(page)).height).toBe(1123);
  await beat(page, 900);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const kept = await sheet(page);
  expect(kept.width).toBe(794);
  expect(kept.height).toBe(1123);
  await caption(page, "Apply keeps the A4 page she just saw.", 1500);

  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 600);
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(editor).toContainText("Minutes");
  await showTop(page);
  const reopened = await sheet(page);
  expect(reopened.width).toBe(794);
  expect(reopened.height).toBe(1123);
  near(reopened.textTop, 1);
  await caption(page, "Saved and reopened. The page is still A4.", 1800);

  await caption(page, "The margin still moves. She sets it from 1 inch to 1.5.", 1400);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup).toBeVisible();
  await showTop(page);
  await beat(page, 400);
  await replaceField(page, "Top margin", "1.5");
  await expect.poll(async () => (await sheet(page)).textTop).toBeGreaterThan(1.3);
  await beat(page, 500);
  for (const label of ["Bottom margin", "Left margin", "Right margin"])
    await replaceField(page, label, "1.5");
  const moved = await sheet(page);
  near(moved.textTop, 1.5);
  near(moved.padTop, 1.5);
  near(moved.headerTop, 0.75);
  expect(moved.width).toBe(794);
  await expect(setup.getByLabel("Top margin")).toHaveValue("1.5");
  await caption(
    page,
    "The title moved in before Apply. Town council stayed where it was.",
    2200,
  );

  await caption(page, "Header from edge, 0.5 inches. Only the header should move.", 1400);
  await replaceField(page, "Header from edge", "0.5");
  await expect.poll(async () => (await sheet(page)).headerTop).toBeLessThan(0.62);
  const letterhead = await sheet(page);
  near(letterhead.headerTop, 0.5);
  near(letterhead.textTop, 1.5);
  expect(letterhead.headerText).toBe("Town council");
  await expect(setup.getByLabel("Paper size")).toBeInViewport();
  await expect(setup.getByLabel("Top margin")).toBeInViewport();
  await expect(setup.getByRole("button", { name: "Apply", exact: true })).toBeInViewport();
  const together = await page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper")!.getBoundingClientRect();
    const dialog = document.querySelector(".page-setup-dialog")!.getBoundingClientRect();
    const stage = document.querySelector(".document-stage")!.getBoundingClientRect();
    const body = document.querySelector(".page-setup-dialog .dialog-body") as HTMLElement;
    return {
      pageBesideDialog: paper.right <= dialog.left + 2,
      pageInsideStage: paper.top >= stage.top - 1 && paper.bottom <= stage.bottom + 1,
      dialogFits: body.scrollHeight <= body.clientHeight + 1,
    };
  });
  expect(together.pageBesideDialog).toBe(true);
  expect(together.pageInsideStage).toBe(true);
  expect(together.dialogFits).toBe(true);
  await caption(
    page,
    "Paper size, the margin, and Apply stay on screen together. The header moved. The title did not.",
    2600,
  );
});
