import type { Locator, Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

function text(content: string) {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 72,
    y: 168,
    width: 800,
    height: 140,
    content,
    fontSize: 72,
    bold: true,
    fontFamily: "Arial",
    color: "#1e293b",
    align: "center",
  };
}

function slide(title: string, word: string, notes?: string) {
  return {
    id: crypto.randomUUID(),
    title,
    layout: "title",
    background: { color: "#ffffff" },
    notes,
    elements: [text(word)],
  };
}

/** Welcome and Thanks each say Market. Prices, in the middle, does not. */
function townHall() {
  const now = new Date().toISOString();
  const welcome = slide("Welcome", "Market", "Say hello.");
  const prices = slide("Prices", "Prices", "Finish the draft later.");
  const thanks = slide("Thanks", "Market", "Wave.");
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
const canvas = (page: Page) => page.locator(".slide-canvas");
const word = (page: Page) => canvas(page).locator(".slide-text.find-match");
const findBar = (page: Page) => page.locator(".slide-find-bar");
const status = (page: Page) => page.locator(".slide-find-status");

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

/** The matched word is on screen and the find bar does not sit on top of it. */
async function wordStaysClear(page: Page) {
  const box = word(page);
  await expect(box.locator("textarea")).toHaveValue("Market");
  const wordBox = await box.boundingBox();
  const barBox = await findBar(page).boundingBox();
  expect(wordBox).toBeTruthy();
  expect(barBox).toBeTruthy();
  expect(overlaps(wordBox!, barBox!)).toBe(false);
  const viewport = page.viewportSize()!;
  expect(wordBox!.y).toBeGreaterThanOrEqual(0);
  expect(wordBox!.height).toBeGreaterThan(24);
  expect(wordBox!.y + wordBox!.height).toBeLessThanOrEqual(viewport.height);
  const captionBar = page.locator("#storyboard-caption");
  if (await captionBar.count()) {
    const captionBox = await captionBar.boundingBox();
    if (captionBox) expect(overlaps(wordBox!, captionBox)).toBe(false);
  }
}

test("171-find-across-the-deck", async ({ page }) => {
  await openDeck(page);
  await expect(rows(page)).toHaveCount(3);
  await expect(canvas(page).locator("textarea").first()).toHaveValue("Market");
  const storedX = await canvas(page).locator(".slide-text").first().getAttribute("data-x");
  const storedY = await canvas(page).locator(".slide-text").first().getAttribute("data-y");
  const snapshot = await page.locator(".slides-editor").getAttribute("data-deck-snapshot");
  expect(storedX).toBeTruthy();
  expect(storedY).toBeTruthy();
  expect(snapshot).toBeTruthy();
  await expect(page.locator("select.zoom-select")).toHaveValue("100%");
  await expect(page.locator(".slide-number-chrome")).toHaveCount(0);

  await caption(page, "Nia is on Prices, the middle slide. Market is on Welcome and on Thanks.", 1600);
  await pointAt(page, rows(page).nth(1));
  await rows(page).nth(1).click();
  await expect(rows(page).nth(1)).toHaveClass(/active/);
  await expect(canvas(page).locator("textarea").first()).toHaveValue("Prices");
  await beat(page, 700);

  await caption(page, "She opens Find and types Market. The deck jumps to Welcome, 1 of 2.", 900);
  const find = page.getByRole("button", { name: "Find", exact: true });
  await find.scrollIntoViewIfNeeded();
  await pointAt(page, find);
  await find.click();
  const field = page.getByLabel("Find text");
  await expect(field).toBeVisible();
  await field.click();
  await typeSlowly(page, "Market", 80);
  await expect(status(page)).toHaveText("1 of 2 on Welcome");
  await expect(rows(page).nth(0)).toHaveClass(/active/);
  await expect(canvas(page).locator("textarea").first()).toHaveValue("Market");
  await wordStaysClear(page);
  await expect(canvas(page).locator(".slide-text").first()).toHaveAttribute("data-x", storedX!);
  await expect(canvas(page).locator(".slide-text").first()).toHaveAttribute("data-y", storedY!);
  await expect(page.locator("select.zoom-select")).toHaveValue("100%");
  await expect(page.locator(".slide-number-chrome")).toHaveCount(0);
  await pointAt(page, status(page));
  await beat(page, 400);
  await pointAt(page, word(page));
  await beat(page, 1400);

  await caption(page, "Next goes to Thanks, the second Market, 2 of 2.", 900);
  const next = page.getByRole("button", { name: "Next match" });
  await pointAt(page, next);
  await next.click();
  await expect(status(page)).toHaveText("2 of 2 on Thanks");
  await expect(rows(page).nth(2)).toHaveClass(/active/);
  await expect(canvas(page).locator("textarea").first()).toHaveValue("Market");
  await wordStaysClear(page);
  await pointAt(page, word(page));
  await beat(page, 1400);

  await caption(page, "Next again wraps to the first Market, still 1 of 2 on Welcome.", 900);
  await pointAt(page, next);
  await next.click();
  await expect(status(page)).toHaveText("1 of 2 on Welcome");
  await expect(rows(page).nth(0)).toHaveClass(/active/);
  await wordStaysClear(page);
  await pointAt(page, word(page));
  await beat(page, 1200);

  await caption(page, "She searches for zzzz. There are no matches, and the words stay put.", 900);
  await field.click();
  await field.press("ControlOrMeta+A");
  await typeSlowly(page, "zzzz", 90);
  await expect(status(page)).toHaveText("No matches");
  await expect(rows(page).nth(0)).toHaveClass(/active/);
  await expect(canvas(page).locator("textarea").first()).toHaveValue("Market");
  await expect(page.locator(".slides-editor")).toHaveAttribute("data-deck-snapshot", snapshot!);
  await expect(canvas(page).locator(".slide-text").first()).toHaveAttribute("data-x", storedX!);
  await expect(canvas(page).locator(".slide-text").first()).toHaveAttribute("data-y", storedY!);
  await expect(page.locator("select.zoom-select")).toHaveValue("100%");
  await expect(page.locator(".slide-number-chrome")).toHaveCount(0);
  await pointAt(page, status(page));
  await beat(page, 1400);

  await caption(page, "She closes Find and stays on Welcome, where the last match was.", 900);
  const close = page.getByRole("button", { name: "Close find" });
  await pointAt(page, close);
  await close.click();
  await expect(findBar(page)).toHaveCount(0);
  await expect(rows(page).nth(0)).toHaveClass(/active/);
  await expect(canvas(page).locator("textarea").first()).toHaveValue("Market");
  await expect(page.locator(".slides-editor")).toHaveAttribute("data-deck-snapshot", snapshot!);
  await beat(page, 1200);
});
