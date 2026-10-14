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
    const paperBox = paper.getBoundingClientRect();
    const zoom = paperBox.width / paper.offsetWidth || 1;
    const style = getComputedStyle(content);
    const stage = document.querySelector(".document-stage")!.getBoundingClientRect();
    const dialog = document.querySelector(".page-setup-dialog")?.getBoundingClientRect();
    return {
      width: parseFloat(paper.style.getPropertyValue("--page-width")),
      height: parseFloat(paper.style.getPropertyValue("--page-height")),
      visualWide: paperBox.width > paperBox.height,
      headerText: header?.textContent ?? "",
      headerTop: header
        ? (header.getBoundingClientRect().top - pageBox.top) / zoom / 96
        : 0,
      textTop: (title.getBoundingClientRect().top - pageBox.top) / zoom / 96,
      padTop: parseFloat(style.paddingTop) / 96,
      titleOnPage: title.getBoundingClientRect().bottom <= pageBox.bottom + 1,
      pageInsideStage:
        paperBox.top >= stage.top - 1 &&
        paperBox.bottom <= stage.bottom + 1 &&
        paperBox.left >= stage.left - 1,
      pageBesideDialog: dialog ? paperBox.right <= dialog.left + 2 : true,
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

test("105-see-landscape", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Sam is laying out a wide sheet. She needs to see the page turn before she applies.",
    1800,
  );
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
  expect(started.visualWide).toBe(false);
  near(started.textTop, 1);
  near(started.headerTop, 0.75);

  await caption(page, "She opens Page setup. The page is Letter, taller than it is wide.", 1600);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup).toBeVisible();
  await showTop(page);
  await beat(page, 700);
  await expect(setup.getByRole("radio", { name: "Portrait" })).toBeChecked();
  await expect(page.locator(".paper-size-live")).toHaveText("Letter, 8.5 × 11 in");
  const before = await sheet(page);
  expect(before.width).toBeLessThan(before.height);
  expect(before.pageInsideStage).toBe(true);
  expect(before.pageBesideDialog).toBe(true);

  await caption(page, "She turns on Landscape. She has not applied.", 1400);
  await setup.getByRole("radio", { name: "Landscape" }).click();
  await expect.poll(async () => (await sheet(page)).width).toBe(1056);
  await expect.poll(async () => (await sheet(page)).height).toBe(816);
  const turned = await sheet(page);
  expect(turned.visualWide).toBe(true);
  expect(turned.titleOnPage).toBe(true);
  expect(turned.headerText).toBe("Town council");
  expect(turned.pageInsideStage).toBe(true);
  expect(turned.pageBesideDialog).toBe(true);
  near(turned.textTop, 1);
  await expect(setup.getByRole("radio", { name: "Landscape" })).toBeChecked();
  await expect(page.locator(".paper-size-live")).toHaveText("Letter, 11 × 8.5 in");
  await expect(setup).toBeVisible();
  await caption(
    page,
    "Before Apply, the page is wider than it is tall. The label says Letter, 11 × 8.5 in.",
    2800,
  );

  await caption(page, "Cancel puts the tall page back.", 1100);
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const restored = await sheet(page);
  expect(restored.width).toBe(816);
  expect(restored.height).toBe(1056);
  expect(restored.visualWide).toBe(false);
  near(restored.textTop, 1);
  await caption(page, "The page is portrait Letter again, 8.5 by 11 inches.", 1800);

  await caption(page, "She turns Landscape on again.", 1200);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup).toBeVisible();
  await showTop(page);
  await beat(page, 400);
  await setup.getByRole("radio", { name: "Landscape" }).click();
  await expect.poll(async () => (await sheet(page)).width).toBe(1056);
  const turning = await sheet(page);
  expect(turning.visualWide).toBe(true);
  expect(turning.pageInsideStage).toBe(true);
  await expect(page.locator(".paper-size-live")).toHaveText("Letter, 11 × 8.5 in");
  await caption(page, "The page turns wide again, before she applies.", 1800);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await page.getByLabel("Zoom").selectOption("50%");
  await showTop(page);
  const kept = await sheet(page);
  expect(kept.width).toBe(1056);
  expect(kept.height).toBe(816);
  expect(kept.visualWide).toBe(true);
  expect(kept.pageInsideStage).toBe(true);
  await caption(page, "Apply keeps the wide page she just saw.", 2000);

  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 600);
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(editor).toContainText("Minutes");
  await page.getByLabel("Zoom").selectOption("50%");
  await showTop(page);
  const reopened = await sheet(page);
  expect(reopened.width).toBe(1056);
  expect(reopened.height).toBe(816);
  expect(reopened.visualWide).toBe(true);
  expect(reopened.pageInsideStage).toBe(true);
  near(reopened.textTop, 1);
  await caption(page, "Saved and reopened. The page is still landscape.", 2000);

  await caption(page, "With the dialog open she chooses A4. Landscape stays on.", 1400);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup).toBeVisible();
  await showTop(page);
  await beat(page, 400);
  const paperSize = setup.getByLabel("Paper size");
  await paperSize.click();
  await beat(page, 300);
  await paperSize.selectOption("a4");
  await expect.poll(async () => (await sheet(page)).width).toBe(1123);
  await expect.poll(async () => (await sheet(page)).height).toBe(794);
  const a4 = await sheet(page);
  expect(a4.visualWide).toBe(true);
  expect(a4.titleOnPage).toBe(true);
  expect(a4.headerText).toBe("Town council");
  expect(a4.pageInsideStage).toBe(true);
  expect(a4.pageBesideDialog).toBe(true);
  await expect(setup.getByRole("radio", { name: "Landscape" })).toBeChecked();
  await expect(page.locator(".paper-size-live")).toHaveText("A4, 11.7 × 8.27 in");
  await expect(setup).toBeVisible();
  await caption(
    page,
    "Before Apply, the page is A4 and still wider than it is tall.",
    2400,
  );

  await caption(page, "The margin still moves. She sets it from 1 inch to 1.5.", 1400);
  await replaceField(page, "Top margin", "1.5");
  await expect.poll(async () => (await sheet(page)).textTop).toBeGreaterThan(1.3);
  await beat(page, 500);
  for (const label of ["Bottom margin", "Left margin", "Right margin"])
    await replaceField(page, label, "1.5");
  const moved = await sheet(page);
  near(moved.textTop, 1.5);
  near(moved.padTop, 1.5);
  near(moved.headerTop, 0.75);
  expect(moved.width).toBe(1123);
  expect(moved.height).toBe(794);
  expect(moved.headerText).toBe("Town council");
  await expect(setup.getByLabel("Paper size")).toBeInViewport();
  await expect(setup.getByRole("radio", { name: "Landscape" })).toBeInViewport();
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
    "The title moved in before Apply. Town council stayed put. Paper size, Landscape, the margin, and Apply are all on screen.",
    2800,
  );
});
