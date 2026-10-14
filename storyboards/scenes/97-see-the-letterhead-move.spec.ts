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
    const footerTop = footer.getBoundingClientRect().top;
    const above = [...content.querySelectorAll("h1, p")].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.height > 0 && box.top >= pageBox.top - 1 && box.bottom <= footerTop + 1;
    });
    const last = above.at(-1);
    const gap = last
      ? (footerTop - last.getBoundingClientRect().bottom) / zoom / 96
      : null;
    return {
      headerTop: fromTop(header),
      headerBottom: (header.getBoundingClientRect().bottom - pageBox.top) / zoom / 96,
      textTop: fromTop(title),
      footerBottom: (pageBox.bottom - footer.getBoundingClientRect().bottom) / zoom / 96,
      padTop: parseFloat(style.paddingTop) / 96,
      padBottom: parseFloat(style.paddingBottom) / 96,
      gap,
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

async function showFooter(page: Page) {
  await page.locator(".document-stage").evaluate((stage) => {
    const footer = stage.querySelector(".page-footer");
    if (!(footer instanceof HTMLElement)) return;
    stage.scrollLeft = 0;
    const box = stage.getBoundingClientRect();
    const footerBox = footer.getBoundingClientRect();
    stage.scrollTop += footerBox.top - (box.top + box.height * 0.42);
  });
  await beat(page, 800);
}

async function replaceDistance(page: Page, label: string, value: string) {
  const field = page.getByRole("dialog", { name: "Page setup" }).getByLabel(label);
  await field.click();
  await field.press("ControlOrMeta+A");
  await beat(page, 250);
  await typeSlowly(page, value, 180);
  return field;
}

test("97-see-the-letterhead-move", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Sam is laying out the minutes. The footer will move before she applies.", 1700);
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

  await caption(page, "Page setup. A 1 inch margin, Town council, and Hearing notes.", 1400);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup).toBeVisible();
  for (const label of ["Top margin", "Bottom margin", "Left margin", "Right margin"]) {
    await setup.getByLabel(label).fill("1");
    await beat(page, 160);
  }
  const header = setup.getByLabel("Page header");
  await header.click();
  await typeSlowly(page, "Town council", 40);
  await beat(page, 200);
  const footer = setup.getByLabel("Page footer");
  await footer.click();
  await typeSlowly(page, "Hearing notes", 40);
  await beat(page, 200);
  await replaceDistance(page, "Footer from edge", "1");
  await beat(page, 300);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await editor.click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.insertText(
    `\n${Array.from({ length: 34 }, (_, index) => `Hearing note ${index + 1}.`).join("\n")}`,
  );
  await beat(page, 400);
  await showFooter(page);
  const started = await places(page);
  near(started.footerBottom, 1);
  await caption(page, "Hearing notes sits 1 inch from the bottom.", 1800);

  await caption(page, "She sets Footer from edge to 1.5 inches. The page is still open.", 1400);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup).toBeVisible();
  await showFooter(page);
  await beat(page, 700);
  await replaceDistance(page, "Footer from edge", "1.5");
  await expect(setup.getByLabel("Bottom margin")).toHaveValue("1");
  const footerNote = setup.getByText(
    "The footer is inside the text area, so the text moves up above it. The bottom margin does not change.",
  );
  await expect(footerNote).toBeVisible();
  const moved = await places(page);
  near(moved.footerBottom, 1.5);
  expect(moved.padBottom).toBeGreaterThan(1.5);
  expect(moved.gap).not.toBeNull();
  expect(moved.gap!).toBeGreaterThan(0.05);
  await expect(setup.getByLabel("Footer from edge")).toBeInViewport();
  await expect(setup.getByLabel("Bottom margin")).toBeInViewport();
  await expect(footerNote).toBeInViewport();
  await expect(setup.getByRole("button", { name: "Apply", exact: true })).toBeInViewport();
  await footerNote.hover();
  await beat(page, 400);
  await setup.getByLabel("Bottom margin").hover();
  await caption(
    page,
    "Hearing notes moved up before Apply. Bottom is still 1 inch, and the notes sit above it.",
    2600,
  );

  await caption(page, "Cancel puts the footer back.", 1200);
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setup).toBeHidden();
  await showFooter(page);
  const restored = await places(page);
  near(restored.footerBottom, 1);
  await caption(page, "Hearing notes is 1 inch from the bottom again.", 1800);

  await caption(page, "She sets 1.5 inches again, sees the page move, and applies.", 1400);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup).toBeVisible();
  await showFooter(page);
  await beat(page, 400);
  await replaceDistance(page, "Footer from edge", "1.5");
  await expect.poll(async () => (await places(page)).footerBottom).toBeGreaterThan(1.3);
  await beat(page, 900);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await showFooter(page);
  const kept = await places(page);
  near(kept.footerBottom, 1.5);
  expect(kept.gap).not.toBeNull();
  expect(kept.gap!).toBeGreaterThan(0.05);
  await caption(page, "Apply keeps the footer she just saw.", 1600);

  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 600);
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(editor).toContainText("Minutes");
  await showFooter(page);
  const reopened = await places(page);
  near(reopened.footerBottom, 1.5);
  await caption(page, "Saved and reopened. Hearing notes is still 1.5 inches from the edge.", 2000);

  await caption(page, "She sets Header from edge to half an inch.", 1400);
  await showTop(page);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup).toBeVisible();
  await showTop(page);
  await beat(page, 800);
  await setup.getByLabel("Header from edge").fill("0.5");
  await beat(page, 700);
  const raised = await places(page);
  near(raised.headerTop, 0.5);
  near(raised.textTop, 1);
  near(raised.padTop, 1);
  near(raised.footerBottom, 1.5);
  await expect(setup.getByLabel("Top margin")).toHaveValue("1");
  await expect(setup.getByText(/header is inside the text area/)).toHaveCount(0);
  await setup.getByLabel("Header from edge").hover();
  await caption(
    page,
    "Town council moved up before Apply. Minutes stays at the 1 inch margin.",
    2600,
  );
});
