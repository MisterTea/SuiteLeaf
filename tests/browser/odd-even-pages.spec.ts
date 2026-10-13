import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { serializeFile } from "../../packages/core/src";
import { minutesDocument } from "../odd-even-fixture";

async function openMinutes(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutesDocument())),
  });
  await expect(page.locator(".editor-status")).toContainText("4 pages");
}

function face(page: Page, index: number) {
  return page.locator(".page-furniture-page").nth(index);
}

test("odd and even pages keep the letterhead, mirror numbers, and survive reopen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  await openMinutes(page);
  await expect(face(page, 0).locator(".page-header")).toHaveText(
    "Riverside Garden Club",
  );
  await expect(face(page, 0)).toHaveAttribute("data-number-side", "none");
  await expect(face(page, 1).locator(".page-header")).toHaveText(
    "Garden club minutes",
  );
  await expect(face(page, 1)).toHaveAttribute("data-number-side", "right");
  await expect(face(page, 1).locator(".page-number")).toHaveText("2 / 4");
  await expect(face(page, 2)).toHaveAttribute("data-number-side", "right");

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  const first = setup.getByRole("checkbox", { name: "Different first page" });
  const oddEven = setup.getByRole("checkbox", {
    name: "Different odd and even pages",
  });
  await expect(first).toBeChecked();
  await expect(oddEven).not.toBeChecked();
  await oddEven.check();
  await expect(setup.getByLabel("Even page header")).toHaveValue(
    "Garden club minutes",
  );
  await expect(setup.getByLabel("Odd page header")).toHaveValue(
    "Garden club minutes",
  );
  await expect(setup.getByLabel("Even page footer")).toHaveValue("Club copy");
  await expect(setup.getByLabel("Odd page footer")).toHaveValue("Club copy");
  const preview = setup.getByRole("group", { name: "Page preview" });
  await expect(preview).toContainText("Riverside Garden Club");
  await expect(preview).toContainText("No number");
  await expect(preview).toContainText("2 / 4 on the left");
  await expect(preview).toContainText("3 / 4 on the right");
  await setup.getByLabel("Even page header").fill("Minutes");
  await setup.getByLabel("Odd page header").fill("Garden club");
  await setup.getByLabel("Even page footer").fill("Left edge");
  await setup.getByLabel("Odd page footer").fill("Right edge");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect(page.getByRole("status")).toContainText("Saved");

  await expect(face(page, 0).locator(".page-header")).toHaveText(
    "Riverside Garden Club",
  );
  await expect(face(page, 0)).toHaveAttribute("data-number-side", "none");
  await expect(face(page, 1).locator(".page-header")).toHaveText("Minutes");
  await expect(face(page, 1)).toHaveAttribute("data-header-align", "left");
  await expect(face(page, 1).locator(".page-footer-text")).toHaveText("Left edge");
  await expect(face(page, 1)).toHaveAttribute("data-number-side", "left");
  await expect(face(page, 1).locator(".page-number")).toHaveText("2 / 4");
  await expect(face(page, 2).locator(".page-header")).toHaveText("Garden club");
  await expect(face(page, 2)).toHaveAttribute("data-header-align", "right");
  await expect(face(page, 2).locator(".page-footer-text")).toHaveText("Right edge");
  await expect(face(page, 2)).toHaveAttribute("data-number-side", "right");
  await expect(face(page, 2).locator(".page-number")).toHaveText("3 / 4");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(saved.content.attrs.pageSettings).toMatchObject({
    differentFirstPage: true,
    differentOddEven: true,
    firstHeader: "Riverside Garden Club",
    header: "Garden club minutes",
    evenHeader: "Minutes",
    oddHeader: "Garden club",
    evenFooter: "Left edge",
    oddFooter: "Right edge",
  });

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes", exact: true }).click();
  await expect(page.locator(".editor-status")).toContainText("4 pages");
  await expect(face(page, 0).locator(".page-header")).toHaveText(
    "Riverside Garden Club",
  );
  await expect(face(page, 1).locator(".page-header")).toHaveText("Minutes");
  await expect(face(page, 1)).toHaveAttribute("data-number-side", "left");
  await expect(face(page, 2).locator(".page-header")).toHaveText("Garden club");
  await expect(face(page, 2)).toHaveAttribute("data-number-side", "right");

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const again = page.getByRole("dialog", { name: "Page setup" });
  await again
    .getByRole("checkbox", { name: "Different odd and even pages" })
    .uncheck();
  await again.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(face(page, 0).locator(".page-header")).toHaveText(
    "Riverside Garden Club",
  );
  await expect(face(page, 0)).toHaveAttribute("data-number-side", "none");
  await expect(face(page, 1).locator(".page-header")).toHaveText(
    "Garden club minutes",
  );
  await expect(face(page, 1).locator(".page-footer-text")).toHaveText("Club copy");
  await expect(face(page, 1)).toHaveAttribute("data-number-side", "right");
  await expect(face(page, 2).locator(".page-header")).toHaveText(
    "Garden club minutes",
  );
  await expect(face(page, 2)).toHaveAttribute("data-number-side", "right");

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const remembered = page.getByRole("dialog", { name: "Page setup" });
  await remembered
    .getByRole("checkbox", { name: "Different odd and even pages" })
    .check();
  await expect(remembered.getByLabel("Even page header")).toHaveValue("Minutes");
  await expect(remembered.getByLabel("Odd page header")).toHaveValue(
    "Garden club",
  );
  await remembered.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(errors).toEqual([]);
});
