import { test, expect, type Page } from "@playwright/test";

async function twoSlideDeck(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New presentation" }).click();
  await page.locator(".slide-element textarea").first().fill("Opening slide");
  await page
    .getByPlaceholder("Click to add speaker notes")
    .fill("Thank everyone for coming.");
  await page.getByRole("button", { name: "+ New slide" }).click();
  await page.getByRole("menuitem", { name: "Title & body" }).click();
  await expect(page.locator(".thumbnail-row")).toHaveCount(2);
  await page.locator(".slide-element textarea").first().fill("Second slide");
}

const fullscreen = (page: Page) =>
  page.evaluate(() => document.fullscreenElement !== null);

test("slideshow starts from the beginning, shows speaker notes, and uses real fullscreen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await twoSlideDeck(page);
  const show = page.locator(".presenter-overlay");

  await expect(
    page.getByRole("button", { name: "Slideshow", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Slideshow options" }).click();
  await page.getByRole("menuitem", { name: /Present from beginning/ }).click();
  await expect(show).toBeVisible();
  await expect(show).toContainText("Opening slide");
  await expect.poll(() => fullscreen(page)).toBe(true);

  const notes = show.getByRole("complementary", { name: "Speaker notes" });
  await expect(notes).toHaveCount(0);
  await page.keyboard.press("s");
  await expect(notes).toContainText("Thank everyone for coming.");
  await expect(notes).toContainText("Next: Second slide");
  await page.keyboard.press("ArrowRight");
  await expect(notes).toContainText("No speaker notes for this slide.");
  await expect(notes).toContainText("End of presentation");
  await page.keyboard.press("b");
  await expect(show.locator(".presenter-blank")).toBeVisible();
  await page.keyboard.press("b");
  await expect(show.locator(".presenter-blank")).toHaveCount(0);

  await page.evaluate(() => document.exitFullscreen());
  await expect(show).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Cmd/Ctrl+Enter presents from the current slide and Escape leaves fullscreen", async ({
  page,
}) => {
  await twoSlideDeck(page);
  const show = page.locator(".presenter-overlay");
  await page.locator(".thumbnail-row").nth(1).click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(show).toBeVisible();
  await expect(show).toContainText("Second slide");
  await expect(show.getByText("Slide 2 of 2")).toBeAttached();
  await expect.poll(() => fullscreen(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(show).toHaveCount(0);
  await expect.poll(() => fullscreen(page)).toBe(false);
});

test("slide text scales with the slide and controls hide until the mouse moves", async ({
  page,
}) => {
  await twoSlideDeck(page);
  await page.locator(".thumbnail-row").nth(0).click();
  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  const show = page.locator(".presenter-overlay");
  await expect(show).toBeVisible();
  // The title slide's heading is 44pt on a 960-wide deck, drawn at 0.95x as in the editor.
  const ratio = await page.evaluate(() => {
    const box = document.querySelector(".presenter-slide-box")!;
    const title = box.querySelector<HTMLElement>(".show-text")!;
    return (
      parseFloat(getComputedStyle(title).fontSize) /
      box.getBoundingClientRect().width
    );
  });
  expect(Math.abs(ratio / ((44 * 0.95) / 960) - 1)).toBeLessThan(0.02);

  const controls = show.locator(".presenter-controls");
  await expect(controls).toHaveClass(/hidden/, { timeout: 5000 });
  await page.mouse.move(300, 300);
  await page.mouse.move(320, 320);
  await expect(controls).toHaveClass(/visible/);
});
