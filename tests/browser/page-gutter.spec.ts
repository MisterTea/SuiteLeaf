import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createFile, serializeFile } from "../../packages/core/src";

const filler =
  "The committee agreed the rainwater tanks, the shed roof, and the harvest supper, and this sentence runs out to the outside margin of the page. ";

function paragraph(text: string) {
  return {
    type: "paragraph",
    attrs: { textAlign: "justify" },
    content: [{ type: "text", text: `${text} ${filler}${filler}` }],
  };
}

async function column(page: Page, marker: string) {
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
    const headerIndex = needle.startsWith("EVEN") ? 1 : needle.startsWith("ODD") ? 2 : 0;
    const header = document.querySelectorAll(".page-header")[headerIndex] as HTMLElement;
    const footer = document.querySelectorAll(".page-footer")[headerIndex] as HTMLElement;
    const number = footer.querySelector("span:last-child") as HTMLElement;
    return {
      lineLeft: (line.left - paperBox.left) / scale,
      lineRight: (paperBox.right - line.right) / scale,
      blockLeft: (block.left - paperBox.left) / scale,
      blockRight: (paperBox.right - block.right) / scale,
      headerLeft: (header.getBoundingClientRect().left - paperBox.left) / scale,
      numberRight: (paperBox.right - number.getBoundingClientRect().right) / scale,
    };
  }, marker);
}

test("binding gutter swaps sides and survives reopen", async ({ page }) => {
  const file = createFile("doc", "Minutes");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: 72,
        header: "Garden club",
        footer: "Minutes",
        pageNumbers: true,
      },
    },
    content: [
      paragraph("COVER the minutes are stapled on the left."),
      { type: "pageBreak" },
      paragraph("EVEN page, the staple is on the right."),
      { type: "pageBreak" },
      paragraph("ODD page, the staple is on the left."),
    ],
  };
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await expect(page.locator(".page-furniture-page")).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  const beforeEven = await column(page, "EVEN");
  const beforeOdd = await column(page, "ODD");
  const beforeCover = await column(page, "COVER");
  expect(Math.abs(beforeEven.lineLeft - beforeOdd.lineLeft)).toBeLessThan(2);
  expect(Math.abs(beforeEven.blockRight - beforeOdd.blockRight)).toBeLessThan(2);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  const gutter = dialog.getByRole("spinbutton", { name: "Gutter (inches)" });
  await expect(gutter).toHaveValue("0");
  await expect(dialog.getByText("No extra room yet")).toBeVisible();
  await gutter.fill("2.5");
  await expect(dialog.getByText("larger than 2 inches is refused")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  await gutter.fill("0.5");
  await expect(dialog.getByText("Odd pages on the left")).toBeVisible();
  await expect(dialog.locator(".gutter-mini")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".doc-bind-odd").first()).toBeAttached();
  await expect(page.locator(".page-gutter-band")).toHaveCount(3);
  await expect(page.locator('[data-bind="odd"]').first()).toBeAttached();
  await expect(page.locator('[data-bind="even"]').first()).toBeAttached();

  const even = await column(page, "EVEN");
  const odd = await column(page, "ODD");
  const cover = await column(page, "COVER");
  expect(odd.lineLeft - beforeOdd.lineLeft).toBeGreaterThan(44);
  expect(odd.lineLeft - beforeOdd.lineLeft).toBeLessThan(52);
  expect(Math.abs(even.lineLeft - beforeEven.lineLeft)).toBeLessThan(3);
  expect(even.blockRight - beforeEven.blockRight).toBeGreaterThan(44);
  expect(even.blockRight - beforeEven.blockRight).toBeLessThan(52);
  expect(Math.abs(odd.blockRight - beforeOdd.blockRight)).toBeLessThan(3);
  expect(Math.abs(even.headerLeft - beforeEven.headerLeft)).toBeLessThan(3);
  expect(Math.abs(odd.numberRight - beforeOdd.numberRight)).toBeLessThan(3);
  expect(cover.lineLeft - beforeCover.lineLeft).toBeGreaterThan(44);
  expect(Math.abs(cover.blockRight - beforeCover.blockRight)).toBeLessThan(3);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await gutter.fill("0");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-gutter-band")).toHaveCount(0);
  await expect(page.locator(".doc-bind-odd")).toHaveCount(0);
  const restoredEven = await column(page, "EVEN");
  const restoredOdd = await column(page, "ODD");
  expect(Math.abs(restoredEven.lineLeft - restoredOdd.lineLeft)).toBeLessThan(2);
  expect(Math.abs(restoredEven.blockRight - beforeEven.blockRight)).toBeLessThan(3);
  expect(Math.abs(restoredOdd.lineLeft - beforeOdd.lineLeft)).toBeLessThan(3);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await gutter.fill("0.5");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("Saved");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(saved.content.attrs.pageSettings.gutter).toBe(48);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes", exact: true }).click();
  await expect(page.locator(".doc-bind-odd").first()).toBeAttached();
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(gutter).toHaveValue("0.5");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const reopened = await column(page, "ODD");
  expect(reopened.lineLeft - beforeOdd.lineLeft).toBeGreaterThan(44);
  const reopenedEven = await column(page, "EVEN");
  expect(Math.abs(reopenedEven.lineLeft - beforeEven.lineLeft)).toBeLessThan(3);
  expect(reopenedEven.blockRight - beforeEven.blockRight).toBeGreaterThan(44);
});
