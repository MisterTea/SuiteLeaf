import { test, expect, type Page } from "@playwright/test";

async function q3Deck(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New presentation" }).click();
  await page.getByLabel("File title").fill("Q3 update");
  await page.locator(".slide-element textarea").first().fill("Q3 update");
  await page.getByRole("button", { name: "Insert text box" }).click();
  await page.locator(".slide-element.selected textarea").fill("September");
  await page.getByRole("button", { name: "+ New slide" }).click();
  await page.getByRole("menuitem", { name: "Title & body" }).click();
  await page.locator(".slide-element textarea").first().fill("What changed");
  await page.getByRole("option", { name: "Slide 1: Q3 update" }).click();
}

test("fade in on click hides one object until the next slideshow click", async ({ page }) => {
  await q3Deck(page);
  await page.locator(".slide-canvas").click({ position: { x: 8, y: 8 } });
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Animation", exact: true }).hover();
  await expect(page.getByRole("menuitem", { name: "Fade in on click" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.locator(".slide-element textarea").nth(2).click();
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Animation", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Fade in on click" }).click();

  const marked = page.locator(".slide-element.has-fade-on-click");
  await expect(marked).toHaveCount(1);
  await expect(marked.locator("textarea")).toHaveValue("September");
  await expect(marked.locator("textarea")).toBeVisible();
  await expect(marked.locator(".fade-on-click-mark")).toHaveText("On click");
  await expect(page.locator(".slide-element textarea").first()).toHaveValue("Q3 update");

  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  const show = page.locator(".presenter-overlay");
  const box = show.locator(".presenter-slide-box");
  await expect(box.getByText("Q3 update")).toBeVisible();
  await expect(box.getByText("September")).toBeHidden();
  await expect(box.locator("[data-fade='hidden']")).toHaveCount(1);

  await box.click();
  await expect(show.getByText("Slide 1 of 2")).toBeVisible();
  await expect(box.getByText("September")).toBeVisible();
  await expect(box.locator(".fade-on-click-enter")).toHaveCount(1);
  await expect(box.getByText("Q3 update")).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(show.getByText("Slide 2 of 2")).toBeVisible();
  await expect(box.getByText("What changed")).toBeVisible();
  await expect(box.getByText("September")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(show).toHaveCount(0);
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: /Q3 update/ }).click();
  await expect(page.locator(".slide-element.has-fade-on-click textarea")).toHaveValue(
    "September",
  );
  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  await expect(box.getByText("September")).toBeHidden();
  await expect(box.getByText("Q3 update")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(box.getByText("September")).toBeVisible();
  await expect(show.getByText("Slide 1 of 2")).toBeVisible();
});
