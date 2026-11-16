import { fillSlideText } from "./slide-text-helpers";
import { test, expect, type Page } from "@playwright/test";

async function twoSlideDeck(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New presentation" }).click();
  await fillSlideText(
    page.locator(".slide-canvas .slide-text").first(),
    "Opening slide",
  );
  await page
    .getByPlaceholder("Click to add speaker notes")
    .fill("Thank everyone for coming.");
  await page.getByRole("button", { name: "+ New slide" }).click();
  await page.getByRole("menuitem", { name: "Title & body" }).click();
  await expect(page.locator(".thumbnail-row")).toHaveCount(2);
  await fillSlideText(
    page.locator(".slide-canvas .slide-text").first(),
    "Second slide",
  );
}

const fullscreen = (page: Page) =>
  page.evaluate(() => document.fullscreenElement !== null);

test("slideshow starts from the beginning, shows speaker notes, and uses real fullscreen", async ({
  page,
  isMobile,
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
  if (!isMobile) await expect.poll(() => fullscreen(page)).toBe(true);

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

  if (isMobile) await page.keyboard.press("Escape");
  else await page.evaluate(() => document.exitFullscreen());
  await expect(show).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Cmd/Ctrl+Enter presents from the current slide and Escape leaves fullscreen", async ({
  page,
  isMobile,
}) => {
  await twoSlideDeck(page);
  const show = page.locator(".presenter-overlay");
  await page.locator(".thumbnail-row").nth(1).click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(show).toBeVisible();
  await expect(show).toContainText("Second slide");
  await expect(show.getByText("Slide 2 of 2")).toBeAttached();
  if (!isMobile) await expect.poll(() => fullscreen(page)).toBe(true);
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
  // The title slide's heading is 44pt on a 960-wide deck, drawn at that point size,
  // then the whole drawing is scaled to the screen.
  const ratio = await page.evaluate(() => {
    const box = document.querySelector(".presenter-slide-box")!;
    const title = box.querySelector<HTMLElement>(".slide-text")!;
    const scale = title.getBoundingClientRect().width / title.offsetWidth;
    return (
      (parseFloat(getComputedStyle(title).fontSize) * scale) /
      box.getBoundingClientRect().width
    );
  });
  expect(Math.abs(ratio / (44 / 960) - 1)).toBeLessThan(0.02);

  const controls = show.locator(".presenter-controls");
  await expect(controls).toHaveClass(/hidden/, { timeout: 5000 });
  await page.mouse.move(300, 300);
  await page.mouse.move(320, 320);
  await expect(controls).toHaveClass(/visible/);
});

test("text selection in presentation mode is disabled to prevent shadow text", async ({
  page,
}) => {
  await twoSlideDeck(page);
  await page.locator(".thumbnail-row").nth(0).click();
  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  const show = page.locator(".presenter-overlay");
  await expect(show).toBeVisible();

  const userSelect = await page.evaluate(() => {
    const slideBox = document.querySelector(".presenter-slide-box") as HTMLElement;
    const textEl = document.querySelector(".presenter-overlay .slide-text") as HTMLElement;
    return {
      slideBox: window.getComputedStyle(slideBox).userSelect,
      textEl: textEl ? window.getComputedStyle(textEl).userSelect : null,
    };
  });
  expect(userSelect.slideBox).toBe("none");
  expect(userSelect.textEl).toBe("none");

  const slideBox = page.locator(".presenter-slide-box");
  const box = await slideBox.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3, { steps: 5 });
    await page.mouse.up();
  }
  const selectedText = await page.evaluate(() => window.getSelection()?.toString() || "");
  expect(selectedText).toBe("");

  // Notes panel retains selectable text for speaker copying
  await page.keyboard.press("s");
  const notesPanel = page.locator(".presenter-notes-panel");
  await expect(notesPanel).toBeVisible();
  const notesUserSelect = await page.evaluate(() => {
    const notes = document.querySelector(".presenter-notes-panel") as HTMLElement;
    return notes ? window.getComputedStyle(notes).userSelect : null;
  });
  expect(notesUserSelect).toBe("text");
});
