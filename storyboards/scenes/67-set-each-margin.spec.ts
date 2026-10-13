import type { Locator, Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

/** A tenth of an inch, in CSS pixels. */
const tenth = 9.6;

const editorOf = (page: Page) =>
  page.getByRole("textbox", { name: "Document content" });

async function newDocument(page: Page, title: string) {
  await page.getByRole("button", { name: "New document" }).click();
  const box = page.getByLabel("File title");
  await expect(box).toBeVisible();
  await box.click();
  await box.press("ControlOrMeta+A");
  await typeSlowly(page, title);
  const editor = editorOf(page);
  await editor.click();
  return editor;
}

async function replaceField(page: Page, field: Locator, value: string) {
  await field.click();
  await field.press("ControlOrMeta+A");
  await typeSlowly(page, value, 90);
}

async function insets(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement;
    const content = document.querySelector(".document-content") as HTMLElement;
    const first = content.querySelector("h1, p") as HTMLElement;
    const zoom = Number(paper.style.zoom) || 1;
    const paperBox = paper.getBoundingClientRect();
    const line = first.getBoundingClientRect();
    const style = getComputedStyle(content);
    const pageHeight = parseFloat(paper.style.getPropertyValue("--page-height"));
    const pageBottom = paperBox.top + pageHeight * zoom;
    const range = document.createRange();
    range.selectNodeContents(content);
    const lines = [...range.getClientRects()].filter(
      (rect) =>
        rect.height > 2 &&
        rect.width > 20 &&
        rect.top >= paperBox.top - 1 &&
        rect.bottom <= pageBottom + 1,
    );
    const last = lines.reduce((best, rect) =>
      rect.bottom > best.bottom ? rect : best,
    );
    return {
      top: (line.top - paperBox.top) / zoom,
      left: (line.left - paperBox.left) / zoom,
      right: (paperBox.right - line.right) / zoom,
      padTop: parseFloat(style.paddingTop),
      padRight: parseFloat(style.paddingRight),
      padBottom: parseFloat(style.paddingBottom),
      padLeft: parseFloat(style.paddingLeft),
      lastToBottom: (pageBottom - last.bottom) / zoom,
      lastToTop: (last.top - paperBox.top) / zoom,
    };
  });
}

test("67-set-each-margin", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Ben is matching the town council template. The letterhead needs a deep top margin.",
  );
  const editor = await newDocument(page, "Minutes");
  await typeSlowly(page, "Town council minutes");
  await page.getByRole("combobox", { name: "Paragraph style" }).selectOption({
    label: "Heading 1",
  });
  await page.keyboard.press("Enter");
  await typeSlowly(page, "The title is in the top margin. ", 25);
  const body = Array.from(
    { length: 70 },
    (_, i) =>
      `Item ${i + 1}. The council approved the hall budget and set the next hearing.`,
  ).join(" ");
  await page.keyboard.insertText(body);
  await page.getByRole("button", { name: "Justify", exact: true }).click();
  await beat(page, 600);

  const before = await insets(page);
  expect(Math.abs(before.top - before.left)).toBeLessThan(tenth);
  expect(Math.abs(before.left - before.right)).toBeLessThan(tenth);
  expect(Math.abs(before.padTop - before.padBottom)).toBeLessThan(tenth);
  await caption(
    page,
    "One margin sets every edge, so the text starts the same distance from each side.",
    1800,
  );

  await caption(
    page,
    "Page setup has Top, Bottom, Left, and Right, in inches, and a preview of the edge he edits.",
    800,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  const top = setup.getByLabel("Top margin");
  const bottom = setup.getByLabel("Bottom margin");
  const left = setup.getByLabel("Left margin");
  const right = setup.getByLabel("Right margin");
  await expect(top).toHaveValue("0.75");
  await expect(bottom).toHaveValue("0.75");
  await expect(left).toHaveValue("0.75");
  await expect(right).toHaveValue("0.75");
  await beat(page, 900);

  await replaceField(page, top, "1.5");
  await expect(bottom).toHaveValue("0.75");
  await expect(left).toHaveValue("0.75");
  await expect(right).toHaveValue("0.75");
  await expect(setup.getByRole("img", { name: /Top 1\.5 in/ })).toBeVisible();
  await expect(setup.getByRole("status")).toHaveText(
    "Only the top margin changes.",
  );
  await caption(
    page,
    "Top is 1.5 inches. The preview grows at the top only. Bottom, left, and right stay 0.75.",
    2200,
  );

  await bottom.click();
  await beat(page, 500);
  await replaceField(page, left, "1");
  await expect(top).toHaveValue("1.5");
  await expect(bottom).toHaveValue("0.75");
  await expect(right).toHaveValue("0.75");
  await right.click();
  await caption(
    page,
    "Left is 1 inch. Bottom and right stay 0.75. Changing one edge leaves the others.",
    1800,
  );
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();

  await expect
    .poll(async () => (await insets(page)).padTop)
    .toBeGreaterThan(140);
  const after = await insets(page);
  expect(after.top).toBeGreaterThan(144 - tenth);
  expect(after.top).toBeLessThan(144 + tenth);
  expect(after.left).toBeGreaterThan(96 - tenth);
  expect(after.left).toBeLessThan(96 + tenth);
  expect(after.right).toBeGreaterThan(72 - tenth);
  expect(after.right).toBeLessThan(72 + tenth);
  expect(after.padBottom).toBeGreaterThan(72 - tenth);
  expect(after.padBottom).toBeLessThan(72 + tenth);
  expect(after.left).toBeGreaterThan(after.right);
  await page.locator(".document-stage").evaluate((el) =>
    el.scrollTo({ top: 0, behavior: "smooth" }),
  );
  await caption(
    page,
    "The first line sits further down, and the left gap is wider than the right.",
    2000,
  );

  await page.locator(".document-stage").evaluate((el) => {
    const stage = el as HTMLElement;
    const paper = document.querySelector(".paginated-paper") as HTMLElement;
    const zoom = Number(paper.style.zoom) || 1;
    const pageHeight = parseFloat(paper.style.getPropertyValue("--page-height"));
    const paperTop =
      paper.getBoundingClientRect().top -
      stage.getBoundingClientRect().top +
      stage.scrollTop;
    const page1Bottom = paperTop + pageHeight * zoom;
    stage.scrollTo({
      top: Math.max(0, page1Bottom - stage.clientHeight + 12),
      behavior: "smooth",
    });
  });
  await beat(page, 900);
  expect(after.lastToBottom).toBeLessThan(after.lastToTop);
  await caption(
    page,
    "On this page the last line sits closer to the bottom edge than to the top.",
    2200,
  );

  await caption(
    page,
    "He tries zero. A margin must be at least 0.25 inches, and Apply stays off.",
    500,
  );
  await page.locator(".document-stage").evaluate((el) =>
    el.scrollTo({ top: 0, behavior: "smooth" }),
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await replaceField(page, top, "0");
  await expect(setup.getByRole("alert")).toHaveText(
    "A margin must be at least 0.25 inches.",
  );
  const apply = setup.getByRole("button", { name: "Apply", exact: true });
  await expect(apply).toBeDisabled();
  await beat(page, 1800);
  await replaceField(page, top, "4");
  await expect(setup.getByRole("alert")).toHaveText(
    "A margin must be at most 3 inches.",
  );
  await expect(apply).toBeDisabled();
  await caption(
    page,
    "More than 3 inches is refused too. Nothing new is saved.",
    1800,
  );
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toContainText("Town council minutes");

  await expect(page.getByRole("status")).toContainText("Saved");
  await caption(page, "He closes the minutes and opens them again.", 700);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(editorOf(page)).toContainText("Town council minutes");
  const reopened = await insets(page);
  expect(reopened.top).toBeGreaterThan(144 - tenth);
  expect(reopened.left).toBeGreaterThan(96 - tenth);
  expect(reopened.right).toBeGreaterThan(72 - tenth);
  expect(reopened.padBottom).toBeGreaterThan(72 - tenth);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(page.getByLabel("Top margin")).toHaveValue("1.5");
  await expect(page.getByLabel("Bottom margin")).toHaveValue("0.75");
  await expect(page.getByLabel("Left margin")).toHaveValue("1");
  await expect(page.getByLabel("Right margin")).toHaveValue("0.75");
  await caption(
    page,
    "Top is still 1.5, bottom 0.75, left 1, and right 0.75.",
    2400,
  );
});
