import { beat, caption, expect, test, typeSlowly } from "./harness";

test("156-add-slide-shapes-and-notes", async ({ page }) => {
  await caption(
    page,
    "Dev creates a new presentation with speaker notes and layouts.",
    1600,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "New presentation" }).click();
  await page.locator(".slide-canvas").waitFor();
  await beat(page, 900);

  await caption(
    page,
    "He writes speaker notes to prepare for the live presentation.",
    1500,
  );
  const notesField = page.getByPlaceholder("Click to add speaker notes");
  if (await notesField.isVisible()) {
    await notesField.click();
    await typeSlowly(page, "Introduce the product launch and welcome attendees.", 35);
    await beat(page, 800);
  }

  await caption(
    page,
    "He adds a new Title & body slide to structure the agenda.",
    1500,
  );
  await page.getByRole("button", { name: "+ New slide" }).click();
  await beat(page, 700);
  await page.getByRole("menuitem", { name: "Title & body" }).click();
  await expect(page.locator(".thumbnail-row")).toHaveCount(2);
  await beat(page, 900);

  await caption(
    page,
    "Starting the slideshow lets the audience view full-bleed slides.",
    1500,
  );
  const showBtn = page.getByRole("button", { name: "Slideshow", exact: true });
  if (await showBtn.isVisible()) {
    await showBtn.click();
    const overlay = page.locator(".presenter-overlay, .slide-show-overlay");
    await expect(overlay).toBeVisible();
    await beat(page, 1000);

    // Toggle speaker notes with 's'
    await page.keyboard.press("s");
    await beat(page, 1000);

    // Advance slide
    await page.keyboard.press("ArrowRight");
    await beat(page, 800);

    // Exit slideshow
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
  }
  await beat(page, 1200);
});
