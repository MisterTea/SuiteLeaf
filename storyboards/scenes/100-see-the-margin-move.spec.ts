import { beat, caption, expect, test, typeSlowly } from "./harness";
import type { Page } from "@playwright/test";

const editorOf = (page: Page) =>
  page.getByRole("textbox", { name: "Document content" });

async function places(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement;
    const content = document.querySelector(".document-content") as HTMLElement;
    const header = paper.querySelector(".page-header") as HTMLElement;
    const footer = paper.querySelector(".page-footer") as HTMLElement;
    const sheet = header.closest(".page-furniture-page") as HTMLElement;
    const title = content.querySelector("h1") as HTMLElement;
    const pageBox = sheet.getBoundingClientRect();
    const zoom = paper.getBoundingClientRect().width / paper.offsetWidth || 1;
    const fromTop = (el: HTMLElement) =>
      (el.getBoundingClientRect().top - pageBox.top) / zoom / 96;
    const style = getComputedStyle(content);
    return {
      headerTop: fromTop(header),
      textTop: fromTop(title),
      textLeft: (title.getBoundingClientRect().left - paper.getBoundingClientRect().left) / zoom / 96,
      footerBottom: (pageBox.bottom - footer.getBoundingClientRect().bottom) / zoom / 96,
      padTop: parseFloat(style.paddingTop) / 96,
      padLeft: parseFloat(style.paddingLeft) / 96,
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
  await beat(page, 700);
}

async function showPageBottom(page: Page) {
  await page.locator(".document-stage").evaluate((stage) => {
    const paper = stage.querySelector(".paginated-paper");
    if (!(paper instanceof HTMLElement)) return;
    stage.scrollLeft = 0;
    const box = stage.getBoundingClientRect();
    const paperBox = paper.getBoundingClientRect();
    stage.scrollTop += paperBox.bottom - (box.bottom - 120);
  });
  await beat(page, 800);
}

async function replaceField(page: Page, label: string, value: string) {
  const field = page.getByRole("dialog", { name: "Page setup" }).getByLabel(label);
  await field.click();
  await field.press("ControlOrMeta+A");
  await beat(page, 200);
  await typeSlowly(page, value, 160);
  return field;
}

test("100-see-the-margin-move", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Sam is widening the minutes. The margin will move before she applies.", 1700);
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
  await beat(page, 300);

  await caption(page, "Page setup. A 1 inch margin, and Town council half an inch from the top.", 1500);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup).toBeVisible();
  for (const label of ["Top margin", "Bottom margin", "Left margin", "Right margin"]) {
    await setup.getByLabel(label).fill("1");
    await beat(page, 140);
  }
  const header = setup.getByLabel("Page header");
  await header.click();
  await typeSlowly(page, "Town council", 40);
  await beat(page, 200);
  const footer = setup.getByLabel("Page footer");
  await footer.click();
  await typeSlowly(page, "Hearing notes", 40);
  await beat(page, 200);
  await replaceField(page, "Header from edge", "0.5");
  await beat(page, 250);
  await replaceField(page, "Footer from edge", "1");
  await beat(page, 250);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const started = await places(page);
  near(started.textTop, 1);
  near(started.headerTop, 0.5);
  await caption(page, "The title starts 1 inch in. Town council is half an inch from the top.", 2000);

  await caption(page, "She sets the margin to 1.5 inches. The dialog stays open.", 1400);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup).toBeVisible();
  await showTop(page);
  await beat(page, 500);
  await replaceField(page, "Top margin", "1.5");
  await expect.poll(async () => (await places(page)).textTop).toBeGreaterThan(1.3);
  await beat(page, 700);
  for (const label of ["Bottom margin", "Left margin", "Right margin"])
    await replaceField(page, label, "1.5");
  const moved = await places(page);
  near(moved.textTop, 1.5);
  near(moved.padTop, 1.5);
  near(moved.padLeft, 1.5);
  near(moved.headerTop, 0.5);
  near(moved.footerBottom, 1);
  for (const label of ["Top margin", "Bottom margin", "Left margin", "Right margin"])
    await expect(setup.getByLabel(label)).toHaveValue("1.5");
  await expect(setup.getByLabel("Header from edge")).toHaveValue("0.5");
  await setup.getByLabel("Top margin").hover();
  await caption(
    page,
    "The title moved in before Apply. Town council stays at half an inch, and the dialog still says 1.5.",
    2800,
  );

  await caption(page, "Cancel puts the title back.", 1200);
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const restored = await places(page);
  near(restored.textTop, 1);
  near(restored.padLeft, 1);
  near(restored.headerTop, 0.5);
  await caption(page, "The title is 1 inch in again. Town council did not move.", 2000);

  await caption(page, "She sets 1.5 inches again, sees the title move, and applies.", 1400);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup).toBeVisible();
  await showTop(page);
  await beat(page, 400);
  for (const label of ["Top margin", "Bottom margin", "Left margin", "Right margin"])
    await replaceField(page, label, "1.5");
  await expect.poll(async () => (await places(page)).textTop).toBeGreaterThan(1.3);
  const headerStill = await places(page);
  near(headerStill.headerTop, 0.5);
  await beat(page, 900);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showTop(page);
  const kept = await places(page);
  near(kept.textTop, 1.5);
  near(kept.headerTop, 0.5);
  await caption(page, "Apply keeps the wider margin she just saw.", 1600);

  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 600);
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(editor).toContainText("Minutes");
  await showTop(page);
  const reopened = await places(page);
  near(reopened.textTop, 1.5);
  near(reopened.padLeft, 1.5);
  near(reopened.headerTop, 0.5);
  await caption(page, "Saved and reopened. The margin is still 1.5 inches.", 2000);

  await caption(page, "Hearing notes is 1 inch from the bottom. Bottom is 1.5.", 1500);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup).toBeVisible();
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1.5");
  await showPageBottom(page);
  await beat(page, 900);
  await caption(page, "She sets Footer from edge to 1.5 inches.", 1200);
  await replaceField(page, "Footer from edge", "1.5");
  await expect.poll(async () => (await places(page)).footerBottom).toBeGreaterThan(1.3);
  const raised = await places(page);
  near(raised.footerBottom, 1.5);
  near(raised.headerTop, 0.5);
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1.5");
  const footerNote = setup.getByText(
    "The footer reaches the text, so the text stops above it. The bottom margin does not change.",
  );
  await expect(footerNote).toBeVisible();
  await expect(setup.getByLabel("Bottom margin")).toBeInViewport();
  await expect(setup.getByLabel("Footer from edge")).toBeInViewport();
  await expect(footerNote).toBeInViewport();
  await expect(setup.getByRole("button", { name: "Apply", exact: true })).toBeInViewport();
  const clear = await page.evaluate(() => {
    const body = document.querySelector(".page-setup-dialog .dialog-body") as HTMLElement;
    return body.scrollHeight <= body.clientHeight + 1;
  });
  expect(clear).toBe(true);
  await footerNote.hover();
  await beat(page, 400);
  await setup.getByLabel("Bottom margin").hover();
  await caption(
    page,
    "Hearing notes rose before Apply. Bottom is still 1.5 inches.",
    2800,
  );
});
