import type { Page } from "@playwright/test";
import { serializeFile } from "../../packages/core/src";
import { minutesDocument } from "../../tests/odd-even-fixture";
import { beat, caption, expect, test, typeSlowly } from "./harness";

function face(page: Page, index: number) {
  return page.locator(".page-furniture-page").nth(index);
}

async function scrollInStage(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  align: "top" | "bottom",
) {
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption");
    if (bar) bar.style.visibility = "hidden";
  });
  await locator.evaluate((el, edge) => {
    const stage = el.closest(".document-stage") as HTMLElement | null;
    if (!stage) return;
    const rect = el.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    // Keep the footer well above the caption bar, which sits on the bottom of the viewport.
    const offset = edge === "top" ? 28 : Math.round(stageRect.height * 0.38);
    const top = stage.scrollTop + rect.top - stageRect.top - offset;
    stage.scrollTo({ top, behavior: "smooth" });
  }, align);
  await beat(page, 1100);
}

async function say(page: Page, text: string, hold = 1400) {
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption");
    if (bar) bar.style.visibility = "visible";
  });
  await caption(page, text, hold);
}

async function replaceField(page: Page, label: string, value: string) {
  const field = page.getByRole("dialog", { name: "Page setup" }).getByLabel(label);
  await field.scrollIntoViewIfNeeded();
  await field.click();
  await page.keyboard.press("ControlOrMeta+A");
  await typeSlowly(page, value, 45);
  await beat(page, 350);
}

test("62-odd-and-even-pages", async ({ page }) => {
  await page.goto("/");
  await say(
    page,
    "Ben is printing the minutes double-sided. Page 1 should stay the letterhead.",
  );
  await page.locator("input[type=file]").setInputFiles({
    name: "Minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutesDocument())),
  });
  await expect(page.locator(".editor-status")).toContainText("4 pages");
  await expect(face(page, 0).locator(".page-header")).toHaveText(
    "Riverside Garden Club",
  );
  await expect(face(page, 0)).toHaveAttribute("data-number-side", "none");
  await beat(page, 500);
  await say(page, "Different first page is already on. Page 1 is the letterhead, with no number.");

  await scrollInStage(page, face(page, 1).locator(".page-header"), "top");
  await expect(face(page, 1).locator(".page-header")).toHaveText("Garden club minutes");
  await expect(face(page, 1)).toHaveAttribute("data-header-align", "left");
  await say(page, "Pages 2 and 3 share one header, sitting on the left.");
  await scrollInStage(page, face(page, 1).locator(".page-number"), "bottom");
  await expect(face(page, 1)).toHaveAttribute("data-number-side", "right");
  await expect(face(page, 1).locator(".page-number")).toHaveText("2 / 4");
  await say(
    page,
    "The number is on the right. On the back of a sheet, that is the gutter.",
    1800,
  );

  await say(
    page,
    "Page setup. Different odd and even pages sits beside Different first page.",
    1100,
  );
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  const oddEven = setup.getByRole("checkbox", { name: "Different odd and even pages" });
  await expect(setup.getByRole("checkbox", { name: "Different first page" })).toBeChecked();
  await expect(oddEven).not.toBeChecked();
  await oddEven.scrollIntoViewIfNeeded();
  await beat(page, 600);
  await oddEven.check();
  await expect(setup.getByLabel("Even page header")).toHaveValue("Garden club minutes");
  await expect(setup.getByLabel("Odd page header")).toHaveValue("Garden club minutes");
  await expect(setup.getByLabel("Even page footer")).toHaveValue("Club copy");
  const preview = setup.getByRole("group", { name: "Page preview" });
  await preview.scrollIntoViewIfNeeded();
  await expect(preview).toContainText("Riverside Garden Club");
  await expect(preview).toContainText("No number");
  await expect(preview).toContainText("2 / 4 on the left");
  await expect(preview).toContainText("3 / 4 on the right");
  await say(
    page,
    "One tick. Page 2 keeps its title on the left. Page 3’s title moves to the right. Page 1 stays the letterhead.",
    2400,
  );

  await replaceField(page, "Even page header", "Minutes");
  await replaceField(page, "Odd page header", "Garden club");
  await say(page, "Minutes on even pages. Garden club on odd pages. The letterhead field is untouched.", 1500);
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();

  await scrollInStage(page, face(page, 0).locator(".page-header"), "top");
  await expect(face(page, 0).locator(".page-header")).toHaveText("Riverside Garden Club");
  await expect(face(page, 0)).toHaveAttribute("data-number-side", "none");
  await expect(face(page, 0).locator(".page-header")).not.toHaveText("Minutes");
  await say(page, "Page 1 is still the letterhead, and it still has no number.");

  await scrollInStage(page, face(page, 1).locator(".page-header"), "top");
  await expect(face(page, 1).locator(".page-header")).toHaveText("Minutes");
  await expect(face(page, 1)).toHaveAttribute("data-header-align", "left");
  await expect(face(page, 1).locator(".page-header")).not.toHaveText("Garden club");
  await say(page, "Page 2 says Minutes, on the left. Garden club is not here.");
  await scrollInStage(page, face(page, 1).locator(".page-number"), "bottom");
  await expect(face(page, 1)).toHaveAttribute("data-number-side", "left");
  await expect(face(page, 1).locator(".page-number")).toHaveText("2 / 4");
  await say(page, "And the even page number sits on the left, on the outside edge.", 2000);

  await scrollInStage(page, face(page, 2).locator(".page-header"), "top");
  await expect(face(page, 2).locator(".page-header")).toHaveText("Garden club");
  await expect(face(page, 2)).toHaveAttribute("data-header-align", "right");
  await expect(face(page, 2).locator(".page-header")).not.toHaveText("Minutes");
  await say(page, "Page 3 says Garden club, on the right. Minutes is not here.");
  await scrollInStage(page, face(page, 2).locator(".page-number"), "bottom");
  await expect(face(page, 2)).toHaveAttribute("data-number-side", "right");
  await expect(face(page, 2).locator(".page-number")).toHaveText("3 / 4");
  await say(page, "The odd page number sits on the right. Facing pages mirror.", 2000);

  await expect(page.getByRole("status")).toContainText("Saved");
  await say(page, "He closes the minutes and opens them again.", 900);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 500);
  await page.getByRole("link", { name: "Minutes", exact: true }).click();
  await expect(page.locator(".editor-status")).toContainText("4 pages");
  await expect(face(page, 0).locator(".page-header")).toHaveText("Riverside Garden Club");
  await expect(face(page, 1).locator(".page-header")).toHaveText("Minutes");
  await expect(face(page, 1)).toHaveAttribute("data-number-side", "left");
  await expect(face(page, 2).locator(".page-header")).toHaveText("Garden club");
  await expect(face(page, 2)).toHaveAttribute("data-header-align", "right");
  await expect(face(page, 2)).toHaveAttribute("data-number-side", "right");
  await scrollInStage(page, face(page, 2).locator(".page-header"), "top");
  await say(page, "Both headers, the letterhead, and the outside numbers came back.", 1800);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const again = page.getByRole("dialog", { name: "Page setup" });
  const box = again.getByRole("checkbox", { name: "Different odd and even pages" });
  await box.scrollIntoViewIfNeeded();
  await beat(page, 400);
  await box.uncheck();
  await expect(again.getByLabel("Header for later pages")).toHaveValue(
    "Garden club minutes",
  );
  await say(page, "Untick, and one shared header is ready for pages 2 and 3.", 1500);
  await again.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(again).toBeHidden();
  await scrollInStage(page, face(page, 0).locator(".page-header"), "top");
  await expect(face(page, 0).locator(".page-header")).toHaveText("Riverside Garden Club");
  await expect(face(page, 0)).toHaveAttribute("data-number-side", "none");
  await say(page, "Page 1’s letterhead is unchanged.");
  await scrollInStage(page, face(page, 1).locator(".page-header"), "top");
  await expect(face(page, 1).locator(".page-header")).toHaveText("Garden club minutes");
  await expect(face(page, 1)).toHaveAttribute("data-header-align", "left");
  await expect(face(page, 2).locator(".page-header")).toHaveText("Garden club minutes");
  await expect(face(page, 2)).toHaveAttribute("data-header-align", "left");
  await say(page, "Pages 2 and 3 share Garden club minutes again, on the left.", 1800);
  await scrollInStage(page, face(page, 1).locator(".page-number"), "bottom");
  await expect(face(page, 1)).toHaveAttribute("data-number-side", "right");
  await expect(face(page, 1).locator(".page-number")).toHaveText("2 / 4");
  await expect(face(page, 2)).toHaveAttribute("data-number-side", "right");
  await say(page, "And the numbers sit on the right again.", 2200);
});
