import type { Locator, Page } from "@playwright/test";
import { beat, caption, expect, test } from "./harness";

function text(content: string) {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 72,
    y: 180,
    width: 800,
    height: 120,
    content,
    fontSize: 64,
    bold: true,
    fontFamily: "Arial",
    color: "#1e293b",
    align: "left",
  };
}

function slide(title: string, notes?: string) {
  return {
    id: crypto.randomUUID(),
    title,
    layout: "title",
    background: { color: "#ffffff" },
    notes,
    elements: [text(title)],
  };
}

/** Welcome, a draft called Prices, and Thanks. */
function townHall() {
  const now = new Date().toISOString();
  const welcome = slide("Welcome", "Say hello.");
  const prices = slide("Prices", "Finish the draft later.");
  const thanks = slide("Thanks", "Wave.");
  const id = crypto.randomUUID();
  return JSON.stringify({
    format: "suiteleaf",
    version: 1,
    id,
    title: "Town hall",
    createdAt: now,
    updatedAt: now,
    kind: "slide",
    content: {
      id,
      width: 960,
      height: 540,
      slideOrder: [welcome.id, prices.id, thanks.id],
      slides: {
        [welcome.id]: welcome,
        [prices.id]: prices,
        [thanks.id]: thanks,
      },
    },
  });
}

async function pointAt(page: Page, target: Locator, dx = 0.5, dy = 0.5) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width * dx, box.y + box.height * dy, { steps: 12 });
}

async function openDeck(page: Page) {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles({
    name: "Town hall.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(townHall()),
  });
  await expect(page.getByLabel("File title")).toHaveValue("Town hall");
}

const rows = (page: Page) => page.locator(".thumbnail-row");
const show = (page: Page) => page.locator(".presenter-overlay");
const box = (page: Page) => show(page).locator(".presenter-slide-box");
const editorNumber = (page: Page) => page.locator(".slide-canvas .slide-number-chrome");
const showNumber = (page: Page) => box(page).locator(".slide-number-chrome");

async function advance(page: Page) {
  const slideBox = box(page);
  await pointAt(page, slideBox, 0.55, 0.5);
  await page.mouse.down();
  await page.mouse.up();
}

async function leaveShow(page: Page) {
  await page.keyboard.press("Escape");
  await expect(show(page)).toHaveCount(0);
}

async function presentFromStart(page: Page) {
  await page.locator(".slideshow-audience").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Slideshow options" }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Present from beginning" }).click();
  await expect(show(page)).toBeVisible();
}

async function numberClearsTitle(page: Page) {
  const title = page.locator(".slide-canvas .slide-text").first();
  const number = editorNumber(page);
  const titleBox = await title.boundingBox();
  const numberBox = await number.boundingBox();
  expect(titleBox).toBeTruthy();
  expect(numberBox).toBeTruthy();
  const overlaps = !(
    titleBox!.x + titleBox!.width <= numberBox!.x ||
    numberBox!.x + numberBox!.width <= titleBox!.x ||
    titleBox!.y + titleBox!.height <= numberBox!.y ||
    numberBox!.y + numberBox!.height <= titleBox!.y
  );
  expect(overlaps).toBe(false);
}

test("157-number-the-slides", async ({ page }) => {
  await page.addInitScript(() => {
    let current: Element | null = null;
    const change = (el: Element | null) => {
      current = el;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => current,
    });
    Element.prototype.requestFullscreen = function () {
      return change(this);
    };
    document.exitFullscreen = () => change(null);
  });

  await openDeck(page);
  await caption(page, "Nia opens the deck. No slide has a number.", 1600);
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator(".slide-number-chrome")).toHaveCount(0);
  await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Welcome");
  await beat(page, 500);

  await caption(page, "She turns slide numbers on. One control, no dialog.", 1100);
  const toggle = page.getByRole("button", { name: "Slide numbers" });
  await toggle.scrollIntoViewIfNeeded();
  await pointAt(page, toggle);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(editorNumber(page)).toHaveText("1 of 3");
  await expect(page.locator(".slide-canvas textarea")).toHaveCount(1);
  await numberClearsTitle(page);
  await pointAt(page, editorNumber(page));
  await beat(page, 1200);

  await caption(page, "Prices is 2 of 3. Thanks is 3 of 3. The titles stay clear.", 900);
  await rows(page).nth(1).click();
  await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Prices");
  await expect(editorNumber(page)).toHaveText("2 of 3");
  await numberClearsTitle(page);
  await pointAt(page, editorNumber(page));
  await beat(page, 1100);
  await rows(page).nth(2).click();
  await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Thanks");
  await expect(editorNumber(page)).toHaveText("3 of 3");
  await expect(page.locator(".slide-canvas textarea")).toHaveCount(1);
  await numberClearsTitle(page);
  await pointAt(page, editorNumber(page));
  await beat(page, 1200);

  await caption(page, "She skips Prices. It stays 2 of 3, and it is labeled Skipped.", 1100);
  await rows(page).nth(1).click();
  await page.getByRole("button", { name: "Skip slide" }).click();
  await expect(rows(page).nth(1)).toContainText("Skipped");
  await expect(page.locator(".thumbnail-skipped")).toHaveText("Skipped");
  await expect(editorNumber(page)).toHaveText("2 of 3");
  await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Prices");
  await pointAt(page, page.locator(".thumbnail-skipped"));
  await beat(page, 700);
  await pointAt(page, editorNumber(page));
  await beat(page, 1100);

  await caption(page, "Welcome is still 1 of 3. Thanks is still 3 of 3.", 900);
  await rows(page).nth(0).click();
  await expect(editorNumber(page)).toHaveText("1 of 3");
  await expect(rows(page).nth(0)).not.toContainText("Skipped");
  await pointAt(page, editorNumber(page));
  await beat(page, 900);
  await rows(page).nth(2).click();
  await expect(editorNumber(page)).toHaveText("3 of 3");
  await expect(rows(page).nth(2)).not.toContainText("Skipped");
  await pointAt(page, editorNumber(page));
  await beat(page, 1100);

  await caption(page, "From the start, the audience sees Welcome, then Thanks.", 1100);
  await presentFromStart(page);
  await expect(box(page).getByText("Welcome", { exact: true })).toBeVisible();
  await expect(box(page).getByText("Prices", { exact: true })).toHaveCount(0);
  await expect(showNumber(page)).toHaveText("1 of 3");
  await expect(show(page).locator(".presenter-counter")).toHaveText("Slide 1 of 2");
  await caption(page, "Welcome's corner says 1 of 3.", 400);
  await pointAt(page, showNumber(page));
  await beat(page, 2800);
  await advance(page);
  await expect(box(page).getByText("Thanks", { exact: true })).toBeVisible();
  await expect(box(page).getByText("Prices", { exact: true })).toHaveCount(0);
  await expect(box(page).getByText("Welcome", { exact: true })).toHaveCount(0);
  await expect(showNumber(page)).toHaveText("3 of 3");
  await expect(show(page).locator(".presenter-counter")).toHaveText("Slide 2 of 2");
  await caption(page, "Thanks' corner still says 3 of 3. Prices never appears.", 400);
  await pointAt(page, showNumber(page));
  await beat(page, 3200);
  await leaveShow(page);

  await caption(page, "She turns slide numbers off. The corners are empty. Prices stays skipped.", 1100);
  await toggle.scrollIntoViewIfNeeded();
  await pointAt(page, toggle);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".slide-number-chrome")).toHaveCount(0);
  await expect(rows(page).nth(1)).toContainText("Skipped");
  await beat(page, 900);

  await caption(page, "The show has no numbers either. Prices still does not appear.", 1100);
  await presentFromStart(page);
  await expect(box(page).getByText("Welcome", { exact: true })).toBeVisible();
  await expect(showNumber(page)).toHaveCount(0);
  await expect(box(page).getByText("Prices", { exact: true })).toHaveCount(0);
  await beat(page, 1000);
  await advance(page);
  await expect(box(page).getByText("Thanks", { exact: true })).toBeVisible();
  await expect(showNumber(page)).toHaveCount(0);
  await expect(box(page).getByText("Prices", { exact: true })).toHaveCount(0);
  await beat(page, 1100);
  await leaveShow(page);
  await expect(rows(page).nth(1)).toContainText("Skipped");

  await caption(page, "She turns the numbers on again and saves.", 1000);
  await toggle.scrollIntoViewIfNeeded();
  await pointAt(page, toggle);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await rows(page).nth(2).click();
  await expect(editorNumber(page)).toHaveText("3 of 3");
  await expect(page.locator(".save-status")).toContainText("Saved");
  await beat(page, 800);

  await caption(page, "She goes home and opens the deck again.", 1000);
  await page.getByRole("button", { name: "Back to files" }).click();
  const row = page.getByRole("link", { name: /Town hall/ });
  await expect(row).toBeVisible();
  await pointAt(page, row, 0.35);
  await row.click();
  await expect(page.getByLabel("File title")).toHaveValue("Town hall");
  await expect(page.getByRole("button", { name: "Slide numbers" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(rows(page).nth(1)).toContainText("Skipped");
  await expect(editorNumber(page)).toHaveText("1 of 3");
  await rows(page).nth(1).click();
  await expect(editorNumber(page)).toHaveText("2 of 3");
  await expect(page.locator(".thumbnail-skipped")).toHaveText("Skipped");
  await pointAt(page, editorNumber(page));
  await beat(page, 900);
  await rows(page).nth(2).click();
  await expect(editorNumber(page)).toHaveText("3 of 3");
  await beat(page, 800);

  await caption(page, "A show from the start is still Welcome, then Thanks.", 1100);
  await presentFromStart(page);
  await expect(box(page).getByText("Welcome", { exact: true })).toBeVisible();
  await expect(showNumber(page)).toHaveText("1 of 3");
  await expect(box(page).getByText("Prices", { exact: true })).toHaveCount(0);
  await caption(page, "Welcome's corner says 1 of 3.", 400);
  await pointAt(page, showNumber(page));
  await beat(page, 1600);
  await advance(page);
  await expect(box(page).getByText("Thanks", { exact: true })).toBeVisible();
  await expect(box(page).getByText("Prices", { exact: true })).toHaveCount(0);
  await expect(showNumber(page)).toHaveText("3 of 3");
  await caption(page, "Thanks stays 3 of 3, and Prices stays skipped.", 400);
  await pointAt(page, showNumber(page));
  await beat(page, 2800);
});
