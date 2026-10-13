import type { Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

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

async function showText(page: Page, text: string) {
  await page
    .locator(".document-content p", { hasText: text })
    .first()
    .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  await beat(page, 900);
}

/** First-line inset from the paper edge, in CSS pixels. */
async function lineBox(page: Page, marker: string) {
  return page.evaluate((needle) => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement;
    const paperBox = paper.getBoundingClientRect();
    const scale = paperBox.width / paper.offsetWidth || 1;
    const el = [...document.querySelectorAll(".document-content p")].find((node) =>
      node.textContent?.includes(needle),
    ) as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(el);
    const line = range.getClientRects()[0];
    const block = el.getBoundingClientRect();
    const index = needle.startsWith("Even") ? 1 : needle.startsWith("Odd") ? 2 : 0;
    const header = document.querySelectorAll(".page-header")[index] as HTMLElement;
    const number = document.querySelectorAll(".page-footer")[index]?.querySelector(
      "span:last-child",
    ) as HTMLElement | null;
    return {
      lineLeft: (line.left - paperBox.left) / scale,
      blockRight: (paperBox.right - block.right) / scale,
      headerLeft: header ? (header.getBoundingClientRect().left - paperBox.left) / scale : 0,
      numberRight: number
        ? (paperBox.right - number.getBoundingClientRect().right) / scale
        : 0,
    };
  }, marker);
}

test("66-leave-room-for-the-binding", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Ben is printing the minutes double-sided, and stapling them on the left.",
    1800,
  );
  await newDocument(page, "Minutes");
  await typeSlowly(page, "Cover. These minutes are bound on the left.");
  await page.keyboard.press("Enter");
  await typeSlowly(
    page,
    "The club agreed on the tanks, the shed roof, and the harvest dinner.",
    16,
  );
  await caption(page, "The back of the sheet is page 2.", 1200);
  await page.getByRole("button", { name: "Page break", exact: true }).click();
  await beat(page, 400);
  await typeSlowly(page, "Even page. On this side the binding is on the right.");
  await page.keyboard.press("Enter");
  await typeSlowly(
    page,
    "The timber for the shed roof is ordered before the end of the month.",
    16,
  );
  await caption(page, "Page 3 is the front of the next sheet.", 1200);
  await page.getByRole("button", { name: "Page break", exact: true }).click();
  await beat(page, 400);
  await typeSlowly(page, "Odd page. The binding is on the left again.");
  await page.keyboard.press("Enter");
  await typeSlowly(
    page,
    "The seed swap is in November, after the harvest dinner.",
    16,
  );
  await expect(page.locator(".editor-status")).toContainText("3 pages");

  await showText(page, "Even page");
  await showText(page, "Odd page");
  const plainEven = await lineBox(page, "Even page");
  const plainOdd = await lineBox(page, "Odd page");
  expect(Math.abs(plainEven.lineLeft - plainOdd.lineLeft)).toBeLessThan(2);
  await caption(
    page,
    "Every page has the same gap on the left and the right. The first lines line up.",
    2200,
  );

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await setup.getByLabel("Page header").click();
  await typeSlowly(page, "Garden club");
  await setup.getByLabel("Page numbers").check();
  await caption(
    page,
    "The header sits on the left. Page numbers sit on the right. Gutter starts at 0.",
    2000,
  );
  const gutter = setup.getByRole("spinbutton", { name: "Gutter (inches)" });
  await expect(gutter).toHaveValue("0");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await showText(page, "Even page");
  const headedEven = await lineBox(page, "Even page");
  const headedOdd = await lineBox(page, "Odd page");
  await caption(page, "Page 2: the header is on the outside edge, the number on the inside.", 2000);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await gutter.click();
  await gutter.fill("3");
  await expect(setup.getByText("larger than 2 inches is refused")).toBeVisible();
  await expect(setup.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  await caption(
    page,
    "Three inches is refused, so the text cannot be pushed off the page.",
    2200,
  );
  await gutter.fill("0.5");
  await expect(setup.locator(".gutter-mini")).toHaveCount(2);
  await caption(
    page,
    "Half an inch. The preview puts the staple in the middle, and leaves the outside edge alone.",
    2600,
  );
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-gutter-band")).toHaveCount(3);

  await showText(page, "Odd page");
  const odd = await lineBox(page, "Odd page");
  expect(odd.lineLeft - plainOdd.lineLeft).toBeGreaterThan(44);
  expect(odd.lineLeft - plainOdd.lineLeft).toBeLessThan(52);
  expect(Math.abs(odd.numberRight - headedOdd.numberRight)).toBeLessThan(3);
  await caption(
    page,
    "Page 3 starts further from the left. Page 2's number sits beside the binding, not on the outside.",
    2600,
  );

  await showText(page, "Even page");
  const even = await lineBox(page, "Even page");
  expect(Math.abs(even.lineLeft - plainEven.lineLeft)).toBeLessThan(3);
  expect(Math.abs(even.headerLeft - headedEven.headerLeft)).toBeLessThan(3);
  expect(even.blockRight - plainEven.blockRight).toBeGreaterThan(44);
  await caption(
    page,
    "Page 2 keeps the header on the outside. The extra half inch is on the right.",
    2400,
  );

  await showText(page, "Cover");
  const cover = await lineBox(page, "Cover");
  expect(cover.lineLeft - plainOdd.lineLeft).toBeGreaterThan(40);
  await caption(
    page,
    "Page 1 is bound on the left too, so the gutter stays on the left.",
    2400,
  );

  await caption(page, "Setting the gutter back to 0 restores equal margins in one step.", 800);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await gutter.fill("0");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-gutter-band")).toHaveCount(0);
  await showText(page, "Even page");
  await showText(page, "Odd page");
  const clearedEven = await lineBox(page, "Even page");
  const clearedOdd = await lineBox(page, "Odd page");
  expect(Math.abs(clearedEven.lineLeft - clearedOdd.lineLeft)).toBeLessThan(2);
  await caption(page, "The lines line up again. The shaded binding room is gone.", 2400);

  await caption(page, "He puts the half inch back, then reopens the file.", 900);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await gutter.fill("0.5");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("Saved");
  await caption(page, "The file is saved. He closes it and opens it again.", 1200);
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 700);
  await page.getByRole("link", { name: "Minutes", exact: true }).click();
  await expect(page.locator(".page-gutter-band")).toHaveCount(3);
  await showText(page, "Odd page");
  const kept = await lineBox(page, "Odd page");
  expect(kept.lineLeft - plainOdd.lineLeft).toBeGreaterThan(44);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(gutter).toHaveValue("0.5");
  await caption(page, "The half inch is still there. The inside edges are still wider.", 2200);
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();
  await showText(page, "Even page");
  await caption(
    page,
    "The staple side of every sheet has an extra half inch. The outside edge does not.",
    2400,
  );
});
